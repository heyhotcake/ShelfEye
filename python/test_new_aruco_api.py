#!/usr/bin/env python3
"""
Test OpenCV's newer ArUco API (ArucoDetector class instead of detectMarkers function)
"""

import cv2
import numpy as np

print(f"OpenCV version: {cv2.__version__}")

# Generate test marker
aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
marker = cv2.aruco.generateImageMarker(aruco_dict, 2, 200)
print(f"✓ Generated marker: {marker.shape}")

# Try NEW API (ArucoDetector class - OpenCV 4.7+)
try:
    params = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, params)
    corners, ids, rejected = detector.detectMarkers(marker)
    
    print(f"\nNEW API (ArucoDetector class):")
    print(f"  Detected: {len(ids) if ids is not None else 0} markers")
    print(f"  Rejected: {len(rejected)}")
    
    if ids is not None and len(ids) > 0:
        print(f"  IDs: {ids.flatten().tolist()}")
        print(f"  ✓✓✓ SUCCESS - New API works!")
        exit(0)
    else:
        print(f"  ✗ New API also failed")
except Exception as e:
    print(f"\nNEW API failed with error: {e}")

# Try OLD API with extreme parameters
print(f"\nTrying OLD API with extreme threshold settings:")
params = cv2.aruco.DetectorParameters()
params.adaptiveThreshConstant = 7
params.adaptiveThreshWinSizeMin = 3
params.adaptiveThreshWinSizeMax = 23
params.adaptiveThreshWinSizeStep = 10
params.minMarkerPerimeterRate = 0.01
params.maxMarkerPerimeterRate = 4.0
params.polygonalApproxAccuracyRate = 0.1
params.minCornerDistanceRate = 0.01
params.minDistanceToBorder = 0
params.minMarkerDistanceRate = 0.01

corners, ids, rejected = cv2.aruco.detectMarkers(marker, aruco_dict, parameters=params)
print(f"  Detected: {len(ids) if ids is not None else 0}")
print(f"  Rejected: {len(rejected)}")

if ids is not None and len(ids) > 0:
    print(f"  ✓✓✓ SUCCESS with extreme params!")
else:
    print(f"\n✗✗✗ ALL METHODS FAILED")
    print(f"\nConclusion: OpenCV {cv2.__version__} ArUco module is non-functional on this system.")
    print(f"Recommendation: Use alternative marker system (QR codes, AprilTags, or pyzbar)")
