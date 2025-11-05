#!/usr/bin/env python3
"""
Diagnostic: Find ALL ArUco markers in the calibration image
Shows what markers are actually present, regardless of expected IDs
"""

import cv2
import numpy as np
import sys
import os

# Suppress OpenCV warnings
os.environ['OPENCV_LOG_LEVEL'] = 'FATAL'
cv2.setLogLevel(0)

def find_all_aruco_markers(image_path):
    """Find ALL ArUco markers in image with multiple preprocessing attempts"""
    
    # Load image
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(f"ERROR: Could not load image: {image_path}")
        return []
    
    print(f"Image loaded: {img.shape[1]}x{img.shape[0]}px")
    print(f"Pixel range: [{img.min()}, {img.max()}]")
    print()
    
    # Initialize ArUco detector
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
    aruco_params = cv2.aruco.DetectorParameters()
    
    # EXTREME relaxation for printed markers
    aruco_params.adaptiveThreshWinSizeMin = 3
    aruco_params.adaptiveThreshWinSizeMax = 200
    aruco_params.adaptiveThreshWinSizeStep = 10
    aruco_params.adaptiveThreshConstant = 7
    aruco_params.minMarkerPerimeterRate = 0.005
    aruco_params.maxMarkerPerimeterRate = 8.0
    aruco_params.polygonalApproxAccuracyRate = 0.15
    aruco_params.minCornerDistanceRate = 0.01
    aruco_params.minDistanceToBorder = 0
    aruco_params.minMarkerDistanceRate = 0.005
    aruco_params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    aruco_params.cornerRefinementWinSize = 5
    aruco_params.cornerRefinementMaxIterations = 50
    aruco_params.cornerRefinementMinAccuracy = 0.01
    aruco_params.markerBorderBits = 1
    aruco_params.perspectiveRemovePixelPerCell = 4
    aruco_params.perspectiveRemoveIgnoredMarginPerCell = 0.1
    aruco_params.maxErroneousBitsInBorderRate = 0.35  # Stricter - prevent false IDs (was 0.5)
    aruco_params.minOtsuStdDev = 2.0
    aruco_params.errorCorrectionRate = 0.6  # Balanced error correction (was 1.0)
    
    all_markers = {}  # Use dict to avoid duplicates
    
    # Try multiple preprocessing methods
    normalized = np.zeros_like(img)
    preprocessing_methods = [
        ("Original", img),
        ("Normalized", cv2.normalize(img, normalized, 0, 255, cv2.NORM_MINMAX)),
        ("Gaussian Blur", cv2.GaussianBlur(img, (3, 3), 0)),
        ("Bilateral Filter", cv2.bilateralFilter(img, 5, 50, 50)),
        ("CLAHE", cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8)).apply(img)),
    ]
    
    for method_name, processed_img in preprocessing_methods:
        corners, ids, rejected = cv2.aruco.detectMarkers(processed_img, aruco_dict, parameters=aruco_params)
        
        if ids is not None and len(ids) > 0:
            print(f"✓ {method_name}: Found {len(ids)} marker(s)")
            for i, marker_id in enumerate(ids.flatten()):
                # Filter out corner markers (96-99)
                if 1 <= marker_id <= 95:
                    marker_corners = corners[i][0]
                    center_x = int(np.mean(marker_corners[:, 0]))
                    center_y = int(np.mean(marker_corners[:, 1]))
                    
                    # Store by ID (last detection wins)
                    all_markers[marker_id] = {
                        'id': marker_id,
                        'x': center_x,
                        'y': center_y,
                        'method': method_name,
                        'corners': marker_corners
                    }
                    
                    marker_type = "SLOT" if marker_id <= 50 else "WORKER"
                    print(f"  - ID {marker_id} ({marker_type}) at ({center_x}, {center_y})")
        else:
            print(f"✗ {method_name}: No markers detected ({len(rejected)} rejected)")
    
    return list(all_markers.values())

if __name__ == "__main__":
    # Default to latest calibration rectified image
    data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
    image_path = os.path.join(data_dir, 'latest_calibration_rectified.jpg')
    
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
    
    if not os.path.exists(image_path):
        print(f"ERROR: Image not found: {image_path}")
        print(f"Usage: python3 {sys.argv[0]} [path/to/image.jpg]")
        sys.exit(1)
    
    print("=" * 60)
    print("DIAGNOSTIC: Finding ALL ArUco markers in image")
    print("=" * 60)
    print(f"Image: {image_path}")
    print()
    
    markers = find_all_aruco_markers(image_path)
    
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total unique markers found: {len(markers)}")
    
    if markers:
        # Sort by ID
        markers.sort(key=lambda m: m['id'])
        
        slot_markers = [m for m in markers if m['id'] <= 50]
        worker_markers = [m for m in markers if 51 <= m['id'] <= 95]
        
        if slot_markers:
            print(f"\nSLOT markers (1-50): {len(slot_markers)}")
            for m in slot_markers:
                print(f"  ID {m['id']:2d} at ({m['x']:4d}, {m['y']:4d}) via {m['method']}")
        
        if worker_markers:
            print(f"\nWORKER markers (51-95): {len(worker_markers)}")
            for m in worker_markers:
                print(f"  ID {m['id']:2d} at ({m['x']:4d}, {m['y']:4d}) via {m['method']}")
        
        print(f"\nMarker IDs detected: {sorted([m['id'] for m in markers])}")
    else:
        print("\n⚠ NO MARKERS DETECTED")
        print("This could mean:")
        print("  1. No ArUco markers are present in the image")
        print("  2. Markers are too small or low quality")
        print("  3. Image quality is poor")
    
    print()
