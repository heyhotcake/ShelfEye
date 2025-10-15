#!/usr/bin/env python3
"""
Camera Test Script for Raspberry Pi
Tests USB camera connectivity and captures a test image
"""

import cv2
import sys
import os

def test_camera(device_index=0):
    """Test camera at given device index"""
    print(f"Testing camera at device index {device_index}...")
    
    cap = cv2.VideoCapture(device_index)
    
    if not cap.isOpened():
        print(f"✗ Failed to open camera at index {device_index}")
        return False
    
    # Get camera properties
    width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    print(f"  Resolution: {int(width)}x{int(height)}")
    print(f"  FPS: {fps}")
    
    # Try to capture a frame
    ret, frame = cap.read()
    
    if not ret:
        print(f"✗ Failed to capture frame from camera {device_index}")
        cap.release()
        return False
    
    # Save test image
    test_dir = "data/test"
    os.makedirs(test_dir, exist_ok=True)
    test_path = f"{test_dir}/camera_{device_index}_test.jpg"
    cv2.imwrite(test_path, frame)
    
    cap.release()
    
    print(f"✓ Camera {device_index} is working!")
    print(f"  Test image saved to: {test_path}")
    return True

def main():
    """Main test function"""
    print("=" * 50)
    print("Camera Test Utility")
    print("=" * 50)
    print()
    
    # Test devices 0-3
    working_cameras = []
    
    for i in range(4):
        if test_camera(i):
            working_cameras.append(i)
        print()
    
    print("=" * 50)
    if working_cameras:
        print(f"✓ Found {len(working_cameras)} working camera(s): {working_cameras}")
        print()
        print("To use camera in the app, update camera configuration:")
        print(f"  Device Index: {working_cameras[0]}")
        sys.exit(0)
    else:
        print("✗ No working cameras found")
        print()
        print("Troubleshooting:")
        print("  1. Check USB camera is connected")
        print("  2. Run: v4l2-ctl --list-devices")
        print("  3. Add user to video group: sudo usermod -a -G video $USER")
        print("  4. Reboot the Raspberry Pi")
        sys.exit(1)

if __name__ == "__main__":
    main()
