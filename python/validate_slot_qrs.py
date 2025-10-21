#!/usr/bin/env python3
"""
Validate slot QR codes in calibrated camera view.
Used for two-step calibration validation:
1. Verify QR codes ARE readable when slots are empty
2. Verify QR codes are NOT readable when tools are placed (covering QRs)
"""

import cv2
import numpy as np
import json
import sys
import argparse
from pyzbar import pyzbar

def decode_qr_codes(image):
    """Decode all QR codes in image with preprocessing for better detection"""
    results = []
    
    # Initialize OpenCV QR detector as fallback
    opencv_detector = cv2.QRCodeDetector()
    
    # Try multiple preprocessing techniques to improve detection
    preprocessing_methods = [
        ('original', image),
        ('grayscale', cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image),
    ]
    
    # Add adaptive thresholding on grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    adaptive_thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    preprocessing_methods.append(('adaptive_threshold', adaptive_thresh))
    
    # Add inverted binary threshold (helps with certain lighting)
    _, binary_inv = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)
    preprocessing_methods.append(('inverted_binary', binary_inv))
    
    # Add Otsu-based inverted threshold (more robust across lighting conditions)
    _, otsu_inv = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    preprocessing_methods.append(('otsu_inverted', otsu_inv))
    
    # Add contrast enhancement
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    enhanced = clahe.apply(gray)
    preprocessing_methods.append(('enhanced', enhanced))
    
    # Track which QR codes we've already found (by data) to avoid duplicates
    found_qr_data = set()
    
    # First pass: Try pyzbar on all preprocessing methods
    for method_name, processed_image in preprocessing_methods:
        qr_codes = pyzbar.decode(processed_image)
        
        for qr in qr_codes:
            data = qr.data.decode('utf-8')
            
            # Skip if we already found this QR code
            if data in found_qr_data:
                continue
            
            found_qr_data.add(data)
            x, y, w, h = qr.rect
            
            results.append({
                'data': data,
                'type': qr.type,
                'rect': {'x': x, 'y': y, 'width': w, 'height': h},
                'polygon': [(point.x, point.y) for point in qr.polygon],
                'center': (x + w / 2, y + h / 2),  # QR code center position
                'detection_method': f'pyzbar_{method_name}'
            })
            print(f"QR detected via pyzbar_{method_name}: {data}", file=sys.stderr)
    
    # Second pass: Try OpenCV QRCodeDetector as fallback (can detect multiple QRs)
    for method_name, processed_image in preprocessing_methods:
        try:
            # Use detectAndDecodeMulti to find all QR codes in the image
            ok, decoded_info, points, _ = opencv_detector.detectAndDecodeMulti(processed_image)
            
            if ok and decoded_info:
                for i, data in enumerate(decoded_info):
                    if data and data not in found_qr_data:
                        found_qr_data.add(data)
                        
                        # Calculate bounding box center from points
                        if points is not None and i < len(points):
                            # Reshape points to ensure correct format: [[x,y], [x,y], ...]
                            pts = np.array(points[i]).reshape(-1, 2).astype(int)
                            x_coords = pts[:, 0]
                            y_coords = pts[:, 1]
                            x, y = int(x_coords.min()), int(y_coords.min())
                            w, h = int(x_coords.max() - x), int(y_coords.max() - y)
                            center = (x + w / 2, y + h / 2)
                            polygon = [(int(p[0]), int(p[1])) for p in pts]
                        else:
                            # Fallback if bbox not available
                            h_img, w_img = processed_image.shape[:2]
                            x, y, w, h = 0, 0, w_img, h_img
                            center = (w_img / 2, h_img / 2)
                            polygon = []
                        
                        results.append({
                            'data': data,
                            'type': 'QRCODE',
                            'rect': {'x': x, 'y': y, 'width': w, 'height': h},
                            'polygon': polygon,
                            'center': center,
                            'detection_method': f'opencv_{method_name}'
                        })
                        print(f"QR detected via opencv_{method_name}: {data}", file=sys.stderr)
        except Exception as e:
            # OpenCV decoder may fail on some images, continue to next method
            pass
    
    return results

