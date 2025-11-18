#!/usr/bin/env python3
"""
Query camera capabilities and supported resolutions
"""

import sys
import argparse

try:
    from picamera2 import Picamera2
    PICAMERA2_AVAILABLE = True
except ImportError:
    PICAMERA2_AVAILABLE = False
    print("ERROR: Picamera2 not available. This only works on Raspberry Pi.")
    sys.exit(1)

def check_camera_capabilities(camera_index=0):
    """
    Check what resolutions and formats a camera supports
    """
    print(f"\n=== Checking Camera {camera_index} Capabilities ===\n")
    
    try:
        picam2 = Picamera2(camera_index)
        
        # Get sensor modes (native resolutions)
        print("📹 SENSOR MODES (Native Resolutions):")
        print("-" * 60)
        sensor_modes = picam2.sensor_modes
        for i, mode in enumerate(sensor_modes):
            size = mode.get('size', 'Unknown')
            fmt = mode.get('format', 'Unknown')
            fps = mode.get('fps', 'Unknown')
            print(f"  Mode {i}: {size[0]}x{size[1]} @ {fps} fps - Format: {fmt}")
        
        print("\n🎥 STREAM CONFIGURATIONS:")
        print("-" * 60)
        
        # Try common resolutions to see what works
        test_resolutions = [
            (3840, 2160, "4K UHD"),
            (2560, 1440, "2K QHD"),
            (1920, 1080, "Full HD"),
            (1280, 720, "HD"),
            (640, 480, "VGA"),
        ]
        
        supported = []
        for width, height, name in test_resolutions:
            try:
                # Try to create a configuration with this resolution
                config = picam2.create_video_configuration(
                    main={"size": (width, height), "format": "RGB888"}
                )
                supported.append(f"  ✓ {width}x{height} ({name})")
            except Exception as e:
                print(f"  ✗ {width}x{height} ({name}) - Not supported")
        
        if supported:
            print("\n✅ SUPPORTED RESOLUTIONS:")
            for res in supported:
                print(res)
        
        # Get camera properties
        print("\n📋 CAMERA PROPERTIES:")
        print("-" * 60)
        props = picam2.camera_properties
        if 'Model' in props:
            print(f"  Model: {props['Model']}")
        if 'PixelArraySize' in props:
            size = props['PixelArraySize']
            print(f"  Pixel Array Size: {size[0]}x{size[1]}")
        if 'UnitCellSize' in props:
            cell = props['UnitCellSize']
            print(f"  Unit Cell Size: {cell[0]/1000:.2f}µm x {cell[1]/1000:.2f}µm")
        
        picam2.close()
        
    except Exception as e:
        print(f"ERROR: Failed to query camera {camera_index}: {e}")
        sys.exit(1)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Check camera capabilities')
    parser.add_argument('--camera', type=int, default=0, help='Camera index (0 or 1)')
    args = parser.parse_args()
    
    check_camera_capabilities(args.camera)
