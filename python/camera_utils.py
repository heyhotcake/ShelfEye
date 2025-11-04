#!/usr/bin/env python3
"""
Camera utilities for optimal camera warmup and image quality
"""

import cv2
import numpy as np
import time
import logging

logger = logging.getLogger(__name__)

def apply_auto_brightness_contrast(image, clip_hist_percent=1):
    """
    Automatic brightness and contrast optimization
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Calculate grayscale histogram
    hist = cv2.calcHist([gray],[0],None,[256],[0,256])
    hist_size = len(hist)
    
    # Calculate cumulative distribution from the histogram
    accumulator = []
    accumulator.append(float(hist[0]))
    for index in range(1, hist_size):
        accumulator.append(accumulator[index -1] + float(hist[index]))
    
    # Locate points to clip
    maximum = accumulator[-1]
    clip_hist_percent *= (maximum/100.0)
    clip_hist_percent /= 2.0
    
    # Locate left cut
    minimum_gray = 0
    while accumulator[minimum_gray] < clip_hist_percent:
        minimum_gray += 1
    
    # Locate right cut
    maximum_gray = hist_size -1
    while accumulator[maximum_gray] >= (maximum - clip_hist_percent):
        maximum_gray -= 1
    
    # Calculate alpha and beta values
    alpha = 255 / (maximum_gray - minimum_gray)
    beta = -minimum_gray * alpha
    
    auto_result = cv2.convertScaleAbs(image, alpha=alpha, beta=beta)
    return auto_result

def apply_sharpening(image):
    """
    Apply unsharp mask for sharpening
    """
    gaussian = cv2.GaussianBlur(image, (0, 0), 2.0)
    sharpened = cv2.addWeighted(image, 1.5, gaussian, -0.5, 0)
    return sharpened

def apply_gamma_correction(image, gamma=1.15):
    """
    Apply gamma correction to brighten images
    """
    inv_gamma = 1.0 / gamma
    table = np.array([((i / 255.0) ** inv_gamma) * 255
                      for i in np.arange(0, 256)]).astype("uint8")
    return cv2.LUT(image, table)

def setup_camera_optimal(cap, resolution=(3840, 2160)):
    """
    Setup camera with optimal settings for quality
    """
    width, height = resolution
    
    # Don't force format - let camera choose best
    # cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))  # DON'T FORCE
    
    # Set resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    
    # Enable autofocus and auto white balance
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
    cap.set(cv2.CAP_PROP_AUTO_WB, 1)
    
    # Manual exposure control for low-light - disable auto-exposure
    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)  # 0.25 = manual mode
    cap.set(cv2.CAP_PROP_EXPOSURE, -6)  # Longer exposure for low-light (1/8 second)
    
    # Aggressive brightness/contrast/gain for low-light ArUco detection
    cap.set(cv2.CAP_PROP_BRIGHTNESS, 160)  # Boosted from default 128
    cap.set(cv2.CAP_PROP_CONTRAST, 150)    # Higher contrast for sharp markers
    cap.set(cv2.CAP_PROP_SATURATION, 130)  # Moderate saturation
    cap.set(cv2.CAP_PROP_GAIN, 100)        # Significant gain boost for low-light
    
    # Log what was actually set
    actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    logger.info(f"Camera resolution: {actual_width}x{actual_height}")
    
def warmup_camera_properly(cap, duration_seconds=10):
    """
    Proper warmup that matches how Windows Camera app keeps camera running
    Read frames continuously but not too fast (30fps pace)
    """
    logger.info(f"Camera warmup: {duration_seconds} seconds at 30fps pace...")
    
    start_time = time.time()
    frame_count = 0
    
    while time.time() - start_time < duration_seconds:
        ret, frame = cap.read()
        frame_count += 1
        
        # Pace at ~30fps (33ms between frames)
        # This gives auto-exposure time to analyze and adjust
        time.sleep(0.033)
    
    logger.info(f"Warmup complete: {frame_count} frames over {duration_seconds}s")

def capture_optimal_frame(cap):
    """
    Capture frame with full quality pipeline (produces CRISP images)
    """
    # Take multiple frames and pick the sharpest
    best_frame = None
    best_sharpness = 0
    
    for i in range(5):
        ret, frame = cap.read()
        if ret:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
            if sharpness > best_sharpness:
                best_sharpness = sharpness
                best_frame = frame
        time.sleep(0.033)  # 30fps pace
    
    if best_frame is None:
        return None
        
    # Apply post-processing pipeline (ESSENTIAL for CRISP quality)
    # Step 1: Auto brightness/contrast
    enhanced = apply_auto_brightness_contrast(best_frame)
    
    # Step 2: Gamma correction
    brightened = apply_gamma_correction(enhanced, gamma=1.15)
    
    # Step 3: Sharpening
    sharpened = apply_sharpening(brightened)
    
    return sharpened