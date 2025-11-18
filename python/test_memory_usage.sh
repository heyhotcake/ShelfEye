#!/bin/bash
# Test validation at 100 px/cm and monitor memory usage

echo "Testing QR validation at 100 px/cm with memory monitoring..."
echo "============================================================"
echo ""

# Run validation with memory monitoring
/usr/bin/time -v python3 python/validate_slot_qrs.py \
  --camera-id "test" \
  --mode visible \
  --homography "$(cat <<EOF
[19.346718838082637, -0.700306621762764, 117.93567085184503, 1.0929139534157435, 18.34922496796555, 121.45645672334406, 0.0005602327474801203, 0.00017450428179071188, 1]
EOF
)" \
  --camera-matrix "$(cat <<EOF
[1536, 0, 960, 0, 1536, 540, 0, 0, 1]
EOF
)" \
  --dist-coeffs "$(cat <<EOF
[0, 0, 0, 0, 0]
EOF
)" \
  --paper-size "89.1,42.0" \
  --slots "$(cat <<EOF
[
  {"slot_id": "slot1", "expected_qr_id": "SLOT-001", "x_cm": 14.9, "y_cm": 7.0, "width_cm": 3.0, "height_cm": 3.0, "rotation": 0},
  {"slot_id": "slot2", "expected_qr_id": "SLOT-002", "x_cm": 29.8, "y_cm": 7.0, "width_cm": 3.0, "height_cm": 3.0, "rotation": 0},
  {"slot_id": "slot3", "expected_qr_id": "SLOT-003", "x_cm": 44.7, "y_cm": 7.0, "width_cm": 3.0, "height_cm": 3.0, "rotation": 0},
  {"slot_id": "slot4", "expected_qr_id": "SLOT-004", "x_cm": 59.6, "y_cm": 7.0, "width_cm": 3.0, "height_cm": 3.0, "rotation": 0},
  {"slot_id": "slot5", "expected_qr_id": "SLOT-005", "x_cm": 14.9, "y_cm": 28.0, "width_cm": 3.0, "height_cm": 3.0, "rotation": 0},
  {"slot_id": "slot6", "expected_qr_id": "SLOT-006", "x_cm": 29.8, "y_cm": 28.0, "width_cm": 3.0, "height_cm": 3.0, "rotation": 0},
  {"slot_id": "slot7", "expected_qr_id": "SLOT-007", "x_cm": 44.7, "y_cm": 28.0, "width_cm": 3.0, "height_cm": 3.0, "rotation": 0}
]
EOF
)" 2>&1 | tee /tmp/validation_memory_test.log

echo ""
echo "============================================================"
echo "Checking memory usage from log..."
grep -i "Maximum resident set size" /tmp/validation_memory_test.log || echo "Memory info not found"
echo ""
echo "Checking validation output image dimensions..."
if [ -f debug_images/validation_rectified_debug.jpg ]; then
  python3 -c "
from PIL import Image
img = Image.open('debug_images/validation_rectified_debug.jpg')
print(f'Image: {img.size[0]}x{img.size[1]} pixels')
print(f'Size: {img.size[0]*img.size[1]/1e6:.1f} megapixels')
print(f'Resolution: {img.size[0]/89.1:.1f} px/cm width, {img.size[1]/42.0:.1f} px/cm height')
"
fi
