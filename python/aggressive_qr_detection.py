#!/usr/bin/env python3
"""
Aggressive QR detection with multiple techniques
"""

import cv2
from pyzbar import pyzbar
import numpy as np

def aggressive_detection():
    rect_path = '/home/naniwa/ShelfEye/debug_images/validation_rectified_debug.jpg'
    
    print("=" * 60)
    print("AGGRESSIVE QR DETECTION")
    print("=" * 60)
    
    # Load image
    img = cv2.imread(rect_path)
    print(f"Image size: {img.shape[1]}x{img.shape[0]} pixels")
    
    all_detections = {}
    
    # Method 1: Original resolution with multiple preprocessing
    print("\nMethod 1: Full resolution (80 px/cm)...")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    methods = [
        ("original", img),
        ("grayscale", gray),
        ("threshold_127", cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)[1]),
        ("threshold_100", cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY)[1]),
        ("threshold_150", cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)[1]),
        ("adaptive", cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)),
        ("otsu", cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]),
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
                    'method': f"full_{method_name}"
                }
                print(f"  Found '{qr_id}' with {method_name}")
    
    # Method 2: Downscaled to 40 px/cm
    print("\nMethod 2: Half resolution (40 px/cm)...")
    scaled = cv2.resize(img, (img.shape[1]//2, img.shape[0]//2), interpolation=cv2.INTER_AREA)
    gray_scaled = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    
    scaled_methods = [
        ("scaled", scaled),
        ("scaled_gray", gray_scaled),
        ("scaled_thresh", cv2.threshold(gray_scaled, 127, 255, cv2.THRESH_BINARY)[1]),
        ("scaled_adaptive", cv2.adaptiveThreshold(gray_scaled, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2))
    ]
    
    for method_name, processed in scaled_methods:
        qrs = pyzbar.decode(processed)
        for qr in qrs:
            qr_id = qr.data.decode('utf-8')
            if qr_id not in all_detections:
                x, y, w, h = qr.rect
                center_x = (x*2 + w) / 80  # Scale back and convert to cm
                center_y = (y*2 + h) / 80
                all_detections[qr_id] = {
                    'pos_cm': (center_x, center_y),
                    'size_px': (w*2, h*2),
                    'method': method_name
                }
                print(f"  Found '{qr_id}' with {method_name}")
    
    # Method 3: Quarter resolution (20 px/cm) for really stubborn QRs
    print("\nMethod 3: Quarter resolution (20 px/cm)...")
    tiny = cv2.resize(img, (img.shape[1]//4, img.shape[0]//4), interpolation=cv2.INTER_AREA)
    gray_tiny = cv2.cvtColor(tiny, cv2.COLOR_BGR2GRAY)
    _, thresh_tiny = cv2.threshold(gray_tiny, 127, 255, cv2.THRESH_BINARY)
    
    for processed in [tiny, thresh_tiny]:
        qrs = pyzbar.decode(processed)
        for qr in qrs:
            qr_id = qr.data.decode('utf-8')
            if qr_id not in all_detections:
                x, y, w, h = qr.rect
                center_x = (x*4 + w*2) / 80
                center_y = (y*4 + h*2) / 80
                all_detections[qr_id] = {
                    'pos_cm': (center_x, center_y),
                    'size_px': (w*4, h*4),
                    'method': "tiny"
                }
                print(f"  Found '{qr_id}' at 20px/cm")
    
    # Method 4: Enhance contrast and sharpness
    print("\nMethod 4: Enhanced contrast...")
    # CLAHE
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    enhanced = clahe.apply(gray)
    
    # Sharpen
    kernel = np.array([[-1,-1,-1],
                       [-1, 9,-1],
                       [-1,-1,-1]])
    sharpened = cv2.filter2D(gray, -1, kernel)
    
    for name, proc in [("clahe", enhanced), ("sharpened", sharpened)]:
        qrs = pyzbar.decode(proc)
        for qr in qrs:
            qr_id = qr.data.decode('utf-8')
            if qr_id not in all_detections:
                x, y, w, h = qr.rect
                center_x = (x + w/2) / 80
                center_y = (y + h/2) / 80
                all_detections[qr_id] = {
                    'pos_cm': (center_x, center_y),
                    'size_px': (w, h),
                    'method': name
                }
                print(f"  Found '{qr_id}' with {name}")
    
    print("\n" + "=" * 60)
    print("RESULTS:")
    print("-" * 40)
    print(f"Total QRs detected: {len(all_detections)}")
    
    for qr_id in sorted(all_detections.keys()):
        info = all_detections[qr_id]
        x, y = info['pos_cm']
        w, h = info['size_px']
        print(f"\n{qr_id}:")
        print(f"  Position: ({x:.1f}, {y:.1f}) cm")
        print(f"  Size: {w}x{h} px")
        print(f"  Method: {info['method']}")
    
    # Expected QRs
    expected = ["pen-001", "pen-002", "pen-003", "pen-004", "5x5-001", "5x5-002", "5x5-003"]
    missing = [qr for qr in expected if qr not in all_detections]
    
    if missing:
        print("\n" + "-" * 40)
        print(f"MISSING QRs ({len(missing)}):")
        for qr in missing:
            print(f"  - {qr}")
        print("\nThese QRs might be:")
        print("  - Too blurry or out of focus")
        print("  - Not actually present in the image")
        print("  - Damaged or partially covered")
        print("  - At extreme angles")
    
    print("\n" + "=" * 60)
    
    # Save enhanced versions for inspection
    cv2.imwrite('/home/naniwa/ShelfEye/debug_images/enhanced_clahe.jpg', enhanced)
    cv2.imwrite('/home/naniwa/ShelfEye/debug_images/enhanced_sharp.jpg', sharpened)
    cv2.imwrite('/home/naniwa/ShelfEye/debug_images/enhanced_thresh.jpg', 
                cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)[1])
    print("Saved enhanced images to debug_images/enhanced_*.jpg")

if __name__ == "__main__":
    aggressive_detection()