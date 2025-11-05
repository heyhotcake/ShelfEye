#!/usr/bin/env python3
"""
Test script to decode a saved ROI image with exact validation parameters
"""

import cv2
import sys
import numpy as np

# Load the ROI image
roi_path = sys.argv[1] if len(sys.argv) > 1 else '/home/naniwa/ShelfEye/data/validation_roi_2.jpg'
image = cv2.imread(roi_path, cv2.IMREAD_GRAYSCALE)

if image is None:
    print(f"ERROR: Could not load image from {roi_path}")
    sys.exit(1)

print(f"Loaded image: {image.shape}, dtype: {image.dtype}, range: [{image.min()}, {image.max()}]")

# Initialize ArUco detector with EXACT same parameters as validation
aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
aruco_params = cv2.aruco.DetectorParameters()

aruco_params.adaptiveThreshWinSizeMin = 3
aruco_params.adaptiveThreshWinSizeMax = 50
aruco_params.adaptiveThreshWinSizeStep = 10
aruco_params.adaptiveThreshConstant = 7
aruco_params.minMarkerPerimeterRate = 0.01
aruco_params.maxMarkerPerimeterRate = 4.0
aruco_params.polygonalApproxAccuracyRate = 0.05
aruco_params.minCornerDistanceRate = 0.05
aruco_params.minDistanceToBorder = 1
aruco_params.minMarkerDistanceRate = 0.05
aruco_params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
aruco_params.cornerRefinementWinSize = 5
aruco_params.cornerRefinementMaxIterations = 30
aruco_params.cornerRefinementMinAccuracy = 0.01
aruco_params.markerBorderBits = 1
aruco_params.perspectiveRemovePixelPerCell = 16
aruco_params.perspectiveRemoveIgnoredMarginPerCell = 0.13
aruco_params.maxErroneousBitsInBorderRate = 0.35
aruco_params.minOtsuStdDev = 5.0
aruco_params.errorCorrectionRate = 0.6

print(f"\nArUco parameters:")
print(f"  perspectiveRemovePixelPerCell = {aruco_params.perspectiveRemovePixelPerCell}")
print(f"  markerBorderBits = {aruco_params.markerBorderBits}")
print(f"  Dictionary = DICT_4X4_100")

# Try detection
print(f"\nAttempting detection...")
corners, ids, rejected = cv2.aruco.detectMarkers(image, aruco_dict, parameters=aruco_params)

print(f"\nResults:")
print(f"  Detected markers: {len(ids) if ids is not None else 0}")
print(f"  Rejected candidates: {len(rejected)}")

if ids is not None and len(ids) > 0:
    print(f"\n✓ SUCCESS! Detected marker IDs: {ids.flatten().tolist()}")
else:
    print(f"\n✗ FAILED - No markers detected")
    
    # Try with different perspectiveRemovePixelPerCell values
    print(f"\nTesting different perspectiveRemovePixelPerCell values:")
    for cell_size in [8, 12, 16, 20, 24, 32]:
        aruco_params.perspectiveRemovePixelPerCell = cell_size
        corners, ids, rejected = cv2.aruco.detectMarkers(image, aruco_dict, parameters=aruco_params)
        found = len(ids) if ids is not None else 0
        print(f"  {cell_size} px/cell: {found} markers, {len(rejected)} rejected")
        if found > 0:
            print(f"    → IDs: {ids.flatten().tolist()}")
