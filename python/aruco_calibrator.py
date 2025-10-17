#!/usr/bin/env python3
"""
ArUco 4-Corner Calibration Module for Tool Tracking System
Detects 4 corner ArUco markers (IDs 17-20) and computes homography matrix
"""

import argparse
import json
import sys
import base64
import logging
from typing import Optional, Tuple, Dict
import numpy as np
import cv2
from rectified_preview import generate_rectified_image_from_frame

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
    
    def estimate_camera_matrix(self, image_shape: Tuple[int, int]) -> np.ndarray:
        """
        Estimate camera intrinsic matrix from image dimensions
        Assumes typical webcam with ~60-70 degree horizontal FOV
        
        Args:
            image_shape: (height, width) of the image
            
        Returns:
            3x3 camera matrix
        """
        height, width = image_shape
        # Assume focal length is ~0.8 * width for typical webcams
        focal_length = width * 0.8
        cx = width / 2.0
        cy = height / 2.0
        
        camera_matrix = np.array([
            [focal_length, 0, cx],
            [0, focal_length, cy],
            [0, 0, 1]
        ], dtype=np.float32)
        
        return camera_matrix

    def calculate_homography(self, marker_centers: Dict[int, np.ndarray], 
                            image_shape: Tuple[int, int],
                            paper_size_cm: Tuple[float, float] = (29.7, 21.0)) -> Tuple[bool, Optional[np.ndarray], float, Optional[np.ndarray], Optional[np.ndarray]]:
        """
        Calculate homography matrix from 4 corner markers with lens distortion correction
        Maps real-world paper coordinates (cm) to camera pixels
        
        Args:
            marker_centers: Dictionary of marker ID -> center point (pixels)
            image_shape: (height, width) of the image
            paper_size_cm: (width_cm, height_cm) of the paper (default A4 landscape)
            
        Returns:
            success: Whether calculation was successful
            homography: 3x3 homography matrix that maps cm → pixels
            quality: Quality metric (mean reprojection error in pixels)
            camera_matrix: 3x3 camera intrinsic matrix
            dist_coeffs: Distortion coefficients (k1, k2, p1, p2, k3)
        """
        try:
            # Verify all 4 markers are detected
            if len(marker_centers) != 4:
                logger.warning(f"Need all 4 markers, only found {len(marker_centers)}")
                return False, None, float('inf'), None, None
            
            # Check that all required IDs are present
            missing_ids = set(self.corner_ids) - set(marker_centers.keys())
            if missing_ids:
                logger.warning(f"Missing marker IDs: {missing_ids}")
                return False, None, float('inf'), None, None
            
            # Estimate camera intrinsic matrix
            camera_matrix = self.estimate_camera_matrix(image_shape)
            logger.info(f"Estimated camera matrix: {camera_matrix.tolist()}")
            
            # Initialize distortion coefficients to zero (no distortion correction)
            # The camera may not have significant distortion, or the homography handles it
            # k1, k2, p1, p2, k3
            dist_coeffs = np.array([0.0, 0.0, 0.0, 0.0, 0.0], dtype=np.float32)
            logger.info(f"Using zero distortion coefficients (no distortion correction): {dist_coeffs.tolist()}")
            
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
                return False, None, float('inf'), None, None
            
            # Calculate quality (reprojection error)
            # Transform source points (cm) using homography to get predicted pixel positions
            src_points_homogeneous = np.hstack([src_points, np.ones((4, 1))])
            projected_points_homogeneous = homography @ src_points_homogeneous.T
            projected_points = (projected_points_homogeneous[:2, :] / projected_points_homogeneous[2, :]).T
            
            # Calculate mean reprojection error (difference between detected and predicted positions)
            point_errors = np.linalg.norm(dst_points - projected_points, axis=1)
            reprojection_error = np.mean(point_errors)
            max_error = np.max(point_errors)
            
            logger.info(f"Homography calculated successfully (maps cm → pixels)")
            logger.info(f"Paper size: {paper_width_cm}cm × {paper_height_cm}cm")
            logger.info(f"Detected points: {dst_points.tolist()}")
            logger.info(f"Projected points: {projected_points.tolist()}")
            logger.info(f"Point-wise errors: {point_errors.tolist()}")
            logger.info(f"Reprojection error: mean={reprojection_error:.4f} px, max={max_error:.4f} px")
            logger.info(f"Note: With 4 points, homography fits perfectly (8 DOF = 8 constraints), so error is near-zero")
            logger.info(f"Camera matrix and distortion coefficients estimated (distortion currently set to zero)")
            
            return True, homography, reprojection_error, camera_matrix, dist_coeffs
            
        except Exception as e:
            logger.error(f"Error calculating homography: {e}")
            return False, None, float('inf'), None, None
    
    def calibrate_from_camera(self, camera_index: int, resolution: Tuple[int, int], 
                             paper_size_cm: Tuple[float, float] = (29.7, 21.0),
                             device_path: Optional[str] = None,
                             generate_preview: bool = False,
                             preview_output_size: Optional[Tuple[int, int]] = None,
                             templates: Optional[list] = None) -> Dict:
        """
        Capture frame from camera and calculate homography
        
        Args:
            camera_index: Camera device index (0, 1, 2, etc.) - used if device_path not provided
            resolution: (width, height) tuple
            paper_size_cm: (width_cm, height_cm) of the paper template
            device_path: Device path for Raspberry Pi (/dev/video0, /dev/video1, etc.)
            generate_preview: Whether to generate rectified preview from calibration frame
            preview_output_size: (width, height) for rectified preview output
            templates: Template rectangles for overlay on preview
            
        Returns:
            Dictionary with calibration results (and optional rectified preview)
        """
        cap = None
        try:
            # Initialize camera - use device path if provided, otherwise use index
            camera_source = device_path if device_path else camera_index
            logger.info(f"Opening camera: {camera_source}")
            cap = cv2.VideoCapture(camera_source)
            if not cap.isOpened():
                raise Exception(f"Could not open camera {camera_source}")
            
            width, height = resolution
            
            # Set MJPG format for better performance with USB cameras
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
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
                success, homography, error, camera_matrix, dist_coeffs = self.calculate_homography(
                    marker_centers, frame.shape[:2], paper_size_cm
                )
                
                if success and homography is not None:
                    result = {
                        'ok': True,
                        'homography_matrix': homography.flatten().tolist(),
                        'camera_matrix': camera_matrix.flatten().tolist() if camera_matrix is not None else None,
                        'dist_coeffs': dist_coeffs.flatten().tolist() if dist_coeffs is not None else None,
                        'reprojection_error': float(error),
                        'markers_detected': num_detected,
                        'marker_positions': {
                            f"marker_{id}": center.tolist() 
                            for id, center in marker_centers.items()
                        }
                    }
                    
                    # Generate rectified preview if requested
                    if generate_preview and preview_output_size:
                        try:
                            logger.info("Generating rectified preview from calibration frame")
                            rectified = generate_rectified_image_from_frame(
                                frame, homography, preview_output_size, paper_size_cm, templates,
                                camera_matrix, dist_coeffs
                            )
                            # Encode as base64
                            _, buffer = cv2.imencode('.jpg', rectified)
                            image_base64 = base64.b64encode(buffer).decode('utf-8')
                            result['rectified_preview'] = f'data:image/jpeg;base64,{image_base64}'
                            logger.info("Rectified preview generated successfully")
                        except Exception as preview_err:
                            logger.warning(f"Failed to generate rectified preview: {preview_err}")
                            # Don't fail calibration if preview generation fails
                    
                    return result
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
                    'detected_ids': [int(k) for k in marker_centers.keys()]
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
    parser.add_argument('--camera', type=int, default=0, help='Camera device index (fallback if --device-path not provided)')
    parser.add_argument('--device-path', type=str, help='Camera device path for Raspberry Pi (e.g., /dev/video0)')
    parser.add_argument('--resolution', type=str, default='1920x1080', help='Camera resolution (WxH)')
    parser.add_argument('--paper-size', type=str, default='29.7x21.0', help='Paper size in cm (WidthxHeight)')
    parser.add_argument('--generate-preview', action='store_true', help='Generate rectified preview from calibration frame')
    parser.add_argument('--preview-output-size', type=str, help='Preview output size (WxH)')
    parser.add_argument('--templates', type=str, help='Template rectangles as JSON string')
    
    args = parser.parse_args()
    
    try:
        # Parse resolution
        width, height = map(int, args.resolution.split('x'))
        resolution = (width, height)
        
        # Parse paper size
        paper_width, paper_height = map(float, args.paper_size.split('x'))
        paper_size_cm = (paper_width, paper_height)
        
        # Parse preview output size if provided
        preview_output_size = None
        if args.preview_output_size:
            prev_width, prev_height = map(int, args.preview_output_size.split('x'))
            preview_output_size = (prev_width, prev_height)
        
        # Parse templates if provided
        templates = None
        if args.templates:
            templates = json.loads(args.templates)
        
        # Initialize calibrator
        calibrator = ArucoCornerCalibrator()
        
        # Run calibration
        result = calibrator.calibrate_from_camera(
            args.camera, resolution, paper_size_cm, device_path=args.device_path,
            generate_preview=args.generate_preview,
            preview_output_size=preview_output_size,
            templates=templates
        )
        
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
