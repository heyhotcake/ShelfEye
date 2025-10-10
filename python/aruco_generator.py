#!/usr/bin/env python3
"""
ArUco Marker Generator for Print Templates
Generates ArUco markers for GridBoard calibration patterns
"""

import argparse
import json
import sys
import base64
from io import BytesIO
import numpy as np
import cv2

def generate_aruco_marker(marker_id: int, marker_size: int = 200, dictionary_type=cv2.aruco.DICT_4X4_100):
    """
    Generate a single ArUco marker image
    
    Args:
        marker_id: ID of the marker to generate
        marker_size: Size of the marker in pixels
        dictionary_type: ArUco dictionary type
        
    Returns:
        Base64 encoded PNG image
    """
    try:
        aruco_dict = cv2.aruco.getPredefinedDictionary(dictionary_type)
        marker_img = cv2.aruco.generateImageMarker(aruco_dict, marker_id, marker_size)
        
        # Convert to PNG and encode as base64
        success, buffer = cv2.imencode('.png', marker_img)
        if not success:
            raise Exception("Failed to encode marker image")
        
        png_bytes = buffer.tobytes()
        base64_str = base64.b64encode(png_bytes).decode('utf-8')
        
        return base64_str
    except Exception as e:
        raise Exception(f"Error generating marker {marker_id}: {e}")

def generate_aruco_grid(markers_x: int = 6, markers_y: int = 10, 
                       marker_length_cm: float = 5.0, 
                       marker_separation_cm: float = 1.0,
                       dictionary_type=cv2.aruco.DICT_4X4_100):
    """
    Generate ArUco GridBoard image for printing
    
    Args:
        markers_x: Number of markers in x direction
        markers_y: Number of markers in y direction
        marker_length_cm: Size of each marker in cm
        marker_separation_cm: Separation between markers in cm
        
    Returns:
        Dictionary with grid layout information and marker images
    """
    try:
        aruco_dict = cv2.aruco.getPredefinedDictionary(dictionary_type)
        
        # Calculate pixels per cm (assuming 300 DPI printing: 300/2.54 ≈ 118 pixels/cm)
        pixels_per_cm = 118
        marker_size_px = int(marker_length_cm * pixels_per_cm)
        separation_px = int(marker_separation_cm * pixels_per_cm)
        
        # Generate markers
        markers = []
        marker_id = 0
        
        for y in range(markers_y):
            for x in range(markers_x):
                marker_img = cv2.aruco.generateImageMarker(aruco_dict, marker_id, marker_size_px)
                
                # Encode as base64
                success, buffer = cv2.imencode('.png', marker_img)
                if success:
                    png_bytes = buffer.tobytes()
                    base64_str = base64.b64encode(png_bytes).decode('utf-8')
                    
                    # Calculate position in cm
                    x_pos_cm = x * (marker_length_cm + marker_separation_cm)
                    y_pos_cm = y * (marker_length_cm + marker_separation_cm)
                    
                    markers.append({
                        'id': marker_id,
                        'x': x,
                        'y': y,
                        'xCm': x_pos_cm,
                        'yCm': y_pos_cm,
                        'sizeCm': marker_length_cm,
                        'image': base64_str
                    })
                    
                marker_id += 1
        
        # Calculate total grid dimensions
        total_width_cm = markers_x * marker_length_cm + (markers_x - 1) * marker_separation_cm
        total_height_cm = markers_y * marker_length_cm + (markers_y - 1) * marker_separation_cm
        
        return {
            'ok': True,
            'markers': markers,
            'gridConfig': {
                'markersX': markers_x,
                'markersY': markers_y,
                'markerLengthCm': marker_length_cm,
                'markerSeparationCm': marker_separation_cm,
                'totalWidthCm': total_width_cm,
                'totalHeightCm': total_height_cm
            }
        }
    except Exception as e:
        return {
            'ok': False,
            'error': str(e)
        }

def main():
    parser = argparse.ArgumentParser(description='ArUco Marker Generator')
    parser.add_argument('--mode', type=str, choices=['single', 'grid'], default='grid', 
                       help='Generation mode: single marker or grid')
    parser.add_argument('--marker-id', type=int, default=0, help='Marker ID for single mode')
    parser.add_argument('--marker-size', type=int, default=200, help='Marker size in pixels for single mode')
    parser.add_argument('--markers-x', type=int, default=6, help='Number of markers in X direction for grid')
    parser.add_argument('--markers-y', type=int, default=10, help='Number of markers in Y direction for grid')
    parser.add_argument('--marker-length-cm', type=float, default=5.0, help='Marker size in cm')
    parser.add_argument('--marker-separation-cm', type=float, default=1.0, help='Marker separation in cm')
    
    args = parser.parse_args()
    
    try:
        if args.mode == 'single':
            base64_image = generate_aruco_marker(args.marker_id, args.marker_size)
            result = {
                'ok': True,
                'markerId': args.marker_id,
                'image': base64_image
            }
            print(json.dumps(result))
        else:  # grid mode
            result = generate_aruco_grid(
                args.markers_x, 
                args.markers_y,
                args.marker_length_cm,
                args.marker_separation_cm
            )
            print(json.dumps(result))
    
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
