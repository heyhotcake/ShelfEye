#!/usr/bin/env python3
"""
Scan entire image for all QR codes - no slot filtering
Used for debugging to see what QR codes are actually readable
"""

import argparse
import json
import sys
import logging
import numpy as np
import cv2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def scan_all_qr_codes(image_path):
    """
    Scan entire image for all QR codes, return everything found
    
    Returns:
        List of detected QR codes with data and positions
    """
    try:
        # Load image
        logger.info(f"Loading image: {image_path}")
        image = cv2.imread(image_path)
        if image is None:
            raise Exception(f"Could not load image: {image_path}")
        
        height, width = image.shape[:2]
        logger.info(f"Image loaded: {width}x{height}px")
        
        # Use OpenCV's QR code detector
        qr_detector = cv2.QRCodeDetector()
        
        # Detect and decode multiple QR codes
        results = []
        success, decoded_info, points, straight_qrcode = qr_detector.detectAndDecodeMulti(image)
        
        if success and decoded_info:
            for i, data in enumerate(decoded_info):
                if data:  # Skip empty detections
                    # Get corner points for this QR code
                    qr_points = points[i]
                    
                    # Calculate bounding box
                    xs = qr_points[:, 0]
                    ys = qr_points[:, 1]
                    left = int(np.min(xs))
                    top = int(np.min(ys))
                    right = int(np.max(xs))
                    bottom = int(np.max(ys))
                    
                    # Calculate center and size
                    center_x = (left + right) / 2
                    center_y = (top + bottom) / 2
                    qr_width = right - left
                    qr_height = bottom - top
                    
                    result = {
                        'data': data,
                        'type': 'QRCODE',
                        'center_x': center_x,
                        'center_y': center_y,
                        'width': qr_width,
                        'height': qr_height,
                        'bbox': {
                            'left': left,
                            'top': top,
                            'width': qr_width,
                            'height': qr_height
                        },
                        'polygon': qr_points.tolist()
                    }
                    
                    results.append(result)
                    logger.info(f"QR found: '{data}' at ({center_x:.1f}, {center_y:.1f})")
        
        logger.info(f"Found {len(results)} QR codes")
        
        return {
            'success': True,
            'qr_codes': results,
            'total_found': len(results),
            'image_size': {
                'width': width,
                'height': height
            }
        }
        
    except Exception as e:
        logger.error(f"Error scanning QR codes: {e}")
        return {
            'success': False,
            'error': str(e),
            'qr_codes': [],
            'total_found': 0
        }

def main():
    parser = argparse.ArgumentParser(description='Scan entire image for all QR codes')
    parser.add_argument('--image-path', type=str, required=True, help='Path to input image file')
    
    args = parser.parse_args()
    
    try:
        result = scan_all_qr_codes(args.image_path)
        
        # Output JSON result
        print(json.dumps(result))
        
        # Exit with appropriate code
        sys.exit(0 if result['success'] else 1)
        
    except Exception as e:
        logger.error(f"Error in main: {e}")
        print(json.dumps({'success': False, 'error': str(e), 'qr_codes': [], 'total_found': 0}))
        sys.exit(1)

if __name__ == '__main__':
    main()
