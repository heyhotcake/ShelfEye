#!/usr/bin/env python3
"""
ArUco GridBoard Calibration Module for Tool Tracking System
Handles camera calibration using ArUco markers for perspective correction
"""

import argparse
import json
import sys
import logging
from typing import Optional, Tuple, List
import numpy as np
import cv2

logger = logging.getLogger(__name__)

class ArucoCalibrator:
    def __init__(self, 
                 markers_x: int = 6, 
                 markers_y: int = 10, 
                 marker_length: float = 0.05, 
                 marker_separation: float = 0.01,
                 dictionary_type = cv2.aruco.DICT_4X4_50):
        """
        Initialize ArUco calibrator
        
        Args:
            markers_x: Number of markers in x direction
            markers_y: Number of markers in y direction  
            marker_length: Length of marker side in meters
            marker_separation: Separation between markers in meters
            dictionary_type: ArUco dictionary type
        """
        self.markers_x = markers_x
        self.markers_y = markers_y
        self.marker_length = marker_length
        self.marker_separation = marker_separation
        
        # Initialize ArUco dictionary and detector
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(dictionary_type)
        self.detector_params = cv2.aruco.DetectorParameters()
        
        # Create GridBoard
        self.board = cv2.aruco.GridBoard(
            (markers_x, markers_y),
            marker_length,
            marker_separation,
            self.aruco_dict
        )
        
        # Camera calibration will be stored here
        self.camera_matrix = None
        self.dist_coeffs = None
        self.homography_matrix = None
        
    def detect_markers(self, image: np.ndarray) -> Tuple[List, List, List]:
        """
        Detect ArUco markers in image
        
        Returns:
            corners: Detected marker corners
            ids: Detected marker IDs  
            rejected: Rejected marker candidates
        """
        try:
            corners, ids, rejected = cv2.aruco.detectMarkers(
                image, self.aruco_dict, parameters=self.detector_params
            )
            return corners, ids, rejected
        except Exception as e:
            logger.error(f"Error detecting markers: {e}")
            return [], [], []
    
    def estimate_pose_board(self, corners: List, ids: List, 
                           camera_matrix: np.ndarray, 
                           dist_coeffs: np.ndarray) -> Tuple[bool, np.ndarray, np.ndarray]:
        """
        Estimate pose of the board
        """
        try:
            if len(corners) == 0 or ids is None:
                return False, None, None
                
            # Estimate pose of the board
            retval, rvec, tvec = cv2.aruco.estimatePoseBoard(
                corners, ids, self.board, camera_matrix, dist_coeffs, None, None
            )
            
            return retval > 0, rvec, tvec
        except Exception as e:
            logger.error(f"Error estimating board pose: {e}")
            return False, None, None
    
    def calculate_reprojection_error(self, corners: List, ids: List, 
                                   rvec: np.ndarray, tvec: np.ndarray,
                                   camera_matrix: np.ndarray, 
                                   dist_coeffs: np.ndarray) -> float:
        """
        Calculate reprojection error for detected markers
        """
        try:
            if not corners or ids is None:
                return float('inf')
            
            total_error = 0.0
            total_points = 0
            
            # Get board object points
            object_points = self.board.getObjPoints()
            
            for i, corner in enumerate(corners):
                if i < len(ids):
                    marker_id = ids[i][0]
                    
                    # Get object points for this marker
                    if marker_id < len(object_points):
                        obj_pts = object_points[marker_id].reshape(-1, 1, 3)
                        
                        # Project points
                        projected_points, _ = cv2.projectPoints(
                            obj_pts, rvec, tvec, camera_matrix, dist_coeffs
                        )
                        
                        # Calculate error
                        error = cv2.norm(corner.reshape(-1, 1, 2), 
                                       projected_points.reshape(-1, 1, 2), 
                                       cv2.NORM_L2)
                        total_error += error
                        total_points += len(corner)
            
            return total_error / total_points if total_points > 0 else float('inf')
            
        except Exception as e:
            logger.error(f"Error calculating reprojection error: {e}")
            return float('inf')
    
    def calibrate_camera_from_images(self, images: List[np.ndarray]) -> bool:
        """
        Calibrate camera from multiple images of the board
        """
        try:
            all_corners = []
            all_ids = []
            
            for image in images:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
                corners, ids, _ = self.detect_markers(gray)
                
                if len(corners) > 0 and ids is not None:
                    all_corners.append(corners)
                    all_ids.append(ids)
            
            if len(all_corners) == 0:
                logger.error("No markers detected in any image")
                return False
            
            # Calibrate camera
            image_size = images[0].shape[:2][::-1]  # (width, height)
            
            ret, camera_matrix, dist_coeffs, rvecs, tvecs = cv2.aruco.calibrateCameraAruco(
                all_corners, all_ids, all_corners, self.board, 
                image_size, None, None
            )
            
            if ret:
                self.camera_matrix = camera_matrix
                self.dist_coeffs = dist_coeffs
                logger.info("Camera calibration successful")
                return True
            else:
                logger.error("Camera calibration failed")
                return False
                
        except Exception as e:
            logger.error(f"Error calibrating camera: {e}")
            return False
    
    def calculate_homography_from_single_image(self, image: np.ndarray) -> Tuple[bool, Optional[np.ndarray], float, int]:
        """
        Calculate homography matrix from a single image of the board
        
        Returns:
            success: Whether calculation was successful
            homography: 3x3 homography matrix
            reprojection_error: Mean reprojection error in pixels
            markers_detected: Number of markers detected
        """
        try:
            # Convert to grayscale if needed
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            
            # Detect markers
            corners, ids, _ = self.detect_markers(gray)
            
            if len(corners) == 0 or ids is None:
                logger.warning("No markers detected")
                return False, None, float('inf'), 0
            
            markers_detected = len(corners)
            logger.info(f"Detected {markers_detected} markers")
            
            # We need at least 4 corners to calculate homography
            if markers_detected < 4:
                logger.warning("Need at least 4 markers for homography calculation")
                return False, None, float('inf'), markers_detected
            
            # Use default camera parameters if not calibrated
            if self.camera_matrix is None:
                h, w = gray.shape
                self.camera_matrix = np.array([
                    [w, 0, w/2],
                    [0, w, h/2], 
                    [0, 0, 1]
                ], dtype=np.float32)
                self.dist_coeffs = np.zeros((4,1))
            
            # Estimate board pose
            pose_found, rvec, tvec = self.estimate_pose_board(
                corners, ids, self.camera_matrix, self.dist_coeffs
            )
            
            if not pose_found:
                logger.warning("Could not estimate board pose")
                return False, None, float('inf'), markers_detected
            
            # Calculate reprojection error
            reprojection_error = self.calculate_reprojection_error(
                corners, ids, rvec, tvec, self.camera_matrix, self.dist_coeffs
            )
            
            # Get board corners in 3D
            board_corners_3d = np.array([
                [0, 0, 0],
                [self.markers_x * (self.marker_length + self.marker_separation), 0, 0],
                [self.markers_x * (self.marker_length + self.marker_separation), 
                 self.markers_y * (self.marker_length + self.marker_separation), 0],
                [0, self.markers_y * (self.marker_length + self.marker_separation), 0]
            ], dtype=np.float32).reshape(-1, 1, 3)
            
            # Project board corners to image
            board_corners_2d, _ = cv2.projectPoints(
                board_corners_3d, rvec, tvec, self.camera_matrix, self.dist_coeffs
            )
            board_corners_2d = board_corners_2d.reshape(-1, 2)
            
            # Define destination corners (rectified coordinates)
            h, w = gray.shape
            dst_corners = np.array([
                [50, 50],
                [w-50, 50],
                [w-50, h-50],
                [50, h-50]
            ], dtype=np.float32)
            
            # Calculate homography
            homography = cv2.getPerspectiveTransform(board_corners_2d, dst_corners)
            self.homography_matrix = homography
            
            logger.info(f"Homography calculated successfully, reprojection error: {reprojection_error:.2f} px")
            
            return True, homography, reprojection_error, markers_detected
            
        except Exception as e:
            logger.error(f"Error calculating homography: {e}")
            return False, None, float('inf'), 0
    
    def generate_board_image(self, image_size: Tuple[int, int] = (1920, 1080), 
                           margin: int = 100) -> np.ndarray:
        """
        Generate an image of the ArUco board for printing
        """
        try:
            board_image = self.board.generateImage(image_size, margin)
            return board_image
        except Exception as e:
            logger.error(f"Error generating board image: {e}")
            return np.zeros(image_size, dtype=np.uint8)

