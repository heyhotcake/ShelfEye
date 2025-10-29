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
from pyzbar.pyzbar import decode

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
        
        # Decode all QR codes
        detected_qrs = decode(image)
        
        logger.info(f"Found {len(detected_qrs)} QR codes")
        
        results = []
        for qr in detected_qrs:
            # Get QR data
            qr_data = qr.data.decode('utf-8')
            
            # Get bounding box
            rect = qr.rect
            polygon = qr.polygon
            
            # Calculate center
            center_x = rect.left + rect.width / 2
            center_y = rect.top + rect.height / 2
            
            result = {
                'data': qr_data,
                'type': qr.type,
                'center_x': center_x,
                'center_y': center_y,
                'width': rect.width,
                'height': rect.height,
                'bbox': {
                    'left': rect.left,
                    'top': rect.top,
                    'width': rect.width,
                    'height': rect.height
                },
                'polygon': [[p.x, p.y] for p in polygon]
            }
            
            results.append(result)
            logger.info(f"QR found: '{qr_data}' at ({center_x:.1f}, {center_y:.1f})")
        
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
