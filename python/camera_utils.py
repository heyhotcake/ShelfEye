#!/usr/bin/env python3
"""
Camera utilities for optimal camera warmup and image quality
"""

import cv2
import numpy as np
import time
import logging
import subprocess
import re

logger = logging.getLogger(__name__)


def enable_camera_auto_modes(device_path: str) -> bool:
    """
    Enable all camera auto modes using v4l2-ctl for reliable results.
    OpenCV's CAP_PROP settings don't always work on Linux USB cameras.
    
    This mimics what laptop camera apps do automatically:
    - Auto focus (continuous)
    - Auto exposure
    - Auto white balance
    
    Args:
        device_path: Camera device path like '/dev/video0' or index like '0'
    
    Returns:
        True if successful, False if v4l2-ctl not available or failed
    """
    # Convert numeric index to device path
    if device_path.isdigit():
        device_path = f"/dev/video{device_path}"
    
    try:
        # Check if v4l2-ctl is available
        result = subprocess.run(['which', 'v4l2-ctl'], capture_output=True)
        if result.returncode != 0:
            logger.warning("v4l2-ctl not found - falling back to OpenCV auto settings")
            return False
        
        # Get available controls
        list_result = subprocess.run(
            ['v4l2-ctl', '-d', device_path, '--list-ctrls'],
            capture_output=True, text=True, timeout=5
        )
        controls = list_result.stdout
        
        # Build the settings command based on available controls
        settings = []
        
        # Auto focus
        if 'focus_automatic_continuous' in controls:
            settings.append('focus_automatic_continuous=1')
            logger.info(f"Enabling auto focus continuous on {device_path}")
        elif 'focus_auto' in controls:
            settings.append('focus_auto=1')
            logger.info(f"Enabling auto focus on {device_path}")
        
        # Auto exposure
        if 'auto_exposure' in controls:
            # 3 = Aperture Priority (auto mode), 1 = Manual
            settings.append('auto_exposure=3')
            logger.info(f"Enabling auto exposure on {device_path}")
        elif 'exposure_auto' in controls:
            settings.append('exposure_auto=3')
            logger.info(f"Enabling auto exposure on {device_path}")
        
        # Auto white balance
        if 'white_balance_automatic' in controls:
            settings.append('white_balance_automatic=1')
            logger.info(f"Enabling auto white balance on {device_path}")
        elif 'white_balance_temperature_auto' in controls:
            settings.append('white_balance_temperature_auto=1')
            logger.info(f"Enabling auto white balance temperature on {device_path}")
        
        if not settings:
            logger.warning(f"No auto controls found on {device_path}")
            return False
        
        # Apply all settings in one call
        cmd = ['v4l2-ctl', '-d', device_path, '--set-ctrl=' + ','.join(settings)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        
        if result.returncode != 0:
            logger.warning(f"v4l2-ctl failed: {result.stderr}")
            return False
        
        logger.info(f"✓ Camera auto modes enabled via v4l2-ctl: {', '.join(settings)}")
        return True
        
    except subprocess.TimeoutExpired:
        logger.warning(f"v4l2-ctl timed out for {device_path}")
        return False
    except Exception as e:
        logger.warning(f"Failed to enable auto modes via v4l2-ctl: {e}")
        return False

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

def setup_camera_optimal(cap, resolution=(3840, 2160), device_path: str = None):
    """
    Setup camera with optimal settings for quality.
    
    Args:
        cap: OpenCV VideoCapture object
        resolution: Tuple of (width, height)
        device_path: Device path like '/dev/video0' for v4l2-ctl (optional but recommended)
    """
    width, height = resolution
    
    # Force MJPEG format for 4K - YUYV saturates USB bandwidth and throttles to 0.1fps
    # MJPEG compression allows 7-10fps at 4K, which lets auto-exposure converge
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    
    # Set resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    
    # Set default brightness/contrast values (critical for proper exposure)
    cap.set(cv2.CAP_PROP_BRIGHTNESS, 128)  # Default value
    cap.set(cv2.CAP_PROP_CONTRAST, 28)     # Default value
    cap.set(cv2.CAP_PROP_GAIN, 0)          # Auto gain
    
    # Enable auto modes via OpenCV (fallback)
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 3)  # 3 = Auto mode (aperture priority)
    cap.set(cv2.CAP_PROP_AUTO_WB, 1)
    
    # Also enable via v4l2-ctl for reliable results (if device path provided)
    # v4l2-ctl is more reliable than OpenCV CAP_PROP on Linux USB cameras
    if device_path:
        enable_camera_auto_modes(device_path)
    
    # Log what was actually set
    actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
    fourcc_str = "".join([chr((fourcc >> 8 * i) & 0xFF) for i in range(4)])
    logger.info(f"Camera format: {fourcc_str}, resolution: {actual_width}x{actual_height}")
    
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

def capture_optimal_frame(cap, num_frames=50):
    """
    Capture frame with full quality pipeline (produces CRISP images)
    Takes multiple frames and picks the sharpest one for best autofocus quality
    
    Args:
        cap: OpenCV VideoCapture object
        num_frames: Number of frames to sample (default 50 for maximum reliability)
    """
    # Take multiple frames and pick the sharpest
    best_frame = None
    best_sharpness = 0
    
    logger.info(f"Capturing {num_frames} frames to select sharpest...")
    
    for i in range(num_frames):
        ret, frame = cap.read()
        if ret:
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
    # Step 1: Auto brightness/contrast
    enhanced = apply_auto_brightness_contrast(best_frame)
    
    # Step 2: Gamma correction
    brightened = apply_gamma_correction(enhanced, gamma=1.15)
    
    # Step 3: Sharpening
    sharpened = apply_sharpening(brightened)
    
    return sharpened