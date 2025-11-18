#!/usr/bin/env python3
"""
Get image dimensions
Usage: python get_image_size.py <image_path>
Output: width,height
"""

import sys
import cv2

def get_image_size(image_path):
    """Get image dimensions"""
    img = cv2.imread(image_path)
    if img is None:
        print("0,0", file=sys.stderr)
        sys.exit(1)
    
    height, width = img.shape[:2]
    print(f"{width},{height}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python get_image_size.py <image_path>", file=sys.stderr)
        sys.exit(1)
    
    get_image_size(sys.argv[1])
