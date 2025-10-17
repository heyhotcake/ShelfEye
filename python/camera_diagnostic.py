#!/usr/bin/env python3
"""
Camera Diagnostic Script
Performs health checks on all cameras before scheduled captures.
Returns status for each camera: accessible, calibrated, can capture.
"""

import cv2
import sys
import json
import logging
from typing import Dict, List, Any
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class CameraDiagnostic:
    """Diagnostic checks for camera health"""
    
    def __init__(self):
        self.results = []
    
    def check_camera(self, camera_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Perform diagnostic checks on a single camera
        
        Args:
            camera_data: Camera configuration dict with id, deviceIndex, devicePath, resolution, homographyMatrix
            
        Returns:
            Diagnostic result with status and details
        """
        camera_id = camera_data.get('id')
        device_index = camera_data.get('deviceIndex', 0)
        device_path = camera_data.get('devicePath')
        resolution = camera_data.get('resolution', [1920, 1080])
        homography_matrix = camera_data.get('homographyMatrix')
        
        # Use device path if available (Raspberry Pi), otherwise use index
        camera_source = device_path if device_path else device_index
        
        result = {
            'cameraId': camera_id,
            'status': 'healthy',
            'errors': [],
            'warnings': [],
            'details': {}
        }
        
        try:
            # Check 1: Camera is accessible
            logger.info(f"Checking camera {camera_id} (source {camera_source})...")
            cap = cv2.VideoCapture(camera_source)
            
            if not cap.isOpened():
                result['status'] = 'failed'
                result['errors'].append(f'Cannot open camera source {camera_source}')
                logger.error(f"Camera {camera_id}: Cannot open source {camera_source}")
                return result
            
            result['details']['accessible'] = True
            
            # Check 2: Set resolution
            width, height = resolution
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            
            actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            
            if actual_width != width or actual_height != height:
                result['warnings'].append(
                    f'Resolution mismatch: requested {width}x{height}, got {actual_width}x{actual_height}'
                )
                logger.warning(f"Camera {camera_id}: Resolution mismatch")
            
            result['details']['resolution'] = [actual_width, actual_height]
            
            # Check 3: Capture test frame
            ret, frame = cap.read()
            if not ret or frame is None:
                result['status'] = 'failed'
                result['errors'].append('Cannot capture frame from camera')
                logger.error(f"Camera {camera_id}: Cannot capture frame")
                cap.release()
                return result
            
            result['details']['frameSize'] = list(frame.shape)
            result['details']['canCapture'] = True
            
            # Check 4: Homography matrix (calibration)
            if homography_matrix is None or len(homography_matrix) == 0:
                result['status'] = 'warning'
                result['warnings'].append('Camera not calibrated (missing homography matrix)')
                logger.warning(f"Camera {camera_id}: Not calibrated")
                result['details']['calibrated'] = False
            else:
                result['details']['calibrated'] = True
            
            # Cleanup
            cap.release()
            
            # Final status
            if len(result['errors']) > 0:
                result['status'] = 'failed'
            elif len(result['warnings']) > 0:
                result['status'] = 'warning'
            else:
                result['status'] = 'healthy'
            
            logger.info(f"Camera {camera_id}: {result['status']}")
            
        except Exception as e:
            result['status'] = 'failed'
            result['errors'].append(f'Diagnostic exception: {str(e)}')
            logger.error(f"Camera {camera_id}: Exception during diagnostic: {e}")
        
        return result
    
    def run_diagnostics(self, cameras: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Run diagnostics on all cameras
        
        Args:
            cameras: List of camera configuration dicts
            
        Returns:
            Overall diagnostic results
        """
        logger.info(f"Starting diagnostics for {len(cameras)} cameras")
        
        results = []
        healthy_count = 0
        warning_count = 0
        failed_count = 0
        
        for camera in cameras:
            result = self.check_camera(camera)
            results.append(result)
            
            if result['status'] == 'healthy':
                healthy_count += 1
            elif result['status'] == 'warning':
                warning_count += 1
            else:
                failed_count += 1
        
        overall_status = 'healthy'
        if failed_count > 0:
            overall_status = 'failed'
        elif warning_count > 0:
            overall_status = 'warning'
        
        summary = {
            'status': overall_status,
            'totalCameras': len(cameras),
            'healthy': healthy_count,
            'warnings': warning_count,
            'failed': failed_count,
            'results': results
        }
        
        logger.info(f"Diagnostics complete: {overall_status} ({healthy_count} healthy, {warning_count} warnings, {failed_count} failed)")
        
        return summary


def main():
    """Main entry point"""
    try:
        # Read camera data from stdin (JSON array)
        input_data = sys.stdin.read()
        cameras = json.loads(input_data)
        
        if not isinstance(cameras, list):
            raise ValueError("Expected array of camera objects")
        
        # Run diagnostics
        diagnostic = CameraDiagnostic()
        results = diagnostic.run_diagnostics(cameras)
        
        # Output results as JSON
        print(json.dumps(results))
        
        # Exit code based on overall status
        if results['status'] == 'failed':
            sys.exit(1)
        elif results['status'] == 'warning':
            sys.exit(2)
        else:
            sys.exit(0)
        
    except Exception as e:
        error_result = {
            'status': 'failed',
            'error': str(e),
            'message': 'Diagnostic script error'
        }
        print(json.dumps(error_result))
        logger.error(f"Diagnostic script error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
