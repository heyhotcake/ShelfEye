#!/usr/bin/env python3
"""
Camera Capture Processing Script
Captures frames from all calibrated cameras and processes each slot.
Uses simplified QR-based detection:
- Slot QR visible → EMPTY (tool missing, alarm)
- Worker QR visible → CHECKED_OUT (signed out)
- No QR visible → ITEM_PRESENT (tool covering slot QR)
"""

import cv2
import sys
import json
import logging
import time
import numpy as np
import subprocess
from typing import Dict, List, Any, Tuple, Optional
from pathlib import Path
from datetime import datetime

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Paper size dimensions lookup (matches server/utils/paper-size.ts)
PAPER_DIMENSIONS = {
    'A5-landscape': (21.0, 14.8),
    'A4-landscape': (29.7, 21.0),
    'A3-landscape': (42.0, 29.7),
    '2xA5-landscape': (42.0, 14.8),
    '3xA5-landscape': (63.0, 14.8),
    '6-page-3x2': (89.1, 42.0),
    '8-page-4x2': (118.8, 42.0),
}

def get_paper_dimensions(paper_size: str) -> Tuple[float, float]:
    """
    Get paper dimensions in cm for a given paper size format.
    
    Args:
        paper_size: Paper size format string (e.g., 'A4-landscape', '6-page-3x2')
        
    Returns:
        Tuple of (width_cm, height_cm)
    """
    if paper_size in PAPER_DIMENSIONS:
        return PAPER_DIMENSIONS[paper_size]
    else:
        logger.warning(f"Unknown paper size: {paper_size}, defaulting to A4 landscape")
        return (29.7, 21.0)


def detect_corner_markers(frame: np.ndarray) -> Tuple[Dict[int, np.ndarray], int]:
    """
    Detect the 4 corner ArUco markers (IDs 96-99) in the frame.
    
    Args:
        frame: Input frame (BGR)
        
    Returns:
        marker_centers: Dictionary mapping marker ID to center point (x, y)
        num_detected: Number of corner markers detected
    """
    corner_ids = [96, 97, 98, 99]
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
    aruco_params = cv2.aruco.DetectorParameters()
    aruco_params.perspectiveRemovePixelPerCell = 16
    
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
    corners, ids, _ = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=aruco_params)
    
    if ids is None or len(corners) == 0:
        return {}, 0
    
    marker_centers = {}
    for i, marker_id in enumerate(ids.flatten()):
        if marker_id in corner_ids:
            corner_points = corners[i][0]
            center_x = np.mean(corner_points[:, 0])
            center_y = np.mean(corner_points[:, 1])
            marker_centers[int(marker_id)] = np.array([center_x, center_y], dtype=np.float32)
    
    return marker_centers, len(marker_centers)


def validate_homography(homography: np.ndarray) -> bool:
    """
    Validate that a homography matrix is well-conditioned and usable.
    
    Checks for:
    - NaN or Inf values
    - Extreme condition number (near-singular matrix)
    - Reasonable determinant (no extreme scaling)
    
    Args:
        homography: 3x3 homography matrix
        
    Returns:
        True if homography is valid, False otherwise
    """
    if homography is None:
        return False
    
    # Check for NaN or Inf
    if np.any(np.isnan(homography)) or np.any(np.isinf(homography)):
        logger.warning("Homography contains NaN or Inf values")
        return False
    
    # Check condition number (ratio of largest to smallest singular value)
    # High condition number means near-singular matrix
    try:
        cond = np.linalg.cond(homography)
        if cond > 1e6:  # Threshold for ill-conditioned matrix
            logger.warning(f"Homography is ill-conditioned (cond={cond:.2e})")
            return False
    except np.linalg.LinAlgError:
        logger.warning("Failed to compute condition number")
        return False
    
    # Check determinant (should be non-zero and not extreme)
    det = np.linalg.det(homography)
    if abs(det) < 1e-10 or abs(det) > 1e10:
        logger.warning(f"Homography determinant is extreme (det={det:.2e})")
        return False
    
    return True


