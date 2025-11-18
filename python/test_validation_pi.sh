#!/bin/bash
# Test validation script on Raspberry Pi

echo "Testing QR validation on Raspberry Pi..."
echo "========================================"

# Get the latest homography and paper size from database
CAMERA_ID="f0302a62-d361-4134-86cc-f8c8558226c0"

# Run validation with debug output
cd ~/ShelfEye

# Test if camera can be opened
echo "1. Testing camera access..."
python3 -c "
import cv2
cap = cv2.VideoCapture(0)
if cap.isOpened():
    print('✓ Camera opened successfully')
    cap.release()
else:
    print('✗ Failed to open camera')
"

echo ""
echo "2. Running validation script..."
python3 python/validate_slot_qrs.py $CAMERA_ID visible 2>&1

echo ""
echo "3. Checking debug images..."
if [ -f "debug_images/validation_rectified_debug.jpg" ]; then
    echo "✓ Debug image created: debug_images/validation_rectified_debug.jpg"
    # Check image size and QR detection
    python3 -c "
import cv2
from pyzbar import pyzbar
img = cv2.imread('debug_images/validation_rectified_debug.jpg')
if img is not None:
    print(f'  Image size: {img.shape[1]}x{img.shape[0]} pixels')
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    qrs = pyzbar.decode(gray)
    print(f'  Basic QR detection: {len(qrs)} QRs found')
    for qr in qrs:
        print(f'    - {qr.data.decode()}')
"
else
    echo "✗ Debug image not created"
fi