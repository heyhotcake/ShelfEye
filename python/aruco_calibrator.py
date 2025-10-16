#!/usr/bin/env python3
"""
ArUco 4-Corner Calibration Module for Tool Tracking System
Detects 4 corner ArUco markers (IDs 17-20) and computes homography matrix
"""

import argparse
import json
import sys
import logging
from typing import Optional, Tuple, Dict
import numpy as np
import cv2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ArucoCornerCalibrator:
    def __init__(self, dictionary_type=cv2.aruco.DICT_4X4_100):
        """
        Initialize ArUco calibrator for 4-corner detection
        
        Args:
            dictionary_type: ArUco dictionary type (DICT_4X4_100)
        """
        # Initialize ArUco dictionary and detector
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(dictionary_type)
        self.detector_params = cv2.aruco.DetectorParameters()
        
        # Expected corner marker IDs (A=17, B=18, C=19, D=20)
        self.corner_ids = [17, 18, 19, 20]
        
    def detect_corner_markers(self, image: np.ndarray) -> Tuple[Dict[int, np.ndarray], int]:
        """
        Detect the 4 corner ArUco markers in the image
        
        Returns:
            marker_centers: Dictionary mapping marker ID to center point (x, y)
            num_detected: Number of corner markers detected
        """
        try:
            # Convert to grayscale if needed
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            
            # Detect all markers
            corners, ids, rejected = cv2.aruco.detectMarkers(
                gray, self.aruco_dict, parameters=self.detector_params
            )
            
            if ids is None or len(corners) == 0:
                logger.warning("No markers detected")
                return {}, 0
            
            # Extract center points for our corner markers
            marker_centers = {}
            for i, marker_id in enumerate(ids.flatten()):
                if marker_id in self.corner_ids:
                    # Calculate center of the marker (average of 4 corners)
                    corner_points = corners[i][0]
                    center_x = np.mean(corner_points[:, 0])
                    center_y = np.mean(corner_points[:, 1])
                    marker_centers[marker_id] = np.array([center_x, center_y], dtype=np.float32)
            
            num_detected = len(marker_centers)
            logger.info(f"Detected {num_detected}/4 corner markers: {list(marker_centers.keys())}")
            
            return marker_centers, num_detected
            
        except Exception as e:
            logger.error(f"Error detecting corner markers: {e}")
            return {}, 0
    
    def calculate_homography(self, marker_centers: Dict[int, np.ndarray], 
                            image_shape: Tuple[int, int],
                            paper_size_cm: Tuple[float, float] = (29.7, 21.0)) -> Tuple[bool, Optional[np.ndarray], float]:
        """
        Calculate homography matrix from 4 corner markers
        Maps real-world paper coordinates (cm) to camera pixels
        
        Args:
            marker_centers: Dictionary of marker ID -> center point (pixels)
            image_shape: (height, width) of the image
            paper_size_cm: (width_cm, height_cm) of the paper (default A4 landscape)
            
        Returns:
            success: Whether calculation was successful
            homography: 3x3 homography matrix that maps cm → pixels
            quality: Quality metric (mean reprojection error in pixels)
        """
        try:
            # Verify all 4 markers are detected
            if len(marker_centers) != 4:
                logger.warning(f"Need all 4 markers, only found {len(marker_centers)}")
                return False, None, float('inf')
            
            # Check that all required IDs are present
            missing_ids = set(self.corner_ids) - set(marker_centers.keys())
            if missing_ids:
                logger.warning(f"Missing marker IDs: {missing_ids}")
                return False, None, float('inf')
            
            # Destination points: detected marker centers in pixels (in order A, B, C, D)
            # A (17) = top-left
            # B (18) = top-right
            # C (19) = bottom-right
            # D (20) = bottom-left
            dst_points = np.array([
                marker_centers[17],  # A: top-left
                marker_centers[18],  # B: top-right
                marker_centers[19],  # C: bottom-right
                marker_centers[20],  # D: bottom-left
            ], dtype=np.float32)
            
            # Source points: paper corners in cm (real-world coordinates)
            # Markers are 5cm × 5cm and positioned at paper corners (0cm from edges)
            # So marker centers are at 2.5cm from each edge
            paper_width_cm, paper_height_cm = paper_size_cm
            marker_size_cm = 5.0
            marker_center_offset = marker_size_cm / 2.0  # 2.5cm
            
            src_points = np.array([
                [marker_center_offset, marker_center_offset],  # A: top-left center
                [paper_width_cm - marker_center_offset, marker_center_offset],  # B: top-right center
                [paper_width_cm - marker_center_offset, paper_height_cm - marker_center_offset],  # C: bottom-right center
                [marker_center_offset, paper_height_cm - marker_center_offset],  # D: bottom-left center
            ], dtype=np.float32)
            
            # Calculate homography matrix: cm → pixels
            homography, mask = cv2.findHomography(src_points, dst_points, cv2.RANSAC, 5.0)
            
            if homography is None:
                logger.error("Failed to calculate homography")
                return False, None, float('inf')
            
            # Calculate quality (reprojection error)
            # Transform source points (cm) using homography to get predicted pixel positions
            src_points_homogeneous = np.hstack([src_points, np.ones((4, 1))])
            projected_points_homogeneous = homography @ src_points_homogeneous.T
            projected_points = (projected_points_homogeneous[:2, :] / projected_points_homogeneous[2, :]).T
            
            # Calculate mean reprojection error (difference between detected and predicted positions)
            reprojection_error = np.mean(np.linalg.norm(dst_points - projected_points, axis=1))
            
            logger.info(f"Homography calculated successfully (maps cm → pixels)")
            logger.info(f"Paper size: {paper_width_cm}cm × {paper_height_cm}cm")
            logger.info(f"Reprojection error: {reprojection_error:.2f} pixels")
            
            return True, homography, reprojection_error
            
        except Exception as e:
            logger.error(f"Error calculating homography: {e}")
            return False, None, float('inf')
    
    def calibrate_from_camera(self, camera_index: int, resolution: Tuple[int, int], 
                             paper_size_cm: Tuple[float, float] = (29.7, 21.0)) -> Dict:
        """
        Capture frame from camera and calculate homography
        
        Args:
            camera_index: Camera device index (0, 1, 2, etc.)
            resolution: (width, height) tuple
            paper_size_cm: (width_cm, height_cm) of the paper template
            
        Returns:
            Dictionary with calibration results
        """
        cap = None
        try:
            # Initialize camera
            cap = cv2.VideoCapture(camera_index)
            if not cap.isOpened():
                raise Exception(f"Could not open camera {camera_index}")
            
            width, height = resolution
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            
            # Capture frame
            ret, frame = cap.read()
            if not ret:
                raise Exception("Failed to capture frame from camera")
            
            # Detect corner markers
            marker_centers, num_detected = self.detect_corner_markers(frame)
            
            # Calculate homography if all markers found
            if num_detected == 4:
                success, homography, error = self.calculate_homography(
                    marker_centers, frame.shape[:2], paper_size_cm
                )
                
                if success and homography is not None:
                    return {
                        'ok': True,
                        'homography_matrix': homography.flatten().tolist(),
                        'reprojection_error': float(error),
                        'markers_detected': num_detected,
                        'marker_positions': {
                            f"marker_{id}": center.tolist() 
                            for id, center in marker_centers.items()
                        }
                    }
                else:
                    return {
                        'ok': False,
                        'error': 'Failed to calculate homography',
                        'markers_detected': num_detected
                    }
            else:
                return {
                    'ok': False,
                    'error': f'Only detected {num_detected}/4 corner markers',
                    'markers_detected': num_detected,
                    'detected_ids': list(marker_centers.keys())
                }
                
        except Exception as e:
            logger.error(f"Error in calibration: {e}")
            return {
                'ok': False,
                'error': str(e),
                'markers_detected': 0
            }
        finally:
            if cap is not None:
                cap.release()

def main():
    parser = argparse.ArgumentParser(description='ArUco 4-Corner Calibration')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index')
    parser.add_argument('--resolution', type=str, default='1920x1080', help='Camera resolution (WxH)')
    parser.add_argument('--paper-size', type=str, default='29.7x21.0', help='Paper size in cm (WidthxHeight)')
    
    args = parser.parse_args()
    
    try:
        # Parse resolution
        width, height = map(int, args.resolution.split('x'))
        resolution = (width, height)
        
        # Parse paper size
        paper_width, paper_height = map(float, args.paper_size.split('x'))
        paper_size_cm = (paper_width, paper_height)
        
        # Initialize calibrator
        calibrator = ArucoCornerCalibrator()
        
        # Run calibration
        result = calibrator.calibrate_from_camera(args.camera, resolution, paper_size_cm)
        
        # Output JSON result
        print(json.dumps(result))
        
        # Exit with appropriate code
        sys.exit(0 if result['ok'] else 1)
        
    except Exception as e:
        logger.error(f"Error in main: {e}")
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
