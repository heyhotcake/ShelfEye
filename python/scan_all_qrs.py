#!/usr/bin/env python3
"""
Scan entire image for all QR codes - no slot filtering
Uses same detection method as production for accurate results
"""

import argparse
import json
import sys
import logging
import numpy as np
import cv2

# Try to import pyzbar (available on Pi, not on Replit)
try:
    from pyzbar import pyzbar
    PYZBAR_AVAILABLE = True
except ImportError:
    PYZBAR_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def scan_with_pyzbar(image):
    """Multi-scale QR detection using pyzbar (production method)"""
    results = []
    found_qr_data = set()
    
    # Convert to grayscale
    gray = image if len(image.shape) == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Multi-scale detection (same as production)
    scales = [1.0, 2.0, 3.0]
    
    # Preprocessing setup
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    
    for scale in scales:
        # Upscale image
        if scale != 1.0:
            scaled_width = int(gray.shape[1] * scale)
            scaled_height = int(gray.shape[0] * scale)
            scaled_gray = cv2.resize(gray, (scaled_width, scaled_height), interpolation=cv2.INTER_CUBIC)
        else:
            scaled_gray = gray
        
        # Try multiple preprocessing methods
        preprocessing_methods = [
            ('original', scaled_gray),
            ('binary_127', cv2.threshold(scaled_gray, 127, 255, cv2.THRESH_BINARY)[1]),
            ('adaptive', cv2.adaptiveThreshold(scaled_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)),
            ('enhanced', clahe.apply(scaled_gray)),
        ]
        
        for method_name, processed_img in preprocessing_methods:
            try:
                qr_codes = pyzbar.decode(processed_img)
                for qr in qr_codes:
                    data = qr.data.decode('utf-8')
                    if data not in found_qr_data:
                        found_qr_data.add(data)
                        
                        # Get bounding box and scale back to original size
                        x, y, w, h = qr.rect
                        if scale != 1.0:
                            x, y, w, h = int(x/scale), int(y/scale), int(w/scale), int(h/scale)
                        
                        center_x = x + w / 2
                        center_y = y + h / 2
                        
                        result = {
                            'data': data,
                            'type': qr.type,
                            'center_x': center_x,
                            'center_y': center_y,
                            'width': w,
                            'height': h,
                            'detection_method': f'pyzbar_{method_name}_x{scale}'
                        }
                        results.append(result)
                        logger.info(f"QR found via {method_name}@{scale}x: '{data}' at ({center_x:.1f}, {center_y:.1f})")
            except:
                pass
    
    return results

def scan_with_opencv(image):
    """Fallback: OpenCV QR detector (less robust, for Replit testing)"""
    results = []
    qr_detector = cv2.QRCodeDetector()
    
    success, decoded_info, points, _ = qr_detector.detectAndDecodeMulti(image)
    
    if success and decoded_info:
        for i, data in enumerate(decoded_info):
            if data:
                qr_points = points[i]
                xs, ys = qr_points[:, 0], qr_points[:, 1]
                left, top = int(np.min(xs)), int(np.min(ys))
                right, bottom = int(np.max(xs)), int(np.max(ys))
                
                center_x = (left + right) / 2
                center_y = (top + bottom) / 2
                
                result = {
                    'data': data,
                    'type': 'QRCODE',
                    'center_x': center_x,
                    'center_y': center_y,
                    'width': right - left,
                    'height': bottom - top,
                    'detection_method': 'opencv_basic'
                }
                results.append(result)
                logger.info(f"QR found via OpenCV: '{data}' at ({center_x:.1f}, {center_y:.1f})")
    
    return results

def scan_all_qr_codes(image_path):
    """
    Scan entire image for all QR codes, return everything found
    Uses production-grade pyzbar if available, falls back to OpenCV
    """
    try:
        # Load image
        logger.info(f"Loading image: {image_path}")
        image = cv2.imread(image_path)
        if image is None:
            raise Exception(f"Could not load image: {image_path}")
        
        height, width = image.shape[:2]
        logger.info(f"Image loaded: {width}x{height}px")
        
        # Use pyzbar if available (production method), otherwise OpenCV
        if PYZBAR_AVAILABLE:
            logger.info("Using pyzbar (production method)")
            results = scan_with_pyzbar(image)
        else:
            logger.warning("pyzbar not available, using OpenCV fallback (less robust)")
            results = scan_with_opencv(image)
        
        logger.info(f"Found {len(results)} QR codes")
        
        return {
            'success': True,
            'qr_codes': results,
            'total_found': len(results),
            'image_size': {'width': width, 'height': height},
            'detector_used': 'pyzbar' if PYZBAR_AVAILABLE else 'opencv'
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
