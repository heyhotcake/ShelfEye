#!/usr/bin/env python3
"""
Test if ArUco detection works on the full rectified image vs ROI
"""
import cv2
import numpy as np

# Load full rectified image
rectified = cv2.imread('/home/naniwa/ShelfEye/data/latest_calibration_rectified.png', cv2.IMREAD_GRAYSCALE)
print(f"Rectified image shape: {rectified.shape}")

# Setup ArUco detector
aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
aruco_params = cv2.aruco.DetectorParameters()
aruco_params.perspectiveRemovePixelPerCell = 16

# Test 1: Detect on FULL rectified image
print("\n=== TEST 1: Full Rectified Image ===")
corners, ids, rejected = cv2.aruco.detectMarkers(rectified, aruco_dict, parameters=aruco_params)
print(f"Markers found: {len(ids) if ids is not None else 0}")
print(f"Rejected: {len(rejected)}")
if ids is not None and len(ids) > 0:
    print(f"IDs found: {sorted(ids.flatten().tolist())}")

# Test 2: Extract ROI manually and test
print("\n=== TEST 2: Manual ROI Extraction ===")
# Slot 1 is at x=3.41cm, y=7.21cm with 7x4cm size, using 4cm ROI
px_per_cm = 31.8
center_x = int(3.41 * px_per_cm)
center_y = int(7.21 * px_per_cm)
roi_size = int(4.0 * px_per_cm)

x1 = max(0, center_x - roi_size // 2)
y1 = max(0, center_y - roi_size // 2)
x2 = min(rectified.shape[1], x1 + roi_size)
y2 = min(rectified.shape[0], y1 + roi_size)

roi = rectified[y1:y2, x1:x2]
print(f"ROI shape: {roi.shape}, extracted from ({x1},{y1}) to ({x2},{y2})")

corners, ids, rejected = cv2.aruco.detectMarkers(roi, aruco_dict, parameters=aruco_params)
print(f"Markers found: {len(ids) if ids is not None else 0}")
print(f"Rejected: {len(rejected)}")
if ids is not None and len(ids) > 0:
    print(f"IDs found: {ids.flatten().tolist()}")