def calculate_homography_from_corners(marker_centers: Dict[int, np.ndarray], 
                                       paper_size_cm: Tuple[float, float]) -> Optional[np.ndarray]:
    """
    Calculate homography matrix from 4 corner markers.
    Maps real-world paper coordinates (cm) to camera pixels.
    
    Args:
        marker_centers: Dictionary of marker ID -> center point (pixels)
        paper_size_cm: (width_cm, height_cm) of the paper
        
    Returns:
        3x3 homography matrix or None if calculation fails
    """
    if len(marker_centers) != 4:
        return None
    
    required_ids = [96, 97, 98, 99]
    if not all(id in marker_centers for id in required_ids):
        return None
    
    paper_width_cm, paper_height_cm = paper_size_cm
    marker_size_cm = 5.0
    marker_center_offset = marker_size_cm / 2.0  # 2.5cm from edge
    
    # Destination points: detected marker centers in pixels
    # A (96) = top-left, B (97) = top-right, C (98) = bottom-right, D (99) = bottom-left
    dst_points = np.array([
        marker_centers[96],
        marker_centers[97],
        marker_centers[98],
        marker_centers[99],
    ], dtype=np.float32)
    
    # Validate marker ordering: verify all 4 markers form a proper quadrilateral
    # Expected positions: 96=TL, 97=TR, 98=BR, 99=BL
    m96, m97, m98, m99 = marker_centers[96], marker_centers[97], marker_centers[98], marker_centers[99]
    
    ordering_valid = True
    ordering_errors = []
    
    # 96 (TL) should be in top-left: smallest x among left markers, smallest y among top markers
    if not (m96[0] < m97[0] and m96[0] < m98[0]):
        ordering_errors.append("96 (TL) not left of 97/98")
        ordering_valid = False
    if not (m96[1] < m99[1] and m96[1] < m98[1]):
        ordering_errors.append("96 (TL) not above 99/98")
        ordering_valid = False
    
    # 97 (TR) should be in top-right: largest x among right markers, smaller y than bottom markers
    if not (m97[0] > m96[0] and m97[0] > m99[0]):
        ordering_errors.append("97 (TR) not right of 96/99")
        ordering_valid = False
    if not (m97[1] < m98[1] and m97[1] < m99[1]):
        ordering_errors.append("97 (TR) not above 98/99")
        ordering_valid = False
    
    # 98 (BR) should be in bottom-right: largest x, largest y
    if not (m98[0] > m96[0] and m98[0] > m99[0]):
        ordering_errors.append("98 (BR) not right of 96/99")
        ordering_valid = False
    if not (m98[1] > m96[1] and m98[1] > m97[1]):
        ordering_errors.append("98 (BR) not below 96/97")
        ordering_valid = False
    
    # 99 (BL) should be in bottom-left: smaller x than right markers, larger y than top markers
    if not (m99[0] < m97[0] and m99[0] < m98[0]):
        ordering_errors.append("99 (BL) not left of 97/98")
        ordering_valid = False
    if not (m99[1] > m96[1] and m99[1] > m97[1]):
        ordering_errors.append("99 (BL) not below 96/97")
        ordering_valid = False
    
    if not ordering_valid:
        logger.error(f"Corner marker positions invalid: {', '.join(ordering_errors)}")
        logger.error(f"Marker positions: 96={list(m96)}, 97={list(m97)}, 98={list(m98)}, 99={list(m99)}")
        return None  # Reject homography calculation if markers are in wrong positions
    
    # Source points: paper corners in cm (marker centers are 2.5cm from edges)
    src_points = np.array([
        [marker_center_offset, marker_center_offset],  # A: top-left
        [paper_width_cm - marker_center_offset, marker_center_offset],  # B: top-right
        [paper_width_cm - marker_center_offset, paper_height_cm - marker_center_offset],  # C: bottom-right
        [marker_center_offset, paper_height_cm - marker_center_offset],  # D: bottom-left
    ], dtype=np.float32)
    
    homography, _ = cv2.findHomography(src_points, dst_points, cv2.RANSAC, 5.0)
    
    # Validate the computed homography
    if not validate_homography(homography):
        logger.error("Computed homography failed validation")
        return None
    
    return homography


def rectify_frame(frame: np.ndarray, homography: np.ndarray, 
                  paper_size_cm: Tuple[float, float], px_per_cm: float = 31.8) -> np.ndarray:
    """
    Rectify a camera frame to a top-down view using the homography.
    
    Args:
        frame: Input camera frame
        homography: 3x3 homography matrix (maps cm -> pixels)
        paper_size_cm: (width_cm, height_cm) of the paper
        px_per_cm: Output resolution in pixels per centimeter
        
    Returns:
        Rectified image with proper dimensions
    """
    paper_width_cm, paper_height_cm = paper_size_cm
    output_width = int(paper_width_cm * px_per_cm)
    output_height = int(paper_height_cm * px_per_cm)
    output_size = (output_width, output_height)
    
    # Scaling matrix: cm -> output pixels
    scale_x = output_width / paper_width_cm
    scale_y = output_height / paper_height_cm
    S = np.array([
        [scale_x, 0, 0],
        [0, scale_y, 0],
        [0, 0, 1]
    ], dtype=np.float32)
    
    # Invert homography: camera pixels -> cm
    H_inv = np.linalg.inv(homography)
    
    # Combined warp: camera_pixel -> cm -> output_pixel
    M = S @ H_inv
    
    # CRITICAL: Use INTER_NEAREST to preserve sharp ArUco marker edges
    rectified = cv2.warpPerspective(frame, M, output_size, flags=cv2.INTER_NEAREST)
    
    return rectified


def has_cm_values(slot_data: Dict[str, Any]) -> bool:
    """
    Check if a slot has valid cm-based coordinate values.
    
    Returns True only if xCm, yCm, widthCm, and heightCm are all present and valid.
    """
    required_fields = ['xCm', 'yCm', 'widthCm', 'heightCm']
    for field in required_fields:
        value = slot_data.get(field)
        if value is None or (isinstance(value, (int, float)) and value <= 0 and field in ['widthCm', 'heightCm']):
            return False
    return True


# Fixed resolution for rectified frames - always use full resolution for reliable ArUco detection
# 31.8 px/cm ensures 3cm ArUco markers have ~95 pixels per side (~16 pixels per module)
RECTIFIED_PX_PER_CM = 31.8


