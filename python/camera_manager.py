#!/usr/bin/env python3
"""
Camera Manager for Tool Tracking System
Handles camera capture, slot detection, and QR analysis
"""

import argparse
import json
import sys
import logging
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import numpy as np
import cv2

from qr_detector import QRDetector
from ssim_analyzer import SSIMAnalyzer

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class CameraManager:
    def __init__(self, camera_index: int = 0, homography_matrix: Optional[np.ndarray] = None):
        self.camera_index = camera_index
        self.homography_matrix = homography_matrix
        self.qr_detector = QRDetector()
        self.ssim_analyzer = SSIMAnalyzer()
        self.cap = None
        
    def initialize_camera(self) -> bool:
        """Initialize camera capture"""
        try:
            self.cap = cv2.VideoCapture(self.camera_index)
            if not self.cap.isOpened():
                logger.error(f"Failed to open camera {self.camera_index}")
                return False
            
            # Set camera properties
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            self.cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)
            
            logger.info(f"Camera {self.camera_index} initialized successfully")
            return True
        except Exception as e:
            logger.error(f"Error initializing camera: {e}")
            return False
    
    def capture_frame(self) -> Optional[np.ndarray]:
        """Capture a single frame from camera"""
        if not self.cap:
            logger.error("Camera not initialized")
            return None
            
        try:
            ret, frame = self.cap.read()
            if not ret:
                logger.error("Failed to capture frame")
                return None
            return frame
        except Exception as e:
            logger.error(f"Error capturing frame: {e}")
            return None
    
    def rectify_image(self, image: np.ndarray) -> Optional[np.ndarray]:
        """Apply homography transformation to rectify image"""
        if self.homography_matrix is None:
            logger.warning("No homography matrix available, using original image")
            return image
            
        try:
            h, w = image.shape[:2]
            rectified = cv2.warpPerspective(image, self.homography_matrix, (w, h))
            return rectified
        except Exception as e:
            logger.error(f"Error rectifying image: {e}")
            return image
    
    def extract_slot_roi(self, image: np.ndarray, coords: List[List[float]]) -> Optional[np.ndarray]:
        """Extract ROI for a specific slot using polygon coordinates"""
        try:
            # Convert coordinates to numpy array
            pts = np.array(coords, dtype=np.int32)
            
            # Create mask for the polygon
            mask = np.zeros(image.shape[:2], dtype=np.uint8)
            cv2.fillPoly(mask, [pts], 255)
            
            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(pts)
            
            # Extract ROI
            roi = image[y:y+h, x:x+w]
            mask_roi = mask[y:y+h, x:x+w]
            
            # Apply mask to ROI
            roi_masked = cv2.bitwise_and(roi, roi, mask=mask_roi)
            
            return roi_masked
        except Exception as e:
            logger.error(f"Error extracting ROI: {e}")
            return None
    
    def process_slot(self, image: np.ndarray, slot_config: Dict) -> Dict:
        """Process a single slot for QR detection and analysis"""
        slot_id = slot_config['id']
        coords = slot_config['coords']
        expected_qr = slot_config.get('expectedQr')
        
        logger.info(f"Processing slot {slot_id}")
        
        result = {
            'slot_id': slot_id,
            'status': 'UNCERTAIN',
            'present': False,
            'correct_item': False,
            's_empty': 0.0,
            's_full': 0.0,
            'pose_quality': 0.0,
            'qr_id': None,
            'worker_name': None,
            'image_path': None,
            'alert_triggered': False,
        }
        
        try:
            # Extract ROI
            roi = self.extract_slot_roi(image, coords)
            if roi is None:
                logger.warning(f"Failed to extract ROI for slot {slot_id}")
                return result
            
            # Save ROI image
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            roi_path = f"data/rois/{slot_id}/{timestamp}_{slot_id}.png"
            
            # Create directory if it doesn't exist
            import os
            os.makedirs(os.path.dirname(roi_path), exist_ok=True)
            
            cv2.imwrite(roi_path, roi)
            result['image_path'] = roi_path
            
            # Also save as last ROI
            last_roi_path = f"data/{slot_id}_last.png"
            cv2.imwrite(last_roi_path, roi)
            
            # QR Detection
            qr_results = self.qr_detector.detect_qr_codes(roi)
            
            if qr_results:
                qr_data = qr_results[0]  # Take first QR code found
                result['qr_id'] = qr_data.get('id')
                
                # Check if it's a worker badge
                if qr_data.get('type') == 'worker':
                    result['status'] = 'CHECKED_OUT'
                    result['worker_name'] = qr_data.get('worker_name')
                    result['present'] = True
                elif qr_data.get('id') == expected_qr:
                    result['status'] = 'ITEM_PRESENT'
                    result['present'] = True
                    result['correct_item'] = True
                else:
                    result['status'] = 'ITEM_PRESENT'
                    result['present'] = True
                    result['correct_item'] = False
            else:
                # No QR detected, check if slot is empty using SSIM
                empty_baseline_path = f"data/{slot_id}_EMPTY.png"
                full_baseline_path = f"data/{slot_id}_FULL.png"
                
                if os.path.exists(empty_baseline_path):
                    empty_baseline = cv2.imread(empty_baseline_path, cv2.IMREAD_GRAYSCALE)
                    if empty_baseline is not None:
                        roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
                        result['s_empty'] = self.ssim_analyzer.compare_images(roi_gray, empty_baseline)
                    
                    # Higher SSIM with empty baseline means slot is likely empty
                    if result['s_empty'] > 0.8:
                        result['status'] = 'EMPTY'
                        result['present'] = False
                    else:
                        result['status'] = 'OCCUPIED_NO_QR'
                        result['present'] = True
                        result['alert_triggered'] = True
                else:
                    result['status'] = 'UNCALIBRATED_EMPTY'
                
                if os.path.exists(full_baseline_path) and result['present']:
                    full_baseline = cv2.imread(full_baseline_path, cv2.IMREAD_GRAYSCALE)
                    if full_baseline is not None:
                        roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
                        result['s_full'] = self.ssim_analyzer.compare_images(roi_gray, full_baseline)
                        result['correct_item'] = result['s_full'] > 0.7
            
            # Calculate pose quality (simple metric based on image sharpness)
            if len(roi.shape) == 3:
                gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            else:
                gray_roi = roi
            
            # Use Laplacian variance as pose quality metric
            laplacian_var = cv2.Laplacian(gray_roi, cv2.CV_64F).var()
            result['pose_quality'] = min(200.0, laplacian_var)
            
        except Exception as e:
            logger.error(f"Error processing slot {slot_id}: {e}")
            result['status'] = 'UNCERTAIN'
        
        return result
    
    def process_all_slots(self, slots: List[Dict]) -> Dict:
        """Process all slots in the current frame"""
        logger.info("Starting capture and analysis")
        
        # Capture frame
        frame = self.capture_frame()
        if frame is None:
            return {
                'ok': False,
                'error': 'Failed to capture frame',
                'time': datetime.now().isoformat(),
                'slots': []
            }
        
        # Rectify image if homography is available
        rectified_frame = self.rectify_image(frame)
        if rectified_frame is None:
            rectified_frame = frame
        
        # Process each slot
        slot_results = []
        for slot_config in slots:
            result = self.process_slot(rectified_frame, slot_config)
            slot_results.append(result)
        
        return {
            'ok': True,
            'time': datetime.now().isoformat(),
            'slots': slot_results
        }
    
    def cleanup(self):
        """Clean up camera resources"""
        if self.cap:
            self.cap.release()
        cv2.destroyAllWindows()

def main():
    parser = argparse.ArgumentParser(description='Camera Manager for Tool Tracking')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index')
    parser.add_argument('--slots', type=str, required=True, help='JSON string of slot configurations')
    parser.add_argument('--homography', type=str, help='JSON string of homography matrix')
    
    args = parser.parse_args()
    camera_manager = None
    
    try:
        # Parse slot configurations
        slots = json.loads(args.slots)
        
        # Parse homography matrix if provided
        homography_matrix = None
        if args.homography:
            homography_data = json.loads(args.homography)
            if homography_data:
                homography_matrix = np.array(homography_data).reshape(3, 3)
        
        # Initialize camera manager
        camera_manager = CameraManager(args.camera, homography_matrix)
        
        if not camera_manager.initialize_camera():
            print(json.dumps({'ok': False, 'error': 'Failed to initialize camera'}))
            sys.exit(1)
        
        # Process all slots
        results = camera_manager.process_all_slots(slots)
        
        # Output results as JSON
        print(json.dumps(results))
        
    except Exception as e:
        logger.error(f"Error in main: {e}")
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
    
    finally:
        try:
            if 'camera_manager' in locals():
                camera_manager.cleanup()
        except:
            pass

if __name__ == '__main__':
    main()
