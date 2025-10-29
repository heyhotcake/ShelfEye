#!/usr/bin/env python3
"""
Test Mode ArUco Calibrator - Processes static images instead of camera capture
"""

import argparse
import json
import sys
import os
import logging
import numpy as np
import cv2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TestArucoCalibrator:
    def __init__(self, dictionary_type=cv2.aruco.DICT_4X4_100):
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(dictionary_type)
        self.detector_params = cv2.aruco.DetectorParameters()
        self.corner_ids = [17, 18, 19, 20]
        
    def detect_corner_markers(self, image: np.ndarray):
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            corners, ids, _ = cv2.aruco.detectMarkers(gray, self.aruco_dict, parameters=self.detector_params)
            
            if ids is None or len(corners) == 0:
                logger.warning("No markers detected")
                return {}, 0
            
            marker_centers = {}
            for i, marker_id in enumerate(ids.flatten()):
                if marker_id in self.corner_ids:
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
    
    def calculate_homography(self, marker_centers, paper_size_cm):
        try:
            if len(marker_centers) != 4:
                logger.warning(f"Need all 4 markers, only found {len(marker_centers)}")
                return False, None
            
            missing_ids = set(self.corner_ids) - set(marker_centers.keys())
            if missing_ids:
                logger.warning(f"Missing marker IDs: {missing_ids}")
                return False, None
            
            # Destination points: detected marker centers in pixels
            dst_points = np.array([
                marker_centers[17],  # A: top-left
                marker_centers[18],  # B: top-right
                marker_centers[19],  # C: bottom-right
                marker_centers[20],  # D: bottom-left
            ], dtype=np.float32)
            
            # Source points: paper corners in cm
            paper_width_cm, paper_height_cm = paper_size_cm
            marker_size_cm = 5.0
            marker_center_offset = marker_size_cm / 2.0
            
            src_points = np.array([
                [marker_center_offset, marker_center_offset],
                [paper_width_cm - marker_center_offset, marker_center_offset],
                [paper_width_cm - marker_center_offset, paper_height_cm - marker_center_offset],
                [marker_center_offset, paper_height_cm - marker_center_offset],
            ], dtype=np.float32)
            
            # Calculate homography
            homography, _ = cv2.findHomography(src_points, dst_points, cv2.RANSAC, 5.0)
            
            if homography is None:
                logger.error("Failed to calculate homography")
                return False, None
            
            logger.info(f"Homography calculated successfully")
            logger.info(f"Paper size: {paper_width_cm}cm × {paper_height_cm}cm")
            
            return True, homography
            
        except Exception as e:
            logger.error(f"Error calculating homography: {e}")
            return False, None
    
    def calibrate_from_image(self, image_path, paper_size_cm, output_dir):
        try:
            # Load image
            logger.info(f"Loading image: {image_path}")
            image = cv2.imread(image_path)
            if image is None:
                raise Exception(f"Could not load image: {image_path}")
            
            logger.info(f"Image loaded: {image.shape[1]}x{image.shape[0]}px")
            
            # Detect corner markers
            marker_centers, num_detected = self.detect_corner_markers(image)
            
            if num_detected != 4:
                return {
                    'success': False,
                    'error': f'Only detected {num_detected}/4 corner markers',
                    'markers_detected': num_detected,
                    'detected_ids': [int(k) for k in marker_centers.keys()]
                }
            
            # Calculate homography
            success, homography = self.calculate_homography(marker_centers, paper_size_cm)
            
            if not success or homography is None:
                return {
                    'success': False,
                    'error': 'Failed to calculate homography',
                    'markers_detected': num_detected
                }
            
            # Generate rectified image at 100 pixels/cm for QR detection
            pixels_per_cm = 100
            output_width = int(paper_size_cm[0] * pixels_per_cm)
            output_height = int(paper_size_cm[1] * pixels_per_cm)
            
            logger.info(f"Generating rectified image: {output_width}x{output_height}px")
            
            # Create output coordinate system (cm → pixels in rectified image)
            M_output = np.array([
                [pixels_per_cm, 0, 0],
                [0, pixels_per_cm, 0],
                [0, 0, 1]
            ], dtype=np.float32)
            
            # Combined transformation: input pixels → cm → output pixels
            M_combined = M_output @ np.linalg.inv(homography)
            
            # Warp image
            rectified = cv2.warpPerspective(image, M_combined, (output_width, output_height))
            
            # Save rectified image
            os.makedirs(output_dir, exist_ok=True)
            rectified_path = os.path.join(output_dir, 'test_rectified.jpg')
            cv2.imwrite(rectified_path, rectified, [cv2.IMWRITE_JPEG_QUALITY, 95])
            logger.info(f"Saved rectified image to: {rectified_path}")
            
            return {
                'success': True,
                'homography_matrix': homography.tolist(),
                'markers_detected': num_detected,
                'marker_positions': {
                    f"marker_{id}": center.tolist() 
                    for id, center in marker_centers.items()
                },
                'rectified_image_path': rectified_path,
                'rectified_size': {
                    'width': output_width,
                    'height': output_height
                }
            }
            
        except Exception as e:
            logger.error(f"Error in calibration: {e}")
            return {
                'success': False,
                'error': str(e),
                'markers_detected': 0
            }

def main():
    parser = argparse.ArgumentParser(description='Test Mode ArUco Calibration from Image File')
    parser.add_argument('--image-path', type=str, required=True, help='Path to input image file')
    parser.add_argument('--paper-width-cm', type=float, required=True, help='Paper width in cm')
    parser.add_argument('--paper-height-cm', type=float, required=True, help='Paper height in cm')
    parser.add_argument('--output-dir', type=str, required=True, help='Output directory for rectified image')
    
    args = parser.parse_args()
    
    try:
        paper_size_cm = (args.paper_width_cm, args.paper_height_cm)
        
        calibrator = TestArucoCalibrator()
        result = calibrator.calibrate_from_image(
            args.image_path,
            paper_size_cm,
            args.output_dir
        )
        
        # Output JSON result
        print(json.dumps(result))
        
        # Exit with appropriate code
        sys.exit(0 if result['success'] else 1)
        
    except Exception as e:
        logger.error(f"Error in main: {e}")
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
