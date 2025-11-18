#!/usr/bin/env python3
"""
Quick diagnostic to test ArUco marker detection on saved ROI images
"""

import cv2
import sys
import os
import numpy as np

# Test multiple ArUco detection configurations
def test_aruco_configs(image_path):
    """Test different ArUco detector configurations"""
    
    if not os.path.exists(image_path):
        print(f"Error: Image not found: {image_path}")
        return
    
    # Load image
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    print(f"Loaded image: {img.shape}, dtype={img.dtype}, range=[{img.min()}, {img.max()}]")
    
    # Test different dictionaries
    dictionaries = {
        'DICT_4X4_50': cv2.aruco.DICT_4X4_50,
        'DICT_4X4_100': cv2.aruco.DICT_4X4_100,
        'DICT_4X4_250': cv2.aruco.DICT_4X4_250,
        'DICT_5X5_50': cv2.aruco.DICT_5X5_50,
        'DICT_6X6_50': cv2.aruco.DICT_6X6_50,
    }
    
    print("\n=== Testing different ArUco dictionaries ===")
    for dict_name, dict_id in dictionaries.items():
        aruco_dict = cv2.aruco.getPredefinedDictionary(dict_id)
        params = cv2.aruco.DetectorParameters()
        
        corners, ids, rejected = cv2.aruco.detectMarkers(img, aruco_dict, parameters=params)
        
        if ids is not None and len(ids) > 0:
            print(f"✓ {dict_name}: Found {len(ids)} markers - IDs: {ids.flatten().tolist()}")
        else:
            print(f"✗ {dict_name}: No markers detected ({len(rejected)} rejected)")
    
    # Test with relaxed parameters on DICT_4X4_100
    print("\n=== Testing relaxed detection parameters (DICT_4X4_100) ===")
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
    params = cv2.aruco.DetectorParameters()
    
    # Relax detection parameters
    params.adaptiveThreshWinSizeMin = 3
    params.adaptiveThreshWinSizeMax = 23
    params.adaptiveThreshWinSizeStep = 10
    params.minMarkerPerimeterRate = 0.01  # Very relaxed
    params.maxMarkerPerimeterRate = 4.0
    params.polygonalApproxAccuracyRate = 0.1  # More tolerant
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    
    corners, ids, rejected = cv2.aruco.detectMarkers(img, aruco_dict, parameters=params)
    
    if ids is not None and len(ids) > 0:
        print(f"✓ Relaxed params: Found {len(ids)} markers - IDs: {ids.flatten().tolist()}")
    else:
        print(f"✗ Relaxed params: No markers detected ({len(rejected)} rejected)")
    
    # Test on different preprocessing versions
    print("\n=== Testing different preprocessing ===")
    
    # Original
    corners, ids, rejected = cv2.aruco.detectMarkers(img, aruco_dict, parameters=params)
    print(f"Original image: {len(ids) if ids is not None else 0} markers")
    
    # Binary threshold
    _, binary = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    corners, ids, rejected = cv2.aruco.detectMarkers(binary, aruco_dict, parameters=params)
    print(f"Binary (Otsu): {len(ids) if ids is not None else 0} markers")
    
    # Gaussian blur
    blurred = cv2.GaussianBlur(img, (3, 3), 0)
    corners, ids, rejected = cv2.aruco.detectMarkers(blurred, aruco_dict, parameters=params)
    print(f"Gaussian blur: {len(ids) if ids is not None else 0} markers")
    
    # Without CLAHE (if original has CLAHE applied)
    # Normalize back to see if CLAHE is the problem
    normalized = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX)
    corners, ids, rejected = cv2.aruco.detectMarkers(normalized, aruco_dict, parameters=params)
    print(f"Normalized only: {len(ids) if ids is not None else 0} markers")

if __name__ == "__main__":
    # Test on one of the validation ROI images
    data_dir = "/home/naniwa/ShelfEye/data"
    
    # Test both the original and boosted versions
    test_files = [
        "validation_roi_1.jpg",
        "validation_roi_1_boosted.jpg",
        "validation_roi_2.jpg",
        "validation_roi_4.jpg",  # The 5x5 one
    ]
    
    for filename in test_files:
        filepath = os.path.join(data_dir, filename)
        print(f"\n{'='*60}")
        print(f"Testing: {filename}")
        print('='*60)
        test_aruco_configs(filepath)
