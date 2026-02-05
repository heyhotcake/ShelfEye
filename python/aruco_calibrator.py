#!/usr/bin/env python3
"""
ArUco 4-Corner Calibration Module for Tool Tracking System
Detects 4 corner ArUco markers (IDs 96-99) and computes homography matrix
"""

import argparse
import json
import sys
import base64
import logging
import time
import os
from typing import Optional, Tuple, Dict
import numpy as np
import cv2
from rectified_preview import generate_rectified_image_from_frame

# Import camera utilities for consistent settings with preview
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from camera_utils_picam2 import setup_camera_picam2, warmup_camera_picam2, capture_optimal_frame_picam2, capture_frame_for_aruco_picam2

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
        self.detector_params.perspectiveRemovePixelPerCell = 16  # CRITICAL: Increased from 8 to preserve 95px slot markers
        
        # Lenient parameters for low-contrast/dark corner detection
        self.detector_params.adaptiveThreshWinSizeMin = 3
        self.detector_params.adaptiveThreshWinSizeMax = 53  # Larger window for uneven lighting
        self.detector_params.adaptiveThreshWinSizeStep = 4  # More steps for better detection
        self.detector_params.adaptiveThreshConstant = 7     # Standard value
        self.detector_params.minMarkerPerimeterRate = 0.02  # Allow smaller markers
        self.detector_params.maxMarkerPerimeterRate = 4.0   # Allow larger markers
        self.detector_params.polygonalApproxAccuracyRate = 0.05  # More lenient polygon approximation
        self.detector_params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX  # Better corner accuracy
        
        # Expected corner marker IDs: 96-99 (reserved high IDs to avoid conflict with slot markers 1-50)
        # A=96 (top-left), B=97 (top-right), C=98 (bottom-right), D=99 (bottom-left)
        self.corner_ids = [96, 97, 98, 99]
        
    def get_outer_corner_index(self, marker_id: int) -> int:
        """
        Get the corner index for the outermost point of each corner marker.
        
        ArUco marker corners are returned in order: [top-left=0, top-right=1, bottom-right=2, bottom-left=3]
        For each corner marker, we want the corner that points toward the paper edge:
        - Marker 96 (top-left of paper): use corner 0 (its top-left corner)
        - Marker 97 (top-right of paper): use corner 1 (its top-right corner)
        - Marker 98 (bottom-right of paper): use corner 2 (its bottom-right corner)
        - Marker 99 (bottom-left of paper): use corner 3 (its bottom-left corner)
        
        Args:
            marker_id: The ArUco marker ID (96, 97, 98, or 99)
            
        Returns:
            Corner index (0, 1, 2, or 3)
        """
        corner_mapping = {
            96: 0,  # top-left marker → use its top-left corner
            97: 1,  # top-right marker → use its top-right corner
            98: 2,  # bottom-right marker → use its bottom-right corner
            99: 3,  # bottom-left marker → use its bottom-left corner
        }
        return corner_mapping.get(marker_id, 0)
    
    def detect_corner_markers(self, image: np.ndarray) -> Tuple[Dict[int, np.ndarray], Dict[int, np.ndarray], int]:
        """
        Detect the 4 corner ArUco markers in the image
        
        Returns:
            marker_centers: Dictionary mapping marker ID to center point (x, y)
            marker_outer_corners: Dictionary mapping marker ID to outer corner point (x, y)
            num_detected: Number of corner markers detected
        """
        try:
            # Convert to grayscale if needed
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            
            # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) to improve
            # detection in dark corners where lighting is uneven
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            gray_enhanced = clahe.apply(gray)
            
            # Save debug image showing enhanced version
            try:
                debug_path = '/tmp/aruco_clahe_enhanced.jpg'
                cv2.imwrite(debug_path, gray_enhanced)
                logger.info(f"Saved CLAHE-enhanced debug image to {debug_path}")
            except Exception as e:
                logger.warning(f"Could not save debug image: {e}")
            
            # First try detection on enhanced image
            corners, ids, rejected = cv2.aruco.detectMarkers(
                gray_enhanced, self.aruco_dict, parameters=self.detector_params
            )
            enhanced_corner_count = len([i for i in ids.flatten() if i in self.corner_ids]) if ids is not None else 0
            logger.info(f"CLAHE-enhanced detection found {enhanced_corner_count}/4 corner markers")
            
            # If we didn't find all 4 corner markers, try original image too
            if ids is None or len([i for i in ids.flatten() if i in self.corner_ids]) < 4:
                corners_orig, ids_orig, _ = cv2.aruco.detectMarkers(
                    gray, self.aruco_dict, parameters=self.detector_params
                )
                # Merge results, preferring enhanced detection
                if ids_orig is not None:
                    if ids is None:
                        corners, ids = corners_orig, ids_orig
                    else:
                        # Add any markers from original that weren't in enhanced
                        enhanced_ids = set(ids.flatten())
                        for i, marker_id in enumerate(ids_orig.flatten()):
                            if marker_id not in enhanced_ids:
                                corners = list(corners) + [corners_orig[i]]
                                ids = np.vstack([ids, [[marker_id]]])
                                logger.info(f"Added marker {marker_id} from original (non-enhanced) detection")
            
            if ids is None or len(corners) == 0:
                logger.warning("No markers detected")
                return {}, {}, 0
            
            # Extract center points AND outer corner points for our corner markers
            marker_centers = {}
            marker_outer_corners = {}
            for i, marker_id in enumerate(ids.flatten()):
                if marker_id in self.corner_ids:
                    # Get all 4 corners of the marker
                    corner_points = corners[i][0]
                    
                    # Calculate center of the marker (average of 4 corners)
                    center_x = np.mean(corner_points[:, 0])
                    center_y = np.mean(corner_points[:, 1])
                    marker_centers[marker_id] = np.array([center_x, center_y], dtype=np.float32)
                    
                    # Get the outermost corner for this marker
                    outer_corner_idx = self.get_outer_corner_index(marker_id)
                    outer_corner = corner_points[outer_corner_idx]
                    marker_outer_corners[marker_id] = np.array([outer_corner[0], outer_corner[1]], dtype=np.float32)
                    
                    logger.info(f"Marker {marker_id}: center=({center_x:.1f}, {center_y:.1f}), "
                               f"outer corner[{outer_corner_idx}]=({outer_corner[0]:.1f}, {outer_corner[1]:.1f})")
            
            num_detected = len(marker_centers)
            logger.info(f"Detected {num_detected}/4 corner markers: {list(marker_centers.keys())}")
            
            return marker_centers, marker_outer_corners, num_detected
            
        except Exception as e:
            logger.error(f"Error detecting corner markers: {e}")
            return {}, {}, 0
    
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
                            marker_outer_corners: Dict[int, np.ndarray],
                            image_shape: Tuple[int, int],
                            paper_size_cm: Tuple[float, float] = (29.7, 21.0),
                            paper_size_name: str = 'A4-landscape') -> Tuple[bool, Optional[np.ndarray], float, Optional[np.ndarray], Optional[np.ndarray]]:
        """
        Calculate homography matrix from 4 corner markers using their OUTER corners
        Maps real-world paper coordinates (cm) to camera pixels
        
        The homography is calculated using the outermost corner of each ArUco marker,
        which defines the exact boundary of the rectified image. This minimizes
        distortion by cropping to only the necessary area.
        
        Args:
            marker_centers: Dictionary of marker ID -> center point (pixels) - for reference
            marker_outer_corners: Dictionary of marker ID -> outer corner point (pixels) - used for homography
            image_shape: (height, width) of the image
            paper_size_cm: (width_cm, height_cm) of the paper (default A4 landscape)
            paper_size_name: Paper format name (e.g., '8-page-4x2', '6-page-3x2', 'A4-landscape')
            
        Returns:
            success: Whether calculation was successful
            homography: 3x3 homography matrix that maps cm → pixels
            quality: Quality metric (mean reprojection error in pixels)
            camera_matrix: 3x3 camera intrinsic matrix
            dist_coeffs: Distortion coefficients (k1, k2, p1, p2, k3)
        """
        try:
            # Verify all 4 markers are detected
            if len(marker_outer_corners) != 4:
                logger.warning(f"Need all 4 markers, only found {len(marker_outer_corners)}")
                return False, None, float('inf'), None, None
            
            # Check that all required IDs are present
            missing_ids = set(self.corner_ids) - set(marker_outer_corners.keys())
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
            
            # Destination points: OUTER CORNERS of markers in pixels (in order A, B, C, D)
            # This defines the exact crop boundary of the rectified image
            # A (96) = top-left marker's top-left corner
            # B (97) = top-right marker's top-right corner
            # C (98) = bottom-right marker's bottom-right corner
            # D (99) = bottom-left marker's bottom-left corner
            dst_points = np.array([
                marker_outer_corners[96],  # A: top-left outer corner
                marker_outer_corners[97],  # B: top-right outer corner
                marker_outer_corners[98],  # C: bottom-right outer corner
                marker_outer_corners[99],  # D: bottom-left outer corner
            ], dtype=np.float32)
            
            logger.info(f"Using OUTER CORNERS for homography (not marker centers)")
            logger.info(f"Outer corners (pixels): TL={dst_points[0].tolist()}, TR={dst_points[1].tolist()}, "
                       f"BR={dst_points[2].tolist()}, BL={dst_points[3].tolist()}")
            
            # Source points: OUTER CORNER positions in cm (real-world coordinates)
            # The outer corners of the markers define the exact boundary of the paper area
            # For multi-sheet layouts, markers are at SHEET corners with 1cm inset
            # For single-sheet layouts, markers are at PAPER corners with 1cm inset
            paper_width_cm, paper_height_cm = paper_size_cm
            marker_size_cm = 5.0
            marker_inset_cm = 1.0  # 10mm safe zone from sheet/paper edge
            
            # Check if this is a multi-sheet layout
            is_8_page = paper_size_name == '8-page-4x2'
            is_6_page = paper_size_name == '6-page-3x2'
            is_multi_sheet = is_8_page or is_6_page
            
            logger.info(f"Paper size name: {paper_size_name}, is_multi_sheet: {is_multi_sheet}")
            
            if is_multi_sheet:
                # Multi-sheet layouts: markers at sheet corners with 1cm inset
                a4_width_cm = 29.7
                a4_height_cm = 21.0
                grid_cols = 4 if is_8_page else 3
                grid_rows = 2
                
                # OUTER CORNERS (not centers) - the corners pointing toward paper edges
                # Top-left (Sheet 1): marker's outer corner at (inset, inset)
                top_left_x = marker_inset_cm
                top_left_y = marker_inset_cm
                
                # Top-right (Sheet 4 or 3): marker's outer corner at (sheet_right - inset, inset)
                # The outer corner is at: (gridCols-1) * sheetWidth + (sheetWidth - inset)
                top_right_x = (grid_cols - 1) * a4_width_cm + (a4_width_cm - marker_inset_cm)
                top_right_y = marker_inset_cm
                
                # Bottom-left (Sheet 5 or 4): marker's outer corner at (inset, sheet_bottom - inset)
                bottom_left_x = marker_inset_cm
                bottom_left_y = (grid_rows - 1) * a4_height_cm + (a4_height_cm - marker_inset_cm)
                
                # Bottom-right (Sheet 8 or 6): marker's outer corner at (sheet_right - inset, sheet_bottom - inset)
                bottom_right_x = (grid_cols - 1) * a4_width_cm + (a4_width_cm - marker_inset_cm)
                bottom_right_y = (grid_rows - 1) * a4_height_cm + (a4_height_cm - marker_inset_cm)
                
                src_points = np.array([
                    [top_left_x, top_left_y],      # A (96): top-left outer corner
                    [top_right_x, top_right_y],    # B (97): top-right outer corner
                    [bottom_right_x, bottom_right_y],  # C (98): bottom-right outer corner
                    [bottom_left_x, bottom_left_y],    # D (99): bottom-left outer corner
                ], dtype=np.float32)
                
                logger.info(f"Multi-sheet OUTER CORNER positions (cm): TL=({top_left_x:.1f},{top_left_y:.1f}), "
                           f"TR=({top_right_x:.1f},{top_right_y:.1f}), BR=({bottom_right_x:.1f},{bottom_right_y:.1f}), "
                           f"BL=({bottom_left_x:.1f},{bottom_left_y:.1f})")
            else:
                # Single-sheet layouts: markers at paper corners with 1cm inset
                # Outer corner = just the inset distance from each edge
                src_points = np.array([
                    [marker_inset_cm, marker_inset_cm],  # A: top-left outer corner
                    [paper_width_cm - marker_inset_cm, marker_inset_cm],  # B: top-right outer corner
                    [paper_width_cm - marker_inset_cm, paper_height_cm - marker_inset_cm],  # C: bottom-right outer corner
                    [marker_inset_cm, paper_height_cm - marker_inset_cm],  # D: bottom-left outer corner
                ], dtype=np.float32)
                
                logger.info(f"Single-sheet OUTER CORNER positions with 1cm inset (cm)")
            
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
            
            # Calculate actual pixel density from detected markers
            # Measure horizontal and vertical pixel distances between markers
            horizontal_pixels = np.linalg.norm(dst_points[1] - dst_points[0])  # Top-left to top-right
            vertical_pixels = np.linalg.norm(dst_points[3] - dst_points[0])  # Top-left to bottom-left
            # Use source points to calculate distances between marker centers
            horizontal_cm = float(src_points[1][0] - src_points[0][0])  # Distance between marker centers
            vertical_cm = float(src_points[3][1] - src_points[0][1])
            measured_px_per_cm_h = float(horizontal_pixels / horizontal_cm)
            measured_px_per_cm_v = float(vertical_pixels / vertical_cm)
            
            # Store the measured pixel density for later use in generating rectified images
            self.measured_px_per_cm = float(min(measured_px_per_cm_h, measured_px_per_cm_v))
            
            logger.info(f"Homography calculated successfully (maps cm → pixels)")
            logger.info(f"Paper size: {paper_width_cm}cm × {paper_height_cm}cm")
            logger.info(f"Detected points: {dst_points.tolist()}")
            logger.info(f"Projected points: {projected_points.tolist()}")
            logger.info(f"Point-wise errors: {point_errors.tolist()}")
            logger.info(f"Reprojection error: mean={reprojection_error:.4f} px, max={max_error:.4f} px")
            logger.info(f"MEASURED pixel density: {measured_px_per_cm_h:.1f} px/cm (horizontal), {measured_px_per_cm_v:.1f} px/cm (vertical)")
            logger.info(f"Using {self.measured_px_per_cm:.1f} px/cm for native-resolution rectified images (no upsampling)")
            logger.info(f"Note: With 4 points, homography fits perfectly (8 DOF = 8 constraints), so error is near-zero")
            logger.info(f"Camera matrix and distortion coefficients estimated (distortion currently set to zero)")
            
            return True, homography, reprojection_error, camera_matrix, dist_coeffs
        except Exception as e:
            logger.error(f"Error calculating homography: {e}")
            return False, None, float('inf'), None, None
    
    def validate_slot_markers_on_raw_frame(self, frame: np.ndarray, homography: np.ndarray, 
                                          paper_size_cm: Tuple[float, float], 
                                          templates: list) -> dict:
        """
        Validate slot ArUco markers on the RAW camera frame (before any warpPerspective)
        This avoids interpolation artifacts that corrupt markers
        
        Args:
            frame: Raw camera frame
            homography: Homography matrix (cm → pixels)
            paper_size_cm: Paper size in cm
            templates: List of template slot configurations with x, y positions in cm
            
        Returns:
            Dictionary with validation results
        """
        # ArUco detector setup (same dictionary as corner markers)
        aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
        aruco_params = cv2.aruco.DetectorParameters()
        aruco_params.perspectiveRemovePixelPerCell = 16
        
        results = {
            'total_count': len(templates),
            'valid_count': 0,
            'invalid_count': 0,
            'slots': []
        }
        
        for i, template in enumerate(templates):
            slot_id = template.get('autoQrId', str(i + 1))
            expected_marker_id = int(slot_id) if slot_id.isdigit() else None
            x_cm = template.get('x', 0)
            y_cm = template.get('y', 0)
            
            # Map slot position (cm) → raw pixel coordinates using homography
            slot_pos_cm = np.array([[x_cm, y_cm]], dtype=np.float32).reshape(-1, 1, 2)
            slot_pos_px = cv2.perspectiveTransform(slot_pos_cm, homography)[0][0]
            
            # Extract ROI from raw frame (5cm = ~159px at 31.8 px/cm, ±2.5cm tolerance)
            roi_size_cm = 5.0
            roi_size_px = int(roi_size_cm * self.measured_px_per_cm)
            half_roi = roi_size_px // 2
            
            x1 = max(0, int(slot_pos_px[0]) - half_roi)
            y1 = max(0, int(slot_pos_px[1]) - half_roi)
            x2 = min(frame.shape[1], x1 + roi_size_px)
            y2 = min(frame.shape[0], y1 + roi_size_px)
            
            roi = frame[y1:y2, x1:x2]
            
            # Convert to grayscale if needed
            if len(roi.shape) == 3:
                roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            else:
                roi_gray = roi
            
            # Detect ArUco markers in ROI
            corners, ids, rejected = cv2.aruco.detectMarkers(roi_gray, aruco_dict, parameters=aruco_params)
            
            detected = False
            detected_id = None
            if ids is not None and len(ids) > 0:
                detected_id = int(ids[0][0])
                detected = (detected_id == expected_marker_id)
            
            slot_result = {
                'slot_id': slot_id,
                'expected_id': expected_marker_id,
                'detected': detected,
                'detected_id': detected_id,
                'position_cm': (x_cm, y_cm),
                'position_px': (int(slot_pos_px[0]), int(slot_pos_px[1]))
            }
            
            results['slots'].append(slot_result)
            
            if detected:
                results['valid_count'] += 1
                logger.info(f"✓ Slot {slot_id}: Marker {expected_marker_id} detected")
            else:
                results['invalid_count'] += 1
                logger.warning(f"✗ Slot {slot_id}: Expected {expected_marker_id}, got {detected_id if detected_id else 'nothing'}")
        
        return results
    
    def validate_slot_markers_on_rectified_image(self, rectified_image: np.ndarray, 
                                                   paper_size_cm: Tuple[float, float],
                                                   templates: list) -> Dict:
        """
        Validate slot ArUco markers on RECTIFIED image (simpler, faster than raw frame validation)
        
        This uses the already-rectified image where:
        - Pixel density is uniform (measured_px_per_cm)
        - ArUco markers are already perspective-corrected (perfect squares)
        - Simple cm → pixel conversion: x_px = x_cm * px_per_cm
        
        Args:
            rectified_image: High-resolution rectified image
            paper_size_cm: (width_cm, height_cm) of the paper
            templates: List of template rectangles with x, y (cm), autoQrId
            
        Returns:
            Dictionary with validation results
        """
        aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
        aruco_params = cv2.aruco.DetectorParameters()
        aruco_params.perspectiveRemovePixelPerCell = 16
        
        # Calculate pixels per cm from image and BOUNDED area (not full paper!)
        # The rectified image is cropped to marker-bounded area (1cm inset from paper edges)
        # This matches rectified_preview.py which uses the same cropping
        img_height, img_width = rectified_image.shape[:2]
        marker_inset_cm = 1.0  # Matches aruco_calibrator.py and rectified_preview.py
        bounded_width_cm = paper_size_cm[0] - 2 * marker_inset_cm
        bounded_height_cm = paper_size_cm[1] - 2 * marker_inset_cm
        px_per_cm = img_width / bounded_width_cm
        
        logger.info(f"Rectified validation setup:")
        logger.info(f"  Image: {img_width}x{img_height}px")
        logger.info(f"  Paper: {paper_size_cm[0]}x{paper_size_cm[1]} cm")
        logger.info(f"  Bounded area: {bounded_width_cm}x{bounded_height_cm} cm (1cm inset)")
        logger.info(f"  Scale: {px_per_cm:.2f} px/cm")
        logger.info(f"  Templates to validate: {len(templates)}")
        
        results = {
            'total_count': len(templates),
            'valid_count': 0,
            'invalid_count': 0,
            'slots': []
        }
        
        # Create CLAHE enhancer (matches scheduled capture settings)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        
        for i, template in enumerate(templates):
            slot_id = template.get('autoQrId', str(i + 1))
            expected_marker_id = int(slot_id) if str(slot_id).isdigit() else None
            
            # Templates store CENTER coordinates (xCm, yCm) in PAPER space
            # This matches slot-drawing.tsx and rectified-preview-canvas.tsx
            center_x_cm = template.get('x', 0)
            center_y_cm = template.get('y', 0)
            width_cm = template.get('width', 4.0)
            height_cm = template.get('height', 4.0)
            
            # Convert PAPER coordinates to CROPPED IMAGE coordinates
            # The rectified image is cropped: pixel (0,0) = paper cm (1.0, 1.0)
            # Formula: output_x = (cm_x - marker_inset_cm) * px_per_cm
            adjusted_x_cm = center_x_cm - marker_inset_cm
            adjusted_y_cm = center_y_cm - marker_inset_cm
            center_x_px = int(adjusted_x_cm * px_per_cm)
            center_y_px = int(adjusted_y_cm * px_per_cm)
            
            # Extract ROI around slot CENTER (5cm gives ±2.5cm tolerance)
            roi_size_cm = 5.0
            roi_size_px = int(roi_size_cm * px_per_cm)
            half_roi = roi_size_px // 2
            
            x1 = max(0, center_x_px - half_roi)
            y1 = max(0, center_y_px - half_roi)
            x2 = min(img_width, x1 + roi_size_px)
            y2 = min(img_height, y1 + roi_size_px)
            
            roi = rectified_image[y1:y2, x1:x2]
            
            if roi.size == 0:
                logger.warning(f"Empty ROI for slot {slot_id} at center ({center_x_cm:.1f}, {center_y_cm:.1f}) cm")
                results['invalid_count'] += 1
                results['slots'].append({
                    'slot_id': slot_id,
                    'expected_id': expected_marker_id,
                    'detected': False,
                    'detected_id': None,
                    'center_cm': (center_x_cm, center_y_cm),
                    'slot_size_cm': (width_cm, height_cm),
                    'position_px': (center_x_px, center_y_px)
                })
                continue
            
            # Convert to grayscale
            if len(roi.shape) == 3:
                roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            else:
                roi_gray = roi
            
            # Apply CLAHE enhancement for better ArUco detection (matches scheduled capture)
            roi_gray = clahe.apply(roi_gray)
            
            # Detect ArUco markers
            corners, ids, rejected = cv2.aruco.detectMarkers(roi_gray, aruco_dict, parameters=aruco_params)
            
            detected = False
            detected_id = None
            if ids is not None and len(ids) > 0:
                detected_id = int(ids[0][0])
                detected = (detected_id == expected_marker_id)
            
            slot_result = {
                'slot_id': slot_id,
                'expected_id': expected_marker_id,
                'detected': detected,
                'detected_id': detected_id,
                'center_cm': (center_x_cm, center_y_cm),
                'adjusted_cm': (adjusted_x_cm, adjusted_y_cm),
                'position_px': (center_x_px, center_y_px)
            }
            results['slots'].append(slot_result)
            
            if detected:
                results['valid_count'] += 1
                logger.info(f"✓ Slot {slot_id}: Marker {expected_marker_id} detected at px ({center_x_px}, {center_y_px})")
            else:
                results['invalid_count'] += 1
                logger.warning(f"✗ Slot {slot_id}: Expected {expected_marker_id}, got {detected_id if detected_id else 'nothing'}")
        
        return results
    
    def calibrate_from_camera(self, camera_index: int, resolution: Tuple[int, int], 
                             paper_size_cm: Tuple[float, float] = (29.7, 21.0),
                             paper_size_name: str = 'A4-landscape',
                             camera_id: str = 'default',
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
            paper_size_name: Paper format name (e.g., '8-page-4x2', '6-page-3x2', 'A4-landscape')
            camera_id: Camera ID for file namespacing (multi-camera support)
            device_path: Device path for Raspberry Pi (/dev/video0, /dev/video1, etc.)
            generate_preview: Whether to generate rectified preview from calibration frame
            preview_output_size: (width, height) for rectified preview output
            templates: Template rectangles for overlay on preview
            
        Returns:
            Dictionary with calibration results (and optional rectified preview)
        """
        picam2 = None
        try:
            # Convert device path to index if needed
            if device_path and device_path.startswith('/dev/video'):
                cam_idx = int(device_path.replace('/dev/video', ''))
            else:
                cam_idx = camera_index
            
            logger.info(f"Opening camera: {cam_idx}")
            
            width, height = resolution
            
            # Setup camera with Picamera2
            picam2 = setup_camera_picam2(cam_idx, resolution=(width, height))
            picam2.start()
            
            # Warmup for autofocus/auto-exposure stability (20 seconds)
            # At 4K MJPEG (~7fps), this is 140+ frames for autofocus to converge
            warmup_camera_picam2(picam2, duration_seconds=20)
            
            # Use ArUco-optimized capture for marker detection
            # This uses CLAHE instead of aggressive sharpening to avoid halos around markers
            # Takes 50 frames and keeps the sharpest one - maximum reliability
            frame = capture_frame_for_aruco_picam2(picam2, num_frames=50)
            
            # CRITICAL: Verify actual captured resolution matches requested resolution
            if frame is not None:
                actual_height, actual_width = frame.shape[:2]
                logger.info(f"✓ Captured frame resolution: {actual_width}x{actual_height} (requested: {width}x{height})")
                if actual_width != width or actual_height != height:
                    logger.warning(f"⚠ RESOLUTION MISMATCH! Requested {width}x{height} but got {actual_width}x{actual_height}")
                    logger.warning(f"⚠ This may cause ArUco detection issues. Check camera capabilities.")
            
            if frame is None:
                raise Exception("Failed to capture frame from camera")
            
            # Detect corner markers (returns both centers and outer corners)
            marker_centers, marker_outer_corners, num_detected = self.detect_corner_markers(frame)
            
            # Calculate homography if all markers found
            if num_detected == 4:
                success, homography, error, camera_matrix, dist_coeffs = self.calculate_homography(
                    marker_centers, marker_outer_corners, frame.shape[:2], paper_size_cm, paper_size_name
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
                        },
                        'marker_outer_corners': {
                            f"marker_{id}": corner.tolist() 
                            for id, corner in marker_outer_corners.items()
                        },
                        # Include measured pixel density for frontend coordinate mapping
                        'measured_px_per_cm': self.measured_px_per_cm,
                        'paper_size_cm': list(paper_size_cm),  # [width, height]
                    }
                    
                    # INTEGRATED SLOT VALIDATION on raw camera frame
                    # Validate slot markers on the SAME raw frame (no warpPerspective corruption)
                    if templates and len(templates) > 0:
                        logger.info(f"Validating {len(templates)} slot markers on raw camera frame...")
                        slot_validation_results = self.validate_slot_markers_on_raw_frame(
                            frame, homography, paper_size_cm, templates
                        )
                        result['slot_validation'] = slot_validation_results
                        logger.info(f"Slot validation: {slot_validation_results['valid_count']}/{slot_validation_results['total_count']} markers detected")
                    
                    # ALWAYS save the high-resolution rectified image for validation
                    # (Even if preview not requested)
                    import os
                    data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
                    os.makedirs(data_dir, exist_ok=True)
                    
                    # Calculate native resolution rectified image with UNIFORM pixel density
                    # CRITICAL: Must maintain aspect ratio to prevent ArUco marker distortion
                    frame_height, frame_width = frame.shape[:2]
                    pixels_per_cm = self.measured_px_per_cm
                    
                    # Use measured dimensions ONLY (no stretching to match frame size)
                    # This ensures uniform pixel density (critical for ArUco detection)
                    highres_width = int(paper_size_cm[0] * pixels_per_cm)
                    highres_height = int(paper_size_cm[1] * pixels_per_cm)
                    highres_size = (highres_width, highres_height)
                    
                    logger.info(f"Rectified image will be {highres_width}x{highres_height}px at uniform {pixels_per_cm:.1f} px/cm")
                    
                    try:
                        logger.info(f"Saving high-resolution rectified image: {highres_width}x{highres_height}px")
                        # Generate CLEAN version without overlays for validation
                        rectified_highres_clean = generate_rectified_image_from_frame(
                            frame, homography, highres_size, paper_size_cm, None,  # No templates - clean image
                            camera_matrix, dist_coeffs
                        )
                        
                        # Save clean high-res version to disk for validation (PNG for lossless quality)
                        highres_path = os.path.join(data_dir, f'latest_calibration_rectified_{camera_id}.png')
                        cv2.imwrite(highres_path, rectified_highres_clean, [cv2.IMWRITE_PNG_COMPRESSION, 3])
                        
                        saved_height, saved_width = rectified_highres_clean.shape[:2]
                        logger.info(f"✓ Saved rectified image for validation: {saved_width}×{saved_height} px at {highres_path}")
                    except Exception as save_err:
                        logger.warning(f"Failed to save rectified image: {save_err}")
                        # Don't fail calibration if saving fails
                    
                    # Generate rectified preview if requested
                    if generate_preview and preview_output_size:
                        try:
                            # Also save a labeled version for download/display (using already calculated highres_size)
                            # Use LINEAR interpolation for smoother visual quality
                            highres_labeled = generate_rectified_image_from_frame(
                                frame, homography, highres_size, paper_size_cm, templates,  # WITH templates - labeled image
                                camera_matrix, dist_coeffs, use_linear_interpolation=True
                            )
                            highres_labeled_path = os.path.join(data_dir, f'latest_calibration_rectified_labeled_{camera_id}.png')
                            cv2.imwrite(highres_labeled_path, highres_labeled, [cv2.IMWRITE_PNG_COMPRESSION, 3])
                            logger.info(f"✓ Saved LABELED high-resolution rectified image for download")
                            
                            # Generate downscaled version for UI preview WITHOUT templates
                            # The frontend RectifiedPreviewCanvas will draw adjustable overlays interactively
                            # Use LINEAR interpolation for smoother visual quality (no marker detection here)
                            logger.info(f"Generating UI preview: {preview_output_size[0]}x{preview_output_size[1]}px (no template overlays)")
                            rectified_preview = generate_rectified_image_from_frame(
                                frame, homography, preview_output_size, paper_size_cm, None,  # NO templates - clean base image
                                camera_matrix, dist_coeffs, use_linear_interpolation=True
                            )
                            
                            # Encode preview as base64 for UI
                            _, buffer = cv2.imencode('.jpg', rectified_preview)
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
                    'detected_ids': [int(k) for k in marker_centers.keys()],
                    'marker_positions': {
                        f"marker_{id}": center.tolist() 
                        for id, center in marker_centers.items()
                    },
                    'marker_outer_corners': {
                        f"marker_{id}": corner.tolist() 
                        for id, corner in marker_outer_corners.items()
                    }
                }
                
        except Exception as e:
            logger.error(f"Error in calibration: {e}")
            return {
                'ok': False,
                'error': str(e),
                'markers_detected': 0
            }
        finally:
            if picam2 is not None:
                picam2.stop()
                picam2.close()

def main():
    parser = argparse.ArgumentParser(description='ArUco 4-Corner Calibration')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index (fallback if --device-path not provided)')
    parser.add_argument('--device-path', type=str, help='Camera device path for Raspberry Pi (e.g., /dev/video0)')
    parser.add_argument('--camera-id', type=str, required=True, help='Camera ID for file namespacing (multi-camera support)')
    parser.add_argument('--resolution', type=str, default='3840x2160', help='Camera resolution (WxH) - 4K for best quality')
    parser.add_argument('--paper-size', type=str, default='29.7x21.0', help='Paper size in cm (WidthxHeight)')
    parser.add_argument('--paper-size-name', type=str, default='A4-landscape', help='Paper size format name (e.g., 8-page-4x2, 6-page-3x2, A4-landscape)')
    parser.add_argument('--generate-preview', action='store_true', help='Generate rectified preview from calibration frame')
    parser.add_argument('--preview-output-size', type=str, help='Preview output size (WxH)')
    parser.add_argument('--templates', type=str, help='Template rectangles as JSON string')
    parser.add_argument('--validate-only', action='store_true', help='Skip camera capture, use saved rectified image for slot validation only')
    
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
            logger.info(f"Parsed {len(templates)} templates for preview overlay")
        
        # Initialize calibrator
        calibrator = ArucoCornerCalibrator()
        
        # VALIDATE-ONLY MODE: Use saved RECTIFIED image (faster, smaller, simpler)
        if args.validate_only:
            logger.info("=== VALIDATE-ONLY MODE: Using saved rectified image ===")
            import os
            data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
            rectified_path = os.path.join(data_dir, f'latest_calibration_rectified_{args.camera_id}.png')
            
            if not os.path.exists(rectified_path):
                result = {
                    'ok': False,
                    'error': f'No saved rectified image found. Run full calibration first.',
                    'markers_detected': 0
                }
            elif not templates or len(templates) == 0:
                result = {
                    'ok': False,
                    'error': 'Templates required for validate-only mode',
                    'markers_detected': 0
                }
            else:
                # Load saved rectified image
                rectified_image = cv2.imread(rectified_path)
                if rectified_image is None:
                    result = {
                        'ok': False,
                        'error': f'Failed to load rectified image from {rectified_path}',
                        'markers_detected': 0
                    }
                else:
                    logger.info(f"Loaded saved rectified image: {rectified_image.shape[1]}x{rectified_image.shape[0]}px")
                    
                    # Run slot validation on rectified image (no homography needed!)
                    slot_validation_results = calibrator.validate_slot_markers_on_rectified_image(
                        rectified_image, paper_size_cm, templates
                    )
                    
                    result = {
                        'ok': True,
                        'slot_validation': slot_validation_results,
                        'validate_only': True,
                        'image_path': rectified_path
                    }
                    logger.info(f"Slot validation complete: {slot_validation_results['valid_count']}/{slot_validation_results['total_count']} markers detected")
        else:
            # Run full calibration with camera capture
            paper_size_name = getattr(args, 'paper_size_name', 'A4-landscape')
            result = calibrator.calibrate_from_camera(
                args.camera, resolution, paper_size_cm,
                paper_size_name=paper_size_name,
                camera_id=args.camera_id,
                device_path=args.device_path,
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
