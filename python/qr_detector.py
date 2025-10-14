#!/usr/bin/env python3
"""
QR Code Detection Module for Tool Tracking System
Handles QR code detection, validation, and parsing
"""

import json
import hmac
import hashlib
from typing import List, Dict, Optional, Tuple
import numpy as np
import cv2
from pyzbar import pyzbar
import logging

logger = logging.getLogger(__name__)

class QRDetector:
    def __init__(self, secret_key: str = "tool_tracker_secret"):
        self.secret_key = secret_key.encode('utf-8')
    
    def detect_qr_codes(self, image: np.ndarray) -> List[Dict]:
        """
        Detect and decode QR codes in the given image
        Returns list of decoded QR code data
        """
        results = []
        
        try:
            # Try multiple preprocessing approaches for better detection
            processed_images = self._preprocess_image(image)
            
            for processed_img in processed_images:
                qr_codes = pyzbar.decode(processed_img)
                
                for qr_code in qr_codes:
                    try:
                        # Decode QR data
                        data = qr_code.data.decode('utf-8')
                        qr_data = json.loads(data)
                        
                        # Validate QR code structure and signature
                        if self._validate_qr_data(qr_data):
                            results.append(qr_data)
                            
                    except (json.JSONDecodeError, UnicodeDecodeError) as e:
                        logger.warning(f"Failed to decode QR data: {e}")
                        continue
        
        except Exception as e:
            logger.error(f"Error detecting QR codes: {e}")
        
        return results
    
    def _preprocess_image(self, image: np.ndarray) -> List[np.ndarray]:
        """
        Apply various preprocessing techniques to improve QR detection
        """
        processed_images = []
        
        # Convert to grayscale if needed
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Original grayscale
        processed_images.append(gray)
        
        # Adaptive thresholding
        adaptive_thresh = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
        )
        processed_images.append(adaptive_thresh)
        
        # Morphological operations to clean up noise
        kernel = np.ones((3,3), np.uint8)
        morph = cv2.morphologyEx(adaptive_thresh, cv2.MORPH_CLOSE, kernel)
        processed_images.append(morph)
        
        # Gaussian blur to reduce noise
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        processed_images.append(blurred)
        
        # Try different scales
        for scale in [0.75, 1.5]:
            h, w = gray.shape
            new_h, new_w = int(h * scale), int(w * scale)
            scaled = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            processed_images.append(scaled)
        
        return processed_images
    
    def _validate_qr_data(self, qr_data: Dict) -> bool:
        """
        Validate QR code data structure and HMAC signature
        """
        required_fields = ['type', 'id', 'version', 'ts']
        
        # Check required fields
        for field in required_fields:
            if field not in qr_data:
                logger.warning(f"Missing required field: {field}")
                return False
        
        # Validate type
        if qr_data['type'] not in ['slot', 'worker']:
            logger.warning(f"Invalid QR type: {qr_data['type']}")
            return False
        
        # Validate HMAC signature if present
        if 'hmac' in qr_data:
            return self._verify_hmac_signature(qr_data)
        
        return True
    
    def _verify_hmac_signature(self, qr_data: Dict) -> bool:
        """
        Verify HMAC signature of QR code data
        """
        try:
            # Extract HMAC from data
            provided_hmac = qr_data.pop('hmac')
            
            # Create message for HMAC calculation
            message = json.dumps(qr_data, sort_keys=True).encode('utf-8')
            
            # Calculate expected HMAC
            expected_hmac = hmac.new(self.secret_key, message, hashlib.sha256).hexdigest()
            
            # Compare HMACs
            is_valid = hmac.compare_digest(provided_hmac, expected_hmac)
            
            # Restore HMAC to data
            qr_data['hmac'] = provided_hmac
            
            if not is_valid:
                logger.warning("HMAC signature verification failed")
            
            return is_valid
            
        except Exception as e:
            logger.error(f"Error verifying HMAC signature: {e}")
            return False
    
    def detect_with_opencv(self, image: np.ndarray) -> List[Dict]:
        """
        Alternative QR detection using OpenCV's QRCodeDetector
        """
        results = []
        
        try:
            detector = cv2.QRCodeDetector()
            
            # Try to detect and decode multiple QR codes
            retval, decoded_info, points, straight_qrcode = detector.detectAndDecodeMulti(image)
            
            if retval:
                for i, info in enumerate(decoded_info):
                    if info:  # Non-empty decoded info
                        try:
                            qr_data = json.loads(info)
                            if self._validate_qr_data(qr_data):
                                results.append(qr_data)
                        except json.JSONDecodeError:
                            logger.warning(f"Invalid JSON in QR code: {info}")
                            continue
        
        except Exception as e:
            logger.error(f"Error with OpenCV QR detection: {e}")
        
        return results
    
    def detect_comprehensive(self, image: np.ndarray) -> List[Dict]:
        """
        Comprehensive QR detection using multiple methods
        """
        all_results = []
        
        # Try pyzbar first (usually more reliable)
        pyzbar_results = self.detect_qr_codes(image)
        all_results.extend(pyzbar_results)
        
        # If no results, try OpenCV method
        if not all_results:
            opencv_results = self.detect_with_opencv(image)
            all_results.extend(opencv_results)
        
        # Remove duplicates based on QR ID
        unique_results = []
        seen_ids = set()
        
        for result in all_results:
            qr_id = result.get('id')
            if qr_id and qr_id not in seen_ids:
                unique_results.append(result)
                seen_ids.add(qr_id)
        
        return unique_results

# Utility functions for QR code generation and validation
def generate_qr_payload(qr_type: str, qr_id: str, **kwargs) -> Dict:
    """Generate QR code payload with proper structure"""
    import time
    import random
    import string
    
    payload = {
        'type': qr_type,
        'id': qr_id,
        'version': '1.0',
        'ts': int(time.time()),
        'nonce': ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
    }
    
    # Add type-specific fields
    if qr_type == 'slot':
        payload['slot_name'] = kwargs.get('slot_name', '')
    elif qr_type == 'worker':
        payload['worker_name'] = kwargs.get('worker_name', '')
    
    return payload

def sign_qr_payload(payload: Dict, secret_key: str = "tool_tracker_secret") -> Dict:
    """Add HMAC signature to QR payload"""
    message = json.dumps(payload, sort_keys=True).encode('utf-8')
    signature = hmac.new(secret_key.encode('utf-8'), message, hashlib.sha256).hexdigest()
    payload['hmac'] = signature
    return payload

if __name__ == '__main__':
    # Test QR detection
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python qr_detector.py <image_path>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    image = cv2.imread(image_path)
    
    if image is None:
        print(f"Could not load image: {image_path}")
        sys.exit(1)
    
    detector = QRDetector()
    results = detector.detect_comprehensive(image)
    
    print(f"Detected {len(results)} QR codes:")
    for result in results:
        print(json.dumps(result, indent=2))
