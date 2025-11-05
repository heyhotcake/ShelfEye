#!/usr/bin/env python3
"""
Generate a fresh ArUco marker and compare it to the ROI image
"""

import cv2
import sys
import numpy as np

# Generate marker ID 2 with our code
aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
fresh_marker = cv2.aruco.generateImageMarker(aruco_dict, 2, 200)

# Load the ROI image
roi_image = cv2.imread('/home/naniwa/ShelfEye/data/validation_roi_2.jpg', cv2.IMREAD_GRAYSCALE)

print(f"Fresh marker shape: {fresh_marker.shape}")
print(f"ROI marker shape: {roi_image.shape}")

# Resize fresh marker to match ROI size for comparison
fresh_resized = cv2.resize(fresh_marker, (roi_image.shape[1], roi_image.shape[0]), interpolation=cv2.INTER_NEAREST)

# Save both for visual comparison
cv2.imwrite('/home/naniwa/ShelfEye/data/debug_fresh_marker.jpg', fresh_resized)
cv2.imwrite('/home/naniwa/ShelfEye/data/debug_roi_marker.jpg', roi_image)

print(f"\nSaved for comparison:")
print(f"  Fresh: /home/naniwa/ShelfEye/data/debug_fresh_marker.jpg")
print(f"  ROI:   /home/naniwa/ShelfEye/data/debug_roi_marker.jpg")

# Binarize both images
_, fresh_binary = cv2.threshold(fresh_resized, 127, 255, cv2.THRESH_BINARY)
_, roi_binary = cv2.threshold(roi_image, 127, 255, cv2.THRESH_BINARY)

# Calculate difference
diff = cv2.absdiff(fresh_binary, roi_binary)
diff_pixels = np.count_nonzero(diff)
total_pixels = diff.size
similarity = 100 * (1 - diff_pixels / total_pixels)

print(f"\nBinary comparison:")
print(f"  Different pixels: {diff_pixels}/{total_pixels}")
print(f"  Similarity: {similarity:.1f}%")

if similarity > 95:
    print(f"  ✓ Markers are nearly identical!")
elif similarity > 80:
    print(f"  ~ Markers are similar but have some differences")
else:
    print(f"  ✗ Markers are VERY different - may be wrong encoding")

# Try to decode the FRESH marker to verify our generator works
aruco_params = cv2.aruco.DetectorParameters()
aruco_params.perspectiveRemovePixelPerCell = 16
corners, ids, rejected = cv2.aruco.detectMarkers(fresh_marker, aruco_dict, parameters=aruco_params)

print(f"\nFresh marker detection test:")
print(f"  Detected: {len(ids) if ids is not None else 0} markers")
if ids is not None and len(ids) > 0:
    print(f"  IDs: {ids.flatten().tolist()}")
    print(f"  ✓ Our generator produces valid markers")
else:
    print(f"  ✗ WARNING: Even fresh markers fail to decode!")
