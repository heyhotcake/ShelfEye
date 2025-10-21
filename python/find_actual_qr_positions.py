#!/usr/bin/env python3
"""
Find the ACTUAL positions of all QR codes in the image
This will help fix the position mapping issue
"""

import cv2
from pyzbar import pyzbar
import numpy as np

def find_actual_positions():
    rect_path = '/home/naniwa/ShelfEye/debug_images/validation_rectified_debug.jpg'
    
    print("=" * 60)
    print("FINDING ACTUAL QR POSITIONS")
    print("=" * 60)
    
    # Load image
    img = cv2.imread(rect_path)
    print(f"\nImage size: {img.shape[1]}x{img.shape[0]} pixels")
    
    # Try multiple preprocessing methods to find ALL QRs
    preprocessing = [
        ("original", img),
        ("grayscale", cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)),
    ]
    
    # Add threshold version
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    preprocessing.append(("threshold", thresh))
    
    # Add adaptive threshold
    adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                    cv2.THRESH_BINARY, 11, 2)
    preprocessing.append(("adaptive", adaptive))
    
    # Collect all detected QRs
    all_detections = {}
    
    for method_name, processed in preprocessing:
        qrs = pyzbar.decode(processed)
        for qr in qrs:
            qr_id = qr.data.decode('utf-8')
            if qr_id not in all_detections:
                x, y, w, h = qr.rect
                center_x = x + w // 2
                center_y = y + h // 2
                
                # Convert pixels to cm (80 px/cm)
                px_per_cm = 80
                center_x_cm = center_x / px_per_cm
                center_y_cm = center_y / px_per_cm
                
                all_detections[qr_id] = {
                    'center_px': (center_x, center_y),
                    'center_cm': (center_x_cm, center_y_cm),
                    'size_px': (w, h),
                    'method': method_name
                }
    
    # Expected positions from database
    expected = {
        "pen-001": (19.5, 15),
        "pen-002": (44, 39),
        "pen-003": (44.5, 16.5),
        "pen-004": (67, 15.5),
        "5x5-001": (24, 27.5),
        "5x5-002": (44, 28.5),
        "5x5-003": (65, 27.5)
    }
    
    print("\n" + "-" * 60)
    print("ACTUAL POSITIONS FOUND:")
    print("-" * 60)
    
    for qr_id in sorted(all_detections.keys()):
        info = all_detections[qr_id]
        x_cm, y_cm = info['center_cm']
        print(f"\n{qr_id}:")
        print(f"  Actual position: ({x_cm:.1f}, {y_cm:.1f}) cm")
        
        # Find closest expected position
        if qr_id in expected:
            exp_x, exp_y = expected[qr_id]
            distance = np.sqrt((x_cm - exp_x)**2 + (y_cm - exp_y)**2)
            print(f"  Expected position: ({exp_x:.1f}, {exp_y:.1f}) cm")
            print(f"  Distance from expected: {distance:.1f} cm")
            if distance > 5:
                print(f"  ⚠️ WARNING: QR is {distance:.1f}cm away from expected position!")
    
    print("\n" + "-" * 60)
    print("QRs NOT DETECTED:")
    print("-" * 60)
    
    for qr_id in expected:
        if qr_id not in all_detections:
            print(f"  {qr_id}")
    
    print("\n" + "=" * 60)
    print("SQL UPDATE STATEMENTS TO FIX POSITIONS:")
    print("=" * 60)
    print("\n-- Run these SQL commands to update the database with actual positions:")
    print("-- (Only if you want to match database to physical QR positions)\n")
    
    for qr_id in sorted(all_detections.keys()):
        x_cm, y_cm = all_detections[qr_id]['center_cm']
        print(f"UPDATE slot_configurations SET x_cm = {x_cm:.1f}, y_cm = {y_cm:.1f}")
        print(f"  WHERE expected_qr_id = '{qr_id}';")
    
    print("\n" + "=" * 60)
    print("SUMMARY:")
    print(f"Detected {len(all_detections)} out of {len(expected)} QR codes")
    print("\nIf QRs are in wrong positions, you can either:")
    print("1. Physically move the QR codes to match the database")
    print("2. Update the database to match physical positions (use SQL above)")
    print("3. Re-print the template with QRs in correct positions")
    print("=" * 60)

if __name__ == "__main__":
    find_actual_positions()