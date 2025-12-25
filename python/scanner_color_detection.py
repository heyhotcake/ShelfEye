#!/usr/bin/env python3
"""
Scanner Color Detection Module

Detects bright fluorescent yellow stickers on handheld scanners using HSV color space.
Works alongside existing ArUco slot detection without interference.

Detection approach:
- Scanner grid: HSV yellow detection (H: 20-35, S: 150-255, V: 180-255)
- Worker tag grid: ArUco badge detection (IDs 51-95)

Yellow sticker detected = scanner is present (OK)
No yellow + worker badge = scanner checked out by worker
No yellow + no badge = scanner missing (ALERT)
"""

import os
import cv2
import numpy as np
import json
import sys
import argparse
from typing import Dict, List, Tuple, Optional

os.environ['OPENCV_LOG_LEVEL'] = 'FATAL'
cv2.setLogLevel(0)


HSV_YELLOW_LOWER = np.array([20, 150, 180])
HSV_YELLOW_UPPER = np.array([35, 255, 255])

MINIMUM_YELLOW_COVERAGE = 0.15

ARUCO_WORKER_ID_MIN = 51
ARUCO_WORKER_ID_MAX = 95


def detect_yellow_in_cell(image: np.ndarray, cell_coords: Dict, debug: bool = False) -> Dict:
    """
    Detect yellow color within a single scanner cell region.
    
    Args:
        image: BGR or grayscale rectified image
        cell_coords: Dict with keys: x_cm, y_cm, width_cm, height_cm, px_per_cm
        debug: If True, output additional debug info
        
    Returns:
        Dict with detection results: {
            detected: bool,
            coverage: float (0.0-1.0),
            cell_id: str,
            debug_mask: np.ndarray (if debug=True)
        }
    """
    x_cm = cell_coords['x_cm']
    y_cm = cell_coords['y_cm']
    width_cm = cell_coords['width_cm']
    height_cm = cell_coords['height_cm']
    px_per_cm = cell_coords.get('px_per_cm', 31.8)
    
    x1 = int((x_cm - width_cm/2) * px_per_cm)
    y1 = int((y_cm - height_cm/2) * px_per_cm)
    x2 = int((x_cm + width_cm/2) * px_per_cm)
    y2 = int((y_cm + height_cm/2) * px_per_cm)
    
    h, w = image.shape[:2]
    x1 = max(0, min(x1, w-1))
    x2 = max(0, min(x2, w))
    y1 = max(0, min(y1, h-1))
    y2 = max(0, min(y2, h))
    
    if x2 <= x1 or y2 <= y1:
        return {
            'detected': False,
            'coverage': 0.0,
            'error': 'Invalid cell coordinates'
        }
    
    cell_roi = image[y1:y2, x1:x2]
    
    if len(cell_roi.shape) == 2:
        cell_bgr = cv2.cvtColor(cell_roi, cv2.COLOR_GRAY2BGR)
    else:
        cell_bgr = cell_roi
    
    cell_hsv = cv2.cvtColor(cell_bgr, cv2.COLOR_BGR2HSV)
    
    yellow_mask = cv2.inRange(cell_hsv, HSV_YELLOW_LOWER, HSV_YELLOW_UPPER)
    
    kernel = np.ones((3, 3), np.uint8)
    yellow_mask = cv2.morphologyEx(yellow_mask, cv2.MORPH_OPEN, kernel)
    yellow_mask = cv2.morphologyEx(yellow_mask, cv2.MORPH_CLOSE, kernel)
    
    total_pixels = yellow_mask.size
    yellow_pixels = np.count_nonzero(yellow_mask)
    coverage = yellow_pixels / total_pixels if total_pixels > 0 else 0.0
    
    detected = coverage >= MINIMUM_YELLOW_COVERAGE
    
    result = {
        'detected': detected,
        'coverage': round(coverage, 4),
        'yellow_pixels': int(yellow_pixels),
        'total_pixels': int(total_pixels),
        'roi': {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2}
    }
    
    if debug:
        result['debug_mask'] = yellow_mask.tolist()
    
    return result


