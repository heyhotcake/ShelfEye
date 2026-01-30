#!/usr/bin/env python3
"""
Camera utilities for optimal camera warmup and image quality

Optimized for Streamplify Cam Pro 4K and similar UVC cameras:
- Sony 8.5MP sensor, 4K@30fps, 105° wide-angle
- Built-in Auto Light Enhancement (firmware-level brightness/color)
- Autofocus (70mm to infinity)
- UVC-compliant with standard v4l2 controls

For ArUco marker detection, we need:
- Sharp, crisp edges (no over-sharpening halos)
- High contrast (clean black/white)
- Consistent exposure (disable fluctuating auto-enhancement)
"""

import cv2
import numpy as np
import time
import logging
import subprocess
import re
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def get_camera_controls(device_path: str) -> Dict[str, dict]:
    """
    Query all available v4l2 controls for a camera device.
    
    Args:
        device_path: Camera device path like '/dev/video0' or index like '0'
    
    Returns:
        Dictionary of control_name -> {min, max, default, value, type}
    """
    if device_path.isdigit():
        device_path = f"/dev/video{device_path}"
    
    controls = {}
    
    try:
        result = subprocess.run(
            ['v4l2-ctl', '-d', device_path, '--list-ctrls-menus'],
            capture_output=True, text=True, timeout=5
        )
        
        if result.returncode != 0:
            logger.warning(f"Failed to list camera controls: {result.stderr}")
            return controls
        
        for line in result.stdout.split('\n'):
            # Parse control lines like:
            # backlight_compensation 0x0098091c (int)    : min=0 max=2 step=1 default=1 value=1
            # Some controls may have hyphens or spaces, e.g., "white_balance_temperature"
            match = re.match(r'\s*([\w_-]+)\s+0x[0-9a-f]+\s+\((\w+)\)\s*:\s*(.*)', line)
            if match:
                name = match.group(1)
                ctrl_type = match.group(2)
                params_str = match.group(3)
                
                ctrl_info = {'type': ctrl_type}
                for param in params_str.split():
                    if '=' in param:
                        key, val = param.split('=', 1)
                        try:
                            ctrl_info[key] = int(val)
                        except ValueError:
                            ctrl_info[key] = val
                
                controls[name] = ctrl_info
                
        logger.info(f"Found {len(controls)} camera controls on {device_path}")
        return controls
        
    except subprocess.TimeoutExpired:
        logger.warning(f"v4l2-ctl timed out for {device_path}")
        return controls
    except FileNotFoundError:
        logger.warning("v4l2-ctl not found")
        return controls
    except Exception as e:
        logger.warning(f"Failed to query camera controls: {e}")
        return controls


