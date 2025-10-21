#!/usr/bin/env python3
"""
Comprehensive QR detection diagnostic
Saves individual QR regions for analysis
"""

import cv2
import numpy as np
from pyzbar import pyzbar
import os

def diagnose_detection():
    rect_path = '/home/naniwa/ShelfEye/debug_images/validation_rectified_debug.jpg'
    
    if not os.path.exists(rect_path):
        print("ERROR: Rectified image not found")
        return
    
    print("=" * 60)
    print("QR DETECTION DIAGNOSTIC")
    print("=" * 60)
    
    # Load image
    img = cv2.imread(rect_path)
    print(f"\nImage loaded: {img.shape[1]}x{img.shape[0]} pixels")
    
    # Define the 7 expected QR positions (in cm, from your database)
    # These are the center positions
    qr_positions = [
        ("pen-001", 19.5, 15),
        ("pen-002", 44, 39),
        ("pen-003", 44.5, 16.5),
        ("pen-004", 67, 15.5),
        ("5x5-001", 24, 27.5),
        ("5x5-002", 44, 28.5),
        ("5x5-003", 65, 27.5)
    ]
    
    # Convert cm to pixels (80 px/cm)
    px_per_cm = 80
    qr_size_cm = 3  # 30mm = 3cm
    qr_size_px = int(qr_size_cm * px_per_cm)
    
    print(f"\nExpecting 7 QR codes, each ~{qr_size_px}px wide")
    print("\nExtracting and testing each QR region:")
    print("-" * 40)
    
    detected_count = 0
    
    for qr_id, x_cm, y_cm in qr_positions:
        # Convert center position to pixel coordinates
        center_x = int(x_cm * px_per_cm)
        center_y = int(y_cm * px_per_cm)
        
        # Extract region around expected QR position (with margin)
        margin = 50  # Extra pixels around QR
        x1 = max(0, center_x - qr_size_px//2 - margin)
        y1 = max(0, center_y - qr_size_px//2 - margin)
        x2 = min(img.shape[1], center_x + qr_size_px//2 + margin)
        y2 = min(img.shape[0], center_y + qr_size_px//2 + margin)
        
        roi = img[y1:y2, x1:x2]
        
        print(f"\n{qr_id}:")
        print(f"  Position: ({x_cm:.1f}, {y_cm:.1f}) cm -> ({center_x}, {center_y}) px")
        print(f"  ROI: [{x1}:{x2}, {y1}:{y2}] = {roi.shape[1]}x{roi.shape[0]} px")
        
        # Save the ROI for manual inspection
        roi_path = f'/home/naniwa/ShelfEye/debug_images/roi_{qr_id}.jpg'
        cv2.imwrite(roi_path, roi)
        
        # Try detecting QR in this region
        qrs = pyzbar.decode(roi)
        if qrs:
            detected_count += 1
            for qr in qrs:
                print(f"  ✓ DETECTED: '{qr.data.decode('utf-8')}'")
                print(f"    Size: {qr.rect.width}x{qr.rect.height} px")
        else:
            print(f"  ✗ NOT DETECTED")
            
            # Try preprocessing
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            
            # Try with threshold
            _, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
            qrs_thresh = pyzbar.decode(thresh)
            if qrs_thresh:
                print(f"  ✓ DETECTED with threshold: '{qrs_thresh[0].data.decode('utf-8')}'")
                detected_count += 0.5  # Partial credit
            else:
                # Try with adaptive threshold
                adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                                cv2.THRESH_BINARY, 11, 2)
                qrs_adaptive = pyzbar.decode(adaptive)
                if qrs_adaptive:
                    print(f"  ✓ DETECTED with adaptive: '{qrs_adaptive[0].data.decode('utf-8')}'")
                    detected_count += 0.5
                else:
                    # Analyze why it might fail
                    print(f"  Analysis:")
                    print(f"    Mean brightness: {gray.mean():.1f}")
                    print(f"    Std deviation: {gray.std():.1f}")
                    
                    # Check if there's any QR-like pattern
                    edges = cv2.Canny(gray, 50, 150)
                    edge_density = edges.sum() / (255 * edges.size)
                    print(f"    Edge density: {edge_density:.3f}")
                    
                    # Save preprocessed versions for inspection
                    cv2.imwrite(f'/home/naniwa/ShelfEye/debug_images/roi_{qr_id}_thresh.jpg', thresh)
                    cv2.imwrite(f'/home/naniwa/ShelfEye/debug_images/roi_{qr_id}_adaptive.jpg', adaptive)
    
    print("\n" + "=" * 60)
    print(f"SUMMARY: Detected {detected_count:.1f} / 7 QR codes")
    print("\nSaved individual ROI images to debug_images/roi_*.jpg")
    print("Check these images to see what the detector is seeing")
    print("=" * 60)
    
    # Also try detecting all QRs in full image
    print("\nFull image detection:")
    all_qrs = pyzbar.decode(img)
    print(f"  Found {len(all_qrs)} QR codes total")
    for qr in all_qrs:
        x, y, w, h = qr.rect
        print(f"  - '{qr.data.decode('utf-8')}' at ({x},{y}) size {w}x{h}")

if __name__ == "__main__":
    diagnose_detection()