def main():
    parser = argparse.ArgumentParser(description='ArUco GridBoard Calibration')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index')
    parser.add_argument('--resolution', type=str, default='1920x1080', help='Camera resolution (WxH)')
    parser.add_argument('--save-board', type=str, help='Save board image to file')
    parser.add_argument('--markers-x', type=int, default=6, help='Number of markers in X direction')
    parser.add_argument('--markers-y', type=int, default=10, help='Number of markers in Y direction')
    
    args = parser.parse_args()
    
    try:
        # Parse resolution
        width, height = map(int, args.resolution.split('x'))
        
        # Initialize calibrator
        calibrator = ArucoCalibrator(args.markers_x, args.markers_y)
        
        # Generate board image if requested
        if args.save_board:
            board_image = calibrator.generate_board_image((width, height))
            cv2.imwrite(args.save_board, board_image)
            logger.info(f"Board image saved to {args.save_board}")
        
        # Initialize camera
        cap = cv2.VideoCapture(args.camera)
        if not cap.isOpened():
            raise Exception(f"Could not open camera {args.camera}")
        
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        
        # Capture frame for calibration
        ret, frame = cap.read()
        if not ret:
            raise Exception("Failed to capture frame")
        
        # Calculate homography
        success, homography, error, markers_detected = calibrator.calculate_homography_from_single_image(frame)
        
        result = {
            'ok': success,
            'homography_matrix': homography.flatten().tolist() if success else None,
            'reprojection_error': error if success else None,
            'markers_detected': markers_detected
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        logger.error(f"Error in main: {e}")
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
    
    finally:
        if 'cap' in locals():
            cap.release()
        cv2.destroyAllWindows()

if __name__ == '__main__':
    main()
