#!/usr/bin/env python3
"""
Rectified Preview Generator for Tool Tracking System
Applies homography transformation to show top-down view of calibrated area
Uses rpicam-still for Raspberry Pi libcamera compatibility
"""

import argparse
import json
import sys
import base64
import logging
import subprocess
import tempfile
import os
from typing import Tuple, Optional, List
import numpy as np
import cv2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def generate_rectified_preview(
    camera_index: int,
    resolution: Tuple[int, int],
    homography_matrix: list,
    output_size: Tuple[int, int] = (800, 600),
    templates: Optional[List[dict]] = None,
    paper_size_cm: Tuple[float, float] = (88.8, 42.0),  # Default for 6-page-3x2
    device_path: Optional[str] = None
) -> dict:
    """
    Generate a rectified preview image using homography transformation
    Uses rpicam-still for libcamera compatibility on Raspberry Pi
    
    Args:
        camera_index: Camera device index (fallback if device_path not provided)
        resolution: (width, height) camera resolution
        homography_matrix: Flattened 3x3 homography matrix (9 values)
        output_size: (width, height) of output rectified image
        templates: List of template rectangles with x, y, width, height in cm
        device_path: Device path for Raspberry Pi (/dev/video0, /dev/video1, etc.)
        
    Returns:
        Dictionary with ok status and base64 encoded image or error
    """
    temp_file = None
    try:
        # Reshape homography matrix from list to 3x3 numpy array
        H = np.array(homography_matrix).reshape(3, 3)
        
        # Create temporary file for image capture
        temp_file = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
        temp_path = temp_file.name
        temp_file.close()
        
        # Use rpicam-still for Raspberry Pi libcamera cameras
        width, height = resolution
        logger.info(f"Capturing with rpicam-still: {width}x{height}")
        cmd = [
            'rpicam-still',
            '-o', temp_path,
            '--width', str(width),
            '--height', str(height),
            '-t', '1',  # 1ms timeout for immediate capture
            '-n'  # No preview window
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
            logger.error(f"rpicam-still failed: {result.stderr}")
            raise Exception(f"Camera capture failed: {result.stderr}")
        
        # Read captured image with OpenCV
        frame = cv2.imread(temp_path)
        if frame is None:
            raise Exception("Failed to read captured image")
        
        # Apply perspective warp using homography
        # H maps from paper coordinates (cm) to camera pixels
        # We want to create a rectified view where the paper fits the output size
        
        # Calculate scaling to fit paper into output
        paper_width_cm, paper_height_cm = paper_size_cm
        scale_x = output_size[0] / paper_width_cm
        scale_y = output_size[1] / paper_height_cm
        
        # Scaling matrix: output pixels → cm
        S_inv = np.array([
            [1.0/scale_x, 0, 0],
            [0, 1.0/scale_y, 0],
            [0, 0, 1]
        ], dtype=np.float32)
        
        # Combined warp: output_pixel → cm → camera_pixel
        M = H @ S_inv
        
        # Warp the image: rectified[x,y] = frame[M @ [x,y]]
        rectified = cv2.warpPerspective(frame, M, output_size)
        
        # Draw grid overlay on rectified image for visual reference
        # Draw vertical lines every 50 pixels (representing ~5cm if output is 800x600)
        for x in range(0, output_size[0], 50):
            cv2.line(rectified, (x, 0), (x, output_size[1]), (0, 255, 0), 1)
        
        # Draw horizontal lines every 50 pixels
        for y in range(0, output_size[1], 50):
            cv2.line(rectified, (0, y), (output_size[0], y), (0, 255, 0), 1)
        
        # Draw template slot overlays if provided
        if templates:
            # With the new warp M = H @ S_inv, output pixels map directly:
            # output_pixel = cm * scale (where scale = output_size / paper_size)
            # So cm coordinates can be directly converted to pixels
            
            logger.info(f"Paper size: {paper_width_cm}×{paper_height_cm} cm")
            logger.info(f"Output size: {output_size[0]}×{output_size[1]} px")
            logger.info(f"Scale: {scale_x:.2f} px/cm (x), {scale_y:.2f} px/cm (y)")
            
            for template in templates:
                # Template has: x, y, width, height, rotation in cm
                x_cm = template.get('x', 0)
                y_cm = template.get('y', 0)
                w_cm = template.get('width', 0)
                h_cm = template.get('height', 0)
                rotation_deg = template.get('rotation', 0)
                label = template.get('categoryName', '')
                
                if w_cm == 0 or h_cm == 0:
                    logger.warning(f"Skipping template {label} with zero dimensions")
                    continue
                
                # Define rectangle corners in cm (unrotated)
                corners_cm = np.array([
                    [x_cm, y_cm],                    # Top-left
                    [x_cm + w_cm, y_cm],             # Top-right
                    [x_cm + w_cm, y_cm + h_cm],      # Bottom-right
                    [x_cm, y_cm + h_cm]              # Bottom-left
                ], dtype=np.float32)
                
                # Apply rotation if specified (around rectangle center)
                if rotation_deg != 0:
                    center_cm = np.array([x_cm + w_cm/2, y_cm + h_cm/2])
                    angle_rad = np.deg2rad(rotation_deg)
                    cos_a = np.cos(angle_rad)
                    sin_a = np.sin(angle_rad)
                    
                    # Rotation matrix
                    R = np.array([[cos_a, -sin_a], [sin_a, cos_a]])
                    
                    # Rotate corners around center
                    corners_cm = (R @ (corners_cm - center_cm).T).T + center_cm
                
                # Convert cm to pixels using the same scale as the warp
                corners_px = corners_cm * np.array([scale_x, scale_y])
                
                # Draw rectangle on rectified image
                pts = corners_px.astype(np.int32).reshape((-1, 1, 2))
                cv2.polylines(rectified, [pts], True, (255, 0, 255), 3)  # Magenta rectangle
                
                # Draw label at center
                center_x = int(np.mean(corners_px[:, 0]))
                center_y = int(np.mean(corners_px[:, 1]))
                
                # Draw background for text
                text_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
                cv2.rectangle(rectified, 
                            (center_x - text_size[0]//2 - 4, center_y - text_size[1]//2 - 4),
                            (center_x + text_size[0]//2 + 4, center_y + text_size[1]//2 + 4),
                            (0, 0, 0), -1)
                
                cv2.putText(rectified, label, 
                          (center_x - text_size[0]//2, center_y + text_size[1]//2),
                          cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        
        # Encode image as JPEG
        _, buffer = cv2.imencode('.jpg', rectified)
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            'ok': True,
            'image': f'data:image/jpeg;base64,{image_base64}',
            'width': output_size[0],
            'height': output_size[1]
        }
        
    except subprocess.TimeoutExpired:
        logger.error("Camera capture timeout")
        return {
            'ok': False,
            'error': 'Camera capture timeout'
        }
    except Exception as e:
        logger.error(f"Error generating rectified preview: {e}")
        return {
            'ok': False,
            'error': str(e)
        }
    finally:
        # Clean up temp file
        if temp_file and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass

def main():
    parser = argparse.ArgumentParser(description='Generate rectified preview using homography')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index (fallback if --device-path not provided)')
    parser.add_argument('--device-path', type=str, help='Camera device path for Raspberry Pi (e.g., /dev/video0)')
    parser.add_argument('--resolution', type=str, required=True, help='Camera resolution (WxH)')
    parser.add_argument('--homography', type=str, required=True, help='Homography matrix as comma-separated values')
    parser.add_argument('--output-size', type=str, default='800x600', help='Output image size (WxH)')
    parser.add_argument('--templates', type=str, default=None, help='Template rectangles as JSON string')
    parser.add_argument('--paper-size', type=str, default='88.8x42.0', help='Paper size in cm (WxH)')
    
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
        
        # Generate rectified preview
        result = generate_rectified_preview(
            args.camera, resolution, homography, output_size, templates, paper_size_cm, device_path=args.device_path
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
