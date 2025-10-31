#!/usr/bin/env python3
"""
Camera utilities for optimal camera warmup
"""

import cv2
import time
import logging

logger = logging.getLogger(__name__)

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
    
    # Enable all auto features
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 3)  # Mode 3 = Aperture Priority
    cap.set(cv2.CAP_PROP_AUTO_WB, 1)
    
    # Optional: Boost brightness/contrast at hardware level
    cap.set(cv2.CAP_PROP_BRIGHTNESS, 140)  # Slightly above default (128)
    cap.set(cv2.CAP_PROP_CONTRAST, 140)    # Slightly above default (128)
    cap.set(cv2.CAP_PROP_SATURATION, 130)  # Slightly above default (128)
    cap.set(cv2.CAP_PROP_GAIN, 20)         # Small gain boost
    
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
    Capture frame - just read, no post-processing
    """
    ret, frame = cap.read()
    return frame if ret else None