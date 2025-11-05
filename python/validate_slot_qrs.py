#!/usr/bin/env python3
"""
Validate slot ArUco markers in calibrated camera view.
Used for two-step calibration validation:
1. Verify ArUco markers ARE readable when slots are empty
2. Verify ArUco markers are NOT readable when tools are placed (covering markers)
"""

import os
import cv2
import numpy as np
import json
import sys
import time
import argparse

# Suppress OpenCV warnings/info to prevent polluting stdout
os.environ['OPENCV_LOG_LEVEL'] = 'FATAL'
cv2.setLogLevel(0)

def decode_aruco_markers(image, expected_count=None, include_workers=False):
    """Decode all ArUco markers in image with robust detection for printed markers
    
    Args:
        image: Input image to scan for ArUco markers
        expected_count: If provided, exit early once this many markers are found (optimization)
        include_workers: If True, include worker markers (50-95) in results
    """
    results = []
    found_marker_ids = set()
    
    # Initialize ArUco detector (using 5x5_100 dictionary to match printed templates)
    # Slot markers: 1-50, Worker markers: 51-95, Corner markers: 96-99 (reserved)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_100)
    aruco_params = cv2.aruco.DetectorParameters()
    
    # EXTREME: Maximum relaxation for printed markers
    aruco_params.adaptiveThreshWinSizeMin = 3
    aruco_params.adaptiveThreshWinSizeMax = 200
    aruco_params.adaptiveThreshWinSizeStep = 10
    aruco_params.adaptiveThreshConstant = 7
    aruco_params.minMarkerPerimeterRate = 0.005  # Very relaxed
    aruco_params.maxMarkerPerimeterRate = 8.0
    aruco_params.polygonalApproxAccuracyRate = 0.15  # Very tolerant
    aruco_params.minCornerDistanceRate = 0.01
    aruco_params.minDistanceToBorder = 0
    aruco_params.minMarkerDistanceRate = 0.005
    aruco_params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    aruco_params.cornerRefinementWinSize = 5
    aruco_params.cornerRefinementMaxIterations = 50
    aruco_params.cornerRefinementMinAccuracy = 0.01
    aruco_params.markerBorderBits = 1
    aruco_params.perspectiveRemovePixelPerCell = 4
    aruco_params.perspectiveRemoveIgnoredMarginPerCell = 0.1
    aruco_params.maxErroneousBitsInBorderRate = 0.5  # Allow 50% error in border
    aruco_params.minOtsuStdDev = 2.0
    aruco_params.errorCorrectionRate = 1.0  # Maximum error correction
    
    # Input is already grayscale from rectification (memory-optimized)
    gray = image if len(image.shape) == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # DEBUG: Print image stats
    print(f"    [ArUco Debug] Image size: {gray.shape}, dtype: {gray.dtype}, range: [{gray.min()}, {gray.max()}]", file=sys.stderr)
    
    # Detect ArUco markers
    try:
        corners, ids, rejected = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=aruco_params)
        
        print(f"    [ArUco Debug] Detection results: {len(ids) if ids is not None else 0} markers, {len(rejected)} rejected candidates", file=sys.stderr)
        
        if ids is not None and len(ids) > 0:
            for i, marker_id in enumerate(ids.flatten()):
                # Filter markers based on type:
                # - Slot markers: 1-50
                # - Worker markers: 51-95 (only if include_workers=True)
                # - Corner markers: 96-99 (exclude)
                is_slot = 1 <= marker_id <= 50
                is_worker = 51 <= marker_id <= 95
                is_corner = 96 <= marker_id <= 99
                
                # Skip corner markers
                if is_corner or marker_id < 1:
                    continue
                
                # Skip worker markers unless explicitly requested
                if is_worker and not include_workers:
                    continue
                
                if marker_id not in found_marker_ids:
                    found_marker_ids.add(marker_id)
                    
                    # Get marker corners
                    marker_corners = corners[i][0]
                    
                    # Calculate center
                    center_x = int(np.mean(marker_corners[:, 0]))
                    center_y = int(np.mean(marker_corners[:, 1]))
                    
                    # Calculate bounding box
                    x_min = int(np.min(marker_corners[:, 0]))
                    y_min = int(np.min(marker_corners[:, 1]))
                    x_max = int(np.max(marker_corners[:, 0]))
                    y_max = int(np.max(marker_corners[:, 1]))
                    
                    # Determine marker category
                    marker_category = 'worker' if is_worker else 'slot'
                    
                    results.append({
                        'data': str(marker_id),  # Store marker ID as string for compatibility
                        'type': 'ARUCO',
                        'category': marker_category,  # 'slot' or 'worker'
                        'rect': {'x': x_min, 'y': y_min, 'width': x_max - x_min, 'height': y_max - y_min},
                        'polygon': [(int(p[0]), int(p[1])) for p in marker_corners],
                        'center': (center_x, center_y),
                        'detection_method': 'aruco_opencv'
                    })
                    print(f"ArUco marker detected: ID {marker_id} ({marker_category}) at ({center_x}, {center_y})", file=sys.stderr)
                    
                    # Early exit if we found all expected markers (only count slot markers for early exit)
                    if expected_count and marker_category == 'slot' and len([m for m in results if m.get('category') == 'slot']) >= expected_count:
                        break
    except Exception as e:
        print(f"[ERROR] ArUco detection failed: {e}", file=sys.stderr)
    
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
        
        # Add 40% padding around slot for better QR detection (in case QR is slightly outside)
        padding = 0.4
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
        
        # DEBUG: Save ROI image to inspect what we're actually scanning
        debug_roi_path = os.path.join(data_dir, f'validation_roi_{slot_id}.jpg')
        cv2.imwrite(debug_roi_path, roi)
        print(f"  DEBUG: Saved ROI to {debug_roi_path}", file=sys.stderr)
        print(f"  DEBUG: ROI shape={roi.shape}, dtype={roi.dtype}, min={roi.min()}, max={roi.max()}", file=sys.stderr)
        
        # For ArUco markers, try detection on ORIGINAL image first (no preprocessing)
        # ArUco markers are simpler patterns than QR codes and work better without aggressive preprocessing
        # IMPORTANT: Scan for BOTH slot markers (1-50) AND worker markers (51-95)
        print(f"  DEBUG: Starting ArUco decode for slot {slot_id} (original image)...", file=sys.stderr)
        roi_marker_results = decode_aruco_markers(roi, expected_count=1, include_workers=True)
        print(f"  DEBUG: Decode complete. Found {len(roi_marker_results)} ArUco markers", file=sys.stderr)
        
        # If no markers found, try with light preprocessing as fallback
        if not roi_marker_results:
            print(f"  DEBUG: No markers on original, trying with normalization...", file=sys.stderr)
            roi_normalized = cv2.normalize(roi, None, 0, 255, cv2.NORM_MINMAX)
            
            # Save normalized version for debugging
            boosted_path = os.path.join(data_dir, f'validation_roi_{slot_id}_normalized.jpg')
            cv2.imwrite(boosted_path, roi_normalized)
            
            roi_marker_results = decode_aruco_markers(roi_normalized, expected_count=1, include_workers=True)
            print(f"  DEBUG: Normalized attempt found {len(roi_marker_results)} ArUco markers", file=sys.stderr)
        
        if roi_marker_results:
            # Separate slot markers from worker markers
            slot_markers = [m for m in roi_marker_results if m.get('category') == 'slot']
            worker_markers = [m for m in roi_marker_results if m.get('category') == 'worker']
            
            # NEW WORKER TRACKING LOGIC:
            # - Slot marker visible + worker marker visible → tool in use by worker (OK)
            # - Slot marker visible + NO worker marker → ERROR (missing without checkout)
            # - Slot marker NOT visible → tool present (OK)
            
            if slot_markers:
                # Slot marker detected in ROI
                slot_marker = slot_markers[0]
                marker_data = slot_marker['data']
                detected_qrs_list.append(marker_data)
                
                print(f"  ✓ Detected Slot ArUco: '{marker_data}' via {slot_marker['detection_method']}", file=sys.stderr)
                
                # Check if there's also a worker marker
                if worker_markers:
                    worker_marker = worker_markers[0]
                    worker_id = worker_marker['data']
                    print(f"  ✓ Detected Worker ArUco: '{worker_id}' - Tool in use by worker", file=sys.stderr)
                
                if mode == 'visible':
                    # ArUco marker should be visible - check if it matches expected
                    if marker_data == expected_qr:
                        validation_details.append({
                            'slot_id': slot_id,
                            'expected_qr': expected_qr,
                            'status': 'correct',
                            'detected': True,
                            'in_bounds': True,
                            'detection_method': slot_marker['detection_method']
                        })
                        print(f"  ✓ CORRECT: Matches expected marker ID '{expected_qr}'", file=sys.stderr)
                    else:
                        validation_details.append({
                            'slot_id': slot_id,
                            'expected_qr': expected_qr,
                            'status': 'wrong_qr',
                            'detected': True,
                            'in_bounds': True,
                            'actual_qr': marker_data,
                            'detection_method': slot_marker['detection_method']
                        })
                        missing_qrs.append(expected_qr)
                        print(f"  ✗ WRONG MARKER: Expected '{expected_qr}' but found '{marker_data}'", file=sys.stderr)
                else:
                    # Slot marker should NOT be visible (tool should cover it)
                    # NEW LOGIC: Check if worker marker is present
                    if worker_markers:
                        # Worker marker present → tool in use (OK, not an error)
                        worker_id = worker_markers[0]['data']
                        validation_details.append({
                            'slot_id': slot_id,
                            'expected_qr': expected_qr,
                            'status': 'in_use',  # Tool is being used by worker
                            'detected': True,
                            'in_bounds': True,
                            'actual_qr': marker_data,
                            'worker_id': worker_id,  # Include worker ID
                            'detection_method': slot_marker['detection_method']
                        })
                        print(f"  ✓ TOOL IN USE: Worker {worker_id} is using the tool", file=sys.stderr)
                    else:
                        # NO worker marker → ERROR (tool missing without checkout)
                        validation_details.append({
                            'slot_id': slot_id,
                            'expected_qr': expected_qr,
                            'status': 'missing_without_checkout',  # ERROR: Missing tool without worker checkout
                            'detected': True,
                            'in_bounds': True,
                            'actual_qr': marker_data,
                            'detection_method': slot_marker['detection_method']
                        })
                        incorrectly_visible.append(expected_qr)
                        print(f"  ✗ ERROR: Slot marker '{marker_data}' is visible but NO worker marker detected - Tool missing without checkout", file=sys.stderr)
            
            elif worker_markers:
                # Only worker marker detected (no slot marker) - This shouldn't happen but handle it
                worker_id = worker_markers[0]['data']
                print(f"  ⚠ WARNING: Worker marker {worker_id} detected but no slot marker", file=sys.stderr)
                # Treat this as if slot marker is covered (tool present with worker tag)
                if mode == 'covered':
                    validation_details.append({
                        'slot_id': slot_id,
                        'expected_qr': expected_qr,
                        'status': 'correct',
                        'detected': False,
                        'in_bounds': True,
                        'worker_id': worker_id
                    })
                    print(f"  ✓ CORRECT: Tool covered, worker {worker_id} present", file=sys.stderr)
                else:
                    validation_details.append({
                        'slot_id': slot_id,
                        'expected_qr': expected_qr,
                        'status': 'missing',
                        'detected': False,
                        'in_bounds': False
                    })
                    missing_qrs.append(expected_qr)
                    print(f"  ✗ ERROR: Expected slot marker '{expected_qr}' not detected", file=sys.stderr)
        else:
            # No ArUco marker detected in this slot's ROI
            print(f"  ✗ No ArUco marker detected in ROI", file=sys.stderr)
            
            if mode == 'visible':
                # ArUco marker should be visible but isn't - MISSING
                validation_details.append({
                    'slot_id': slot_id,
                    'expected_qr': expected_qr,
                    'status': 'missing',
                    'detected': False,
                    'in_bounds': False
                })
                missing_qrs.append(expected_qr)
                print(f"  ✗ ERROR: Expected marker ID '{expected_qr}' not detected", file=sys.stderr)
            else:
                # ArUco marker not visible - CORRECT (tool is covering it)
                validation_details.append({
                    'slot_id': slot_id,
                    'expected_qr': expected_qr,
                    'status': 'correct',
                    'detected': False,
                    'in_bounds': True
                })
                print(f"  ✓ CORRECT: Marker is covered as expected", file=sys.stderr)
    
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