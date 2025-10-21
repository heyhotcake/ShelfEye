#!/usr/bin/env python3
"""
Test QR detection after database position updates
"""

import cv2
from pyzbar import pyzbar
import numpy as np

def test_detection():
    rect_path = '/home/naniwa/ShelfEye/debug_images/validation_rectified_debug.jpg'
    
    print("=" * 60)
    print("TESTING QR DETECTION AFTER POSITION UPDATES")
    print("=" * 60)
    
    # Load image
    img = cv2.imread(rect_path)
    if img is None:
        print("ERROR: Could not load image")
        return
    
    print(f"Image size: {img.shape[1]}x{img.shape[0]} pixels")
    print(f"Resolution: 80 px/cm")
    
    # Updated expected positions after database swap
    expected_positions = {
        'pen-001': (19.5, 15.0),
        'pen-002': (67.0, 15.5),  # Swapped with pen-004
        'pen-003': (44.5, 16.5),
        'pen-004': (44.0, 39.0),  # Swapped with pen-002  
        '5x5-001': (44.0, 28.5),  # Swapped with 5x5-002
        '5x5-002': (24.0, 27.5),  # Swapped with 5x5-001
        '5x5-003': (65.0, 27.5),
    }
    
    # Try multiple preprocessing methods
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    
    all_detections = {}
    methods = [
        ("original", img),
        ("grayscale", gray),
        ("threshold", thresh)
    ]
    
    for method_name, processed in methods:
        qrs = pyzbar.decode(processed)
        for qr in qrs:
            qr_id = qr.data.decode('utf-8')
            if qr_id not in all_detections:
                x, y, w, h = qr.rect
                center_x = (x + w/2) / 80  # Convert to cm
                center_y = (y + h/2) / 80
                all_detections[qr_id] = {
                    'pos_cm': (center_x, center_y),
                    'size_px': (w, h),
                    'method': method_name
                }
    
    print("\n" + "-" * 40)
    print("DETECTION RESULTS:")
    print("-" * 40)
    
    # Check each expected QR
    for qr_id, expected_pos in expected_positions.items():
        if qr_id in all_detections:
            detected = all_detections[qr_id]
            det_x, det_y = detected['pos_cm']
            exp_x, exp_y = expected_pos
            distance = np.sqrt((det_x - exp_x)**2 + (det_y - exp_y)**2)
            
            print(f"\n✓ {qr_id}: DETECTED")
            print(f"  Expected: ({exp_x:.1f}, {exp_y:.1f}) cm")
            print(f"  Found at: ({det_x:.1f}, {det_y:.1f}) cm")
            print(f"  Distance: {distance:.1f} cm")
            
            if distance > 2.0:  # More than 2cm off
                print(f"  ⚠️ WARNING: Position off by {distance:.1f} cm!")
        else:
            print(f"\n✗ {qr_id}: NOT DETECTED")
            print(f"  Expected at: ({expected_pos[0]:.1f}, {expected_pos[1]:.1f}) cm")
    
    print("\n" + "-" * 40)
    print(f"SUMMARY: {len(all_detections)}/7 QR codes detected")
    
    if len(all_detections) < 7:
        missing = [qr for qr in expected_positions if qr not in all_detections]
        print(f"Missing: {', '.join(missing)}")
        
        print("\nTROUBLESHOOTING TIPS:")
        print("1. Check if missing QRs are physically present on the printout")
        print("2. Try reprinting at 40mm size instead of 30mm")
        print("3. Ensure good lighting and focus")
        print("4. Make sure QRs are pure black on white background")
    else:
        print("All QR codes detected successfully!")
        print("\nYou can now proceed with calibration validation.")
    
    print("=" * 60)

if __name__ == "__main__":
    test_detection()