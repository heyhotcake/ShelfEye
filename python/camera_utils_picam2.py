#!/usr/bin/env python3
"""
Camera utilities using Picamera2 (recommended for Raspberry Pi)
Provides the same interface as camera_utils.py but uses Picamera2 instead of cv2.VideoCapture
"""

import cv2
import numpy as np
import time
import logging

# Try to import Picamera2 - only available on Raspberry Pi
try:
    from picamera2 import Picamera2
    PICAMERA2_AVAILABLE = True
except ImportError:
    PICAMERA2_AVAILABLE = False
    Picamera2 = None

logger = logging.getLogger(__name__)

def apply_auto_brightness_contrast(image, clip_hist_percent=1):
    """
    Automatic brightness and contrast optimization
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    
    hist = cv2.calcHist([gray],[0],None,[256],[0,256])
    hist_size = len(hist)
    
    accumulator = []
    accumulator.append(float(hist[0]))
    for index in range(1, hist_size):
        accumulator.append(accumulator[index -1] + float(hist[index]))
    
    maximum = accumulator[-1]
    clip_hist_percent *= (maximum/100.0)
    clip_hist_percent /= 2.0
    
    minimum_gray = 0
    while accumulator[minimum_gray] < clip_hist_percent:
        minimum_gray += 1
    
    maximum_gray = hist_size -1
    while accumulator[maximum_gray] >= (maximum - clip_hist_percent):
        maximum_gray -= 1
    
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

def setup_camera_picam2(camera_index=0, resolution=(3840, 2160), max_retries=3):
    """
    Setup Picamera2 with optimal settings for quality
    Returns configured Picamera2 instance
    
    Args:
        camera_index: Camera device index (0 for /dev/video0, 1 for /dev/video1, etc.)
        resolution: Tuple of (width, height)
        max_retries: Number of retries if camera is busy
    """
    if not PICAMERA2_AVAILABLE:
        raise ImportError("Picamera2 is not available. This module only works on Raspberry Pi.")
    
    width, height = resolution
    
    # Retry logic for "Pipeline handler in use" errors
    for attempt in range(max_retries):
        try:
            logger.info(f"Initializing Picamera2 on camera {camera_index} (attempt {attempt + 1}/{max_retries})")
            picam2 = Picamera2(camera_index)
            break  # Success!
        except Exception as e:
            if "in use" in str(e).lower() and attempt < max_retries - 1:
                logger.warning(f"Camera busy, retrying in 2 seconds... ({e})")
                time.sleep(2)
                continue
            else:
                raise  # Re-raise if not a "busy" error or out of retries
    else:
        raise Exception(f"Failed to initialize camera after {max_retries} attempts")
    
    # Create configuration with minimal settings to avoid unsupported controls
    # Use video configuration to get exact resolution without cropping
    # RGB888 format - will convert to BGR after capture for OpenCV compatibility
    config = picam2.create_video_configuration(
        main={"size": (width, height), "format": "RGB888"},
        buffer_count=1  # Minimize memory usage
    )
    
    # DON'T align - it auto-crops to sensor aspect ratio
    # We need exact resolution to match calibration
    picam2.configure(config)
    
    # Set automatic controls for optimal image quality (only if supported)
    try:
        picam2.set_controls({
            "AwbEnable": True,  # Auto white balance
            "AeEnable": True,  # Auto exposure
        })
        logger.info(f"Camera configured: {width}x{height}, format: RGB888 with AWB/AE")
    except Exception as e:
        logger.warning(f"Could not set auto controls: {e}")
        logger.info(f"Camera configured: {width}x{height}, format: RGB888 (no auto-controls)")
    
    # Try to enable auto-focus if supported (some cameras don't have it)
    try:
        picam2.set_controls({"AfMode": 2})  # Auto focus continuous
        logger.info("Auto-focus enabled")
    except Exception as e:
        logger.info("Auto-focus not available (fixed-focus camera)")
    return picam2

def warmup_camera_picam2(picam2, duration_seconds=10):
    """
    Proper warmup using metadata polling (Picamera2 best practice)
    Allows auto-exposure and auto-focus to converge without dropping frames
    
    Args:
        picam2: Picamera2 instance (must be started)
        duration_seconds: How long to warmup
    """
    logger.info(f"Camera warmup: {duration_seconds} seconds (metadata polling)...")
    
    start_time = time.time()
    metadata_count = 0
    
    # Poll metadata to let AE/AF settle without heavy frame captures
    while time.time() - start_time < duration_seconds:
        metadata = picam2.capture_metadata()
        metadata_count += 1
        time.sleep(0.1)  # 10Hz polling rate
    
    logger.info(f"Warmup complete: {metadata_count} metadata polls over {duration_seconds}s")

def capture_optimal_frame_picam2(picam2, num_frames=50):
    """
    Capture frame with full quality pipeline (produces CRISP images)
    Takes multiple frames and picks the sharpest one for best autofocus quality
    
    Args:
        picam2: Picamera2 instance (must be started)
        num_frames: Number of frames to sample (default 50)
    """
    best_frame = None
    best_sharpness = 0
    
    logger.info(f"Capturing {num_frames} frames to select sharpest...")
    
    for i in range(num_frames):
        # Capture from 'main' stream and convert RGB to BGR for OpenCV
        frame_rgb = picam2.capture_array("main")
        frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
        
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
        if sharpness > best_sharpness:
            best_sharpness = sharpness
            best_frame = frame
            logger.info(f"Frame {i+1}/{num_frames}: New best sharpness = {sharpness:.1f}")
        time.sleep(0.033)  # 30fps pace
    
    logger.info(f"Selected frame with sharpness = {best_sharpness:.1f}")
    
    if best_frame is None:
        return None
    
    # Apply post-processing pipeline (ESSENTIAL for CRISP quality)
    enhanced = apply_auto_brightness_contrast(best_frame)
    brightened = apply_gamma_correction(enhanced, gamma=1.15)
    sharpened = apply_sharpening(brightened)
    
    return sharpened
