#!/usr/bin/env python3
"""
Rectified Preview Generator for Tool Tracking System
Applies homography transformation to show top-down view of calibrated area
"""

import argparse
import json
import sys
import base64
import logging
from typing import Tuple, Optional, List
import numpy as np
import cv2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def generate_rectified_image_from_frame(
    frame: np.ndarray,
    homography_matrix: np.ndarray,
    output_size: Tuple[int, int],
    paper_size_cm: Tuple[float, float],
    templates: Optional[List[dict]] = None,
    camera_matrix: Optional[np.ndarray] = None,
    dist_coeffs: Optional[np.ndarray] = None,
    use_linear_interpolation: bool = False
) -> np.ndarray:
    """
    Generate rectified image from an existing frame using homography
    
    Args:
        frame: Input camera frame (numpy array)
        homography_matrix: 3x3 homography matrix that maps cm → pixels
        output_size: (width, height) of output rectified image
        paper_size_cm: (width, height) of paper in cm
        templates: List of template rectangles with x, y, width, height in cm
        camera_matrix: 3x3 camera intrinsic matrix for lens distortion correction
        dist_coeffs: Distortion coefficients (k1, k2, p1, p2, k3)
        
    Returns:
        Rectified image as numpy array
    """
    # Step 1: Undistort the frame if camera parameters are provided
    # Skip undistortion if all distortion coefficients are zero (to avoid interpolation artifacts)
    if camera_matrix is not None and dist_coeffs is not None:
        if np.any(dist_coeffs != 0):
            logger.info("Undistorting frame before warping")
            frame = cv2.undistort(frame, camera_matrix, dist_coeffs)
        else:
            logger.info("Skipping undistortion (all coefficients are zero)")
    
    # Step 2: Apply homography transformation
    # Homography maps cm → camera pixels (from calibration)
    # For warpPerspective backward mapping: output pixels → camera pixels
    
    H = homography_matrix
    paper_width_cm, paper_height_cm = paper_size_cm
    
    # Calculate the ArUco marker outer corner bounds (the actual rectified area)
    # The homography was calculated using outer corners at inset positions
    marker_inset_cm = 1.0  # 10mm inset from paper edge to marker outer corner
    
    # The rectified image should show only the area bounded by marker outer corners
    # This puts the markers squarely at the corners of the output image
    crop_left_cm = marker_inset_cm
    crop_top_cm = marker_inset_cm
    crop_right_cm = paper_width_cm - marker_inset_cm
    crop_bottom_cm = paper_height_cm - marker_inset_cm
    
    # Cropped area dimensions
    cropped_width_cm = crop_right_cm - crop_left_cm
    cropped_height_cm = crop_bottom_cm - crop_top_cm
    
    # Scale based on cropped area (so output_size covers just the marker-bounded area)
    scale_x = output_size[0] / cropped_width_cm
    scale_y = output_size[1] / cropped_height_cm
    
    # Scaling matrix: cropped_cm → output pixels
    # S_inv maps output pixels → cropped_cm (0 to cropped_width, 0 to cropped_height)
    S_inv = np.array([
        [1/scale_x, 0, 0],
        [0, 1/scale_y, 0],
        [0, 0, 1]
    ], dtype=np.float32)
    
    # Translation matrix: add offset to convert cropped_cm → full paper cm
    # cropped_cm + (crop_left, crop_top) = full_cm
    T = np.array([
        [1, 0, crop_left_cm],
        [0, 1, crop_top_cm],
        [0, 0, 1]
    ], dtype=np.float32)
    
    # warpPerspective uses backward mapping: for each OUTPUT pixel, find the INPUT pixel
    # Chain: output_pixels → cropped_cm → full_cm → camera_pixels
    # S_inv: output_pixels → cropped_cm
    # T: cropped_cm → full_cm (add offset)
    # H: full_cm → camera_pixels
    # M = H @ T @ S_inv: output_pixels → cropped_cm → full_cm → camera_pixels
    M = H @ T @ S_inv
    
    logger.info(f"Rectification: paper={paper_width_cm}x{paper_height_cm}cm, "
                f"crop=({crop_left_cm},{crop_top_cm})-({crop_right_cm},{crop_bottom_cm})cm, "
                f"output={output_size[0]}x{output_size[1]}px")
    
    # Choose interpolation method
    # INTER_NEAREST preserves sharp ArUco marker edges (for detection)
    # INTER_LINEAR produces smoother images (for display)
    interp_flag = cv2.INTER_LINEAR if use_linear_interpolation else cv2.INTER_NEAREST
    rectified = cv2.warpPerspective(frame, M, output_size, flags=interp_flag)
    
    # NOTE: Grid overlay removed - was permanently burning into downloaded images
    # and could corrupt ArUco markers. Frontend canvas draws non-destructive overlays.
    
    # Draw template slot overlays if provided
    if templates:
        logger.info(f"Drawing {len(templates)} template overlays")
        logger.info(f"Templates data: {templates}")
        for template in templates:
            x_cm = template.get('x', 0)
            y_cm = template.get('y', 0)
            w_cm = template.get('width', 0)
            h_cm = template.get('height', 0)
            rotation_deg = template.get('rotation', 0)
            label = template.get('categoryName', '')
            
            if w_cm == 0 or h_cm == 0:
                logger.warning(f"Skipping template {label} with zero dimensions")
                continue
            
            # x_cm, y_cm represent the CENTER of the rectangle (from database)
            # Define rectangle corners relative to center
            half_w = w_cm / 2
            half_h = h_cm / 2
            center_cm = np.array([x_cm, y_cm])
            
            # Define corners relative to center (unrotated)
            corners_relative = np.array([
                [-half_w, -half_h],  # Top-left
                [half_w, -half_h],   # Top-right
                [half_w, half_h],    # Bottom-right
                [-half_w, half_h]    # Bottom-left
            ], dtype=np.float32)
            
            # Apply rotation if specified
            if rotation_deg != 0:
                angle_rad = np.deg2rad(rotation_deg)
                cos_a = np.cos(angle_rad)
                sin_a = np.sin(angle_rad)
                R = np.array([[cos_a, -sin_a], [sin_a, cos_a]])
                corners_relative = (R @ corners_relative.T).T
            
            # Translate to world position (full paper cm coordinates)
            corners_cm = corners_relative + center_cm
            
            # Convert to cropped coordinates (subtract crop offset, then scale to pixels)
            # corners_cm is in full paper coords, we need to subtract crop_left/crop_top
            corners_cropped_cm = corners_cm - np.array([crop_left_cm, crop_top_cm])
            corners_px = corners_cropped_cm * np.array([scale_x, scale_y])
            
            # Draw rectangle (thin line so template details are visible)
            pts = corners_px.astype(np.int32).reshape((-1, 1, 2))
            cv2.polylines(rectified, [pts], True, (255, 0, 255), 1)
            
            # Draw label
            center_x = int(np.mean(corners_px[:, 0]))
            center_y = int(np.mean(corners_px[:, 1]))
            text_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
            cv2.rectangle(rectified, 
                        (center_x - text_size[0]//2 - 4, center_y - text_size[1]//2 - 4),
                        (center_x + text_size[0]//2 + 4, center_y + text_size[1]//2 + 4),
                        (0, 0, 0), -1)
            cv2.putText(rectified, label, 
                      (center_x - text_size[0]//2, center_y + text_size[1]//2),
                      cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    
    return rectified

def generate_rectified_preview(
    camera_index: int,
    resolution: Tuple[int, int],
    homography_matrix: list,
    output_size: Tuple[int, int] = (800, 600),
    templates: Optional[List[dict]] = None,
    paper_size_cm: Tuple[float, float] = (89.1, 42.0),  # Default for 6-page-3x2 (3×2 A4 landscape = 89.1cm × 42.0cm)
    device_path: Optional[str] = None,
    led_pin: int = 18,
    camera_matrix: Optional[list] = None,
    dist_coeffs: Optional[list] = None
) -> dict:
    """
    Generate a rectified preview image using homography transformation with lens distortion correction
    
    Args:
        camera_index: Camera device index (fallback if device_path not provided)
        resolution: (width, height) camera resolution
        homography_matrix: Flattened 3x3 homography matrix (9 values)
        output_size: (width, height) of output rectified image
        templates: List of template rectangles with x, y, width, height in cm
        device_path: Device path for Raspberry Pi (/dev/video0, /dev/video1, etc.)
        led_pin: GPIO pin for LED light control
        camera_matrix: Flattened 3x3 camera intrinsic matrix (9 values)
        dist_coeffs: Distortion coefficients (k1, k2, p1, p2, k3) as list
        
    Returns:
        Dictionary with ok status and base64 encoded image or error
    """
    picam2 = None
    try:
        # LED control disabled for preview to avoid constant flashing
        # User can manually control LED via Config page if needed
        # Reshape homography matrix from list to 3x3 numpy array
        H = np.array(homography_matrix).reshape(3, 3)
        
        # Parse camera matrix and distortion coefficients if provided
        cam_mat = np.array(camera_matrix).reshape(3, 3) if camera_matrix else None
        dist = np.array(dist_coeffs) if dist_coeffs else None
        
        if cam_mat is not None and dist is not None:
            logger.info(f"Using camera matrix and distortion coefficients for undistortion")
            logger.info(f"Camera matrix: {cam_mat.tolist()}")
            logger.info(f"Distortion coeffs: {dist.tolist()}")
        else:
            logger.info("No camera calibration parameters provided - skipping undistortion")
        
        # Convert device path to index if needed
        if device_path and device_path.startswith('/dev/video'):
            cam_idx = int(device_path.replace('/dev/video', ''))
        else:
            cam_idx = camera_index
        
        logger.info(f"Opening camera: {cam_idx}")
        
        width, height = resolution
        
        # Setup camera with Picamera2
        from camera_utils_picam2 import setup_camera_picam2, warmup_camera_picam2
        picam2 = setup_camera_picam2(cam_idx, resolution=(width, height))
        picam2.start()
        
        # Warmup: Let auto-exposure and autofocus settle
        logger.info("Warming up camera (auto-exposure, autofocus, white balance)...")
        warmup_camera_picam2(picam2, duration_seconds=15)
        
        # Capture frame from 'main' stream and convert RGB to BGR for OpenCV
        frame_rgb = picam2.capture_array("main")
        frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
        if frame is None:
            raise Exception("Failed to capture frame from camera")
        
        # Generate rectified image using shared helper (with undistortion if parameters provided)
        rectified = generate_rectified_image_from_frame(
            frame, H, output_size, paper_size_cm, templates, cam_mat, dist
        )
        
        # Encode image as JPEG
        _, buffer = cv2.imencode('.jpg', rectified)
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            'ok': True,
            'image': f'data:image/jpeg;base64,{image_base64}',
            'width': output_size[0],
            'height': output_size[1]
        }
        
    except Exception as e:
        logger.error(f"Error generating rectified preview: {e}")
        return {
            'ok': False,
            'error': str(e)
        }
    finally:
        if picam2 is not None:
            picam2.stop()
            picam2.close()

def main():
    parser = argparse.ArgumentParser(description='Generate rectified preview using homography')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index (fallback if --device-path not provided)')
    parser.add_argument('--device-path', type=str, help='Camera device path for Raspberry Pi (e.g., /dev/video0)')
    parser.add_argument('--resolution', type=str, required=True, help='Camera resolution (WxH)')
    parser.add_argument('--homography', type=str, required=True, help='Homography matrix as comma-separated values')
    parser.add_argument('--output-size', type=str, default=None, help='Output image size (WxH). If not provided, calculates from homography to match camera resolution')
    parser.add_argument('--templates', type=str, default=None, help='Template rectangles as JSON string')
    parser.add_argument('--paper-size', type=str, default='89.1x42.0', help='Paper size in cm (WxH)')
    parser.add_argument('--camera-matrix', type=str, default=None, help='Camera intrinsic matrix as comma-separated values (9 values)')
    parser.add_argument('--dist-coeffs', type=str, default=None, help='Distortion coefficients as comma-separated values (5 values)')
    
    args = parser.parse_args()
    
    try:
        # Parse resolution
        width, height = map(int, args.resolution.split('x'))
        resolution = (width, height)
        
        # Parse output size (or calculate from homography if not provided)
        if args.output_size:
            out_width, out_height = map(int, args.output_size.split('x'))
            output_size = (out_width, out_height)
        else:
            # Calculate output size from measured pixel density in homography
            # Measure pixel density from homography matrix
            homography_arr = np.array([float(x) for x in args.homography.split(',')]).reshape(3, 3)
            paper_w, paper_h = map(float, args.paper_size.split('x'))
            
            # Sample points at paper corners to measure pixel density
            # Markers are 5cm from edges, so paper area is between markers
            marker_offset = 5.0
            test_points_cm = np.array([
                [marker_offset, marker_offset],
                [paper_w - marker_offset, marker_offset],
                [paper_w - marker_offset, paper_h - marker_offset],
                [marker_offset, paper_h - marker_offset]
            ])
            
            # Convert to homogeneous coordinates and apply homography
            test_points_h = np.hstack([test_points_cm, np.ones((4, 1))])
            pixels_h = (homography_arr @ test_points_h.T).T
            pixels = pixels_h[:, :2] / pixels_h[:, 2:3]
            
            # Measure pixel density from horizontal and vertical spans
            horizontal_px = np.linalg.norm(pixels[1] - pixels[0])
            vertical_px = np.linalg.norm(pixels[3] - pixels[0])
            horizontal_cm = paper_w - 2 * marker_offset
            vertical_cm = paper_h - 2 * marker_offset
            
            px_per_cm_h = horizontal_px / horizontal_cm
            px_per_cm_v = vertical_px / vertical_cm
            px_per_cm = min(px_per_cm_h, px_per_cm_v)
            
            # Output size should match the CROPPED area dimensions (marker-bounded area)
            # The rectification crops to area from (1cm,1cm) to (paper-1cm, paper-1cm)
            marker_inset_cm = 1.0
            cropped_width_cm = paper_w - 2 * marker_inset_cm
            cropped_height_cm = paper_h - 2 * marker_inset_cm
            
            out_width = int(cropped_width_cm * px_per_cm)
            out_height = int(cropped_height_cm * px_per_cm)
            output_size = (out_width, out_height)
            
            logger.info(f"Calculated output size from homography: {out_width}x{out_height} ({px_per_cm:.1f} px/cm) for cropped area {cropped_width_cm}x{cropped_height_cm}cm")
        
        # Parse homography matrix
        homography = [float(x) for x in args.homography.split(',')]
        if len(homography) != 9:
            raise ValueError(f"Homography matrix must have 9 values, got {len(homography)}")
        
        # Parse templates if provided
        templates = None
        if args.templates:
            templates = json.loads(args.templates)
        
        # Parse paper size
        paper_width, paper_height = map(float, args.paper_size.split('x'))
        paper_size_cm = (paper_width, paper_height)
        
        # Parse camera calibration parameters if provided
        camera_matrix = None
        dist_coeffs = None
        if args.camera_matrix:
            camera_matrix = [float(x) for x in args.camera_matrix.split(',')]
            if len(camera_matrix) != 9:
                raise ValueError(f"Camera matrix must have 9 values, got {len(camera_matrix)}")
        if args.dist_coeffs:
            dist_coeffs = [float(x) for x in args.dist_coeffs.split(',')]
            if len(dist_coeffs) != 5:
                raise ValueError(f"Distortion coefficients must have 5 values, got {len(dist_coeffs)}")
        
        # Generate rectified preview (with lens distortion correction if parameters provided)
        result = generate_rectified_preview(
            args.camera, resolution, homography, output_size, templates, paper_size_cm,
            device_path=args.device_path, camera_matrix=camera_matrix, dist_coeffs=dist_coeffs
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
