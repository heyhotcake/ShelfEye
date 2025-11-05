#!/usr/bin/env python3
"""
Test ArUco detection on the newest rectified image
"""
import cv2
import os
import time

# Get file modification time
rectified_path = '/home/naniwa/ShelfEye/data/latest_calibration_rectified.png'
if os.path.exists(rectified_path):
    mod_time = os.path.getmtime(rectified_path)
    mod_time_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(mod_time))
    print(f"Rectified image last modified: {mod_time_str}")
else:
    print("ERROR: Rectified image not found!")
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