def calculate_rectified_region_coords(slot_data: Dict[str, Any], px_per_cm: float = 31.8) -> Optional[List[List[float]]]:
    """
    Calculate region coordinates in rectified pixel space from cm values.
    
    In the rectified image, coordinates are simply cm * px_per_cm.
    This replaces the stored regionCoords which were in raw camera pixel space.
    
    Args:
        slot_data: Slot configuration with xCm, yCm, widthCm, heightCm, rotationDeg
        px_per_cm: Pixels per centimeter in the rectified image
        
    Returns:
        List of 4 corner points [[x1,y1], [x2,y2], [x3,y3], [x4,y4]], or None if cm values missing
    """
    # Check if slot has valid cm values
    if not has_cm_values(slot_data):
        return None
    
    x_cm = slot_data.get('xCm', 0)
    y_cm = slot_data.get('yCm', 0)
    width_cm = slot_data.get('widthCm', 10)
    height_cm = slot_data.get('heightCm', 5)
    rotation_deg = slot_data.get('rotationDeg', 0)
    
    # Calculate half dimensions
    half_w = width_cm / 2
    half_h = height_cm / 2
    
    # Define corners relative to center (before rotation)
    corners = [
        [-half_w, -half_h],  # top-left
        [half_w, -half_h],   # top-right
        [half_w, half_h],    # bottom-right
        [-half_w, half_h],   # bottom-left
    ]
    
    # Apply rotation if needed
    if rotation_deg != 0:
        angle_rad = np.deg2rad(rotation_deg)
        cos_a = np.cos(angle_rad)
        sin_a = np.sin(angle_rad)
        rotated_corners = []
        for cx, cy in corners:
            rx = cx * cos_a - cy * sin_a
            ry = cx * sin_a + cy * cos_a
            rotated_corners.append([rx, ry])
        corners = rotated_corners
    
    # Translate to center position and convert to pixels
    pixel_coords = []
    for cx, cy in corners:
        px = (x_cm + cx) * px_per_cm
        py = (y_cm + cy) * px_per_cm
        pixel_coords.append([px, py])
    
    return pixel_coords


# GPIO Light Control Functions
def control_light(pin: int, state: str):
    """
    Control LED lighting via the LED Manager Daemon (no direct WS2812 access).
    Uses led_control_client.py → named pipe → daemon to avoid DMA conflicts.
    
    Args:
        pin: GPIO pin number (legacy parameter, kept for compatibility)
        state: 'on' or 'off'
    """
    try:
        script_dir = Path(__file__).parent
        client = script_dir / "led_control_client.py"
        
        # Map 'on' to 'white' for the LED daemon
        action = 'white' if state == 'on' else 'off'
        
        # Use sudo for daemon client (daemon runs as root)
        cmd = ["sudo", sys.executable, str(client), action]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            logger.info(f"Light strip: {state.upper()} (daemon client)")
        else:
            logger.warning(f"LED client failed: {result.stderr or result.stdout}")
    except Exception as e:
        logger.warning(f"LED client error: {e}")