def point_in_rotated_rect(point, center_cm, width_cm, height_cm, rotation_deg, scale_x, scale_y):
    """Check if point (in pixels) is inside a rotated rectangle (defined in cm)"""
    # Convert point to cm space
    point_cm = np.array([point[0] / scale_x, point[1] / scale_y])
    
    # Translate to rectangle's local coordinate system (center at origin)
    local_point = point_cm - center_cm
    
    # Rotate point by negative rotation to align with rectangle axes
    if rotation_deg != 0:
        angle_rad = -np.deg2rad(rotation_deg)
        cos_a = np.cos(angle_rad)
        sin_a = np.sin(angle_rad)
        local_point = np.array([
            cos_a * local_point[0] - sin_a * local_point[1],
            sin_a * local_point[0] + cos_a * local_point[1]
        ])
    
    # Check if point is within rectangle bounds
    half_w = width_cm / 2
    half_h = height_cm / 2
    return abs(local_point[0]) <= half_w and abs(local_point[1]) <= half_h

def validate_slot_qrs(camera_index, resolution, homography_matrix, expected_slots, should_detect=True, device_path=None, camera_matrix=None, dist_coeffs=None, paper_width_cm=None, paper_height_cm=None):
    """
    Validate slot QR codes in calibrated camera view.
    
    Args:
        camera_index: Camera device index (fallback if device_path not provided)
        resolution: Tuple of (width, height)
        homography_matrix: 3x3 homography matrix for perspective correction
        expected_slots: List of expected slot QR data (id, slotId, etc.)
        should_detect: True if QRs should be detected, False if they should NOT be detected
        device_path: Device path for Raspberry Pi (/dev/video0, /dev/video1, etc.)
        paper_width_cm: Paper width in cm for output size calculation
        paper_height_cm: Paper height in cm for output size calculation
    
    Returns:
        JSON with validation results
    """
    
    # Open camera - use device path if provided, otherwise use index
    camera_source = device_path if device_path else camera_index
    print(f"[VALIDATION] Opening camera: {camera_source}", file=sys.stderr)
    sys.stderr.flush()
    cap = cv2.VideoCapture(camera_source)
    if not cap.isOpened():
        print(f"[VALIDATION] ERROR: Failed to open camera {camera_source}", file=sys.stderr)
        sys.stderr.flush()
        return {
            'success': False,
            'error': f'Failed to open camera {camera_source}'
        }
    print(f"[VALIDATION] Camera opened successfully", file=sys.stderr)
    sys.stderr.flush()
    
    # Set MJPG format for better performance with USB cameras
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    
    # Set resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, resolution[0])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, resolution[1])
    
    # Set buffer size to 1 to avoid stale frames
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    print(f"[VALIDATION] Starting frame capture (2 warmup + 5 capture frames)", file=sys.stderr)
    sys.stderr.flush()
    
    # Warm-up: Discard first 2 frames to let AE stabilize
    for i in range(2):
        ret, _ = cap.read()
        if ret:
            print(f"[VALIDATION] Warmup frame {i+1}/2 captured", file=sys.stderr)
            sys.stderr.flush()
    
    # Capture multiple frames and select the sharpest (reduces motion blur and AE instability)
    num_frames = 5
    frames = []
    sharpness_scores = []
    
    print(f"[VALIDATION] Capturing {num_frames} frames for sharpness analysis", file=sys.stderr)
    sys.stderr.flush()
    
    for i in range(num_frames):
        ret, frame = cap.read()
        if ret:
            # Calculate sharpness using Laplacian variance (higher = sharper)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
            frames.append(frame)
            sharpness_scores.append(sharpness)
            print(f"[VALIDATION] Frame {i+1}/{num_frames} captured, sharpness={sharpness:.2f}", file=sys.stderr)
            sys.stderr.flush()
    
    cap.release()
    print(f"[VALIDATION] Camera released, captured {len(frames)} frames", file=sys.stderr)
    sys.stderr.flush()
    
    if not frames:
        print(f"[VALIDATION] ERROR: Failed to capture any frames", file=sys.stderr)
        sys.stderr.flush()
        return {
            'success': False,
            'error': 'Failed to capture any frames'
        }
    
    # Select the sharpest frame
    best_frame_idx = np.argmax(sharpness_scores)
    frame = frames[best_frame_idx]
    print(f"[VALIDATION] Selected frame {best_frame_idx+1}/{num_frames} with sharpness {sharpness_scores[best_frame_idx]:.2f}", file=sys.stderr)
    sys.stderr.flush()
    
    # Save the raw captured frame for debugging
    import os
    debug_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'debug_images')
    os.makedirs(debug_dir, exist_ok=True)
    raw_frame_path = os.path.join(debug_dir, 'validation_raw_frame.jpg')
    cv2.imwrite(raw_frame_path, frame)
    print(f"[VALIDATION] Saved raw captured frame to: {raw_frame_path}", file=sys.stderr)
    sys.stderr.flush()
    
    # Apply lens distortion correction if camera calibration parameters provided
    # Skip undistortion if all distortion coefficients are zero (to avoid interpolation artifacts)
    if camera_matrix is not None and dist_coeffs is not None:
        D = np.array(dist_coeffs)
        if np.any(D != 0):
            print(f"Applying lens undistortion before warp", file=sys.stderr)
            K = np.array(camera_matrix).reshape(3, 3)
            frame = cv2.undistort(frame, K, D)
        else:
            print(f"Skipping undistortion (all coefficients are zero)", file=sys.stderr)
    
    # Apply homography transformation to get rectified view
    # Use SAME transformation logic as rectified_preview.py
    H = np.array(homography_matrix, dtype=np.float32).reshape(3, 3)
    
    # Calculate output size based on paper dimensions (if provided)
    if paper_width_cm and paper_height_cm:
        # Increased from 40 to 80 for much better QR detection at 30mm size
        pixels_per_cm = 80  # Higher resolution prevents module blur
        output_width = int(paper_width_cm * pixels_per_cm)
        output_height = int(paper_height_cm * pixels_per_cm)
        print(f"Using paper-based output size: {output_width}x{output_height} ({paper_width_cm}x{paper_height_cm} cm) @ {pixels_per_cm}px/cm", file=sys.stderr)
        
        # Build transformation matrix like rectified_preview.py
        scale_x = output_width / paper_width_cm
        scale_y = output_height / paper_height_cm
        
        # Scaling matrix: cm → output pixels
        S = np.array([
            [scale_x, 0, 0],
            [0, scale_y, 0],
            [0, 0, 1]
        ], dtype=np.float32)
        
        # Invert homography: camera pixels → cm
        H_inv = np.linalg.inv(H)
        
        # Combined warp: camera_pixel → cm → output_pixel
        M = S @ H_inv
        
        # Use INTER_NEAREST to avoid blurring QR code modules during warping
        rectified = cv2.warpPerspective(frame, M, (output_width, output_height), flags=cv2.INTER_NEAREST)
    else:
        # Fallback to camera resolution (use H directly - legacy behavior)
        h, w = frame.shape[:2]
        output_width, output_height = w, h
        print(f"Using camera resolution as output size: {output_width}x{output_height}", file=sys.stderr)
        # Use INTER_NEAREST here too to avoid QR module blur
        rectified = cv2.warpPerspective(frame, H, (output_width, output_height), flags=cv2.INTER_NEAREST)
    
    # Draw template slot overlays on rectified image (for visual verification)
    debug_image = rectified.copy()
    if paper_width_cm and paper_height_cm:
        scale_x = output_width / paper_width_cm
        scale_y = output_height / paper_height_cm
        
        for slot in expected_slots:
            x_cm = slot.get('x', 0)
            y_cm = slot.get('y', 0)
            w_cm = slot.get('width', 0)
            h_cm = slot.get('height', 0)
            rotation_deg = slot.get('rotation', 0)
            label = slot.get('toolName', '')
            
            if w_cm == 0 or h_cm == 0:
                continue
            
            # Define rectangle corners (center-based)
            half_w = w_cm / 2
            half_h = h_cm / 2
            center_cm = np.array([x_cm, y_cm])
            
            corners_relative = np.array([
                [-half_w, -half_h],  # Top-left
                [half_w, -half_h],   # Top-right
                [half_w, half_h],    # Bottom-right
                [-half_w, half_h]    # Bottom-left
            ], dtype=np.float32)
            
            # Apply rotation if specified
            if rotation_deg != 0:
                angle_rad = np.deg2rad(rotation_deg)
                cos_a = np.cos(angle_rad)
                sin_a = np.sin(angle_rad)
                R = np.array([[cos_a, -sin_a], [sin_a, cos_a]])
                corners_relative = (R @ corners_relative.T).T
            
            # Translate to world position
            corners_cm = corners_relative + center_cm
            
            # Convert cm to pixels
            corners_px = corners_cm * np.array([scale_x, scale_y])
            corners_px = corners_px.astype(np.int32)
            
            # Draw rectangle
            cv2.polylines(debug_image, [corners_px], True, (255, 0, 255), 2)  # Magenta
            
            # Draw label
            center_px = (center_cm * np.array([scale_x, scale_y])).astype(np.int32)
            cv2.putText(debug_image, label, tuple(center_px), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 255), 1)
    
    # Save debug image with overlays
    # Use current directory so file persists and has correct permissions
    import os
    debug_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'debug_images')
    os.makedirs(debug_dir, exist_ok=True)
    debug_path = os.path.join(debug_dir, 'validation_rectified_debug.jpg')
    cv2.imwrite(debug_path, debug_image)
    print(f"Saved rectified image with overlays to: {debug_path}", file=sys.stderr)
    
    # Also save to /tmp for backward compatibility
    tmp_path = '/tmp/validation_rectified_debug.jpg'
    cv2.imwrite(tmp_path, debug_image)
    print(f"Also saved to: {tmp_path}", file=sys.stderr)
    print(f"Rectified image size: {debug_image.shape[1]}x{debug_image.shape[0]}", file=sys.stderr)
    
    # Decode QR codes in rectified image
    print(f"[VALIDATION] Starting QR code decoding with dual decoders (pyzbar + OpenCV)", file=sys.stderr)
    sys.stderr.flush()
    detected_qrs = decode_qr_codes(rectified)
    print(f"[VALIDATION] QR decoding complete: {len(detected_qrs)} total QR codes detected", file=sys.stderr)
    sys.stderr.flush()
    
    # Parse detected QR codes and validate with spatial checking
    valid_slot_qrs = []
    invalid_qrs = []
    
    # Calculate scale factors for spatial validation
    if paper_width_cm and paper_height_cm:
        scale_x = output_width / paper_width_cm
        scale_y = output_height / paper_height_cm
    else:
        scale_x = scale_y = None
    
    for qr in detected_qrs:
        try:
            # QR data is now just a simple string (numeric ID)
            qr_id = qr['data'].strip()
            qr_center = qr['center']
            
            # Check if this ID matches any expected slot
            expected_slot = next((s for s in expected_slots if s['id'] == qr_id), None)
            
            if expected_slot and scale_x and scale_y:
                # Spatial validation: check if QR code is inside its expected slot region
                expected_center_cm = np.array([expected_slot.get('x', 0), expected_slot.get('y', 0)])
                detected_center_cm = np.array([qr_center[0] / scale_x, qr_center[1] / scale_y])
                
                is_in_region = point_in_rotated_rect(
                    qr_center,
                    expected_center_cm,
                    expected_slot.get('width', 0),
                    expected_slot.get('height', 0),
                    expected_slot.get('rotation', 0),
                    scale_x,
                    scale_y
                )
                
                # Calculate distance for debugging
                distance_cm = np.linalg.norm(detected_center_cm - expected_center_cm)
                
                if is_in_region:
                    print(f"[VALIDATION] ✓ {qr_id}: detected at ({detected_center_cm[0]:.1f}, {detected_center_cm[1]:.1f}) cm, expected at ({expected_center_cm[0]:.1f}, {expected_center_cm[1]:.1f}) cm, distance={distance_cm:.1f} cm - PASS", file=sys.stderr)
                    sys.stderr.flush()
                    valid_slot_qrs.append({
                        'slotId': expected_slot['slotId'],
                        'toolName': expected_slot['toolName'],
                        'qrData': {'id': qr_id},  # Simple format for compatibility
                        'rect': qr['rect']
                    })
                else:
                    print(f"[VALIDATION] ✗ {qr_id}: detected at ({detected_center_cm[0]:.1f}, {detected_center_cm[1]:.1f}) cm, expected at ({expected_center_cm[0]:.1f}, {expected_center_cm[1]:.1f}) cm, distance={distance_cm:.1f} cm - REJECTED (outside slot region)", file=sys.stderr)
                    sys.stderr.flush()
                    invalid_qrs.append({
                        'data': qr['data'],
                        'reason': f'QR ID {qr_id} found but NOT in expected slot region (spatial mismatch)'
                    })
            elif expected_slot:
                # Fallback if no spatial data - just match by ID
                valid_slot_qrs.append({
                    'slotId': expected_slot['slotId'],
                    'toolName': expected_slot['toolName'],
                    'qrData': {'id': qr_id},
                    'rect': qr['rect']
                })
            else:
                # ID not in expected slots - might be worker QR or invalid
                invalid_qrs.append({
                    'data': qr['data'],
                    'reason': f'QR ID {qr_id} not expected for this camera'
                })
        
        except Exception as e:
            invalid_qrs.append({
                'data': qr['data'],
                'reason': str(e)
            })
    
    # Determine validation result
    print(f"[VALIDATION] Spatial validation complete: {len(valid_slot_qrs)} valid QRs, {len(invalid_qrs)} invalid QRs", file=sys.stderr)
    sys.stderr.flush()
    
    if should_detect:
        # Step 1: QR codes SHOULD be detected (slots empty)
        success = len(valid_slot_qrs) == len(expected_slots)
        missing_slots = []
        
        if not success:
            detected_slot_ids = {qr['qrData']['id'] for qr in valid_slot_qrs}
            missing_slots = [
                {'slotId': s['slotId'], 'toolName': s['toolName']}
                for s in expected_slots
                if s['id'] not in detected_slot_ids
            ]
            print(f"[VALIDATION] Missing {len(missing_slots)} expected QR codes", file=sys.stderr)
            sys.stderr.flush()
        
        total_qrs = len(valid_slot_qrs) + len(invalid_qrs)
        result = {
            'success': success,
            'step': 'validate_qrs_visible',
            'detected_count': len(valid_slot_qrs),
            'expected_count': len(expected_slots),
            'total_qrs_detected': total_qrs,
            'valid_qrs': valid_slot_qrs,
            'missing_slots': missing_slots,
            'invalid_qrs': invalid_qrs,
            'message': f'Detected {len(valid_slot_qrs)}/{len(expected_slots)} expected slot QR codes (total QRs found: {total_qrs})'
        }
        print(f"[VALIDATION] Result: {'SUCCESS' if success else 'FAILED'} - {result['message']}", file=sys.stderr)
        sys.stderr.flush()
        return result
    else:
        # Step 2: QR codes should NOT be detected (tools covering them)
        success = len(valid_slot_qrs) == 0
        
        result = {
            'success': success,
            'step': 'validate_qrs_covered',
            'detected_count': len(valid_slot_qrs),
            'expected_count': 0,
            'visible_qrs': valid_slot_qrs,
            'message': 'All QR codes properly covered by tools' if success else f'{len(valid_slot_qrs)} QR codes still visible'
        }
        print(f"[VALIDATION] Result: {'SUCCESS' if success else 'FAILED'} - {result['message']}", file=sys.stderr)
        sys.stderr.flush()
        return result

