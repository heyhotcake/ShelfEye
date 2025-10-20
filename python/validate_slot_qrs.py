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
import hmac
import hashlib

def validate_hmac_signature(qr_data: dict, secret_key: str) -> bool:
    """Validate HMAC signature of QR code payload"""
    try:
        # Extract HMAC from data
        provided_hmac = qr_data.get('hmac')
        if not provided_hmac:
            return False
        
        # Create a copy without the HMAC for verification
        data_copy = {k: v for k, v in qr_data.items() if k != 'hmac'}
        
        # Create message for HMAC calculation
        message = json.dumps(data_copy, sort_keys=True).encode('utf-8')
        
        # Calculate expected HMAC
        expected_hmac = hmac.new(secret_key.encode(), message, hashlib.sha256).hexdigest()
        
        # Compare HMACs
        return hmac.compare_digest(provided_hmac, expected_hmac)
    except Exception as e:
        return False

def decode_qr_codes(image):
    """Decode all QR codes in image"""
    qr_codes = pyzbar.decode(image)
    results = []
    
    for qr in qr_codes:
        data = qr.data.decode('utf-8')
        x, y, w, h = qr.rect
        
        results.append({
            'data': data,
            'type': qr.type,
            'rect': {'x': x, 'y': y, 'width': w, 'height': h},
            'polygon': [(point.x, point.y) for point in qr.polygon],
            'center': (x + w / 2, y + h / 2)  # QR code center position
        })
    
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

def validate_slot_qrs(camera_index, resolution, homography_matrix, expected_slots, secret_key, should_detect=True, device_path=None, camera_matrix=None, dist_coeffs=None, paper_width_cm=None, paper_height_cm=None):
    """
    Validate slot QR codes in calibrated camera view.
    
    Args:
        camera_index: Camera device index (fallback if device_path not provided)
        resolution: Tuple of (width, height)
        homography_matrix: 3x3 homography matrix for perspective correction
        expected_slots: List of expected slot QR data (id, slotId, etc.)
        secret_key: HMAC secret key for QR validation
        should_detect: True if QRs should be detected, False if they should NOT be detected
        device_path: Device path for Raspberry Pi (/dev/video0, /dev/video1, etc.)
        paper_width_cm: Paper width in cm for output size calculation
        paper_height_cm: Paper height in cm for output size calculation
    
    Returns:
        JSON with validation results
    """
    
    # Open camera - use device path if provided, otherwise use index
    camera_source = device_path if device_path else camera_index
    print(f"Opening camera: {camera_source}", file=sys.stderr)
    cap = cv2.VideoCapture(camera_source)
    if not cap.isOpened():
        return {
            'success': False,
            'error': f'Failed to open camera {camera_source}'
        }
    
    # Set MJPG format for better performance with USB cameras
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    
    # Set resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, resolution[0])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, resolution[1])
    
    # Capture frame
    ret, frame = cap.read()
    cap.release()
    
    if not ret:
        return {
            'success': False,
            'error': 'Failed to capture frame'
        }
    
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
        # Use same pixels-per-cm as rectified preview
        pixels_per_cm = 20  # Standard conversion
        output_width = int(paper_width_cm * pixels_per_cm)
        output_height = int(paper_height_cm * pixels_per_cm)
        print(f"Using paper-based output size: {output_width}x{output_height} ({paper_width_cm}x{paper_height_cm} cm)", file=sys.stderr)
        
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
        
        rectified = cv2.warpPerspective(frame, M, (output_width, output_height))
    else:
        # Fallback to camera resolution (use H directly - legacy behavior)
        h, w = frame.shape[:2]
        output_width, output_height = w, h
        print(f"Using camera resolution as output size: {output_width}x{output_height}", file=sys.stderr)
        rectified = cv2.warpPerspective(frame, H, (output_width, output_height))
    
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
    detected_qrs = decode_qr_codes(rectified)
    print(f"Total QR codes detected in image: {len(detected_qrs)}", file=sys.stderr)
    
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
                is_in_region = point_in_rotated_rect(
                    qr_center,
                    np.array([expected_slot.get('x', 0), expected_slot.get('y', 0)]),
                    expected_slot.get('width', 0),
                    expected_slot.get('height', 0),
                    expected_slot.get('rotation', 0),
                    scale_x,
                    scale_y
                )
                
                if is_in_region:
                    valid_slot_qrs.append({
                        'slotId': expected_slot['slotId'],
                        'toolName': expected_slot['toolName'],
                        'qrData': {'id': qr_id},  # Simple format for compatibility
                        'rect': qr['rect']
                    })
                else:
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
        
        total_qrs = len(valid_slot_qrs) + len(invalid_qrs)
        return {
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
    else:
        # Step 2: QR codes should NOT be detected (tools covering them)
        success = len(valid_slot_qrs) == 0
        
        return {
            'success': success,
            'step': 'validate_qrs_covered',
            'detected_count': len(valid_slot_qrs),
            'expected_count': 0,
            'visible_qrs': valid_slot_qrs,
            'message': 'All QR codes properly covered by tools' if success else f'{len(valid_slot_qrs)} QR codes still visible'
        }

def main():
    parser = argparse.ArgumentParser(description='Validate slot QR codes in calibrated camera')
    parser.add_argument('--camera', type=int, default=0, help='Camera device index (fallback if --device-path not provided)')
    parser.add_argument('--device-path', type=str, help='Camera device path for Raspberry Pi (e.g., /dev/video0)')
    parser.add_argument('--resolution', type=str, required=True, help='Camera resolution (WxH)')
    parser.add_argument('--homography', type=str, required=True, help='Homography matrix (JSON array)')
    parser.add_argument('--slots', type=str, required=True, help='Expected slots (JSON array)')
    parser.add_argument('--secret', type=str, required=True, help='HMAC secret key')
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
        args.secret,
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