def detect_worker_badge_in_cell(image: np.ndarray, cell_coords: Dict, debug: bool = False) -> Dict:
    """
    Detect ArUco worker badge (IDs 51-95) within a worker tag cell region.
    
    Args:
        image: BGR or grayscale rectified image
        cell_coords: Dict with keys: x_cm, y_cm, width_cm, height_cm, px_per_cm
        debug: If True, output additional debug info
        
    Returns:
        Dict with detection results: {
            detected: bool,
            worker_id: int or None,
            cell_id: str
        }
    """
    x_cm = cell_coords['x_cm']
    y_cm = cell_coords['y_cm']
    width_cm = cell_coords['width_cm']
    height_cm = cell_coords['height_cm']
    px_per_cm = cell_coords.get('px_per_cm', 31.8)
    
    x1 = int((x_cm - width_cm/2) * px_per_cm)
    y1 = int((y_cm - height_cm/2) * px_per_cm)
    x2 = int((x_cm + width_cm/2) * px_per_cm)
    y2 = int((y_cm + height_cm/2) * px_per_cm)
    
    h, w = image.shape[:2]
    x1 = max(0, min(x1, w-1))
    x2 = max(0, min(x2, w))
    y1 = max(0, min(y1, h-1))
    y2 = max(0, min(y2, h))
    
    if x2 <= x1 or y2 <= y1:
        return {
            'detected': False,
            'worker_id': None,
            'error': 'Invalid cell coordinates'
        }
    
    cell_roi = image[y1:y2, x1:x2]
    
    if len(cell_roi.shape) == 3:
        gray_roi = cv2.cvtColor(cell_roi, cv2.COLOR_BGR2GRAY)
    else:
        gray_roi = cell_roi
    
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
    aruco_params = cv2.aruco.DetectorParameters()
    
    aruco_params.adaptiveThreshWinSizeMin = 3
    aruco_params.adaptiveThreshWinSizeMax = 30
    aruco_params.adaptiveThreshWinSizeStep = 5
    aruco_params.minMarkerPerimeterRate = 0.02
    aruco_params.maxMarkerPerimeterRate = 4.0
    aruco_params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    
    corners, ids, rejected = cv2.aruco.detectMarkers(gray_roi, aruco_dict, parameters=aruco_params)
    
    worker_id = None
    detected = False
    
    if ids is not None:
        for marker_id in ids.flatten():
            if ARUCO_WORKER_ID_MIN <= marker_id <= ARUCO_WORKER_ID_MAX:
                worker_id = int(marker_id)
                detected = True
                break
    
    result = {
        'detected': detected,
        'worker_id': worker_id,
        'roi': {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2}
    }
    
    if debug:
        result['all_detected_ids'] = [int(i) for i in ids.flatten()] if ids is not None else []
        result['rejected_count'] = len(rejected) if rejected is not None else 0
    
    return result