def main():
    parser = argparse.ArgumentParser(description='Validate slot QR codes in calibrated camera')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index (fallback if --device-path not provided)')
    parser.add_argument('--device-path', type=str, help='Camera device path for Raspberry Pi (e.g., /dev/video0)')
    parser.add_argument('--resolution', type=str, required=True, help='Camera resolution (WxH)')
    parser.add_argument('--homography', type=str, required=True, help='Homography matrix (JSON array)')
    parser.add_argument('--slots', type=str, required=True, help='Expected slots (JSON array)')
    parser.add_argument('--should-detect', type=str, choices=['true', 'false'], required=True,
                       help='Whether QR codes should be detected (true for step 1, false for step 2)')
    parser.add_argument('--camera-matrix', type=str, default=None, help='Camera intrinsic matrix as comma-separated values (9 values)')
    parser.add_argument('--dist-coeffs', type=str, default=None, help='Distortion coefficients as comma-separated values (5 values)')
    parser.add_argument('--paper-width-cm', type=float, default=None, help='Paper width in cm for output size calculation')
    parser.add_argument('--paper-height-cm', type=float, default=None, help='Paper height in cm for output size calculation')
    
    args = parser.parse_args()
    
    # Parse resolution
    w, h = map(int, args.resolution.split('x'))
    resolution = (w, h)
    
    # Parse homography matrix
    homography_matrix = json.loads(args.homography)
    
    # Parse expected slots
    expected_slots = json.loads(args.slots)
    
    # Parse should_detect
    should_detect = args.should_detect == 'true'
    
    # Parse camera calibration parameters if provided
    camera_matrix = None
    dist_coeffs = None
    if args.camera_matrix:
        camera_matrix = [float(x) for x in args.camera_matrix.split(',')]
        if len(camera_matrix) != 9:
            print(json.dumps({'success': False, 'error': f'Camera matrix must have 9 values, got {len(camera_matrix)}'}))
            sys.exit(1)
    if args.dist_coeffs:
        dist_coeffs = [float(x) for x in args.dist_coeffs.split(',')]
        if len(dist_coeffs) != 5:
            print(json.dumps({'success': False, 'error': f'Distortion coefficients must have 5 values, got {len(dist_coeffs)}'}))
            sys.exit(1)
    
    # Run validation
    result = validate_slot_qrs(
        args.camera,
        resolution,
        homography_matrix,
        expected_slots,
        should_detect,
        device_path=args.device_path,
        camera_matrix=camera_matrix,
        dist_coeffs=dist_coeffs,
        paper_width_cm=args.paper_width_cm,
        paper_height_cm=args.paper_height_cm
    )
    
    # Output JSON result
    print(json.dumps(result))
    
    sys.exit(0 if result['success'] else 1)

if __name__ == '__main__':
    main()