class SlotProcessor:
    """Process individual tool slots with simplified QR-based detection"""
    
    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(exist_ok=True)
        
        # Initialize QR decoder
        self.qr_detector = cv2.QRCodeDetector()
    
    def extract_roi(self, frame: np.ndarray, region_coords: List[List[float]]) -> Optional[np.ndarray]:
        """
        Extract region of interest from frame using polygon coordinates
        
        Args:
            frame: Input frame
            region_coords: Polygon coordinates [[x1, y1], [x2, y2], ...]
            
        Returns:
            Cropped ROI or None if extraction fails
        """
        try:
            # Convert to numpy array
            pts = np.array(region_coords, dtype=np.int32)
            
            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(pts)
            
            # Ensure bounds are within frame
            x = max(0, x)
            y = max(0, y)
            w = min(w, frame.shape[1] - x)
            h = min(h, frame.shape[0] - y)
            
            if w <= 0 or h <= 0:
                logger.warning("Invalid ROI bounds")
                return None
            
            # Extract ROI
            roi = frame[y:y+h, x:x+w]
            
            return roi
            
        except Exception as e:
            logger.error(f"ROI extraction failed: {e}")
            return None
    
    def extract_rectified_roi(self, frame: np.ndarray, region_coords: List[List[float]], 
                               width_cm: float, height_cm: float, 
                               px_per_cm: float = 31.8) -> Optional[np.ndarray]:
        """
        Extract and rectify region of interest using perspective transform.
        Creates a properly aligned rectangular view matching template dimensions.
        
        Args:
            frame: Input frame
            region_coords: Polygon coordinates [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
            width_cm: Expected width in centimeters
            height_cm: Expected height in centimeters
            px_per_cm: Output resolution in pixels per centimeter
            
        Returns:
            Rectified ROI with proper dimensions or None if extraction fails
        """
        try:
            if len(region_coords) != 4:
                logger.warning(f"Rectified ROI requires exactly 4 points, got {len(region_coords)}")
                return self.extract_roi(frame, region_coords)
            
            # Source points from the detected slot polygon (camera space)
            src_pts = np.array(region_coords, dtype=np.float32)
            
            # Destination points for rectified output
            out_width = int(width_cm * px_per_cm)
            out_height = int(height_cm * px_per_cm)
            
            dst_pts = np.array([
                [0, 0],
                [out_width, 0],
                [out_width, out_height],
                [0, out_height]
            ], dtype=np.float32)
            
            # Compute perspective transform matrix
            M = cv2.getPerspectiveTransform(src_pts, dst_pts)
            
            # Apply perspective transform to rectify the slot region
            rectified = cv2.warpPerspective(frame, M, (out_width, out_height))
            
            return rectified
            
        except Exception as e:
            logger.error(f"Rectified ROI extraction failed: {e}")
            return None
    
    def decode_qr(self, roi: np.ndarray) -> Optional[str]:
        """
        Decode QR code from ROI
        
        Args:
            roi: Region of interest image
            
        Returns:
            QR code data or None if not found
        """
        try:
            # Try multiple preprocessing approaches
            attempts = [
                roi,  # Original
                cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY),  # Grayscale
            ]
            
            for img in attempts:
                data, bbox, _ = self.qr_detector.detectAndDecode(img)
                if data and bbox is not None:
                    logger.debug(f"QR decoded: {data}")
                    return data
            
            return None
            
        except Exception as e:
            logger.error(f"QR decoding failed: {e}")
            return None
    
    def parse_qr_json(self, qr_raw: str) -> Optional[Dict]:
        """
        Parse QR code data as JSON
        
        Args:
            qr_raw: Raw QR code string
            
        Returns:
            Parsed JSON dict or None
        """
        try:
            return json.loads(qr_raw)
        except json.JSONDecodeError:
            logger.warning(f"QR data is not valid JSON: {qr_raw}")
            return None
    
    def determine_status(self, qr_data: Optional[str]) -> Tuple[str, bool, Optional[str]]:
        """
        Determine slot status using simplified QR-based logic
        
        Args:
            qr_data: Decoded QR data (JSON string)
            
        Returns:
            Tuple of (status, alert_triggered, worker_name)
        """
        # No QR detected → tool is covering the slot QR
        if not qr_data:
            return ("ITEM_PRESENT", False, None)
        
        # Parse QR JSON
        qr_json = self.parse_qr_json(qr_data)
        if not qr_json:
            # Invalid QR format, assume item present
            return ("ITEM_PRESENT", False, None)
        
        qr_type = qr_json.get('type')
        
        # Worker badge → checked out
        if qr_type == 'worker':
            worker_name = qr_json.get('worker_name', 'Unknown')
            return ("CHECKED_OUT", False, worker_name)
        
        # Slot QR → tool missing (alarm!)
        elif qr_type == 'slot':
            return ("EMPTY", True, None)
        
        # Unknown QR type
        else:
            logger.warning(f"Unknown QR type: {qr_type}")
            return ("ITEM_PRESENT", False, None)
    
    def process_slot(self, frame: np.ndarray, slot_data: Dict[str, Any], 
                      linked_slots: Optional[Dict[str, Dict[str, Any]]] = None,
                      use_rectified_coords: bool = False,
                      px_per_cm: float = 31.8) -> Dict[str, Any]:
        """
        Process a single slot using detection based on slot type
        
        Args:
            frame: Camera frame (raw or rectified)
            slot_data: Slot configuration
            linked_slots: Optional dict of linked slots (for scanner/worker grid pairing)
            use_rectified_coords: If True, calculate coords from cm values for rectified frame
            px_per_cm: Pixels per cm for rectified coordinate calculation
            
        Returns:
            Processing result with status and metrics
        """
        slot_id = slot_data.get('id')
        slot_name = slot_data.get('slotId', slot_id)
        slot_type = slot_data.get('slotType', 'tool')
        grid_metadata = slot_data.get('gridMetadata', [])
        
        # Use cm-based coordinates for rectified frames, or stored regionCoords for raw frames
        if use_rectified_coords:
            region_coords = calculate_rectified_region_coords(slot_data, px_per_cm=px_per_cm)
            if region_coords is None:
                # This shouldn't happen - legacy slots should be filtered at camera level
                # Log error and skip this slot
                logger.error(f"Slot {slot_name}: Missing cm values but use_rectified_coords=True - this slot should have been processed on raw frame")
                return {
                    'slotId': slot_id,
                    'slotName': slot_name,
                    'slotType': slot_type,
                    'status': 'ERROR',
                    'error': 'Missing cm values for rectified processing',
                    'qrData': None,
                    'workerName': None,
                    'alertTriggered': False
                }
            logger.debug(f"Slot {slot_name}: Using rectified coords at {px_per_cm:.1f} px/cm")
        else:
            region_coords = slot_data.get('regionCoords', [])
            logger.debug(f"Slot {slot_name}: Using stored regionCoords on raw frame")
        
        logger.info(f"Processing slot: {slot_name} (type: {slot_type})")
        
        result = {
            'slotId': slot_id,
            'slotName': slot_name,
            'slotType': slot_type,
            'status': 'ITEM_PRESENT',  # Default
            'qrData': None,
            'workerName': None,
            'alertTriggered': False,
            'error': None
        }
        
        try:
            # For grid slots, use rectified ROI extraction for proper coordinate alignment
            is_grid_slot = slot_type in ('scanner_grid', 'worker_tag_grid')
            
            if is_grid_slot:
                width_cm = slot_data.get('widthCm', 32)
                height_cm = slot_data.get('heightCm', 16)
                px_per_cm = 31.8  # Standard resolution for grid processing
                
                roi = self.extract_rectified_roi(frame, region_coords, width_cm, height_cm, px_per_cm)
                if roi is None:
                    # Fall back to regular ROI extraction
                    roi = self.extract_roi(frame, region_coords)
            else:
                roi = self.extract_roi(frame, region_coords)
            
            if roi is None:
                result['error'] = 'Failed to extract ROI'
                result['status'] = 'ERROR'
                return result
            
            # Save current ROI
            roi_path = self.data_dir / f"{slot_name}_last.png"
            cv2.imwrite(str(roi_path), roi)
            
            # Branch based on slot type
            if slot_type == 'scanner_grid':
                # Use yellow color detection for scanner grids (ROI is already rectified)
                result = self.process_scanner_grid_slot(slot_data, roi, grid_metadata, linked_slots, is_rectified=True)
            elif slot_type == 'worker_tag_grid':
                # Use ArUco detection for worker tag grids (ROI is already rectified)
                result = self.process_worker_tag_grid_slot(slot_data, roi, grid_metadata, is_rectified=True)
            else:
                # Standard tool slot - use QR detection
                qr_data = self.decode_qr(roi)
                result['qrData'] = qr_data
                
                # Determine status using simplified logic
                status, alert_triggered, worker_name = self.determine_status(qr_data)
                result['status'] = status
                result['alertTriggered'] = alert_triggered
                result['workerName'] = worker_name
            
            logger.info(f"Slot {slot_name}: {result.get('status')} (type: {slot_type})")
            
        except Exception as e:
            result['error'] = str(e)
            result['status'] = 'ERROR'
            logger.error(f"Slot {slot_name} processing error: {e}")
        
        return result
    
    def process_scanner_grid_slot(self, slot_data: Dict[str, Any], roi: np.ndarray, 
                                   grid_metadata: List[Dict], 
                                   linked_slots: Optional[Dict[str, Dict[str, Any]]] = None,
                                   is_rectified: bool = False) -> Dict[str, Any]:
        """
        Process a scanner grid slot using yellow color detection
        
        Args:
            slot_data: Slot configuration
            roi: Region of interest image (rectified if is_rectified=True)
            grid_metadata: List of cell definitions
            linked_slots: Dict of linked slots keyed by slot ID
            is_rectified: Whether the ROI has been perspective-corrected
            
        Returns:
            Processing result with cell statuses
        """
        from scanner_color_detection import detect_yellow_in_cell
        
        slot_id = slot_data.get('id')
        slot_name = slot_data.get('slotId', slot_id)
        linked_slot_id = slot_data.get('linkedSlotId')
        
        result = {
            'slotId': slot_id,
            'slotName': slot_name,
            'slotType': 'scanner_grid',
            'status': 'OK',  # Overall grid status
            'cellResults': [],
            'alertTriggered': False,
            'missingCount': 0,
            'presentCount': 0,
            'checkedOutCount': 0,
            'error': None
        }
        
        # Get linked worker tag grid results if available
        worker_tag_results = None
        if linked_slot_id and linked_slots and linked_slot_id in linked_slots:
            worker_tag_results = linked_slots[linked_slot_id].get('cellResults', [])
        
        # For rectified ROI, px_per_cm matches the extraction resolution
        width_cm = slot_data.get('widthCm', 32)
        height_cm = slot_data.get('heightCm', 16)
        roi_height, roi_width = roi.shape[:2]
        
        if is_rectified:
            # Rectified ROI was created at 31.8 px/cm
            px_per_cm = 31.8
        else:
            # Fall back to computed ratio (less accurate)
            px_per_cm = roi_width / width_cm
        
        # Get grid dimensions
        n_cols = 4  # Default 2x4 grid
        n_rows = 2
        if grid_metadata:
            max_col = max(cell.get('col', 0) for cell in grid_metadata)
            max_row = max(cell.get('row', 0) for cell in grid_metadata)
            n_cols = max_col + 1
            n_rows = max_row + 1
        
        for cell in grid_metadata:
            cell_num = cell.get('row', 0) * n_cols + cell.get('col', 0) + 1
            cell_width = cell.get('widthCm', width_cm / n_cols)
            cell_height = cell.get('heightCm', height_cm / n_rows)
            
            # For rectified ROI, coordinates are relative to the ROI origin (0,0 is top-left)
            # Cell center in cm from top-left of ROI
            col = cell.get('col', 0)
            row = cell.get('row', 0)
            cell_center_x_cm = (col + 0.5) * cell_width
            cell_center_y_cm = (row + 0.5) * cell_height
            
            cell_coords = {
                'x_cm': cell_center_x_cm,
                'y_cm': cell_center_y_cm,
                'width_cm': cell_width,
                'height_cm': cell_height,
                'px_per_cm': px_per_cm
            }
            
            detection = detect_yellow_in_cell(roi, cell_coords, debug=False)
            detection['cell_number'] = cell_num
            detection['label'] = cell.get('label', f'Cell {cell_num}')
            
            # Determine cell status
            if detection['detected']:
                detection['status'] = 'PRESENT'
                result['presentCount'] += 1
            else:
                # Check if worker badge is present in linked cell
                worker_badge = None
                if worker_tag_results:
                    for wr in worker_tag_results:
                        if wr.get('cell_number') == cell_num:
                            worker_badge = wr
                            break
                
                if worker_badge and worker_badge.get('detected'):
                    detection['status'] = 'CHECKED_OUT'
                    detection['checked_out_by'] = worker_badge.get('worker_id')
                    result['checkedOutCount'] += 1
                else:
                    detection['status'] = 'MISSING'
                    result['missingCount'] += 1
                    result['alertTriggered'] = True
            
            result['cellResults'].append(detection)
        
        # Set overall status
        if result['missingCount'] > 0:
            result['status'] = 'ALERT'
        elif result['checkedOutCount'] > 0:
            result['status'] = 'PARTIAL'
        else:
            result['status'] = 'OK'
        
        return result
    
    def process_worker_tag_grid_slot(self, slot_data: Dict[str, Any], roi: np.ndarray,
                                      grid_metadata: List[Dict],
                                      is_rectified: bool = False) -> Dict[str, Any]:
        """
        Process a worker tag grid slot using ArUco badge detection
        
        Args:
            slot_data: Slot configuration
            roi: Region of interest image (rectified if is_rectified=True)
            grid_metadata: List of cell definitions
            is_rectified: Whether the ROI has been perspective-corrected
            
        Returns:
            Processing result with cell statuses
        """
        from scanner_color_detection import detect_worker_badge_in_cell
        
        slot_id = slot_data.get('id')
        slot_name = slot_data.get('slotId', slot_id)
        
        result = {
            'slotId': slot_id,
            'slotName': slot_name,
            'slotType': 'worker_tag_grid',
            'status': 'OK',
            'cellResults': [],
            'badgesDetected': 0,
            'error': None
        }
        
        # For rectified ROI, px_per_cm matches the extraction resolution
        width_cm = slot_data.get('widthCm', 32)
        height_cm = slot_data.get('heightCm', 16)
        roi_height, roi_width = roi.shape[:2]
        
        if is_rectified:
            # Rectified ROI was created at 31.8 px/cm
            px_per_cm = 31.8
        else:
            # Fall back to computed ratio (less accurate)
            px_per_cm = roi_width / width_cm
        
        # Get grid dimensions
        n_cols = 4  # Default 2x4 grid
        n_rows = 2
        if grid_metadata:
            max_col = max(cell.get('col', 0) for cell in grid_metadata)
            max_row = max(cell.get('row', 0) for cell in grid_metadata)
            n_cols = max_col + 1
            n_rows = max_row + 1
        
        for cell in grid_metadata:
            cell_num = cell.get('row', 0) * n_cols + cell.get('col', 0) + 1
            cell_width = cell.get('widthCm', width_cm / n_cols)
            cell_height = cell.get('heightCm', height_cm / n_rows)
            
            # For rectified ROI, coordinates are relative to the ROI origin (0,0 is top-left)
            col = cell.get('col', 0)
            row = cell.get('row', 0)
            cell_center_x_cm = (col + 0.5) * cell_width
            cell_center_y_cm = (row + 0.5) * cell_height
            
            cell_coords = {
                'x_cm': cell_center_x_cm,
                'y_cm': cell_center_y_cm,
                'width_cm': cell_width,
                'height_cm': cell_height,
                'px_per_cm': px_per_cm
            }
            
            detection = detect_worker_badge_in_cell(roi, cell_coords, debug=False)
            detection['cell_number'] = cell_num
            detection['label'] = cell.get('label', f'Cell {cell_num}')
            
            if detection['detected']:
                result['badgesDetected'] += 1
            
            result['cellResults'].append(detection)
        
        return result


