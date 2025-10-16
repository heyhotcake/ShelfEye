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
            'polygon': [(point.x, point.y) for point in qr.polygon]
        })
    
    return results

def validate_slot_qrs(camera_index, resolution, homography_matrix, expected_slots, secret_key, should_detect=True):
    """
    Validate slot QR codes in calibrated camera view.
    
    Args:
        camera_index: Camera device index
        resolution: Tuple of (width, height)
        homography_matrix: 3x3 homography matrix for perspective correction
        expected_slots: List of expected slot QR data (id, slotId, etc.)
        secret_key: HMAC secret key for QR validation
        should_detect: True if QRs should be detected, False if they should NOT be detected
    
    Returns:
        JSON with validation results
    """
    
    # Open camera
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return {
            'success': False,
            'error': f'Failed to open camera {camera_index}'
        }
    
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
    
    # Apply homography transformation to get rectified view
    H = np.array(homography_matrix).reshape(3, 3)
    h, w = frame.shape[:2]
    rectified = cv2.warpPerspective(frame, H, (w, h))
    
    # Decode QR codes in rectified image
    detected_qrs = decode_qr_codes(rectified)
    
    # Parse detected QR codes and validate
    valid_slot_qrs = []
    invalid_qrs = []
    
    for qr in detected_qrs:
        try:
            # Parse QR data (JSON format with embedded HMAC)
            qr_payload = json.loads(qr['data'])
            
            # Validate HMAC signature
            if not validate_hmac_signature(qr_payload, secret_key):
                invalid_qrs.append({
                    'data': qr['data'],
                    'reason': 'Invalid HMAC signature'
                })
                continue
            
            # Check if this is a slot QR code
            if qr_payload.get('type') != 'slot':
                continue
            
            # Check if this slot is expected
            slot_id = qr_payload.get('id')
            expected_slot = next((s for s in expected_slots if s['id'] == slot_id), None)
            
            if expected_slot:
                valid_slot_qrs.append({
                    'slotId': expected_slot['slotId'],
                    'toolName': expected_slot['toolName'],
                    'qrData': qr_payload,
                    'rect': qr['rect']
                })
            else:
                invalid_qrs.append({
                    'data': qr['data'],
                    'reason': f'Slot {slot_id} not expected for this camera'
                })
        
        except json.JSONDecodeError:
            invalid_qrs.append({
                'data': qr['data'],
                'reason': 'Invalid JSON in QR payload'
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
        
        return {
            'success': success,
            'step': 'validate_qrs_visible',
            'detected_count': len(valid_slot_qrs),
            'expected_count': len(expected_slots),
            'valid_qrs': valid_slot_qrs,
            'missing_slots': missing_slots,
            'invalid_qrs': invalid_qrs,
            'message': f'Detected {len(valid_slot_qrs)}/{len(expected_slots)} expected slot QR codes'
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
    parser.add_argument('--camera', type=int, required=True, help='Camera device index')
    parser.add_argument('--resolution', type=str, required=True, help='Camera resolution (WxH)')
    parser.add_argument('--homography', type=str, required=True, help='Homography matrix (JSON array)')
    parser.add_argument('--slots', type=str, required=True, help='Expected slots (JSON array)')
    parser.add_argument('--secret', type=str, required=True, help='HMAC secret key')
    parser.add_argument('--should-detect', type=str, choices=['true', 'false'], required=True,
                       help='Whether QR codes should be detected (true for step 1, false for step 2)')
    
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
    
    # Run validation
    result = validate_slot_qrs(
        args.camera,
        resolution,
        homography_matrix,
        expected_slots,
        args.secret,
        should_detect
    )
    
    # Output JSON result
    print(json.dumps(result))
    
    sys.exit(0 if result['success'] else 1)

if __name__ == '__main__':
    main()
