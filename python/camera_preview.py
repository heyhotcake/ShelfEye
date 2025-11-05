#!/usr/bin/env python3
"""
Camera Preview Script using Picamera2
Captures a single frame from camera and saves as base64 for web display
Uses October 31st proven pipeline for bright, natural images
"""

import cv2
import sys
import json
import base64
import logging
import os

# Add parent directory to path to import camera_utils
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from camera_utils_picam2 import setup_camera_picam2, warmup_camera_picam2, capture_optimal_frame_picam2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def capture_preview(device_source, width: int = 2560, height: int = 1440):
    """
    Capture a single frame from camera using Picamera2 and return as base64 JPEG
    Uses the October 31st proven pipeline that produced bright, natural images
    
    Args:
        device_source: Camera device index (int) or device path (str like /dev/video0)
        width: Frame width
        height: Frame height
        
    Returns:
        JSON with base64 image data
    """
    picam2 = None
    try:
        # Convert device path to index if needed
        if isinstance(device_source, str) and device_source.startswith('/dev/video'):
            camera_index = int(device_source.replace('/dev/video', ''))
        else:
            camera_index = int(device_source) if isinstance(device_source, (int, str)) else 0
        
        logger.info(f"Opening camera: {camera_index}")
        
        # Setup camera with Picamera2
        picam2 = setup_camera_picam2(camera_index, resolution=(width, height))
        picam2.start()
        
        # Warmup camera properly (10 seconds at 30fps - proven on Oct 31st)
        warmup_camera_picam2(picam2, duration_seconds=10)
        
        # Capture optimal frame with multi-frame selection and post-processing
        # This applies: auto brightness/contrast, gamma correction, sharpening
        frame = capture_optimal_frame_picam2(picam2)
        
        if frame is None:
            return {
                'ok': False,
                'error': 'Failed to capture frame'
            }
        
        # Encode as JPEG with high quality
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        
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
        if picam2 is not None:
            picam2.stop()
            picam2.close()

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
    
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 2560
    height = int(sys.argv[3]) if len(sys.argv) > 3 else 1440
    
    result = capture_preview(device_source, width, height)
    print(json.dumps(result))
