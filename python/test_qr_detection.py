#!/usr/bin/env python3
"""
Direct QR detection test - bypasses all system complexity
Run this directly on your Pi to test QR detection
"""

import cv2
import numpy as np
from pyzbar import pyzbar
import sys
import os

def test_qr_detection():
    # Load the saved debug images
    raw_path = '/home/naniwa/ShelfEye/debug_images/validation_raw_frame.jpg'
    rect_path = '/home/naniwa/ShelfEye/debug_images/validation_rectified_debug.jpg'
    
    print("=" * 60)
    print("QR DETECTION TEST")
    print("=" * 60)
    
    # Test 1: Raw frame
    if os.path.exists(raw_path):
        print("\n1. Testing RAW camera frame:")
        raw = cv2.imread(raw_path)
        print(f"   Image size: {raw.shape[1]}x{raw.shape[0]}")
        
        # Try pyzbar
        qrs = pyzbar.decode(raw)
        print(f"   pyzbar found: {len(qrs)} QR codes")
        for qr in qrs:
            print(f"      - {qr.data.decode('utf-8')}")
        
        # Try OpenCV
        detector = cv2.QRCodeDetector()
        data, bbox, _ = detector.detectAndDecode(raw)
        if data:
            print(f"   OpenCV found: {data}")
    else:
        print(f"   ERROR: {raw_path} not found")
    
    # Test 2: Rectified image
    if os.path.exists(rect_path):
        print("\n2. Testing RECTIFIED image:")
        rect = cv2.imread(rect_path)
        print(f"   Image size: {rect.shape[1]}x{rect.shape[0]}")
        
        # Try pyzbar
        qrs = pyzbar.decode(rect)
        print(f"   pyzbar found: {len(qrs)} QR codes")
        for qr in qrs:
            x, y, w, h = qr.rect
            print(f"      - '{qr.data.decode('utf-8')}' at ({x},{y}) size {w}x{h}")
        
        # Try with grayscale
        gray = cv2.cvtColor(rect, cv2.COLOR_BGR2GRAY)
        qrs_gray = pyzbar.decode(gray)
        if len(qrs_gray) > len(qrs):
            print(f"   Grayscale improved detection: {len(qrs_gray)} QR codes")
        
        # Try with threshold
        _, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
        qrs_thresh = pyzbar.decode(thresh)
        if len(qrs_thresh) > len(qrs):
            print(f"   Threshold improved detection: {len(qrs_thresh)} QR codes")
            
        # Extract and analyze a small region for QR quality
        if len(qrs) > 0:
            qr = qrs[0]
            x, y, w, h = qr.rect
            roi = rect[y:y+h, x:x+w]
            print(f"\n   First QR analysis:")
            print(f"      Size in pixels: {w}x{h}")
            print(f"      Pixels per module (approx): {w/21:.1f}")  # QR v1 has 21 modules
            
            # Check contrast
            gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            min_val = gray_roi.min()
            max_val = gray_roi.max()
            print(f"      Contrast range: {min_val}-{max_val}")
            
            # Check sharpness
            laplacian = cv2.Laplacian(gray_roi, cv2.CV_64F).var()
            print(f"      Sharpness score: {laplacian:.1f}")
    else:
        print(f"   ERROR: {rect_path} not found")
    
    print("\n" + "=" * 60)
    print("ANALYSIS:")
    
    # Resolution check
    if os.path.exists(rect_path):
        rect = cv2.imread(rect_path)
        width_px = rect.shape[1]
        height_px = rect.shape[0]
        
        # For 6-page-3x2: 89.1cm x 42.0cm
        width_cm = 89.1
        height_cm = 42.0
        
        px_per_cm = width_px / width_cm
        print(f"Resolution: {px_per_cm:.1f} px/cm")
        
        # 30mm QR code should be ~240px at 80px/cm
        qr_size_mm = 30
        expected_px = (qr_size_mm / 10) * px_per_cm
        print(f"30mm QR code should be: {expected_px:.0f} pixels")
        
        if px_per_cm < 40:
            print("⚠️  WARNING: Resolution too low for reliable 30mm QR detection")
            print("   Need at least 40 px/cm, ideally 80 px/cm")
    
    print("=" * 60)

if __name__ == "__main__":
    test_qr_detection()