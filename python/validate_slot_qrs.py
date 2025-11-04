#!/usr/bin/env python3
"""
Validate slot QR codes in calibrated camera view.
Used for two-step calibration validation:
1. Verify QR codes ARE readable when slots are empty
2. Verify QR codes are NOT readable when tools are placed (covering QRs)
"""

import os
import cv2
import numpy as np
import json
import sys
import time
import argparse
from pyzbar import pyzbar

# Suppress OpenCV warnings/info to prevent polluting stdout
os.environ['OPENCV_LOG_LEVEL'] = 'FATAL'
cv2.setLogLevel(0)

def decode_qr_codes(image, expected_count=None):
    """Decode all QR codes in image with multi-scale detection and aggressive preprocessing
    
    Args:
        image: Input image to scan for QR codes
        expected_count: If provided, exit early once this many QRs are found (optimization)
    """
    results = []
    found_qr_data = set()
    
    # Initialize OpenCV QR detector once (reuse across scales)
    opencv_detector = cv2.QRCodeDetector()
    
    # Input is already grayscale from rectification (memory-optimized)
    gray = image if len(image.shape) == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Multi-scale detection for robustness across different QR sizes
    # At native 43 px/cm: 30mm QR = ~130px base, ~260px at 2x, ~390px at 3x
    # Upsampling helps detect small/damaged QR codes that need more pixels
    scales = [1.0, 2.0, 3.0]
    
    # Preallocate reusable resources (avoid recreation in loops)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    kernel_sharpen = np.array([[-1,-1,-1], [-1, 9,-1], [-1,-1,-1]])
    kernel_morph = np.ones((3,3), np.uint8)
    
    for scale in scales:
        # Early exit if we found all expected QRs (optimization)
        if expected_count and len(found_qr_data) >= expected_count:
            print(f"[DECODE] Early exit: found {len(found_qr_data)}/{expected_count} QRs at scale {scale}", file=sys.stderr)
            break
        
        # Upscale image for this scale level (reusing memory)
        if scale != 1.0:
            scaled_width = int(gray.shape[1] * scale)
            scaled_height = int(gray.shape[0] * scale)
            scaled_gray = cv2.resize(gray, (scaled_width, scaled_height), interpolation=cv2.INTER_CUBIC)
        else:
            scaled_gray = gray
        
        # Helper function to try pyzbar decode and add results
        def try_decode(img, method_name):
            try:
                qr_codes = pyzbar.decode(img)
                for qr in qr_codes:
                    data = qr.data.decode('utf-8')
                    if data not in found_qr_data:
                        found_qr_data.add(data)
                        x, y, w, h = qr.rect
                        # Scale coordinates back to original size
                        if scale != 1.0:
                            x, y, w, h = int(x/scale), int(y/scale), int(w/scale), int(h/scale)
                        results.append({
                            'data': data,
                            'type': qr.type,
                            'rect': {'x': x, 'y': y, 'width': w, 'height': h},
                            'polygon': [(int(point.x/scale), int(point.y/scale)) for point in qr.polygon],
                            'center': (x + w / 2, y + h / 2),
                            'detection_method': f'pyzbar_{method_name}'
                        })
                        print(f"QR detected via pyzbar_{method_name}: {data}", file=sys.stderr)
                        
                        # Early exit check after each QR found
                        if expected_count and len(found_qr_data) >= expected_count:
                            return True
            except:
                pass
            return False
        
        # Try preprocessing methods in order, with early exit
        # Process and discard immediately to save memory
        
        # 1. Original grayscale (input is already grayscale)
        if try_decode(scaled_gray, f'grayscale_x{scale}'): continue
        
        # 2. Binary threshold - try most effective value first
        _, binary_127 = cv2.threshold(scaled_gray, 127, 255, cv2.THRESH_BINARY)
        if try_decode(binary_127, f'binary_127_x{scale}'): continue
        del binary_127  # Free memory
        
        # 3. Adaptive thresholding (usually very effective)
        adaptive = cv2.adaptiveThreshold(scaled_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
        if try_decode(adaptive, f'adaptive_x{scale}'): continue
        del adaptive
        
        # 4. CLAHE contrast enhancement (reusing preallocated instance)
        enhanced = clahe.apply(scaled_gray)
        if try_decode(enhanced, f'enhanced_x{scale}'): continue
        del enhanced
        
        # Only try additional preprocessing at scale 1.0 and 2.0 (not at 3.0 to save time/memory)
        if scale <= 2.0:
            # 5. Sharpening for blurry QRs (reusing preallocated kernel)
            sharpened = cv2.filter2D(scaled_gray, -1, kernel_sharpen)
            if try_decode(sharpened, f'sharpened_x{scale}'): continue
            del sharpened
            
            # 6. Try other binary thresholds
            _, binary_100 = cv2.threshold(scaled_gray, 100, 255, cv2.THRESH_BINARY)
            if try_decode(binary_100, f'binary_100_x{scale}'): continue
            del binary_100
            
            _, binary_150 = cv2.threshold(scaled_gray, 150, 255, cv2.THRESH_BINARY)
            if try_decode(binary_150, f'binary_150_x{scale}'): continue
            del binary_150
            
            # 7. Morphological operations (reusing preallocated kernel)
            _, binary_base = cv2.threshold(scaled_gray, 127, 255, cv2.THRESH_BINARY)
            morphed = cv2.morphologyEx(binary_base, cv2.MORPH_CLOSE, kernel_morph)
            if try_decode(morphed, f'morphed_x{scale}'): continue
            del morphed, binary_base
        
        # Try OpenCV detector at this scale
        if scale <= 2.0:  # Don't use OpenCV at very high scales (too slow)
            try:
                ok, decoded_info, points, _ = opencv_detector.detectAndDecodeMulti(scaled_gray)
                
                if ok and decoded_info:
                    for i, data in enumerate(decoded_info):
                        if data and data not in found_qr_data:
                            found_qr_data.add(data)
                            
                            # Calculate bounding box from points
                            if points is not None and i < len(points):
                                pts = points[i].reshape(-1, 2)
                                x = int(pts[:, 0].min() / scale)
                                y = int(pts[:, 1].min() / scale)
                                w = int((pts[:, 0].max() - pts[:, 0].min()) / scale)
                                h = int((pts[:, 1].max() - pts[:, 1].min()) / scale)
                            else:
                                x, y, w, h = 0, 0, 100, 100  # Fallback
                            
                            results.append({
                                'data': data,
                                'type': 'QRCODE',
                                'rect': {'x': x, 'y': y, 'width': w, 'height': h},
                                'polygon': [],
                                'center': (x + w/2, y + h/2),
                                'detection_method': f'opencv_x{scale}'
                            })
                            print(f"QR detected via opencv_x{scale}: {data}", file=sys.stderr)
            except Exception as e:
                # Skip OpenCV failures silently
                pass
        
        # Clean up scaled images to free memory (except scale 1.0 which references original)
        if scale != 1.0:
            del scaled_gray
    
    return results

def point_in_rotated_rect(point, center_cm, width_cm, height_cm, rotation_deg, scale_x, scale_y):
    """Check if point (in pixels) is inside a rotated rectangle (defined in cm)"""
    # Convert point to cm space
    point_cm = np.array([point[0] / scale_x, point[1] / scale_y])
    
    # Translate to rectangle center
    translated = point_cm - center_cm
    
    # Rotate by negative angle (to align rectangle with axes)
    angle_rad = -np.radians(rotation_deg)
    cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
    rotated = np.array([
        translated[0] * cos_a - translated[1] * sin_a,
        translated[0] * sin_a + translated[1] * cos_a
    ])
    
    # Check if point is inside axis-aligned rectangle
    half_width = width_cm / 2
    half_height = height_cm / 2
    return (abs(rotated[0]) <= half_width and abs(rotated[1]) <= half_height)

def validate_slot_qrs(camera_id, mode='visible', homography_matrix=None, camera_matrix=None, 
                      dist_coeffs=None, paper_width_cm=None, paper_height_cm=None, 
                      expected_slots=None, use_saved_rectified=False):
    """
    Validate QR codes in calibrated camera view
    
    Args:
        camera_id: ID of the camera to validate
        mode: 'visible' (QRs should be visible) or 'covered' (QRs should be covered)
        homography_matrix: Homography matrix for perspective correction
        camera_matrix: Camera intrinsic matrix for distortion correction
        dist_coeffs: Distortion coefficients
        paper_width_cm: Paper width in cm
        paper_height_cm: Paper height in cm
        expected_slots: List of expected slot configurations
        use_saved_rectified: If True, load saved rectified image from calibration
    
    Returns:
        Dictionary with validation results
    """
    print(f"[VALIDATION] Starting validation for camera {camera_id} in mode '{mode}'", file=sys.stderr)
    if use_saved_rectified:
        print(f"[VALIDATION] Will use saved calibration rectified image", file=sys.stderr)
    sys.stderr.flush()
    
    # Set default for expected_slots if not provided
    if expected_slots is None:
        expected_slots = []
    
    # Set up debug directory
    import os
    enable_debug_images = os.environ.get('DEBUG_IMAGES', '1') == '1'  # Default enabled for compatibility
    debug_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
    os.makedirs(debug_dir, exist_ok=True)
    
    # Validate and print received parameters
    print(f"[VALIDATION] Received parameters:", file=sys.stderr)
    print(f"  - Homography matrix: {'Yes' if homography_matrix else 'No'}", file=sys.stderr)
    print(f"  - Camera matrix: {'Yes' if camera_matrix else 'No'}", file=sys.stderr)
    print(f"  - Distortion coeffs: {'Yes' if dist_coeffs else 'No'}", file=sys.stderr)
    print(f"  - Paper size: {paper_width_cm}x{paper_height_cm} cm", file=sys.stderr)
    print(f"  - Use saved rectified: {use_saved_rectified}", file=sys.stderr)
    sys.stderr.flush()
    
    # Branch based on whether to use saved rectified image
    if use_saved_rectified:
        # LOAD SAVED HIGH-RES RECTIFIED IMAGE PATH
        print(f"[VALIDATION] Using saved calibration rectified image", file=sys.stderr)
        data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
        saved_rectified_path = os.path.join(data_dir, 'latest_calibration_rectified.jpg')
        
        if not os.path.exists(saved_rectified_path):
            print(f"[VALIDATION] ERROR: Saved rectified image not found at {saved_rectified_path}", file=sys.stderr)
            print(f"[VALIDATION] Run ArUco calibration first to generate the rectified image", file=sys.stderr)
            sys.stderr.flush()
            return {
                'success': False,
                'error': 'Saved rectified image not found. Run ArUco calibration first.'
            }
        
        rectified = cv2.imread(saved_rectified_path, cv2.IMREAD_GRAYSCALE)
        
        if rectified is None:
            print(f"[VALIDATION] ERROR: Failed to load rectified image", file=sys.stderr)
            sys.stderr.flush()
            return {
                'success': False,
                'error': 'Failed to load saved rectified image'
            }
        
        print(f"[VALIDATION] Loaded rectified image: {rectified.shape[1]}x{rectified.shape[0]}px", file=sys.stderr)
        print(f"[VALIDATION] Found {len(expected_slots)} expected slots for validation", file=sys.stderr)
        sys.stderr.flush()
        
        # Calculate ACTUAL scale factors from the loaded image dimensions
        # This supports any resolution (native camera resolution, not hardcoded upsampling)
        if paper_width_cm and paper_height_cm:
            actual_px_per_cm_width = rectified.shape[1] / paper_width_cm
            actual_px_per_cm_height = rectified.shape[0] / paper_height_cm
            pixels_per_cm = min(actual_px_per_cm_width, actual_px_per_cm_height)
            scale_x = actual_px_per_cm_width
            scale_y = actual_px_per_cm_height
            print(f"[VALIDATION] Calculated pixel density from saved image: {actual_px_per_cm_width:.1f} px/cm (width), {actual_px_per_cm_height:.1f} px/cm (height)", file=sys.stderr)
            print(f"[VALIDATION] Using {pixels_per_cm:.1f} px/cm for coordinate conversion", file=sys.stderr)
        else:
            scale_x = scale_y = 1.0
            print(f"[VALIDATION] No paper dimensions provided, using scale 1.0", file=sys.stderr)
    
    else:
        # CAPTURE NEW FRAME AND APPLY HOMOGRAPHY PATH
        print(f"[VALIDATION] Capturing new frame from camera", file=sys.stderr)
        print(f"[VALIDATION] Found {len(expected_slots)} expected slots for validation", file=sys.stderr)
        
        # Validate required parameters
        if not homography_matrix:
            print(f"[VALIDATION] ERROR: No homography matrix provided", file=sys.stderr)
            sys.stderr.flush()
            return {
                'success': False,
                'error': 'No homography matrix provided'
            }
        
        # Capture frame from camera
        # Use camera_id if it's a device path, otherwise use index 0
        device_source = camera_id if camera_id and camera_id.startswith('/dev/') else 0
        print(f"[VALIDATION] Opening camera: {device_source}", file=sys.stderr)
        sys.stderr.flush()
        
        # Try to open camera with device path first
        cap = cv2.VideoCapture(device_source)
        
        # If device path fails, fall back to camera index 0
        if not cap.isOpened() and isinstance(device_source, str) and device_source.startswith('/'):
            print(f"[VALIDATION] WARNING: Device path {device_source} failed, falling back to camera index 0", file=sys.stderr)
            sys.stderr.flush()
            device_source = 0
            cap = cv2.VideoCapture(device_source)
        
        # Force MJPEG format for 4K - YUYV saturates USB bandwidth and throttles to 0.1fps
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        
        # Set camera to highest resolution for better QR detection
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 3840)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 2160)
        
        # Enable all automatic features - let camera firmware handle everything
        cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
        cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 3)  # 3 = Auto mode (aperture priority)
        cap.set(cv2.CAP_PROP_AUTO_WB, 1)
        
        # Log actual resolution achieved
        actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"[VALIDATION] Camera resolution: {actual_width}x{actual_height} (requested 3840x2160)", file=sys.stderr)
        
        # Reduce buffer size to get fresh frames
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        
        if not cap.isOpened():
            print(f"[VALIDATION] ERROR: Failed to open camera", file=sys.stderr)
            sys.stderr.flush()
            return {
                'success': False,
                'error': 'Failed to open camera',
                'missing_qrs': [],
                'incorrectly_visible': [],
                'expected_visible': 0,
                'actual_visible': 0,
                'expected_hidden': 0,
                'actual_hidden': 0,
                'details': []
            }
        
        # Get actual camera resolution
        actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"[VALIDATION] Camera resolution: {actual_width}x{actual_height}", file=sys.stderr)
        sys.stderr.flush()
        
        # Discard first few frames (camera warmup and autofocus)
        # Give autofocus time to settle (critical for sharp QR codes)
        print(f"[VALIDATION] Warming up autofocus (discarding 20 frames over 4 seconds)...", file=sys.stderr)
        sys.stderr.flush()
        for i in range(20):
            cap.read()
            time.sleep(0.2)  # 200ms between frames = 4 seconds total
        
        # Memory-optimized: Capture frames one at a time, keep only the sharpest
        # This avoids storing 5 full frames simultaneously (~70MB → ~14MB)
        num_frames = 5
        best_frame = None
        best_sharpness = -1
        best_frame_idx = -1
        
        print(f"[VALIDATION] Capturing {num_frames} frames for sharpness analysis (memory-optimized)", file=sys.stderr)
        sys.stderr.flush()
        
        for i in range(num_frames):
            ret, frame = cap.read()
            if ret:
                # Calculate sharpness using Laplacian variance (higher = sharper)
                # Work on grayscale to save memory
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
                
                # Keep this frame only if it's the sharpest so far
                if sharpness > best_sharpness:
                    best_frame = frame  # Old frame will be garbage collected
                    best_sharpness = sharpness
                    best_frame_idx = i
                
                print(f"[VALIDATION] Frame {i+1}/{num_frames} captured, sharpness={sharpness:.2f}", file=sys.stderr)
                sys.stderr.flush()
        
        cap.release()
        print(f"[VALIDATION] Camera released", file=sys.stderr)
        sys.stderr.flush()
        
        if best_frame is None:
            print(f"[VALIDATION] ERROR: Failed to capture any frames", file=sys.stderr)
            sys.stderr.flush()
            return {
                'success': False,
                'error': 'Failed to capture any frames'
            }
        
        # Use the sharpest frame
        frame = best_frame
        print(f"[VALIDATION] Selected frame {best_frame_idx+1}/{num_frames} with sharpness {best_sharpness:.2f}", file=sys.stderr)
        sys.stderr.flush()
        
        # Signal that frame capture is complete - LED can turn off now
        print("[LED_OFF_SIGNAL]", file=sys.stderr)
        sys.stderr.flush()
        
        # Save the raw captured frame for debugging (optional, controlled by env var)
        if enable_debug_images:
            raw_frame_path = os.path.join(debug_dir, 'validation_raw_frame.jpg')
            cv2.imwrite(raw_frame_path, frame)
            print(f"[VALIDATION] Saved raw captured frame to: {raw_frame_path}", file=sys.stderr)
            sys.stderr.flush()
        else:
            print(f"[VALIDATION] Debug images disabled (set DEBUG_IMAGES=1 to enable)", file=sys.stderr)
            sys.stderr.flush()
        
        # Apply lens distortion correction if camera calibration parameters provided
        # Skip undistortion if all distortion coefficients are zero (to avoid interpolation artifacts)
        if camera_matrix is not None and dist_coeffs is not None:
            D = np.array(dist_coeffs)
            if np.any(D != 0):
                print(f"Applying lens undistortion before warp", file=sys.stderr)
                K = np.array(camera_matrix).reshape(3, 3)
                frame = cv2.undistort(frame, K, D)
            else:
                print(f"Skipping undistortion (all coefficients are zero)", file=sys.stderr)
        
        # Apply homography transformation to get rectified view
        # Use SAME transformation logic as rectified_preview.py
        H = np.array(homography_matrix, dtype=np.float32).reshape(3, 3)
        
        # Calculate output size based on paper dimensions (if provided)
        if paper_width_cm and paper_height_cm:
            # Memory-optimized: 100 px/cm for reliable 30mm QR detection (300x300 pixels)
            # With grayscale output: 8910×4200×1 = ~37MB vs RGB 112MB (saves 75MB)
            # Multi-scale upsampling (3x) gives 900x900 pixels - excellent for detection
            pixels_per_cm = 100  # Required for 30-40 QR codes per camera
            output_width = int(paper_width_cm * pixels_per_cm)
            output_height = int(paper_height_cm * pixels_per_cm)
            print(f"Using paper-based output size: {output_width}x{output_height} ({paper_width_cm}x{paper_height_cm} cm) @ {pixels_per_cm}px/cm", file=sys.stderr)
            
            # Build transformation matrix like rectified_preview.py
            scale_x = output_width / paper_width_cm
            scale_y = output_height / paper_height_cm
            
            # Scaling matrix: cm → output pixels
            S = np.array([
                [scale_x, 0, 0],
                [0, scale_y, 0],
                [0, 0, 1]
            ], dtype=np.float32)
            
            # Invert homography: camera pixels → cm
            H_inv = np.linalg.inv(H)
            
            # Combined warp: camera_pixel → cm → output_pixel
            M = S @ H_inv
            
            # Use INTER_NEAREST for sharp edges (best for QR codes)
            rectified = cv2.warpPerspective(frame, M, (output_width, output_height), 
                                           flags=cv2.INTER_NEAREST,
                                           borderMode=cv2.BORDER_CONSTANT,
                                           borderValue=(255, 255, 255))
            
            # Convert to grayscale immediately to save memory (3x reduction)
            # QR detection works on grayscale, no need for color
            rectified = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
            print(f"[VALIDATION] Converted rectified image to grayscale (saves 75MB)", file=sys.stderr)
        else:
            # Fallback to direct homography (no scaling)
            rectified = cv2.warpPerspective(frame, np.linalg.inv(H), (frame.shape[1], frame.shape[0]))
            rectified = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
            scale_x = scale_y = 1.0
            print(f"Using direct homography warp (no paper size)", file=sys.stderr)
    
    # Save debug rectified image (if enabled)
    rectified_path = os.path.join(debug_dir, 'validation_rectified_debug.jpg')
    if enable_debug_images:
        cv2.imwrite(rectified_path, rectified, [cv2.IMWRITE_JPEG_QUALITY, 95])
        print(f"[VALIDATION] Saved rectified view to: {rectified_path}", file=sys.stderr)
        sys.stderr.flush()
    else:
        # Still create path for result even if not saved
        print(f"[VALIDATION] Rectified debug image not saved (DEBUG_IMAGES=0)", file=sys.stderr)
        sys.stderr.flush()
    
    # PER-SLOT ROI SCANNING: Extract and scan each slot individually for better accuracy
    print(f"[VALIDATION] Starting per-slot ROI QR code detection...", file=sys.stderr)
    sys.stderr.flush()
    
    # Build validation results based on mode
    validation_details = []
    missing_qrs = []
    incorrectly_visible = []
    detected_qrs_list = []
    
    # Process each expected slot - extract ROI and scan individually
    for idx, slot in enumerate(expected_slots):
        # Backend sends camelCase JSON, handle both snake_case (legacy) and camelCase (current)
        slot_id = slot.get('slotId') or slot.get('slot_id', 'unknown')
        expected_qr = slot.get('id') or slot.get('expected_qr_id', '')
        x_cm = slot.get('x') or slot.get('x_cm', 0)
        y_cm = slot.get('y') or slot.get('y_cm', 0)
        width_cm = slot.get('width') or slot.get('width_cm', 3.0)
        height_cm = slot.get('height') or slot.get('height_cm', 3.0)
        rotation = slot.get('rotation', 0)
        
        print(f"[VALIDATION] Slot {idx+1}/{len(expected_slots)}: {slot_id} (expected QR: '{expected_qr}')", file=sys.stderr)
        
        # Convert slot position from cm to pixels
        center_x_px = int(x_cm * scale_x)
        center_y_px = int(y_cm * scale_y)
        width_px = int(width_cm * scale_x)
        height_px = int(height_cm * scale_y)
        
        # Add 20% padding around slot for better QR detection (in case QR is slightly outside)
        padding = 0.2
        padded_width = int(width_px * (1 + padding))
        padded_height = int(height_px * (1 + padding))
        
        # Calculate ROI boundaries (top-left corner)
        roi_x1 = max(0, center_x_px - padded_width // 2)
        roi_y1 = max(0, center_y_px - padded_height // 2)
        roi_x2 = min(rectified.shape[1], center_x_px + padded_width // 2)
        roi_y2 = min(rectified.shape[0], center_y_px + padded_height // 2)
        
        # Extract ROI
        roi = rectified[roi_y1:roi_y2, roi_x1:roi_x2]
        
        if roi.size == 0:
            print(f"  WARNING: Empty ROI for slot {slot_id}", file=sys.stderr)
            if mode == 'visible':
                validation_details.append({
                    'slot_id': slot_id,
                    'expected_qr': expected_qr,
                    'status': 'missing',
                    'detected': False,
                    'in_bounds': False
                })
                missing_qrs.append(expected_qr)
            else:
                validation_details.append({
                    'slot_id': slot_id,
                    'expected_qr': expected_qr,
                    'status': 'correct',
                    'detected': False,
                    'in_bounds': True
                })
            continue
        
        print(f"  ROI size: {roi.shape[1]}x{roi.shape[0]}px at ({roi_x1},{roi_y1})", file=sys.stderr)
        
        # Scan this ROI for QR codes (limit to 1 expected in this slot)
        roi_qr_results = decode_qr_codes(roi, expected_count=1)
        
        if roi_qr_results:
            # QR detected in this slot's ROI
            qr = roi_qr_results[0]
            qr_data = qr['data']
            detected_qrs_list.append(qr_data)
            
            print(f"  ✓ Detected QR: '{qr_data}' via {qr['detection_method']}", file=sys.stderr)
            
            if mode == 'visible':
                # QR should be visible - check if it matches expected
                if qr_data == expected_qr:
                    validation_details.append({
                        'slot_id': slot_id,
                        'expected_qr': expected_qr,
                        'status': 'correct',
                        'detected': True,
                        'in_bounds': True,
                        'detection_method': qr['detection_method']
                    })
                    print(f"  ✓ CORRECT: Matches expected QR '{expected_qr}'", file=sys.stderr)
                else:
                    validation_details.append({
                        'slot_id': slot_id,
                        'expected_qr': expected_qr,
                        'status': 'wrong_qr',
                        'detected': True,
                        'in_bounds': True,
                        'actual_qr': qr_data,
                        'detection_method': qr['detection_method']
                    })
                    missing_qrs.append(expected_qr)
                    print(f"  ✗ WRONG QR: Expected '{expected_qr}' but found '{qr_data}'", file=sys.stderr)
            else:
                # QR should NOT be visible (tool should cover it)
                validation_details.append({
                    'slot_id': slot_id,
                    'expected_qr': expected_qr,
                    'status': 'incorrect',
                    'detected': True,
                    'in_bounds': True,
                    'actual_qr': qr_data,
                    'detection_method': qr['detection_method']
                })
                incorrectly_visible.append(expected_qr)
                print(f"  ✗ ERROR: QR '{qr_data}' is visible but should be covered", file=sys.stderr)
        else:
            # No QR detected in this slot's ROI
            print(f"  ✗ No QR detected in ROI", file=sys.stderr)
            
            if mode == 'visible':
                # QR should be visible but isn't - MISSING
                validation_details.append({
                    'slot_id': slot_id,
                    'expected_qr': expected_qr,
                    'status': 'missing',
                    'detected': False,
                    'in_bounds': False
                })
                missing_qrs.append(expected_qr)
                print(f"  ✗ ERROR: Expected QR '{expected_qr}' not detected", file=sys.stderr)
            else:
                # QR not visible - CORRECT (tool is covering it)
                validation_details.append({
                    'slot_id': slot_id,
                    'expected_qr': expected_qr,
                    'status': 'correct',
                    'detected': False,
                    'in_bounds': True
                })
                print(f"  ✓ CORRECT: QR is covered as expected", file=sys.stderr)
    
    # Calculate summary
    expected_visible = 0
    actual_visible = 0
    expected_hidden = 0
    actual_hidden = 0
    
    if mode == 'visible':
        expected_visible = len(expected_slots)
        actual_visible = len([d for d in validation_details if d['detected']])
        success = len(missing_qrs) == 0
        
        result = {
            'success': success,
            'expected_visible': expected_visible,
            'actual_visible': actual_visible,
            'missing_qrs': missing_qrs,
            'detected_qrs': detected_qrs_list,
            'details': validation_details,
            'debug_image': rectified_path
        }
    else:
        expected_hidden = len(expected_slots)
        actual_hidden = len([d for d in validation_details if not d['detected']])
        success = len(incorrectly_visible) == 0
        
        result = {
            'success': success,
            'expected_hidden': expected_hidden,
            'actual_hidden': actual_hidden,
            'incorrectly_visible': incorrectly_visible,
            'details': validation_details,
            'debug_image': rectified_path
        }
    
    print(f"\n[VALIDATION] Summary:", file=sys.stderr)
    print(f"  - Success: {success}", file=sys.stderr)
    if mode == 'visible':
        print(f"  - Expected visible: {expected_visible}", file=sys.stderr)
        print(f"  - Actually visible: {actual_visible}", file=sys.stderr)
        if missing_qrs:
            print(f"  - Missing: {', '.join(missing_qrs)}", file=sys.stderr)
    else:
        print(f"  - Expected hidden: {expected_hidden}", file=sys.stderr)
        print(f"  - Actually hidden: {actual_hidden}", file=sys.stderr)
        if incorrectly_visible:
            print(f"  - Incorrectly visible: {', '.join(incorrectly_visible)}", file=sys.stderr)
    sys.stderr.flush()
    
    return result

if __name__ == "__main__":
    # Check if being called with old positional arguments or new named arguments
    if len(sys.argv) >= 3 and not sys.argv[1].startswith('--'):
        # Old style: python validate_slot_qrs.py camera_id mode
        parser = argparse.ArgumentParser(description='Validate slot QR codes in calibrated camera view')
        parser.add_argument('camera_id', help='Camera ID')
        parser.add_argument('mode', choices=['visible', 'covered'], help='Validation mode')
        
        args = parser.parse_args()
        
        # Run validation with minimal parameters (for manual testing)
        result = validate_slot_qrs(args.camera_id, args.mode)
    else:
        # New style with named arguments (from backend)
        parser = argparse.ArgumentParser(description='Validate slot QR codes in calibrated camera view')
        parser.add_argument('--resolution', help='Camera resolution (e.g., 1920x1080)')
        parser.add_argument('--homography', help='Homography matrix as JSON string')
        parser.add_argument('--slots', help='Expected slots configuration as JSON string')
        parser.add_argument('--should-detect', choices=['true', 'false'], help='Whether QRs should be detected')
        parser.add_argument('--paper-width-cm', type=float, help='Paper width in cm')
        parser.add_argument('--paper-height-cm', type=float, help='Paper height in cm')
        parser.add_argument('--camera-matrix', help='Camera matrix for distortion correction')
        parser.add_argument('--dist-coeffs', help='Distortion coefficients')
        parser.add_argument('--device-path', help='Camera device path (e.g., /dev/video0)')
        parser.add_argument('--camera', type=int, help='Camera index', default=0)
        parser.add_argument('--use-saved-rectified', action='store_true', help='Use saved high-res rectified image from calibration instead of capturing new frame')
        
        args = parser.parse_args()
        
        # Determine mode based on should-detect flag
        mode = 'visible' if args.should_detect == 'true' else 'covered'
        
        # Extract camera ID from device path or use default
        camera_id = 'default'
        if args.device_path:
            camera_id = args.device_path
        
        # Parse JSON parameters
        homography_matrix = json.loads(args.homography) if args.homography else None
        camera_matrix = json.loads(args.camera_matrix) if args.camera_matrix else None
        dist_coeffs = json.loads(args.dist_coeffs) if args.dist_coeffs else None
        expected_slots = json.loads(args.slots) if args.slots else []
        
        # Run validation with parsed parameters
        result = validate_slot_qrs(
            camera_id=camera_id,
            mode=mode,
            homography_matrix=homography_matrix,
            camera_matrix=camera_matrix,
            dist_coeffs=dist_coeffs,
            paper_width_cm=args.paper_width_cm,
            paper_height_cm=args.paper_height_cm,
            expected_slots=expected_slots,
            use_saved_rectified=args.use_saved_rectified
        )
    
    # Output JSON result
    print(json.dumps(result))
    sys.exit(0 if result['success'] else 1)