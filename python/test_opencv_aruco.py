#!/usr/bin/env python3
"""
Minimal test: Can OpenCV generate and detect ANY ArUco marker?
"""

import cv2
import numpy as np

print(f"OpenCV version: {cv2.__version__}")

# Test 1: Generate marker
aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
marker = cv2.aruco.generateImageMarker(aruco_dict, 2, 200)
print(f"\n✓ Generated marker: {marker.shape}, unique values: {len(np.unique(marker))}")

# Test 2: Detect with MINIMAL parameters (no custom settings)
params = cv2.aruco.DetectorParameters()
corners, ids, rejected = cv2.aruco.detectMarkers(marker, aruco_dict, parameters=params)

print(f"\nDetection with DEFAULT parameters:")
print(f"  Detected: {len(ids) if ids is not None else 0} markers")
print(f"  Rejected: {len(rejected)}")

if ids is not None and len(ids) > 0:
    print(f"  IDs: {ids.flatten().tolist()}")
    print(f"  ✓✓✓ SUCCESS - OpenCV ArUco works!")
else:
    print(f"  ✗✗✗ FAILED - OpenCV ArUco is BROKEN on this system!")
    print(f"\nThis suggests:")
    print(f"  - OpenCV installation issue")
    print(f"  - Version incompatibility")
    print(f"  - Corrupted ArUco module")
