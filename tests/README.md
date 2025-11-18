# Multi-Camera E2E Test Suite

Comprehensive testing framework for ShelfEye multi-camera tool tracking system.

## Overview

This test suite validates multi-camera operation including:
- Sequential calibration without crashes
- Sequential detection with mandatory delays
- Resource usage limits (RAM < 1.5GB)
- Camera identification in alerts
- File collision prevention
- 24-hour stability testing

## Prerequisites

### Hardware Requirements
- Raspberry Pi with 2GB+ RAM
- 2+ USB cameras connected
- v4l-utils installed: `sudo apt-get install v4l-utils`
- bc calculator: `sudo apt-get install bc`

### Software Requirements
- Node.js application running on port 5000
- PostgreSQL database configured
- Python 3 with required packages

## Test Scripts

### 1. Quick E2E Tests (`test-multi-camera-e2e.sh`)

Runs static code validation and quick checks.

**Usage:**
```bash
cd tests
chmod +x test-multi-camera-e2e.sh
./test-multi-camera-e2e.sh
```

**What it tests:**
- ✅ Database schema includes multi-camera fields
- ✅ Python scripts accept --camera-id parameter
- ✅ ROI files use camera-scoped subdirectories
- ✅ Sequential processing enforced in process_cameras.py
- ✅ Alerts include camera names
- ✅ No file collisions

**Expected output:**
```
==================================================================
Test Summary
==================================================================
Passed:  7
Failed:  0
Skipped: 2
==================================================================
[✓] All tests passed!
```

### 2. 24-Hour Stability Test (`test-24h-stability.sh`)

Monitors system health over extended period.

**Usage:**
```bash
cd tests
chmod +x test-24h-stability.sh

# Run 24-hour test
./test-24h-stability.sh 24

# Run shorter test (e.g., 2 hours for quick validation)
./test-24h-stability.sh 2
```

**What it monitors:**
- RAM usage every 5 minutes
- Python process memory
- Disk usage growth
- USB errors from dmesg
- Application errors
- File integrity (checksums)
- Memory leak detection

**Outputs:**
- `logs/stability/` - Detailed logs
- `metrics/stability/` - CSV files with metrics

**Pass criteria:**
- Peak RAM < 1500MB
- No memory leaks (< 50% growth)
- No USB errors
- No crashes or critical errors

## Test Checkpoints

### ✅ Sequential Calibration
**Manual test required:**
1. Open calibration UI for Camera 1
2. Start calibration
3. Try to start calibration for Camera 2
4. **Expected:** Camera 2 shows "Another camera is calibrating" error
5. Wait for Camera 1 to complete
6. Start Camera 2 calibration
7. **Expected:** Camera 2 calibrates successfully

**Verification:**
```bash
grep "Global calibration lock" logs/*.log
```

### ✅ Sequential Detection
**Automated via scheduler:**
1. Ensure 2+ cameras are active in database
2. Trigger manual capture:
   ```bash
   curl -X POST http://localhost:5000/api/scheduler/trigger
   ```
3. **Expected:** Logs show:
   ```
   [SEQUENTIAL] Processing camera 1/2: Camera Name 1
   [SEQUENTIAL] Completed camera Camera Name 1, resources cleaned
   [SEQUENTIAL] Waiting 30 seconds before processing next camera...
   [SEQUENTIAL] Processing camera 2/2: Camera Name 2
   ```

**Verification:**
```bash
grep "\[SEQUENTIAL\]" logs/*.log
```

### ✅ RAM Usage < 1.5GB
**Automated during 24h test:**
- Monitored every 5 minutes
- Fails if Python processes exceed 1500MB

**Manual check:**
```bash
ps aux | grep python3 | awk '{print $6/1024 " MB - " $11}'
```

### ✅ No USB Errors
**Automated check:**
```bash
dmesg | grep -i "usb.*error\|input/output error"
```
**Expected:** No output

### ✅ Alerts Include Camera Names
**Automated validation:**
- Checks email-alerts.ts includes cameraName
- Checks sheets-logger.ts includes cameraName column
- Checks scheduler.ts passes camera info

**Manual verification:**
1. Trigger test alert:
   ```bash
   curl -X POST http://localhost:5000/api/alerts/test
   ```
2. Check email subject includes camera name
3. Check Google Sheets has "Camera" column

### ✅ Google Sheets Camera Column
**Check sheet structure:**
1. Open configured Google Sheet
2. **Expected columns:**
   - Timestamp
   - **Camera** (user-friendly name)
   - Alert Type
   - Status
   - Camera ID (UUID)
   - Slot ID
   - Error Message
   - Details

### ✅ No File Collisions
**Automated check:**
```bash
ls -la data/rois/
```
**Expected structure:**
```
data/rois/
├── camera-1-uuid/
│   ├── slot1_last.png
│   └── slot2_last.png
└── camera-2-uuid/
    ├── slot1_last.png  # Same filename, different directory ✓
    └── slot2_last.png
```

## Running Full Test Suite

### Complete Validation Flow

```bash
#!/bin/bash
# Complete multi-camera validation

# 1. Quick static checks
./test-multi-camera-e2e.sh

# 2. Start 24-hour stability test
./test-24h-stability.sh 24 &
STABILITY_PID=$!

# 3. Manual calibration test (while stability runs)
echo "Perform manual calibration test now..."
read -p "Press Enter when calibration test complete..."

# 4. Trigger scheduled capture and check logs
curl -X POST http://localhost:5000/api/scheduler/trigger
sleep 120  # Wait for capture to complete

grep "\[SEQUENTIAL\]" ../logs/*.log

# 5. Trigger test alert
curl -X POST http://localhost:5000/api/alerts/test

# 6. Check alerts
echo "Check your email and Google Sheets for alert with camera name"
read -p "Press Enter when verified..."

# 7. Wait for stability test
wait $STABILITY_PID
```

## Troubleshooting

### Test fails: "v4l2-ctl not found"
```bash
sudo apt-get install v4l-utils
```

### Test fails: "No cameras detected"
```bash
# Check connected cameras
ls -la /dev/video*

# Verify camera works
v4l2-ctl --list-devices
```

### RAM limit exceeded
- Check for memory leaks in Python processes
- Reduce camera resolution if needed
- Increase delay between cameras

### USB errors in dmesg
```bash
# Check USB power
vcgencmd get_throttled

# Check USB controller
lsusb -t

# Reboot if needed
sudo reboot
```

### File collisions detected
- Verify camera-scoped ROI directories exist
- Check Python scripts use --camera-id parameter
- Ensure database has unique camera IDs

## Continuous Integration

For automated testing in CI/CD:

```yaml
# .github/workflows/e2e-tests.yml
name: Multi-Camera E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run static tests
        run: |
          cd tests
          chmod +x test-multi-camera-e2e.sh
          ./test-multi-camera-e2e.sh
```

## Test Results Archive

Store test results for regression analysis:

```bash
# Archive test results
mkdir -p test-results/$(date +%Y%m%d)
cp tests/logs/*.log test-results/$(date +%Y%m%d)/
cp tests/metrics/*.csv test-results/$(date +%Y%m%d)/
```

## Support

For issues or questions:
1. Check logs in `tests/logs/`
2. Review metrics in `tests/metrics/`
3. Verify hardware with `v4l2-ctl --list-devices`
4. Check application logs in project root

---

**Last Updated:** 2025-01-11  
**Test Suite Version:** 1.0.0
