#!/usr/bin/env python3
"""
Camera Manager for Tool Tracking System
Handles camera capture, slot detection, and ArUco marker analysis
"""

import argparse
import json
import sys
import logging
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import numpy as np
import cv2
from camera_utils import enable_camera_auto_modes

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class CameraManager:
    def __init__(self, camera_index: int = 0, homography_matrix: Optional[np.ndarray] = None):
        self.camera_index = camera_index
        self.homography_matrix = homography_matrix
        self.cap = None
        # Initialize ArUco detector (using 4x4_100 dictionary, IDs 0-99)
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
        self.aruco_params = cv2.aruco.DetectorParameters()
        
    def initialize_camera(self) -> bool:
        """Initialize camera capture"""
        try:
            self.cap = cv2.VideoCapture(self.camera_index)
            if not self.cap.isOpened():
                logger.error(f"Failed to open camera {self.camera_index}")
                return False
            
            # Force MJPEG format - YUYV at high res throttles to 0.1fps
            self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc(*'MJPG'))
            
            # Set camera properties
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 2560)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1440)
            # Enable all automatic features via OpenCV (fallback)
            self.cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
            self.cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 3)  # 3 = Aperture Priority (auto mode for v4l2)
            self.cap.set(cv2.CAP_PROP_AUTO_WB, 1)
            
            # Also enable via v4l2-ctl for more reliable results on Linux
            enable_camera_auto_modes(str(self.camera_index))
            
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
    
    def detect_aruco_in_roi(self, roi: np.ndarray) -> Optional[Dict]:
        """Detect ArUco markers in a given ROI"""
        try:
            # Convert to grayscale if needed
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
            
            # Detect ArUco markers
            corners, ids, rejected = cv2.aruco.detectMarkers(
                gray, self.aruco_dict, parameters=self.aruco_params
            )
            
            if ids is not None and len(ids) > 0:
                # Return the first detected marker
                marker_id = int(ids[0][0])
                
                # Determine marker type based on ID range
                # Slot markers: 1-50, Worker markers: 51-95, Corner markers: 96-99
                if 1 <= marker_id <= 50:
                    return {'id': marker_id, 'type': 'slot'}
                elif 51 <= marker_id <= 95:
                    return {'id': marker_id, 'type': 'worker', 'worker_name': f'Worker_{marker_id}'}
                else:
                    return {'id': marker_id, 'type': 'other'}
            
            return None
            
        except Exception as e:
            logger.error(f"Error detecting ArUco markers: {e}")
            return None
    
    def process_slot(self, image: np.ndarray, slot_config: Dict) -> Dict:
        """
        Process a single slot using ArUco marker detection
        
        Detection Logic:
        - Slot ArUco visible → EMPTY (tool missing, trigger alarm)
        - Worker ArUco visible → CHECKED_OUT (signed out by worker)
        - No ArUco visible → ITEM_PRESENT (tool covering slot marker)
        """
        slot_id = slot_config['id']
        coords = slot_config['coords']
        expected_aruco_id = slot_config.get('slotNumber')  # This is the slot's ArUco ID
        
        logger.info(f"Processing slot {slot_id} (ArUco ID: {expected_aruco_id})")
        
        result = {
            'slot_id': slot_id,
            'status': 'ITEM_PRESENT',  # Default: assume tool present
            'present': True,
            'pose_quality': 0.0,
            'aruco_id': None,
            'qr_id': None,  # Worker code (e.g., "W51") for database lookup
            'worker_name': None,
            'image_path': None,
            'alert_triggered': False,
        }
        
        try:
            # Extract ROI
            roi = self.extract_slot_roi(image, coords)
            if roi is None:
                logger.warning(f"Failed to extract ROI for slot {slot_id}")
                result['status'] = 'ERROR'
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
            
            # ArUco Detection (the core of simplified logic)
            aruco_result = self.detect_aruco_in_roi(roi)
            
            if aruco_result:
                result['aruco_id'] = aruco_result.get('id')
                marker_type = aruco_result.get('type')
                
                if marker_type == 'worker':
                    # Worker badge visible → checked out
                    result['status'] = 'CHECKED_OUT'
                    result['worker_name'] = aruco_result.get('worker_name')
                    result['qr_id'] = f"W{aruco_result.get('id')}"  # Format as workerCode (e.g., "W51")
                    result['present'] = True  # Item is "present" with worker
                    result['alert_triggered'] = False
                    
                elif marker_type == 'slot':
                    # Check if it's the expected slot marker
                    if result['aruco_id'] == expected_aruco_id:
                        # Slot ArUco visible → tool missing!
                        result['status'] = 'EMPTY'
                        result['present'] = False
                        result['alert_triggered'] = True
                        logger.warning(f"Slot {slot_id} ArUco visible - tool missing!")
                    else:
                        # Wrong slot marker detected - possible misalignment
                        result['status'] = 'ERROR'
                        logger.error(f"Slot {slot_id} detected wrong ArUco ID: {result['aruco_id']} (expected: {expected_aruco_id})")
                    
            else:
                # No ArUco detected → tool is covering the slot marker
                result['status'] = 'ITEM_PRESENT'
                result['present'] = True
                result['alert_triggered'] = False
            
            # Calculate pose quality (image sharpness metric)
            if len(roi.shape) == 3:
                gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            else:
                gray_roi = roi
            
            # Use Laplacian variance as pose quality metric
            laplacian_var = cv2.Laplacian(gray_roi, cv2.CV_64F).var()
            result['pose_quality'] = min(200.0, laplacian_var)
            
        except Exception as e:
            logger.error(f"Error processing slot {slot_id}: {e}")
            result['status'] = 'ERROR'
        
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
            if camera_manager is not None:
                camera_manager.cleanup()
        except:
            pass

if __name__ == '__main__':
    main()