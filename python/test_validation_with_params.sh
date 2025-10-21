#!/bin/bash
# Test validation with proper parameters like the backend sends

echo "Testing validation with calibration parameters..."
echo "================================================"

# Get calibration data from database
CAMERA_ID="f0302a62-d361-4134-86cc-f8c8558226c0"

# First, get the homography matrix from the database
echo "1. Getting calibration data from database..."
psql $DATABASE_URL -t -A -c "
SELECT homography_matrix FROM cameras WHERE id = '$CAMERA_ID';
" > /tmp/homography.txt

HOMOGRAPHY=$(cat /tmp/homography.txt)

if [ -z "$HOMOGRAPHY" ]; then
    echo "ERROR: No homography matrix found in database"
    exit 1
fi

echo "Found homography matrix"

# Get slots data
psql $DATABASE_URL -t -A -c "
SELECT json_agg(json_build_object(
    'slot_id', slot_id,
    'expected_qr_id', expected_qr_id,
    'x_cm', x_cm,
    'y_cm', y_cm,
    'width_cm', width_cm,
    'height_cm', height_cm
))::text
FROM slots WHERE camera_id = '$CAMERA_ID';
" > /tmp/slots.txt

SLOTS=$(cat /tmp/slots.txt)

echo "Found slots configuration"

# Run validation with all parameters like the backend does
echo ""
echo "2. Running validation with full parameters..."
python3 python/validate_slot_qrs.py \
    --resolution "1920x1080" \
    --homography "$HOMOGRAPHY" \
    --slots "$SLOTS" \
    --should-detect "true" \
    --paper-width-cm 89.1 \
    --paper-height-cm 42.0 \
    --device-path "/dev/video0" 2>&1

echo ""
echo "3. Check rectified image..."
if [ -f debug_images/validation_rectified_debug.jpg ]; then
    echo "✓ Rectified debug image created"
    python3 -c "
import cv2
from pyzbar import pyzbar
img = cv2.imread('debug_images/validation_rectified_debug.jpg')
print(f'Size: {img.shape[1]}x{img.shape[0]} px')
print(f'Resolution: {img.shape[1]/89.1:.0f} px/cm')

# Try different preprocessing
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
_, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)

methods = [
    ('original', img),
    ('grayscale', gray),
    ('threshold', thresh)
]

all_qrs = set()
for name, proc in methods:
    qrs = pyzbar.decode(proc)
    for qr in qrs:
        all_qrs.add(qr.data.decode())

print(f'Found {len(all_qrs)} unique QRs: {sorted(list(all_qrs))}')
"
else
    echo "✗ No rectified image created"
fi