class CameraProcessor:
    """Process all cameras and their slots"""
    
    def __init__(self):
        self.slot_processor = SlotProcessor()
    
    def process_camera(self, camera_data: Dict[str, Any], slots: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Process a single camera and all its slots
        
        Args:
            camera_data: Camera configuration
            slots: List of slot configurations for this camera
            
        Returns:
            Processing result
        """
        camera_id = camera_data.get('id')
        device_path = camera_data.get('devicePath')
        device_index = camera_data.get('deviceIndex', 0)
        resolution = camera_data.get('resolution', [2560, 1440])
        stored_homography = camera_data.get('homographyMatrix')
        paper_size = camera_data.get('paperSize', 'A4-landscape')
        
        # Convert device path to index if needed
        if device_path and device_path.startswith('/dev/video'):
            device_index = int(device_path.replace('/dev/video', ''))
        
        logger.info(f"Processing camera: {camera_id} (device {device_index})")
        
        result = {
            'cameraId': camera_id,
            'status': 'success',
            'slotsProcessed': 0,
            'slotResults': [],
            'errors': []
        }
        
        # Check if calibrated (stored homography indicates camera was calibrated)
        if not stored_homography:
            result['status'] = 'failed'
            result['errors'].append('Camera not calibrated (missing homography matrix)')
            logger.error(f"Camera {camera_id}: Not calibrated")
            return result
        
        # Get paper dimensions for this camera's template format
        paper_size_cm = get_paper_dimensions(paper_size)
        logger.info(f"Camera {camera_id}: Using paper size {paper_size} ({paper_size_cm[0]}x{paper_size_cm[1]} cm)")
        
        picam2 = None
        try:
            # Setup camera with Picamera2
            from camera_utils_picam2 import setup_camera_picam2, warmup_camera_picam2
            
            width, height = resolution
            picam2 = setup_camera_picam2(device_index, resolution=(width, height))
            picam2.start()
            
            # Give autofocus time to adjust (critical for sharp images)
            logger.info(f"Camera {camera_id}: Warming up autofocus...")
            warmup_camera_picam2(picam2, duration_seconds=1)
            
            # Capture frame from 'main' stream and convert RGB to BGR for OpenCV
            frame_rgb = picam2.capture_array("main")
            frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
            picam2.stop()
            picam2.close()
            picam2 = None
            
            if frame is None:
                result['status'] = 'failed'
                result['errors'].append('Failed to capture frame')
                logger.error(f"Camera {camera_id}: Frame capture failed")
                return result
            
            logger.info(f"Camera {camera_id}: Frame captured ({frame.shape})")
            
            # Detect 4 corner ArUco markers (96, 97, 98, 99) and get their centers
            # This ensures template sheets are in place AND allows us to calculate fresh homography
            try:
                marker_centers, num_detected = detect_corner_markers(frame)
                
                if num_detected < 4:
                    corner_marker_ids = [96, 97, 98, 99]
                    detected_ids = list(marker_centers.keys())
                    missing_ids = [id for id in corner_marker_ids if id not in detected_ids]
                    result['status'] = 'failed'
                    result['errors'].append(
                        f'Corner marker validation failed: Only {num_detected}/4 markers detected. '
                        f'Missing: {missing_ids}. Template sheets may not be in place or camera position changed.'
                    )
                    logger.error(f"Camera {camera_id}: Corner marker validation failed - only {num_detected}/4 detected, missing {missing_ids}")
                    return result
                
                logger.info(f"Camera {camera_id}: All 4 corner markers detected at positions: {[(id, list(pos)) for id, pos in marker_centers.items()]}")
                
            except Exception as aruco_err:
                result['status'] = 'failed'
                result['errors'].append(f'Corner marker detection exception: {str(aruco_err)}')
                logger.error(f"Camera {camera_id}: ArUco detection error: {aruco_err}")
                return result
            
            # Calculate fresh homography from detected corner positions
            # This automatically adjusts for any camera/template movement since calibration
            try:
                homography = calculate_homography_from_corners(marker_centers, paper_size_cm)
                if homography is None:
                    result['status'] = 'failed'
                    result['errors'].append('Failed to calculate homography from corner markers')
                    logger.error(f"Camera {camera_id}: Homography calculation failed")
                    return result
                
                logger.info(f"Camera {camera_id}: Fresh homography calculated from current corner positions")
                
            except Exception as homo_err:
                result['status'] = 'failed'
                result['errors'].append(f'Homography calculation exception: {str(homo_err)}')
                logger.error(f"Camera {camera_id}: Homography error: {homo_err}")
                return result
            
            # Use fixed full resolution for reliable ArUco detection on all template sizes
            # 31.8 px/cm ensures 3cm markers have ~95 pixels (adequate for detection)
            px_per_cm = RECTIFIED_PX_PER_CM
            logger.info(f"Camera {camera_id}: Using fixed {px_per_cm:.1f} px/cm for paper {paper_size_cm[0]:.1f}x{paper_size_cm[1]:.1f} cm")
            
            # Rectify the frame to top-down view using the calculated homography
            # Slot coordinates are defined in this rectified space
            try:
                rectified_frame = rectify_frame(frame, homography, paper_size_cm, px_per_cm=px_per_cm)
                logger.info(f"Camera {camera_id}: Frame rectified to {rectified_frame.shape[1]}x{rectified_frame.shape[0]} pixels (~{rectified_frame.nbytes / 1024 / 1024:.1f} MB)")
                
            except Exception as rect_err:
                result['status'] = 'failed'
                result['errors'].append(f'Frame rectification exception: {str(rect_err)}')
                logger.error(f"Camera {camera_id}: Rectification error: {rect_err}")
                return result
            
            # Separate slots by type for processing order
            # Process worker tag grids first, then scanner grids (need badge results), then tools
            worker_tag_slots = [s for s in slots if s.get('slotType') == 'worker_tag_grid']
            scanner_grid_slots = [s for s in slots if s.get('slotType') == 'scanner_grid']
            tool_slots = [s for s in slots if s.get('slotType', 'tool') == 'tool']
            
            # Separate slots with cm values from legacy slots (no cm values)
            # Slots with cm values are processed on the rectified frame
            # Legacy slots are processed on the raw frame with stored regionCoords
            slots_with_cm = [s for s in tool_slots if has_cm_values(s)]
            legacy_slots = [s for s in tool_slots if not has_cm_values(s)]
            
            if legacy_slots:
                logger.warning(f"Camera {camera_id}: Found {len(legacy_slots)} legacy slots without cm values - processing on raw frame")
            
            # Track processed results for linked slot lookups
            processed_slots: Dict[str, Dict[str, Any]] = {}
            
            # Process slots on the RECTIFIED frame
            # Coordinates are calculated from cm values (not stored regionCoords in camera pixel space)
            # 1. Process worker tag grids first (no dependencies)
            for slot in worker_tag_slots:
                slot_result = self.slot_processor.process_slot(
                    rectified_frame, slot, use_rectified_coords=True, px_per_cm=px_per_cm)
                result['slotResults'].append(slot_result)
                result['slotsProcessed'] += 1
                slot_id_key = slot.get('id') or slot.get('slotId', 'unknown')
                processed_slots[slot_id_key] = slot_result
            
            # 2. Process scanner grids (may depend on worker tag results)
            for slot in scanner_grid_slots:
                slot_result = self.slot_processor.process_slot(
                    rectified_frame, slot, linked_slots=processed_slots, 
                    use_rectified_coords=True, px_per_cm=px_per_cm)
                result['slotResults'].append(slot_result)
                result['slotsProcessed'] += 1
                slot_id_key = slot.get('id') or slot.get('slotId', 'unknown')
                processed_slots[slot_id_key] = slot_result
            
            # 3. Process regular tool slots WITH cm values on RECTIFIED frame
            for slot in slots_with_cm:
                slot_result = self.slot_processor.process_slot(
                    rectified_frame, slot, use_rectified_coords=True, px_per_cm=px_per_cm)
                result['slotResults'].append(slot_result)
                result['slotsProcessed'] += 1
            
            # 4. Process LEGACY tool slots on RAW frame with stored regionCoords
            for slot in legacy_slots:
                slot_result = self.slot_processor.process_slot(
                    frame, slot, use_rectified_coords=False)  # Use raw frame with stored coords
                result['slotResults'].append(slot_result)
                result['slotsProcessed'] += 1
            
            logger.info(f"Camera {camera_id}: Processed {result['slotsProcessed']} slots "
                       f"(workers: {len(worker_tag_slots)}, scanners: {len(scanner_grid_slots)}, "
                       f"tools_cm: {len(slots_with_cm)}, tools_legacy: {len(legacy_slots)})")
            
        except Exception as e:
            result['status'] = 'failed'
            result['errors'].append(f'Processing exception: {str(e)}')
            logger.error(f"Camera {camera_id}: Exception: {e}")
        
        return result
    
    def process_all(self, cameras: List[Dict[str, Any]], 
                   slots_by_camera: Dict[str, List[Dict[str, Any]]],
                   light_strip_pin: Optional[int] = None) -> Dict[str, Any]:
        """
        Process all cameras
        
        Args:
            cameras: List of camera configurations
            slots_by_camera: Slots grouped by camera ID
            light_strip_pin: GPIO pin for LED light strip (optional)
            
        Returns:
            Overall processing result
        """
        logger.info(f"Starting capture processing for {len(cameras)} cameras")
        
        # Turn on light strip for consistent lighting
        if light_strip_pin:
            control_light(light_strip_pin, "on")
            import time
            time.sleep(0.5)  # Brief delay to let light stabilize
        
        results = []
        total_slots = 0
        total_cameras_success = 0
        total_cameras_failed = 0
        
        try:
            for i, camera in enumerate(cameras):
                camera_id = camera.get('id')
                if not camera_id:
                    logger.warning("Camera missing 'id' field, skipping")
                    continue
                    
                camera_name = camera.get('name', camera_id)
                logger.info(f"[SEQUENTIAL] Processing camera {i+1}/{len(cameras)}: {camera_name}")
                
                camera_slots = slots_by_camera.get(camera_id, [])
                
                try:
                    result = self.process_camera(camera, camera_slots)
                    results.append(result)
                    
                    total_slots += result['slotsProcessed']
                    
                    if result['status'] == 'success':
                        total_cameras_success += 1
                    else:
                        total_cameras_failed += 1
                        
                except Exception as e:
                    logger.error(f"[SEQUENTIAL] Error processing camera {camera_name}: {e}")
                    total_cameras_failed += 1
                    results.append({
                        'cameraId': camera_id,
                        'status': 'failed',
                        'errors': [f'Processing exception: {str(e)}']
                    })
                
                finally:
                    # CRITICAL: Resource cleanup after each camera to prevent memory leaks
                    import gc
                    gc.collect()  # Force garbage collection to free camera resources
                    logger.info(f"[SEQUENTIAL] Completed camera {camera_name}, resources cleaned")
                    
                    # CRITICAL: 30-second delay before next camera to prevent resource conflicts
                    if i < len(cameras) - 1:
                        logger.info(f"[SEQUENTIAL] Waiting 30 seconds before processing next camera...")
                        time.sleep(30)
                        logger.info(f"[SEQUENTIAL] Resource cleanup complete, ready for next camera")
        finally:
            # Always turn off light strip after captures
            if light_strip_pin:
                control_light(light_strip_pin, "off")
        
        overall_status = 'success'
        if total_cameras_failed > 0:
            if total_cameras_success == 0:
                overall_status = 'failure'
            else:
                overall_status = 'partial_failure'
        
        summary = {
            'status': overall_status,
            'camerasCaptured': total_cameras_success,
            'slotsProcessed': total_slots,
            'failureCount': total_cameras_failed,
            'results': results
        }
        
        logger.info(f"Processing complete: {overall_status} ({total_cameras_success} cameras, {total_slots} slots)")
        
        return summary


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Process camera captures')
    parser.add_argument('--input', type=str, help='Path to JSON input file (alternative to stdin)')
    args = parser.parse_args()
    
    try:
        # Read input data from file (preferred) or stdin (fallback)
        if args.input:
            with open(args.input, 'r') as f:
                input_data = f.read()
            logger.info(f"Read input from file: {args.input}")
        else:
            input_data = sys.stdin.read()
            logger.info("Read input from stdin")
        
        data = json.loads(input_data)
        
        cameras = data.get('cameras', [])
        slots_by_camera = data.get('slotsByCamera', {})
        light_strip_pin = data.get('lightStripPin')  # Optional GPIO pin for light strip
        
        # Process all cameras
        processor = CameraProcessor()
        results = processor.process_all(cameras, slots_by_camera, light_strip_pin)
        
        # Output results as JSON
        print(json.dumps(results))
        
        # Exit code based on status
        if results['status'] == 'failure':
            sys.exit(1)
        elif results['status'] == 'partial_failure':
            sys.exit(2)
        else:
            sys.exit(0)
        
    except Exception as e:
        error_result = {
            'status': 'failure',
            'error': str(e),
            'message': 'Capture processing script error'
        }
        print(json.dumps(error_result))
        logger.error(f"Processing script error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
