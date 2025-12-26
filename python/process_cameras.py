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
import time
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
    Control GPIO light strip via unified LED controller
    
    Args:
        pin: GPIO pin number
        state: 'on' or 'off'
    """
    try:
        script_dir = Path(__file__).parent
        led_controller = script_dir / "unified_led_controller.py"
        
        # Map 'on' to 'white' for the unified controller
        action = 'white' if state == 'on' else 'off'
        
        # Use sudo for WS2812B /dev/mem access with proper arguments
        result = subprocess.run(
            ["sudo", sys.executable, str(led_controller), "--pin", str(pin), "--action", action],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            logger.info(f"Light strip (GPIO {pin}): {state.upper()} (unified controller)")
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
    
    def extract_rectified_roi(self, frame: np.ndarray, region_coords: List[List[float]], 
                               width_cm: float, height_cm: float, 
                               px_per_cm: float = 31.8) -> Optional[np.ndarray]:
        """
        Extract and rectify region of interest using perspective transform.
        Creates a properly aligned rectangular view matching template dimensions.
        
        Args:
            frame: Input frame
            region_coords: Polygon coordinates [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
            width_cm: Expected width in centimeters
            height_cm: Expected height in centimeters
            px_per_cm: Output resolution in pixels per centimeter
            
        Returns:
            Rectified ROI with proper dimensions or None if extraction fails
        """
        try:
            if len(region_coords) != 4:
                logger.warning(f"Rectified ROI requires exactly 4 points, got {len(region_coords)}")
                return self.extract_roi(frame, region_coords)
            
            # Source points from the detected slot polygon (camera space)
            src_pts = np.array(region_coords, dtype=np.float32)
            
            # Destination points for rectified output
            out_width = int(width_cm * px_per_cm)
            out_height = int(height_cm * px_per_cm)
            
            dst_pts = np.array([
                [0, 0],
                [out_width, 0],
                [out_width, out_height],
                [0, out_height]
            ], dtype=np.float32)
            
            # Compute perspective transform matrix
            M = cv2.getPerspectiveTransform(src_pts, dst_pts)
            
            # Apply perspective transform to rectify the slot region
            rectified = cv2.warpPerspective(frame, M, (out_width, out_height))
            
            return rectified
            
        except Exception as e:
            logger.error(f"Rectified ROI extraction failed: {e}")
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
    
    def process_slot(self, frame: np.ndarray, slot_data: Dict[str, Any], 
                      linked_slots: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        Process a single slot using detection based on slot type
        
        Args:
            frame: Camera frame
            slot_data: Slot configuration
            linked_slots: Optional dict of linked slots (for scanner/worker grid pairing)
            
        Returns:
            Processing result with status and metrics
        """
        slot_id = slot_data.get('id')
        slot_name = slot_data.get('slotId', slot_id)
        region_coords = slot_data.get('regionCoords', [])
        slot_type = slot_data.get('slotType', 'tool')
        grid_metadata = slot_data.get('gridMetadata', [])
        
        logger.info(f"Processing slot: {slot_name} (type: {slot_type})")
        
        result = {
            'slotId': slot_id,
            'slotName': slot_name,
            'slotType': slot_type,
            'status': 'ITEM_PRESENT',  # Default
            'qrData': None,
            'workerName': None,
            'alertTriggered': False,
            'error': None
        }
        
        try:
            # For grid slots, use rectified ROI extraction for proper coordinate alignment
            is_grid_slot = slot_type in ('scanner_grid', 'worker_tag_grid')
            
            if is_grid_slot:
                width_cm = slot_data.get('widthCm', 32)
                height_cm = slot_data.get('heightCm', 16)
                px_per_cm = 31.8  # Standard resolution for grid processing
                
                roi = self.extract_rectified_roi(frame, region_coords, width_cm, height_cm, px_per_cm)
                if roi is None:
                    # Fall back to regular ROI extraction
                    roi = self.extract_roi(frame, region_coords)
            else:
                roi = self.extract_roi(frame, region_coords)
            
            if roi is None:
                result['error'] = 'Failed to extract ROI'
                result['status'] = 'ERROR'
                return result
            
            # Save current ROI
            roi_path = self.data_dir / f"{slot_name}_last.png"
            cv2.imwrite(str(roi_path), roi)
            
            # Branch based on slot type
            if slot_type == 'scanner_grid':
                # Use yellow color detection for scanner grids (ROI is already rectified)
                result = self.process_scanner_grid_slot(slot_data, roi, grid_metadata, linked_slots, is_rectified=True)
            elif slot_type == 'worker_tag_grid':
                # Use ArUco detection for worker tag grids (ROI is already rectified)
                result = self.process_worker_tag_grid_slot(slot_data, roi, grid_metadata, is_rectified=True)
            else:
                # Standard tool slot - use QR detection
                qr_data = self.decode_qr(roi)
                result['qrData'] = qr_data
                
                # Determine status using simplified logic
                status, alert_triggered, worker_name = self.determine_status(qr_data)
                result['status'] = status
                result['alertTriggered'] = alert_triggered
                result['workerName'] = worker_name
            
            logger.info(f"Slot {slot_name}: {result.get('status')} (type: {slot_type})")
            
        except Exception as e:
            result['error'] = str(e)
            result['status'] = 'ERROR'
            logger.error(f"Slot {slot_name} processing error: {e}")
        
        return result
    
    def process_scanner_grid_slot(self, slot_data: Dict[str, Any], roi: np.ndarray, 
                                   grid_metadata: List[Dict], 
                                   linked_slots: Optional[Dict[str, Dict[str, Any]]] = None,
                                   is_rectified: bool = False) -> Dict[str, Any]:
        """
        Process a scanner grid slot using yellow color detection
        
        Args:
            slot_data: Slot configuration
            roi: Region of interest image (rectified if is_rectified=True)
            grid_metadata: List of cell definitions
            linked_slots: Dict of linked slots keyed by slot ID
            is_rectified: Whether the ROI has been perspective-corrected
            
        Returns:
            Processing result with cell statuses
        """
        from scanner_color_detection import detect_yellow_in_cell
        
        slot_id = slot_data.get('id')
        slot_name = slot_data.get('slotId', slot_id)
        linked_slot_id = slot_data.get('linkedSlotId')
        
        result = {
            'slotId': slot_id,
            'slotName': slot_name,
            'slotType': 'scanner_grid',
            'status': 'OK',  # Overall grid status
            'cellResults': [],
            'alertTriggered': False,
            'missingCount': 0,
            'presentCount': 0,
            'checkedOutCount': 0,
            'error': None
        }
        
        # Get linked worker tag grid results if available
        worker_tag_results = None
        if linked_slot_id and linked_slots and linked_slot_id in linked_slots:
            worker_tag_results = linked_slots[linked_slot_id].get('cellResults', [])
        
        # For rectified ROI, px_per_cm matches the extraction resolution
        width_cm = slot_data.get('widthCm', 32)
        height_cm = slot_data.get('heightCm', 16)
        roi_height, roi_width = roi.shape[:2]
        
        if is_rectified:
            # Rectified ROI was created at 31.8 px/cm
            px_per_cm = 31.8
        else:
            # Fall back to computed ratio (less accurate)
            px_per_cm = roi_width / width_cm
        
        # Get grid dimensions
        n_cols = 4  # Default 2x4 grid
        n_rows = 2
        if grid_metadata:
            max_col = max(cell.get('col', 0) for cell in grid_metadata)
            max_row = max(cell.get('row', 0) for cell in grid_metadata)
            n_cols = max_col + 1
            n_rows = max_row + 1
        
        for cell in grid_metadata:
            cell_num = cell.get('row', 0) * n_cols + cell.get('col', 0) + 1
            cell_width = cell.get('widthCm', width_cm / n_cols)
            cell_height = cell.get('heightCm', height_cm / n_rows)
            
            # For rectified ROI, coordinates are relative to the ROI origin (0,0 is top-left)
            # Cell center in cm from top-left of ROI
            col = cell.get('col', 0)
            row = cell.get('row', 0)
            cell_center_x_cm = (col + 0.5) * cell_width
            cell_center_y_cm = (row + 0.5) * cell_height
            
            cell_coords = {
                'x_cm': cell_center_x_cm,
                'y_cm': cell_center_y_cm,
                'width_cm': cell_width,
                'height_cm': cell_height,
                'px_per_cm': px_per_cm
            }
            
            detection = detect_yellow_in_cell(roi, cell_coords, debug=False)
            detection['cell_number'] = cell_num
            detection['label'] = cell.get('label', f'Cell {cell_num}')
            
            # Determine cell status
            if detection['detected']:
                detection['status'] = 'PRESENT'
                result['presentCount'] += 1
            else:
                # Check if worker badge is present in linked cell
                worker_badge = None
                if worker_tag_results:
                    for wr in worker_tag_results:
                        if wr.get('cell_number') == cell_num:
                            worker_badge = wr
                            break
                
                if worker_badge and worker_badge.get('detected'):
                    detection['status'] = 'CHECKED_OUT'
                    detection['checked_out_by'] = worker_badge.get('worker_id')
                    result['checkedOutCount'] += 1
                else:
                    detection['status'] = 'MISSING'
                    result['missingCount'] += 1
                    result['alertTriggered'] = True
            
            result['cellResults'].append(detection)
        
        # Set overall status
        if result['missingCount'] > 0:
            result['status'] = 'ALERT'
        elif result['checkedOutCount'] > 0:
            result['status'] = 'PARTIAL'
        else:
            result['status'] = 'OK'
        
        return result
    
    def process_worker_tag_grid_slot(self, slot_data: Dict[str, Any], roi: np.ndarray,
                                      grid_metadata: List[Dict],
                                      is_rectified: bool = False) -> Dict[str, Any]:
        """
        Process a worker tag grid slot using ArUco badge detection
        
        Args:
            slot_data: Slot configuration
            roi: Region of interest image (rectified if is_rectified=True)
            grid_metadata: List of cell definitions
            is_rectified: Whether the ROI has been perspective-corrected
            
        Returns:
            Processing result with cell statuses
        """
        from scanner_color_detection import detect_worker_badge_in_cell
        
        slot_id = slot_data.get('id')
        slot_name = slot_data.get('slotId', slot_id)
        
        result = {
            'slotId': slot_id,
            'slotName': slot_name,
            'slotType': 'worker_tag_grid',
            'status': 'OK',
            'cellResults': [],
            'badgesDetected': 0,
            'error': None
        }
        
        # For rectified ROI, px_per_cm matches the extraction resolution
        width_cm = slot_data.get('widthCm', 32)
        height_cm = slot_data.get('heightCm', 16)
        roi_height, roi_width = roi.shape[:2]
        
        if is_rectified:
            # Rectified ROI was created at 31.8 px/cm
            px_per_cm = 31.8
        else:
            # Fall back to computed ratio (less accurate)
            px_per_cm = roi_width / width_cm
        
        # Get grid dimensions
        n_cols = 4  # Default 2x4 grid
        n_rows = 2
        if grid_metadata:
            max_col = max(cell.get('col', 0) for cell in grid_metadata)
            max_row = max(cell.get('row', 0) for cell in grid_metadata)
            n_cols = max_col + 1
            n_rows = max_row + 1
        
        for cell in grid_metadata:
            cell_num = cell.get('row', 0) * n_cols + cell.get('col', 0) + 1
            cell_width = cell.get('widthCm', width_cm / n_cols)
            cell_height = cell.get('heightCm', height_cm / n_rows)
            
            # For rectified ROI, coordinates are relative to the ROI origin (0,0 is top-left)
            col = cell.get('col', 0)
            row = cell.get('row', 0)
            cell_center_x_cm = (col + 0.5) * cell_width
            cell_center_y_cm = (row + 0.5) * cell_height
            
            cell_coords = {
                'x_cm': cell_center_x_cm,
                'y_cm': cell_center_y_cm,
                'width_cm': cell_width,
                'height_cm': cell_height,
                'px_per_cm': px_per_cm
            }
            
            detection = detect_worker_badge_in_cell(roi, cell_coords, debug=False)
            detection['cell_number'] = cell_num
            detection['label'] = cell.get('label', f'Cell {cell_num}')
            
            if detection['detected']:
                result['badgesDetected'] += 1
            
            result['cellResults'].append(detection)
        
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
        device_path = camera_data.get('devicePath')
        device_index = camera_data.get('deviceIndex', 0)
        resolution = camera_data.get('resolution', [2560, 1440])
        homography = camera_data.get('homographyMatrix')
        
        # Convert device path to index if needed
        if device_path and device_path.startswith('/dev/video'):
            device_index = int(device_path.replace('/dev/video', ''))
        
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
        
        picam2 = None
        try:
            # Setup camera with Picamera2
            from camera_utils_picam2 import setup_camera_picam2, warmup_camera_picam2
            
            width, height = resolution
            picam2 = setup_camera_picam2(device_index, resolution=(width, height))
            picam2.start()
            
            # Give autofocus time to adjust (critical for sharp images)
            logger.info(f"Camera {camera_id}: Warming up autofocus...")
            warmup_camera_picam2(picam2, duration_seconds=1)
            
            # Capture frame from 'main' stream and convert RGB to BGR for OpenCV
            frame_rgb = picam2.capture_array("main")
            frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
            picam2.stop()
            picam2.close()
            picam2 = None
            
            if frame is None:
                result['status'] = 'failed'
                result['errors'].append('Failed to capture frame')
                logger.error(f"Camera {camera_id}: Frame capture failed")
                return result
            
            logger.info(f"Camera {camera_id}: Frame captured ({frame.shape})")
            
            # Separate slots by type for processing order
            # Process worker tag grids first, then scanner grids (need badge results), then tools
            worker_tag_slots = [s for s in slots if s.get('slotType') == 'worker_tag_grid']
            scanner_grid_slots = [s for s in slots if s.get('slotType') == 'scanner_grid']
            tool_slots = [s for s in slots if s.get('slotType', 'tool') == 'tool']
            
            # Track processed results for linked slot lookups
            processed_slots: Dict[str, Dict[str, Any]] = {}
            
            # 1. Process worker tag grids first (no dependencies)
            for slot in worker_tag_slots:
                slot_result = self.slot_processor.process_slot(frame, slot)
                result['slotResults'].append(slot_result)
                result['slotsProcessed'] += 1
                processed_slots[slot.get('id')] = slot_result
            
            # 2. Process scanner grids (may depend on worker tag results)
            for slot in scanner_grid_slots:
                slot_result = self.slot_processor.process_slot(frame, slot, linked_slots=processed_slots)
                result['slotResults'].append(slot_result)
                result['slotsProcessed'] += 1
                processed_slots[slot.get('id')] = slot_result
            
            # 3. Process regular tool slots
            for slot in tool_slots:
                slot_result = self.slot_processor.process_slot(frame, slot)
                result['slotResults'].append(slot_result)
                result['slotsProcessed'] += 1
            
            logger.info(f"Camera {camera_id}: Processed {result['slotsProcessed']} slots (workers: {len(worker_tag_slots)}, scanners: {len(scanner_grid_slots)}, tools: {len(tool_slots)})")
            
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
            for i, camera in enumerate(cameras):
                camera_id = camera.get('id')
                if not camera_id:
                    logger.warning("Camera missing 'id' field, skipping")
                    continue
                    
                camera_name = camera.get('name', camera_id)
                logger.info(f"[SEQUENTIAL] Processing camera {i+1}/{len(cameras)}: {camera_name}")
                
                camera_slots = slots_by_camera.get(camera_id, [])
                
                try:
                    result = self.process_camera(camera, camera_slots)
                    results.append(result)
                    
                    total_slots += result['slotsProcessed']
                    
                    if result['status'] == 'success':
                        total_cameras_success += 1
                    else:
                        total_cameras_failed += 1
                        
                except Exception as e:
                    logger.error(f"[SEQUENTIAL] Error processing camera {camera_name}: {e}")
                    total_cameras_failed += 1
                    results.append({
                        'cameraId': camera_id,
                        'status': 'failed',
                        'errors': [f'Processing exception: {str(e)}']
                    })
                
                finally:
                    # CRITICAL: Resource cleanup after each camera to prevent memory leaks
                    import gc
                    gc.collect()  # Force garbage collection to free camera resources
                    logger.info(f"[SEQUENTIAL] Completed camera {camera_name}, resources cleaned")
                    
                    # CRITICAL: 30-second delay before next camera to prevent resource conflicts
                    if i < len(cameras) - 1:
                        logger.info(f"[SEQUENTIAL] Waiting 30 seconds before processing next camera...")
                        time.sleep(30)
                        logger.info(f"[SEQUENTIAL] Resource cleanup complete, ready for next camera")
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
