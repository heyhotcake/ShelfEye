#!/usr/bin/env python3
"""
Test ArUco detection on the newest rectified image
"""
import cv2
import os
import time
import argparse

# Parse arguments
parser = argparse.ArgumentParser(description='Test ArUco detection on newest rectified image')
parser.add_argument('--camera-id', required=True, help='Camera ID for multi-camera support')
args = parser.parse_args()

# Get camera-specific rectified image path
data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
rectified_path = os.path.join(data_dir, f'latest_calibration_rectified_{args.camera_id}.png')

if os.path.exists(rectified_path):
    mod_time = os.path.getmtime(rectified_path)
    mod_time_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(mod_time))
    print(f"Camera ID: {args.camera_id}")
    print(f"Rectified image: {rectified_path}")
    print(f"Rectified image last modified: {mod_time_str}")
else:
    print(f"ERROR: Rectified image not found: {rectified_path}")
    print(f"Usage: python3 {__file__} --camera-id CAMERA_ID")
    exit(1)

# Load and test
rectified = cv2.imread(rectified_path, cv2.IMREAD_GRAYSCALE)
print(f"Image shape: {rectified.shape}")

# Setup ArUco
aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
aruco_params = cv2.aruco.DetectorParameters()
aruco_params.perspectiveRemovePixelPerCell = 16

# Detect
corners, ids, rejected = cv2.aruco.detectMarkers(rectified, aruco_dict, parameters=aruco_params)
print(f"\nArUco detection results:")
print(f"  Markers found: {len(ids) if ids is not None else 0}")
print(f"  Rejected: {len(rejected)}")
if ids is not None and len(ids) > 0:
    print(f"  IDs detected: {sorted(ids.flatten().tolist())}")
    print("\n✓✓✓ SUCCESS! ArUco markers detected on rectified image! ✓✓✓")
else:
    print("\n✗✗✗ FAILED - No markers detected ✗✗✗")
