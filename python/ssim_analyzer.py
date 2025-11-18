#!/usr/bin/env python3
"""
SSIM (Structural Similarity Index) Analyzer for Tool Tracking System
Handles image comparison for presence detection
"""

import numpy as np
import cv2
from typing import Tuple, Optional
import logging
from skimage.metrics import structural_similarity as ssim

logger = logging.getLogger(__name__)

class SSIMAnalyzer:
    def __init__(self):
        """Initialize SSIM analyzer"""
        pass
    
    def preprocess_image(self, image: np.ndarray, target_size: Tuple[int, int] = (200, 200)) -> np.ndarray:
        """
        Preprocess image for SSIM comparison
        
        Args:
            image: Input image (grayscale or color)
            target_size: Target size for resizing (width, height)
        
        Returns:
            Preprocessed grayscale image
        """
        try:
            # Convert to grayscale if needed
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()
            
            # Resize image to standard size for comparison
            resized = cv2.resize(gray, target_size, interpolation=cv2.INTER_AREA)
            
            # Apply Gaussian blur to reduce noise
            blurred = cv2.GaussianBlur(resized, (3, 3), 0)
            
            # Normalize pixel values
            normalized = np.zeros_like(blurred)
            normalized = cv2.normalize(blurred, normalized, 0, 255, cv2.NORM_MINMAX)
            
            return normalized.astype(np.uint8)
            
        except Exception as e:
            logger.error(f"Error preprocessing image: {e}")
            return image
    
    def compare_images(self, img1: np.ndarray, img2: np.ndarray, 
                      target_size: Tuple[int, int] = (200, 200)) -> float:
        """
        Compare two images using SSIM
        
        Args:
            img1: First image
            img2: Second image  
            target_size: Target size for preprocessing
        
        Returns:
            SSIM score between 0 and 1 (1 = identical)
        """
        try:
            # Preprocess both images
            processed_img1 = self.preprocess_image(img1, target_size)
            processed_img2 = self.preprocess_image(img2, target_size)
            
            # Ensure images have the same size
            if processed_img1.shape != processed_img2.shape:
                logger.warning("Images have different shapes, resizing")
                processed_img2 = cv2.resize(processed_img2, 
                                          (processed_img1.shape[1], processed_img1.shape[0]))
            
            # Calculate SSIM
            ssim_score, _ = ssim(processed_img1, processed_img2, full=True)
            
            return float(ssim_score)
            
        except Exception as e:
            logger.error(f"Error comparing images: {e}")
            return 0.0
    
    def create_empty_baseline(self, background_image: np.ndarray, 
                            roi_coords: np.ndarray) -> np.ndarray:
        """
        Create empty baseline image from background
        
        Args:
            background_image: Full camera image with empty shelf
            roi_coords: Region of interest coordinates
        
        Returns:
            Empty baseline ROI image
        """
        try:
            # Extract ROI using coordinates
            mask = np.zeros(background_image.shape[:2], dtype=np.uint8)
            cv2.fillPoly(mask, [roi_coords.astype(np.int32)], 255)
            
            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(roi_coords.astype(np.int32))
            
            # Extract and mask ROI
            roi = background_image[y:y+h, x:x+w]
            mask_roi = mask[y:y+h, x:x+w]
            
            if len(background_image.shape) == 3:
                roi_masked = cv2.bitwise_and(roi, roi, mask=mask_roi)
            else:
                roi_masked = cv2.bitwise_and(roi, mask_roi)
            
            return self.preprocess_image(roi_masked)
            
        except Exception as e:
            logger.error(f"Error creating empty baseline: {e}")
            return np.zeros((200, 200), dtype=np.uint8)
    
    def create_full_baseline(self, tool_image: np.ndarray, 
                           roi_coords: np.ndarray) -> np.ndarray:
        """
        Create full baseline image with correct tool in place
        
        Args:
            tool_image: Full camera image with correct tool in place
            roi_coords: Region of interest coordinates
        
        Returns:
            Full baseline ROI image
        """
        try:
            # Extract ROI using coordinates (same as empty baseline)
            mask = np.zeros(tool_image.shape[:2], dtype=np.uint8)
            cv2.fillPoly(mask, [roi_coords.astype(np.int32)], 255)
            
            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(roi_coords.astype(np.int32))
            
            # Extract and mask ROI
            roi = tool_image[y:y+h, x:x+w]
            mask_roi = mask[y:y+h, x:x+w]
            
            if len(tool_image.shape) == 3:
                roi_masked = cv2.bitwise_and(roi, roi, mask=mask_roi)
            else:
                roi_masked = cv2.bitwise_and(roi, mask_roi)
            
            return self.preprocess_image(roi_masked)
            
        except Exception as e:
            logger.error(f"Error creating full baseline: {e}")
            return np.zeros((200, 200), dtype=np.uint8)
    
    def analyze_presence(self, current_roi: np.ndarray, 
                        empty_baseline: np.ndarray,
                        full_baseline: Optional[np.ndarray] = None,
                        empty_threshold: float = 0.8,
                        full_threshold: float = 0.7) -> dict:
        """
        Analyze presence and correctness of tool in ROI
        
        Args:
            current_roi: Current ROI image
            empty_baseline: Empty slot baseline image
            full_baseline: Full slot baseline image (optional)
            empty_threshold: SSIM threshold for empty detection
            full_threshold: SSIM threshold for correct tool detection
        
        Returns:
            Analysis results dictionary
        """
        try:
            # Compare with empty baseline
            empty_score = self.compare_images(current_roi, empty_baseline)
            
            # Determine presence (high similarity with empty = not present)
            present = empty_score < empty_threshold
            
            result = {
                'present': present,
                'correct_item': False,
                's_empty': empty_score,
                's_full': 0.0
            }
            
            # Compare with full baseline if available and item is present
            if full_baseline is not None and present:
                full_score = self.compare_images(current_roi, full_baseline)
                result['s_full'] = full_score
                result['correct_item'] = full_score >= full_threshold
            
            return result
            
        except Exception as e:
            logger.error(f"Error analyzing presence: {e}")
            return {
                'present': False,
                'correct_item': False,
                's_empty': 0.0,
                's_full': 0.0
            }
    
    def calculate_image_quality_metrics(self, image: np.ndarray) -> dict:
        """
        Calculate image quality metrics for pose quality assessment
        
        Args:
            image: Input image
        
        Returns:
            Dictionary of quality metrics
        """
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
            
            # Laplacian variance (focus/sharpness measure)
            laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
            
            # Sobel gradient magnitude (edge strength)
            sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
            sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
            gradient_magnitude = np.sqrt(sobelx**2 + sobely**2).mean()
            
            # Brightness and contrast
            brightness = gray.mean()
            contrast = gray.std()
            
            # Overall quality score (weighted combination)
            quality_score = min(200.0, laplacian_var * 0.7 + gradient_magnitude * 0.3)
            
            return {
                'laplacian_variance': laplacian_var,
                'gradient_magnitude': gradient_magnitude,
                'brightness': brightness,
                'contrast': contrast,
                'quality_score': quality_score
            }
            
        except Exception as e:
            logger.error(f"Error calculating image quality metrics: {e}")
            return {
                'laplacian_variance': 0.0,
                'gradient_magnitude': 0.0,
                'brightness': 0.0,
                'contrast': 0.0,
                'quality_score': 0.0
            }

def test_ssim_analyzer():
    """Test function for SSIM analyzer"""
    import sys
    
    if len(sys.argv) < 3:
        print("Usage: python ssim_analyzer.py <image1_path> <image2_path>")
        sys.exit(1)
    
    img1_path = sys.argv[1]
    img2_path = sys.argv[2]
    
    # Load images
    img1 = cv2.imread(img1_path)
    img2 = cv2.imread(img2_path)
    
    if img1 is None or img2 is None:
        print("Error: Could not load one or both images")
        sys.exit(1)
    
    # Create analyzer
    analyzer = SSIMAnalyzer()
    
    # Compare images
    ssim_score = analyzer.compare_images(img1, img2)
    print(f"SSIM score: {ssim_score:.4f}")
    
    # Calculate quality metrics
    quality1 = analyzer.calculate_image_quality_metrics(img1)
    quality2 = analyzer.calculate_image_quality_metrics(img2)
    
    print(f"Image 1 quality: {quality1['quality_score']:.2f}")
    print(f"Image 2 quality: {quality2['quality_score']:.2f}")

if __name__ == '__main__':
    test_ssim_analyzer()
