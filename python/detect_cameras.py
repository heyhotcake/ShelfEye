#!/usr/bin/env python3
"""
Camera Device Detection Utility
Scans for available video devices (particularly for Raspberry Pi /dev/video* devices)
"""

import cv2
import os
import sys
import json
import argparse
from pathlib import Path

def detect_cameras(max_index=10):
    """
    Detect available cameras by testing device indices and paths
    
    Returns:
        List of detected cameras with index, path, and basic info
    """
    detected = []
    
    # Method 1: Check /dev/video* devices (Linux/Raspberry Pi)
    if os.name != 'nt':  # Not Windows
        video_devices = sorted(Path('/dev').glob('video*'))
        
        for device_path in video_devices:
            device_str = str(device_path)
            
            # Try to open the camera
            cap = cv2.VideoCapture(device_str)
            
            if cap.isOpened():
                # Get camera properties
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                fps = int(cap.get(cv2.CAP_PROP_FPS))
                
                # Try to capture a frame to verify it's a real camera
                ret, _ = cap.read()
                
                if ret:
                    detected.append({
                        'devicePath': device_str,
                        'deviceIndex': None,  # Unknown for path-based detection
                        'name': f'Camera at {device_str}',
                        'width': width if width > 0 else None,
                        'height': height if height > 0 else None,
                        'fps': fps if fps > 0 else None,
                        'available': True
                    })
                
                cap.release()
    
    # Method 2: Check device indices (cross-platform)
    for index in range(max_index):
        cap = cv2.VideoCapture(index)
        
        if cap.isOpened():
            # Get camera properties
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = int(cap.get(cv2.CAP_PROP_FPS))
            
            # Try to capture a frame to verify it's a real camera
            ret, _ = cap.read()
            
            if ret:
                # Check if we already detected this camera via device path
                device_str = f'/dev/video{index}' if os.name != 'nt' else None
                already_detected = any(
                    cam['devicePath'] == device_str for cam in detected
                ) if device_str else False
                
                if not already_detected:
                    detected.append({
                        'devicePath': device_str,
                        'deviceIndex': index,
                        'name': f'Camera {index}',
                        'width': width if width > 0 else None,
                        'height': height if height > 0 else None,
                        'fps': fps if fps > 0 else None,
                        'available': True
                    })
            
            cap.release()
    
    return detected

def main():
    parser = argparse.ArgumentParser(description='Detect available camera devices')
    parser.add_argument('--max-index', type=int, default=10, 
                       help='Maximum device index to check (default: 10)')
    
    args = parser.parse_args()
    
    try:
        cameras = detect_cameras(args.max_index)
        
        result = {
            'success': True,
            'cameras': cameras,
            'count': len(cameras)
        }
        
        print(json.dumps(result), file=sys.stdout)
        return 0
        
    except Exception as e:
        result = {
            'success': False,
            'error': str(e),
            'cameras': []
        }
        print(json.dumps(result), file=sys.stdout)
        return 1

if __name__ == "__main__":
    sys.exit(main())