def process_scanner_grid(
    image: np.ndarray,
    scanner_cells: List[Dict],
    worker_tag_cells: List[Dict],
    px_per_cm: float = 31.8,
    debug: bool = False
) -> Dict:
    """
    Process both scanner grid and worker tag grid cells.
    
    Args:
        image: Rectified BGR image
        scanner_cells: List of scanner cell configs with x_cm, y_cm, width_cm, height_cm
        worker_tag_cells: List of worker tag cell configs (same structure)
        px_per_cm: Pixels per centimeter for coordinate conversion
        debug: If True, include debug info
        
    Returns:
        Dict with all detection results and summary
    """
    results = {
        'scanner_cells': [],
        'worker_tag_cells': [],
        'summary': {
            'total_scanner_cells': len(scanner_cells),
            'scanners_present': 0,
            'scanners_checked_out': 0,
            'scanners_missing': 0,
            'alerts': []
        }
    }
    
    for cell in scanner_cells:
        cell_coords = {
            'x_cm': cell['x_cm'],
            'y_cm': cell['y_cm'],
            'width_cm': cell['width_cm'],
            'height_cm': cell['height_cm'],
            'px_per_cm': px_per_cm
        }
        detection = detect_yellow_in_cell(image, cell_coords, debug)
        detection['cell_id'] = cell.get('id', f"scanner_{cell.get('cell_number', '?')}")
        detection['cell_number'] = cell.get('cell_number')
        detection['linked_cell_id'] = cell.get('linked_cell_id')
        results['scanner_cells'].append(detection)
    
    for cell in worker_tag_cells:
        cell_coords = {
            'x_cm': cell['x_cm'],
            'y_cm': cell['y_cm'],
            'width_cm': cell['width_cm'],
            'height_cm': cell['height_cm'],
            'px_per_cm': px_per_cm
        }
        detection = detect_worker_badge_in_cell(image, cell_coords, debug)
        detection['cell_id'] = cell.get('id', f"tag_{cell.get('cell_number', '?')}")
        detection['cell_number'] = cell.get('cell_number')
        detection['linked_cell_id'] = cell.get('linked_cell_id')
        results['worker_tag_cells'].append(detection)
    
    for scanner_result in results['scanner_cells']:
        linked_cell_id = scanner_result.get('linked_cell_id')
        cell_number = scanner_result.get('cell_number')
        
        worker_result = None
        for wr in results['worker_tag_cells']:
            if wr.get('cell_id') == linked_cell_id or wr.get('cell_number') == cell_number:
                worker_result = wr
                break
        
        if scanner_result['detected']:
            scanner_result['status'] = 'PRESENT'
            results['summary']['scanners_present'] += 1
        elif worker_result and worker_result['detected']:
            scanner_result['status'] = 'CHECKED_OUT'
            scanner_result['checked_out_by'] = worker_result['worker_id']
            results['summary']['scanners_checked_out'] += 1
        else:
            scanner_result['status'] = 'MISSING'
            results['summary']['scanners_missing'] += 1
            results['summary']['alerts'].append({
                'type': 'SCANNER_MISSING',
                'cell_id': scanner_result['cell_id'],
                'cell_number': cell_number,
                'message': f"Scanner {cell_number} is missing without checkout"
            })
    
    return results


def main():
    parser = argparse.ArgumentParser(description='Scanner color detection for handheld scanner tracking')
    parser.add_argument('--image', required=True, help='Path to rectified image')
    parser.add_argument('--cells', required=True, help='JSON file or string with cell configurations')
    parser.add_argument('--px-per-cm', type=float, default=31.8, help='Pixels per centimeter')
    parser.add_argument('--debug', action='store_true', help='Enable debug output')
    parser.add_argument('--output', help='Output file path for results JSON')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.image):
        print(json.dumps({'error': f'Image not found: {args.image}'}))
        sys.exit(1)
    
    image = cv2.imread(args.image)
    if image is None:
        print(json.dumps({'error': f'Failed to load image: {args.image}'}))
        sys.exit(1)
    
    if os.path.exists(args.cells):
        with open(args.cells, 'r') as f:
            cells_config = json.load(f)
    else:
        cells_config = json.loads(args.cells)
    
    scanner_cells = cells_config.get('scanner_cells', [])
    worker_tag_cells = cells_config.get('worker_tag_cells', [])
    
    results = process_scanner_grid(
        image,
        scanner_cells,
        worker_tag_cells,
        args.px_per_cm,
        args.debug
    )
    
    output_json = json.dumps(results, indent=2)
    
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output_json)
        print(f"Results written to {args.output}", file=sys.stderr)
    
    print(output_json)


if __name__ == '__main__':
    main()