def configure_camera_for_aruco(device_path: str) -> bool:
    """
    Configure camera settings optimized for ArUco marker detection.
    
    For Streamplify Cam Pro 4K and similar cameras:
    - Disable backlight_compensation (causes dynamic brightness changes)
    - Disable power_line_frequency flickering compensation if causing issues
    - Keep auto exposure/focus/white balance enabled but stable
    - Set optimal sharpness (not too high to avoid halos around markers)
    
    Args:
        device_path: Camera device path like '/dev/video0' or index like '0'
    
    Returns:
        True if configuration was successful
    """
    if device_path.isdigit():
        device_path = f"/dev/video{device_path}"
    
    try:
        # Get available controls
        controls = get_camera_controls(device_path)
        if not controls:
            logger.warning(f"No controls found for {device_path}")
            return False
        
        settings = []
        
        # === Disable firmware auto-enhancement features that conflict with ArUco detection ===
        
        # Backlight compensation causes dynamic brightness adjustment - disable it
        # This is the main "Auto Light Enhancement" feature on Streamplify Cam Pro
        if 'backlight_compensation' in controls:
            settings.append('backlight_compensation=0')
            logger.info("Disabling backlight_compensation (prevents dynamic brightness)")
        
        # === Enable stable auto modes ===
        
        # Auto focus - keep enabled for continuous sharp focus
        if 'focus_automatic_continuous' in controls:
            settings.append('focus_automatic_continuous=1')
            logger.info("Enabling continuous auto focus")
        elif 'focus_auto' in controls:
            settings.append('focus_auto=1')
            logger.info("Enabling auto focus")
        
        # Auto exposure - use aperture priority mode (3)
        if 'auto_exposure' in controls:
            settings.append('auto_exposure=3')
            logger.info("Enabling auto exposure (aperture priority)")
        elif 'exposure_auto' in controls:
            settings.append('exposure_auto=3')
            logger.info("Enabling auto exposure")
        
        # Auto white balance - keep enabled for consistent color
        if 'white_balance_automatic' in controls:
            settings.append('white_balance_automatic=1')
            logger.info("Enabling auto white balance")
        elif 'white_balance_temperature_auto' in controls:
            settings.append('white_balance_temperature_auto=1')
            logger.info("Enabling auto white balance temperature")
        
        # === Set optimal fixed values for ArUco detection ===
        
        # Sharpness - moderate value to avoid halos around marker edges
        # Too high sharpness creates bright/dark halos that corrupt marker detection
        if 'sharpness' in controls:
            ctrl = controls['sharpness']
            # Use ~60% of max sharpness (not too aggressive)
            optimal_sharpness = int(ctrl.get('max', 128) * 0.6)
            settings.append(f'sharpness={optimal_sharpness}')
            logger.info(f"Setting sharpness to {optimal_sharpness} (avoiding over-sharpening)")
        
        # Contrast - slightly above default for better marker edge definition
        if 'contrast' in controls:
            ctrl = controls['contrast']
            default_contrast = ctrl.get('default', 128)
            # Boost by ~10% for clearer black/white distinction
            optimal_contrast = min(int(default_contrast * 1.1), ctrl.get('max', 255))
            settings.append(f'contrast={optimal_contrast}')
            logger.info(f"Setting contrast to {optimal_contrast}")
        
        # Saturation - keep at default (ArUco is black/white, saturation doesn't matter much)
        # But avoid oversaturation which can bleed colors
        if 'saturation' in controls:
            ctrl = controls['saturation']
            default_sat = ctrl.get('default', 128)
            settings.append(f'saturation={default_sat}')
        
        # Power line frequency - leave at default unless user has configured it
        # Changing this can cause flicker issues depending on region (50Hz vs 60Hz)
        # Only log what's currently set for debugging
        if 'power_line_frequency' in controls:
            current_val = controls['power_line_frequency'].get('value', 'unknown')
            logger.info(f"Power line frequency: current={current_val} (not changing - region-specific)")
        
        if not settings:
            logger.warning(f"No settings to apply on {device_path}")
            return False
        
        # Apply all settings
        cmd = ['v4l2-ctl', '-d', device_path, '--set-ctrl=' + ','.join(settings)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        
        if result.returncode != 0:
            logger.warning(f"v4l2-ctl failed: {result.stderr}")
            return False
        
        logger.info(f"✓ Camera configured for ArUco detection: {', '.join(settings)}")
        return True
        
    except subprocess.TimeoutExpired:
        logger.warning(f"v4l2-ctl timed out for {device_path}")
        return False
    except Exception as e:
        logger.warning(f"Failed to configure camera for ArUco: {e}")
        return False


def log_camera_settings(device_path: str) -> None:
    """
    Log all current camera settings for debugging.
    
    Args:
        device_path: Camera device path like '/dev/video0' or index like '0'
    """
    if device_path.isdigit():
        device_path = f"/dev/video{device_path}"
    
    try:
        result = subprocess.run(
            ['v4l2-ctl', '-d', device_path, '--all'],
            capture_output=True, text=True, timeout=5
        )
        
        if result.returncode == 0:
            logger.info(f"=== Camera settings for {device_path} ===\n{result.stdout}")
        else:
            logger.warning(f"Failed to get camera settings: {result.stderr}")
            
    except Exception as e:
        logger.warning(f"Failed to log camera settings: {e}")


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

def capture_optimal_frame(cap, num_frames=50, apply_post_processing=True):
    """
    Capture frame with full quality pipeline (produces CRISP images)
    Takes multiple frames and picks the sharpest one for best autofocus quality
    
    Args:
        cap: OpenCV VideoCapture object
        num_frames: Number of frames to sample (default 50 for maximum reliability)
        apply_post_processing: Whether to apply brightness/gamma/sharpening (default True)
                              Set False when camera firmware handles enhancement
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
    
    if not apply_post_processing:
        logger.info("Skipping post-processing (camera firmware handles enhancement)")
        return best_frame
        
    # Apply post-processing pipeline (ESSENTIAL for CRISP quality)
    # Step 1: Auto brightness/contrast
    enhanced = apply_auto_brightness_contrast(best_frame)
    
    # Step 2: Gamma correction
    brightened = apply_gamma_correction(enhanced, gamma=1.15)
    
    # Step 3: Sharpening
    sharpened = apply_sharpening(brightened)
    
    return sharpened


def capture_frame_for_aruco(cap, num_frames=50, device_path: Optional[str] = None):
    """
    Capture frame optimized for ArUco marker detection.
    
    This function:
    1. Configures camera with optimal settings for marker detection
    2. Takes multiple frames and selects the sharpest
    3. Applies MINIMAL post-processing to avoid conflicts with camera firmware
    
    For Streamplify Cam Pro 4K and similar cameras with built-in Auto Light Enhancement,
    we disable firmware enhancements that cause brightness fluctuations and skip
    aggressive post-processing that creates artifacts (halos, noise amplification).
    
    Args:
        cap: OpenCV VideoCapture object
        num_frames: Number of frames to sample (default 50)
        device_path: Camera device path for v4l2 configuration
    
    Returns:
        Captured frame optimized for ArUco detection, or None if failed
    """
    # Configure camera for ArUco if device path provided
    if device_path:
        configure_camera_for_aruco(device_path)
        # Brief pause to let settings take effect
        time.sleep(0.1)
    
    # Take multiple frames and pick the sharpest
    best_frame = None
    best_sharpness = 0
    
    logger.info(f"[ArUco Mode] Capturing {num_frames} frames for marker detection...")
    
    for i in range(num_frames):
        ret, frame = cap.read()
        if ret:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
            if sharpness > best_sharpness:
                best_sharpness = sharpness
                best_frame = frame
        time.sleep(0.033)  # 30fps pace
    
    logger.info(f"[ArUco Mode] Selected frame with sharpness = {best_sharpness:.1f}")
    
    if best_frame is None:
        return None
    
    # For ArUco detection, we apply MINIMAL post-processing
    # The camera's auto exposure/white balance handles most image quality
    # We only apply light contrast enhancement for better marker edge detection
    
    # Light contrast boost for better black/white marker distinction
    # Uses CLAHE (Contrast Limited Adaptive Histogram Equalization)
    # This is gentler than full auto brightness/contrast and preserves local detail
    gray = cv2.cvtColor(best_frame, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced_gray = clahe.apply(gray)
    
    # Convert back to BGR for consistency with rest of pipeline
    enhanced_frame = cv2.cvtColor(enhanced_gray, cv2.COLOR_GRAY2BGR)
    
    # Copy original color info back (CLAHE only on luminance)
    # This preserves color information while enhancing contrast
    hsv = cv2.cvtColor(best_frame, cv2.COLOR_BGR2HSV)
    hsv[:, :, 2] = enhanced_gray  # Replace V channel with CLAHE-enhanced version
    enhanced_frame = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    
    logger.info("[ArUco Mode] Applied CLAHE contrast enhancement (no sharpening)")
    
    return enhanced_frame