#!/usr/bin/env python3
"""
Camera Capture Processing Script
Captures frames from all calibrated cameras and processes each slot.
Uses simplified QR-based detection:
- Slot QR visible → EMPTY (tool missing, alarm)
- Worker QR visible → CHECKED_OUT (signed out)
- No QR visible → ITEM_PRESENT (tool covering slot QR)
"""

import cv2
import sys
import json
import logging
import numpy as np
import subprocess
from typing import Dict, List, Any, Tuple, Optional
from pathlib import Path
from datetime import datetime

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# GPIO Light Control Functions
def control_light(pin: int, state: str):
    """
    Control GPIO light strip
    
    Args:
        pin: GPIO pin number
        state: 'on' or 'off'
    """
    try:
        script_dir = Path(__file__).parent
        gpio_script = script_dir / "gpio_controller.py"
        
        # Use sudo for WS2812B /dev/mem access
        result = subprocess.run(
            ["sudo", sys.executable, str(gpio_script), "--pin", str(pin), "--action", state],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            logger.info(f"Light strip (GPIO {pin}): {state.upper()}")
        else:
            logger.warning(f"Light control failed: {result.stderr}")
    except Exception as e:
        logger.warning(f"Light control error: {e}")


class SlotProcessor:
    """Process individual tool slots with simplified QR-based detection"""
    
    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(exist_ok=True)
        
        # Initialize QR decoder
        self.qr_detector = cv2.QRCodeDetector()
    
    def extract_roi(self, frame: np.ndarray, region_coords: List[List[float]]) -> Optional[np.ndarray]:
        """
        Extract region of interest from frame using polygon coordinates
        
        Args:
            frame: Input frame
            region_coords: Polygon coordinates [[x1, y1], [x2, y2], ...]
            
        Returns:
            Cropped ROI or None if extraction fails
        """
        try:
            # Convert to numpy array
            pts = np.array(region_coords, dtype=np.int32)
            
            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(pts)
            
            # Ensure bounds are within frame
            x = max(0, x)
            y = max(0, y)
            w = min(w, frame.shape[1] - x)
            h = min(h, frame.shape[0] - y)
            
            if w <= 0 or h <= 0:
                logger.warning("Invalid ROI bounds")
                return None
            
            # Extract ROI
            roi = frame[y:y+h, x:x+w]
            
            return roi
            
        except Exception as e:
            logger.error(f"ROI extraction failed: {e}")
            return None
    
    def decode_qr(self, roi: np.ndarray) -> Optional[str]:
        """
        Decode QR code from ROI
        
        Args:
            roi: Region of interest image
            
        Returns:
            QR code data or None if not found
        """
        try:
            # Try multiple preprocessing approaches
            attempts = [
                roi,  # Original
                cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY),  # Grayscale
            ]
            
            for img in attempts:
                data, bbox, _ = self.qr_detector.detectAndDecode(img)
                if data and bbox is not None:
                    logger.debug(f"QR decoded: {data}")
                    return data
            
            return None
            
        except Exception as e:
            logger.error(f"QR decoding failed: {e}")
            return None
    
    def parse_qr_json(self, qr_raw: str) -> Optional[Dict]:
        """
        Parse QR code data as JSON
        
        Args:
            qr_raw: Raw QR code string
            
        Returns:
            Parsed JSON dict or None
        """
        try:
            return json.loads(qr_raw)
        except json.JSONDecodeError:
            logger.warning(f"QR data is not valid JSON: {qr_raw}")
            return None
    
    def determine_status(self, qr_data: Optional[str]) -> Tuple[str, bool, Optional[str]]:
        """
        Determine slot status using simplified QR-based logic
        
        Args:
            qr_data: Decoded QR data (JSON string)
            
        Returns:
            Tuple of (status, alert_triggered, worker_name)
        """
        # No QR detected → tool is covering the slot QR
        if not qr_data:
            return ("ITEM_PRESENT", False, None)
        
        # Parse QR JSON
        qr_json = self.parse_qr_json(qr_data)
        if not qr_json:
            # Invalid QR format, assume item present
            return ("ITEM_PRESENT", False, None)
        
        qr_type = qr_json.get('type')
        
        # Worker badge → checked out
        if qr_type == 'worker':
            worker_name = qr_json.get('worker_name', 'Unknown')
            return ("CHECKED_OUT", False, worker_name)
        
        # Slot QR → tool missing (alarm!)
        elif qr_type == 'slot':
            return ("EMPTY", True, None)
        
        # Unknown QR type
        else:
            logger.warning(f"Unknown QR type: {qr_type}")
            return ("ITEM_PRESENT", False, None)
    
    def process_slot(self, frame: np.ndarray, slot_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a single slot using simplified QR detection
        
        Args:
            frame: Camera frame
            slot_data: Slot configuration
            
        Returns:
            Processing result with status and metrics
        """
        slot_id = slot_data.get('id')
        slot_name = slot_data.get('slotId', slot_id)
        region_coords = slot_data.get('regionCoords', [])
        
        logger.info(f"Processing slot: {slot_name}")
        
        result = {
            'slotId': slot_id,
            'slotName': slot_name,
            'status': 'ITEM_PRESENT',  # Default
            'qrData': None,
            'workerName': None,
            'alertTriggered': False,
            'error': None
        }
        
        try:
            # Extract ROI
            roi = self.extract_roi(frame, region_coords)
            if roi is None:
                result['error'] = 'Failed to extract ROI'
                result['status'] = 'ERROR'
                return result
            
            # Save current ROI
            roi_path = self.data_dir / f"{slot_name}_last.png"
            cv2.imwrite(str(roi_path), roi)
            
            # Decode QR
            qr_data = self.decode_qr(roi)
            result['qrData'] = qr_data
            
            # Determine status using simplified logic
            status, alert_triggered, worker_name = self.determine_status(qr_data)
            result['status'] = status
            result['alertTriggered'] = alert_triggered
            result['workerName'] = worker_name
            
            logger.info(f"Slot {slot_name}: {status} (QR: {qr_data if qr_data else 'None'}, Alert: {alert_triggered})")
            
        except Exception as e:
            result['error'] = str(e)
            result['status'] = 'ERROR'
            logger.error(f"Slot {slot_name} processing error: {e}")
        
        return result


class CameraProcessor:
    """Process all cameras and their slots"""
    
    def __init__(self):
        self.slot_processor = SlotProcessor()
    
    def process_camera(self, camera_data: Dict[str, Any], slots: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Process a single camera and all its slots
        
        Args:
            camera_data: Camera configuration
            slots: List of slot configurations for this camera
            
        Returns:
            Processing result
        """
        camera_id = camera_data.get('id')
        device_index = camera_data.get('deviceIndex', 0)
        resolution = camera_data.get('resolution', [1920, 1080])
        homography = camera_data.get('homographyMatrix')
        
        logger.info(f"Processing camera: {camera_id} (device {device_index})")
        
        result = {
            'cameraId': camera_id,
            'status': 'success',
            'slotsProcessed': 0,
            'slotResults': [],
            'errors': []
        }
        
        # Check if calibrated
        if not homography:
            result['status'] = 'failed'
            result['errors'].append('Camera not calibrated (missing homography matrix)')
            logger.error(f"Camera {camera_id}: Not calibrated")
            return result
        
        try:
            # Open camera
            cap = cv2.VideoCapture(device_index)
            if not cap.isOpened():
                result['status'] = 'failed'
                result['errors'].append(f'Cannot open camera device {device_index}')
                logger.error(f"Camera {camera_id}: Cannot open device")
                return result
            
            # Set resolution
            width, height = resolution
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            
            # Capture frame
            ret, frame = cap.read()
            cap.release()
            
            if not ret or frame is None:
                result['status'] = 'failed'
                result['errors'].append('Failed to capture frame')
                logger.error(f"Camera {camera_id}: Frame capture failed")
                return result
            
            logger.info(f"Camera {camera_id}: Frame captured ({frame.shape})")
            
            # Process each slot
            for slot in slots:
                slot_result = self.slot_processor.process_slot(frame, slot)
                result['slotResults'].append(slot_result)
                result['slotsProcessed'] += 1
            
            logger.info(f"Camera {camera_id}: Processed {result['slotsProcessed']} slots")
            
        except Exception as e:
            result['status'] = 'failed'
            result['errors'].append(f'Processing exception: {str(e)}')
            logger.error(f"Camera {camera_id}: Exception: {e}")
        
        return result
    
    def process_all(self, cameras: List[Dict[str, Any]], 
                   slots_by_camera: Dict[str, List[Dict[str, Any]]],
                   light_strip_pin: Optional[int] = None) -> Dict[str, Any]:
        """
        Process all cameras
        
        Args:
            cameras: List of camera configurations
            slots_by_camera: Slots grouped by camera ID
            light_strip_pin: GPIO pin for LED light strip (optional)
            
        Returns:
            Overall processing result
        """
        logger.info(f"Starting capture processing for {len(cameras)} cameras")
        
        # Turn on light strip for consistent lighting
        if light_strip_pin:
            control_light(light_strip_pin, "on")
            import time
            time.sleep(0.5)  # Brief delay to let light stabilize
        
        results = []
        total_slots = 0
        total_cameras_success = 0
        total_cameras_failed = 0
        
        try:
            for camera in cameras:
                camera_id = camera.get('id')
                if not camera_id:
                    logger.warning("Camera missing 'id' field, skipping")
                    continue
                camera_slots = slots_by_camera.get(camera_id, [])
                
                result = self.process_camera(camera, camera_slots)
                results.append(result)
                
                total_slots += result['slotsProcessed']
                
                if result['status'] == 'success':
                    total_cameras_success += 1
                else:
                    total_cameras_failed += 1
        finally:
            # Always turn off light strip after captures
            if light_strip_pin:
                control_light(light_strip_pin, "off")
        
        overall_status = 'success'
        if total_cameras_failed > 0:
            if total_cameras_success == 0:
                overall_status = 'failure'
            else:
                overall_status = 'partial_failure'
        
        summary = {
            'status': overall_status,
            'camerasCaptured': total_cameras_success,
            'slotsProcessed': total_slots,
            'failureCount': total_cameras_failed,
            'results': results
        }
        
        logger.info(f"Processing complete: {overall_status} ({total_cameras_success} cameras, {total_slots} slots)")
        
        return summary


def main():
    """Main entry point"""
    try:
        # Read input data from stdin (JSON object with cameras and slots)
        input_data = sys.stdin.read()
        data = json.loads(input_data)
        
        cameras = data.get('cameras', [])
        slots_by_camera = data.get('slotsByCamera', {})
        light_strip_pin = data.get('lightStripPin')  # Optional GPIO pin for light strip
        
        # Process all cameras
        processor = CameraProcessor()
        results = processor.process_all(cameras, slots_by_camera, light_strip_pin)
        
        # Output results as JSON
        print(json.dumps(results))
        
        # Exit code based on status
        if results['status'] == 'failure':
            sys.exit(1)
        elif results['status'] == 'partial_failure':
            sys.exit(2)
        else:
            sys.exit(0)
        
    except Exception as e:
        error_result = {
            'status': 'failure',
            'error': str(e),
            'message': 'Capture processing script error'
        }
        print(json.dumps(error_result))
        logger.error(f"Processing script error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
