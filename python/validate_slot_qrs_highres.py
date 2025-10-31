#!/usr/bin/env python3
"""
High-resolution QR validation with better detection
"""

import cv2
import numpy as np
import json
import sys
import argparse
from pyzbar import pyzbar

def decode_qr_codes_aggressive(image):
    """Decode QR codes with aggressive preprocessing and multi-scale detection"""
    results = []
    found_qr_data = set()
    
    # Convert to grayscale if needed
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    
    # Try multiple scales - CRUCIAL for small QRs
    scales = [1.0, 1.5, 2.0, 3.0]  # Upscale for better detection
    
    for scale in scales:
        if scale != 1.0:
            # Upscale the image for better QR detection
            scaled_width = int(gray.shape[1] * scale)
            scaled_height = int(gray.shape[0] * scale)
            scaled = cv2.resize(gray, (scaled_width, scaled_height), interpolation=cv2.INTER_CUBIC)
        else:
            scaled = gray
        
        # Multiple preprocessing methods
        preprocessing = [
            ('scaled', scaled),
            ('threshold', cv2.threshold(scaled, 127, 255, cv2.THRESH_BINARY)[1]),
            ('adaptive', cv2.adaptiveThreshold(scaled, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)),
        ]
        
        # Add sharpening for blurry QRs
        kernel = np.array([[-1,-1,-1],
                          [-1, 9,-1],
                          [-1,-1,-1]])
        sharpened = cv2.filter2D(scaled, -1, kernel)
        preprocessing.append(('sharpened', sharpened))
        
        for method_name, processed in preprocessing:
            try:
                qrs = pyzbar.decode(processed)
                
                for qr in qrs:
                    data = qr.data.decode('utf-8')
                    
                    if data not in found_qr_data:
                        found_qr_data.add(data)
                        x, y, w, h = qr.rect
                        
                        # Scale coordinates back to original
                        results.append({
                            'data': data,
                            'type': str(qr.type),
                            'rect': {
                                'x': int(x / scale),
                                'y': int(y / scale),
                                'width': int(w / scale),
                                'height': int(h / scale)
                            },
                            'method': f'{method_name}_x{scale}'
                        })
                        print(f"  ✓ Found '{data}' using {method_name} at {scale}x scale")
                        
            except Exception as e:
                continue
    
    # Try OpenCV detector as fallback
    if len(results) < 7:  # If we haven't found all QRs
        detector = cv2.QRCodeDetector()
        
        # Try at 2x scale with OpenCV
        scaled = cv2.resize(gray, (gray.shape[1]*2, gray.shape[0]*2), interpolation=cv2.INTER_CUBIC)
        retval, decoded_data, points, straight_qrcode = detector.detectAndDecodeMulti(scaled)
        
        if retval and decoded_data:
            for i, data in enumerate(decoded_data):
                if data and data not in found_qr_data:
                    found_qr_data.add(data)
                    if points is not None and i < len(points):
                        # Get bounding box from points
                        pts = points[i]
                        x = int(np.min(pts[:, 0]) / 2)
                        y = int(np.min(pts[:, 1]) / 2)
                        w = int((np.max(pts[:, 0]) - np.min(pts[:, 0])) / 2)
                        h = int((np.max(pts[:, 1]) - np.min(pts[:, 1])) / 2)
                        
                        results.append({
                            'data': data,
                            'type': 'QRCODE',
                            'rect': {'x': x, 'y': y, 'width': w, 'height': h},
                            'method': 'opencv_x2'
                        })
                        print(f"  ✓ Found '{data}' using OpenCV detector")
    
    return results

