#!/usr/bin/env python3
"""
Camera Capture Processing Script
Captures frames from all calibrated cameras and processes each slot.
Performs QR decoding and SSIM analysis to determine tool status.
"""

import cv2
import sys
import json
import logging
import numpy as np
from typing import Dict, List, Any, Tuple, Optional
from pathlib import Path
from datetime import datetime
from skimage.metrics import structural_similarity as ssim

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SlotProcessor:
    """Process individual tool slots with QR and SSIM analysis"""
    
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
    
    def calculate_ssim(self, roi: np.ndarray, baseline_path: Path) -> Optional[float]:
        """
        Calculate SSIM between current ROI and baseline image
        
        Args:
            roi: Current ROI image
            baseline_path: Path to baseline image
            
        Returns:
            SSIM score (0-1) or None if calculation fails
        """
        try:
            if not baseline_path.exists():
                logger.warning(f"Baseline image not found: {baseline_path}")
                return None
            
            # Load baseline
            baseline = cv2.imread(str(baseline_path))
            if baseline is None:
                logger.error(f"Failed to load baseline: {baseline_path}")
                return None
            
            # Resize ROI to match baseline
            roi_resized = cv2.resize(roi, (baseline.shape[1], baseline.shape[0]))
            
            # Convert to grayscale
            roi_gray = cv2.cvtColor(roi_resized, cv2.COLOR_BGR2GRAY)
            baseline_gray = cv2.cvtColor(baseline, cv2.COLOR_BGR2GRAY)
            
            # Calculate SSIM
            score = ssim(baseline_gray, roi_gray)
            
            return float(score)
            
        except Exception as e:
            logger.error(f"SSIM calculation failed: {e}")
            return None
    
    def determine_status(self, qr_data: Optional[str], ssim_empty: Optional[float], 
                        ssim_full: Optional[float], expected_qr: Optional[str]) -> str:
        """
        Determine slot status based on QR and SSIM data
        
        Args:
            qr_data: Decoded QR data
            ssim_empty: SSIM score vs empty baseline
            ssim_full: SSIM score vs full baseline
            expected_qr: Expected QR ID for this slot
            
        Returns:
            Status string (EMPTY, ITEM_PRESENT, CHECKED_OUT, TRAINING_ERROR, etc.)
        """
        # If no baselines exist yet
        if ssim_empty is None and ssim_full is None:
            return "TRAINING_ERROR"
        
        # Thresholds
        SSIM_HIGH_THRESHOLD = 0.85
        SSIM_LOW_THRESHOLD = 0.60
        
        # Check if slot appears empty
        if ssim_empty is not None and ssim_empty > SSIM_HIGH_THRESHOLD:
            return "EMPTY"
        
        # Check if slot appears full (tool present)
        if ssim_full is not None and ssim_full > SSIM_HIGH_THRESHOLD:
            # Tool present, check QR
            if qr_data:
                if expected_qr and qr_data == expected_qr:
                    return "ITEM_PRESENT"
                else:
                    return "WRONG_ITEM"
            else:
                return "ITEM_PRESENT"  # Tool there but no QR
        
        # Intermediate state - something changed but unclear what
        if qr_data:
            # QR visible but doesn't match baselines strongly
            return "CHECKED_OUT"  # Assume checkout scenario
        
        return "OCCUPIED_NO_QR"
    
    def process_slot(self, frame: np.ndarray, slot_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a single slot
        
        Args:
            frame: Camera frame
            slot_data: Slot configuration
            
        Returns:
            Processing result with status and metrics
        """
        slot_id = slot_data.get('id')
        slot_name = slot_data.get('slotId', slot_id)
        region_coords = slot_data.get('regionCoords', [])
        expected_qr = slot_data.get('expectedQrId')
        
        logger.info(f"Processing slot: {slot_name}")
        
        result = {
            'slotId': slot_id,
            'slotName': slot_name,
            'status': 'UNKNOWN',
            'qrData': None,
            'ssimEmpty': None,
            'ssimFull': None,
            'error': None
        }
        
        try:
            # Extract ROI
            roi = self.extract_roi(frame, region_coords)
            if roi is None:
                result['error'] = 'Failed to extract ROI'
                result['status'] = 'PROCESSING_ERROR'
                return result
            
            # Save current ROI
            roi_path = self.data_dir / f"{slot_name}_last.png"
            cv2.imwrite(str(roi_path), roi)
            
            # Decode QR
            qr_data = self.decode_qr(roi)
            result['qrData'] = qr_data
            
            # Calculate SSIM vs baselines
            empty_baseline = self.data_dir / f"{slot_name}_EMPTY.png"
            full_baseline = self.data_dir / f"{slot_name}_FULL.png"
            
            ssim_empty = self.calculate_ssim(roi, empty_baseline)
            ssim_full = self.calculate_ssim(roi, full_baseline)
            
            result['ssimEmpty'] = ssim_empty
            result['ssimFull'] = ssim_full
            
            # Determine status
            status = self.determine_status(qr_data, ssim_empty, ssim_full, expected_qr)
            result['status'] = status
            
            logger.info(f"Slot {slot_name}: {status} (QR: {qr_data}, SSIM_E: {ssim_empty:.3f if ssim_empty else 'N/A'}, SSIM_F: {ssim_full:.3f if ssim_full else 'N/A'})")
            
        except Exception as e:
            result['error'] = str(e)
            result['status'] = 'PROCESSING_ERROR'
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
                   slots_by_camera: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
        """
        Process all cameras
        
        Args:
            cameras: List of camera configurations
            slots_by_camera: Slots grouped by camera ID
            
        Returns:
            Overall processing result
        """
        logger.info(f"Starting capture processing for {len(cameras)} cameras")
        
        results = []
        total_slots = 0
        total_cameras_success = 0
        total_cameras_failed = 0
        
        for camera in cameras:
            camera_id = camera.get('id')
            camera_slots = slots_by_camera.get(camera_id, [])
            
            result = self.process_camera(camera, camera_slots)
            results.append(result)
            
            total_slots += result['slotsProcessed']
            
            if result['status'] == 'success':
                total_cameras_success += 1
            else:
                total_cameras_failed += 1
        
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
        
        # Process all cameras
        processor = CameraProcessor()
        results = processor.process_all(cameras, slots_by_camera)
        
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
