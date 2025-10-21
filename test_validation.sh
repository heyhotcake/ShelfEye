#!/bin/bash

# Test script to manually run QR validation and see errors
# Run this on your Raspberry Pi: bash test_validation.sh

cd ~/ShelfEye

# Get camera info from database (assuming camera ID from your setup)
CAMERA_ID="f0302a62-d361-4134-86cc-f8c8558226c0"

# Test with minimal args to see if script runs
python3 python/validate_slot_qrs.py \
  --device-path /dev/video0 \
  --resolution 1920x1080 \
  --homography '[[-0.44117647058823534, 0.04411764705882353, 838.5294117647059], [0.8529411764705883, -0.019607843137254943, -52.94117647058824], [0.0009803921568627454, -4.901960784313726e-05, 1]]' \
  --slots '[{"id":"pen-001","slotId":"test","toolName":"test","x":19.5,"y":15,"width":4,"height":4,"rotation":0}]' \
  --should-detect true \
  --paper-width-cm 88.8 \
  --paper-height-cm 42.0 \
  2>&1

echo ""
echo "Exit code: $?"