def validate_slot_qrs(camera_id, mode='visible'):
    """Main validation function with high-resolution processing"""
    
    # Camera capture at MAXIMUM resolution
    cap = cv2.VideoCapture(0)
    
    # Try to set maximum 4K resolution for best QR detection
    # Camera will fall back to best supported resolution if 4K not available
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 3840)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 2160)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    # Enable autofocus only - let camera handle exposure/white balance automatically
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)  # Autofocus
    # Note: NOT setting AUTO_EXPOSURE - camera defaults work best
    # Note: NOT setting AUTO_WB - let camera use built-in auto white balance
    
    if not cap.isOpened():
        print(json.dumps({"error": "Failed to open camera"}))
        sys.exit(1)
    
    # Get actual resolution
    actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Camera resolution: {actual_width}x{actual_height}")
    
    # Warm up camera
    print("Warming up camera...")
    for _ in range(5):
        cap.read()
    
    # Capture multiple frames and pick sharpest
    print("Capturing frames...")
    best_frame = None
    best_sharpness = 0
    
    for i in range(10):  # Capture 10 frames
        ret, frame = cap.read()
        if ret:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
            if sharpness > best_sharpness:
                best_sharpness = sharpness
                best_frame = frame
    
    cap.release()
    
    if best_frame is None:
        print(json.dumps({"error": "Failed to capture frame"}))
        sys.exit(1)
    
    print(f"Best frame sharpness: {best_sharpness:.2f}")
    
    # Load calibration data
    try:
        # This would normally load from database
        # For now, using expected values
        homography_matrix = np.eye(3)  # Placeholder
        paper_width_cm = 89.1  # 6-page-3x2
        paper_height_cm = 42.0
        
        # Calculate pixels per cm at higher resolution
        px_per_cm = 160  # Double the normal resolution
        
        output_width = int(paper_width_cm * px_per_cm)
        output_height = int(paper_height_cm * px_per_cm)
        
        print(f"Output size: {output_width}x{output_height} at {px_per_cm} px/cm")
        
    except Exception as e:
        print(json.dumps({"error": f"Failed to load calibration: {str(e)}"}))
        sys.exit(1)
    
    # Apply homography transformation at high resolution
    # This is where you'd apply the actual homography
    # For testing, we'll use the captured frame directly
    rectified = best_frame
    
    # Save high-res debug image
    debug_path = '/tmp/highres_validation.jpg'
    cv2.imwrite(debug_path, rectified)
    print(f"Saved high-res debug image to {debug_path}")
    
    # Decode QR codes with aggressive detection
    print("\nSearching for QR codes...")
    qr_results = decode_qr_codes_aggressive(rectified)
    
    # Expected slots
    expected_slots = [
        {'slot_id': 'pen-001', 'expected_qr_id': 'pen-001'},
        {'slot_id': 'pen-002', 'expected_qr_id': 'pen-002'},
        {'slot_id': 'pen-003', 'expected_qr_id': 'pen-003'},
        {'slot_id': 'pen-004', 'expected_qr_id': 'pen-004'},
        {'slot_id': '5x5-001', 'expected_qr_id': '5x5-001'},
        {'slot_id': '5x5-002', 'expected_qr_id': '5x5-002'},
        {'slot_id': '5x5-003', 'expected_qr_id': '5x5-003'},
    ]
    
    # Build validation results
    detected_qrs = {qr['data']: qr for qr in qr_results}
    
    if mode == 'visible':
        # Mode 1: QRs should be visible (empty slots)
        expected_visible = len(expected_slots)
        actual_visible = len(detected_qrs)
        
        missing_qrs = []
        for slot in expected_slots:
            if slot['expected_qr_id'] not in detected_qrs:
                missing_qrs.append(slot['expected_qr_id'])
        
        validation = {
            'expected_visible': expected_visible,
            'actual_visible': actual_visible,
            'missing_qrs': missing_qrs,
            'detected_qrs': list(detected_qrs.keys()),
            'success': len(missing_qrs) == 0
        }
    else:
        # Mode 2: QRs should NOT be visible (tools present)
        validation = {
            'expected_hidden': len(expected_slots),
            'actual_hidden': len(expected_slots) - len(detected_qrs),
            'incorrectly_visible': list(detected_qrs.keys()),
            'success': len(detected_qrs) == 0
        }
    
    print("\n" + "=" * 60)
    print("VALIDATION RESULTS:")
    print(json.dumps(validation, indent=2))
    print("=" * 60)
    
    return validation

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Validate slot QR codes')
    parser.add_argument('camera_id', help='Camera ID')
    parser.add_argument('mode', choices=['visible', 'covered'], help='Validation mode')
    
    args = parser.parse_args()
    validate_slot_qrs(args.camera_id, args.mode)