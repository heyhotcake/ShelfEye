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
from typing import Tuple
import numpy as np
import cv2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def generate_rectified_preview(
    camera_index: int,
    resolution: Tuple[int, int],
    homography_matrix: list,
    output_size: Tuple[int, int] = (800, 600)
) -> dict:
    """
    Generate a rectified preview image using homography transformation
    
    Args:
        camera_index: Camera device index
        resolution: (width, height) camera resolution
        homography_matrix: Flattened 3x3 homography matrix (9 values)
        output_size: (width, height) of output rectified image
        
    Returns:
        Dictionary with ok status and base64 encoded image or error
    """
    cap = None
    try:
        # Reshape homography matrix from list to 3x3 numpy array
        H = np.array(homography_matrix).reshape(3, 3)
        
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
        
        # Apply perspective warp using homography
        # The homography maps from paper coordinates (cm) to pixels
        # We need the inverse to map from pixels to normalized paper coordinates
        H_inv = np.linalg.inv(H)
        
        # Warp the image to get a top-down rectified view
        rectified = cv2.warpPerspective(frame, H_inv, output_size)
        
        # Draw grid overlay on rectified image for visual reference
        # Draw vertical lines every 50 pixels (representing ~5cm if output is 800x600)
        for x in range(0, output_size[0], 50):
            cv2.line(rectified, (x, 0), (x, output_size[1]), (0, 255, 0), 1)
        
        # Draw horizontal lines every 50 pixels
        for y in range(0, output_size[1], 50):
            cv2.line(rectified, (0, y), (output_size[0], y), (0, 255, 0), 1)
        
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

def main():
    parser = argparse.ArgumentParser(description='Generate rectified preview using homography')
    parser.add_argument('--camera', type=int, required=True, help='Camera device index')
    parser.add_argument('--resolution', type=str, required=True, help='Camera resolution (WxH)')
    parser.add_argument('--homography', type=str, required=True, help='Homography matrix as comma-separated values')
    parser.add_argument('--output-size', type=str, default='800x600', help='Output image size (WxH)')
    
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
        
        # Generate rectified preview
        result = generate_rectified_preview(args.camera, resolution, homography, output_size)
        
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
