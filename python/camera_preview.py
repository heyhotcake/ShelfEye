#!/usr/bin/env python3
"""
Camera Preview Script
Captures a single frame from camera and saves as base64 for web display
Uses rpicam-still for Raspberry Pi libcamera compatibility
"""

import cv2
import sys
import json
import base64
import logging
import subprocess
import tempfile
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def capture_preview(device_source, width: int = 1920, height: int = 1080):
    """
    Capture a single frame from camera and return as base64 JPEG
    Uses rpicam-still for libcamera compatibility on Raspberry Pi
    
    Args:
        device_source: Camera device index (int) or device path (str like /dev/video0)
        width: Frame width
        height: Frame height
        
    Returns:
        JSON with base64 image data
    """
    temp_file = None
    try:
        # Create temporary file for image capture
        temp_file = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
        temp_path = temp_file.name
        temp_file.close()
        
        # Use rpicam-still for Raspberry Pi libcamera cameras
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
            return {
                'ok': False,
                'error': f'Camera capture failed: {result.stderr}'
            }
        
        # Read captured image with OpenCV
        frame = cv2.imread(temp_path)
        if frame is None:
            return {
                'ok': False,
                'error': 'Failed to read captured image'
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
        
    except subprocess.TimeoutExpired:
        logger.error("Camera capture timeout")
        return {
            'ok': False,
            'error': 'Camera capture timeout'
        }
    except Exception as e:
        logger.error(f"Preview error: {e}")
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
