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
    dist_coeffs: Optional[np.ndarray] = None
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
    if camera_matrix is not None and dist_coeffs is not None:
        logger.info("Undistorting frame before warping")
        frame = cv2.undistort(frame, camera_matrix, dist_coeffs)
    
    # Step 2: Apply homography transformation
    # Homography maps cm → pixels (from calibration)
    # For warpPerspective, we need: camera pixels → cm → output pixels
    
    H = homography_matrix
    paper_width_cm, paper_height_cm = paper_size_cm
    scale_x = output_size[0] / paper_width_cm
    scale_y = output_size[1] / paper_height_cm
    
    # Scaling matrix: cm → output pixels
    S = np.array([
        [scale_x, 0, 0],
        [0, scale_y, 0],
        [0, 0, 1]
    ], dtype=np.float32)
    
    # Invert homography: camera pixels → cm
    H_inv = np.linalg.inv(H)
    
    # Combined warp for warpPerspective: camera_pixel → cm → output_pixel
    M = S @ H_inv
    
    # Warp the image
    rectified = cv2.warpPerspective(frame, M, output_size)
    
    # Draw grid overlay for visual reference
    for x in range(0, output_size[0], 50):
        cv2.line(rectified, (x, 0), (x, output_size[1]), (0, 255, 0), 1)
    for y in range(0, output_size[1], 50):
        cv2.line(rectified, (0, y), (output_size[0], y), (0, 255, 0), 1)
    
    # Draw template slot overlays if provided
    if templates:
        logger.info(f"Drawing {len(templates)} template overlays")
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
            
            # Translate to world position
            corners_cm = corners_relative + center_cm
            
            # Convert cm to pixels
            corners_px = corners_cm * np.array([scale_x, scale_y])
            
            # Draw rectangle
            pts = corners_px.astype(np.int32).reshape((-1, 1, 2))
            cv2.polylines(rectified, [pts], True, (255, 0, 255), 3)
            
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
    paper_size_cm: Tuple[float, float] = (88.8, 42.0),  # Default for 6-page-3x2
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
    cap = None
    led_was_on = False
    try:
        # Turn on LED light for consistent illumination
        try:
            import subprocess
            import os
            script_dir = os.path.dirname(os.path.abspath(__file__))
            gpio_script = os.path.join(script_dir, 'gpio_controller.py')
            subprocess.run(['sudo', 'python3', gpio_script, '--pin', str(led_pin), '--action', 'on'], 
                         check=True, capture_output=True, timeout=5)
            led_was_on = True
            logger.info(f"LED light turned ON (pin {led_pin})")
            # Brief delay to let LED stabilize
            import time
            time.sleep(0.3)
        except Exception as led_err:
            logger.warning(f"Could not control LED light: {led_err}")
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
        if cap is not None:
            cap.release()
        
        # Turn off LED light
        if led_was_on:
            try:
                import subprocess
                import os
                script_dir = os.path.dirname(os.path.abspath(__file__))
                gpio_script = os.path.join(script_dir, 'gpio_controller.py')
                subprocess.run(['sudo', 'python3', gpio_script, '--pin', str(led_pin), '--action', 'off'], 
                             check=True, capture_output=True, timeout=5)
                logger.info(f"LED light turned OFF (pin {led_pin})")
            except Exception as led_err:
                logger.warning(f"Could not turn off LED light: {led_err}")

def main():
    parser = argparse.ArgumentParser(description='Generate rectified preview using homography')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index (fallback if --device-path not provided)')
    parser.add_argument('--device-path', type=str, help='Camera device path for Raspberry Pi (e.g., /dev/video0)')
    parser.add_argument('--resolution', type=str, required=True, help='Camera resolution (WxH)')
    parser.add_argument('--homography', type=str, required=True, help='Homography matrix as comma-separated values')
    parser.add_argument('--output-size', type=str, default='800x600', help='Output image size (WxH)')
    parser.add_argument('--templates', type=str, default=None, help='Template rectangles as JSON string')
    parser.add_argument('--paper-size', type=str, default='88.8x42.0', help='Paper size in cm (WxH)')
    parser.add_argument('--camera-matrix', type=str, default=None, help='Camera intrinsic matrix as comma-separated values (9 values)')
    parser.add_argument('--dist-coeffs', type=str, default=None, help='Distortion coefficients as comma-separated values (5 values)')
    
    args = parser.parse_args()
    
    try:
        # Parse resolution
        width, height = map(int, args.resolution.split('x'))
        resolution = (width, height)
        
        # Parse output size
        out_width, out_height = map(int, args.output_size.split('x'))
        output_size = (out_width, out_height)
        
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
