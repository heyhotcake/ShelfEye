#!/usr/bin/env python3
"""
Camera Preview Script
Captures a single frame from camera and saves as base64 for web display
"""

import cv2
import sys
import json
import base64
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def capture_preview(device_source, width: int = 1920, height: int = 1080):
    """
    Capture a single frame from camera and return as base64 JPEG
    
    Args:
        device_source: Camera device index (int) or device path (str like /dev/video0)
        width: Frame width
        height: Frame height
        
    Returns:
        JSON with base64 image data
    """
    cap = None
    try:
        # Open camera
        logger.info(f"Opening camera: {device_source}")
        cap = cv2.VideoCapture(device_source)
        if not cap.isOpened():
            return {
                'ok': False,
                'error': f'Cannot open camera device {device_source}'
            }
        
        # Set resolution
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        
        # Capture frame
        ret, frame = cap.read()
        if not ret or frame is None:
            return {
                'ok': False,
                'error': 'Failed to capture frame'
            }
        
        # Encode as JPEG
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        
        # Convert to base64
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            'ok': True,
            'image': f'data:image/jpeg;base64,{img_base64}',
            'width': frame.shape[1],
            'height': frame.shape[0]
        }
        
    except Exception as e:
        logger.error(f"Preview error: {e}")
        return {
            'ok': False,
            'error': str(e)
        }
    finally:
        if cap is not None:
            cap.release()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': 'Missing device argument'}))
        sys.exit(1)
    
    # Check if argument is a device path (starts with /) or device index (integer)
    device_arg = sys.argv[1]
    if device_arg.startswith('/'):
        device_source = device_arg  # Device path like /dev/video0
    else:
        device_source = int(device_arg)  # Device index like 0, 1, 2
    
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 1920
    height = int(sys.argv[3]) if len(sys.argv) > 3 else 1080
    
    result = capture_preview(device_source, width, height)
    print(json.dumps(result))
