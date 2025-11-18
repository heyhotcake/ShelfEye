#!/usr/bin/env python3
"""
Test if loading BGR image as GRAYSCALE breaks ArUco detection
"""
import cv2
import numpy as np
import sys

# Load the saved rectified image TWO ways
bgr_image = cv2.imread('/home/naniwa/ShelfEye/data/latest_calibration_rectified.png', cv2.IMREAD_COLOR)
gray_direct = cv2.imread('/home/naniwa/ShelfEye/data/latest_calibration_rectified.png', cv2.IMREAD_GRAYSCALE)

# Convert BGR to grayscale manually
gray_converted = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2GRAY)

print(f"BGR image shape: {bgr_image.shape if bgr_image is not None else 'None'}")
print(f"Gray direct shape: {gray_direct.shape if gray_direct is not None else 'None'}")
print(f"Gray converted shape: {gray_converted.shape if gray_converted is not None else 'None'}")

# Compare the two grayscale versions
if gray_direct is not None and gray_converted is not None:
    diff = np.abs(gray_direct.astype(int) - gray_converted.astype(int))
    print(f"\nDifference between IMREAD_GRAYSCALE and cvtColor(BGR2GRAY):")
    print(f"  Max diff: {diff.max()}")
    print(f"  Mean diff: {diff.mean():.2f}")
    print(f"  Are they identical? {np.array_equal(gray_direct, gray_converted)}")
    
    # Load an ROI and test ArUco on it
    roi = cv2.imread('/home/naniwa/ShelfEye/data/validation_roi_1.jpg', cv2.IMREAD_GRAYSCALE)
    if roi is not None:
        print(f"\nROI image shape: {roi.shape}")
        print(f"ROI dtype: {roi.dtype}, range: [{roi.min()}, {roi.max()}]")
        
        # Test ArUco detection
        aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
        aruco_params = cv2.aruco.DetectorParameters()
        aruco_params.perspectiveRemovePixelPerCell = 16
        
        corners, ids, rejected = cv2.aruco.detectMarkers(roi, aruco_dict, parameters=aruco_params)
        print(f"\nArUco detection on ROI:")
        print(f"  Markers found: {len(ids) if ids is not None else 0}")
        print(f"  Rejected candidates: {len(rejected)}")
        if ids is not None:
            print(f"  IDs: {ids.flatten().tolist()}")
else:
    print("ERROR: Could not load images!")
    sys.exit(1)
