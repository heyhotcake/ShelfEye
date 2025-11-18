# 4K Camera Upgrade Guide

## Overview

This guide walks you through upgrading from your current 1920x1080 camera to a true 4K camera (3840x2160).

**Benefits:**
- 4x more pixels for QR detection
- Faster validation (2-3 min vs 5-10 min currently)
- Higher detection success rate
- Can simplify post-processing later

---

## Step 1: Verify Your New 4K Camera

Before buying, make sure the camera supports **3840x2160 in MJPG format** (not just YUYV).

### After You Receive the Camera

**Plug it into your Pi and test:**

```bash
ssh naniwa@naniwatanacheck.local

# Check what the camera actually supports
v4l2-ctl --device=/dev/video0 --list-formats-ext

# Look for this in the output:
#   [0]: 'MJPG' (Motion-JPEG, compressed)
#       Size: Discrete 3840x2160
#           Interval: Discrete 0.033s (30.000 fps)  # or 15-30fps
```

**✅ If you see 3840x2160 in MJPG format → Good to go!**  
**❌ If only YUYV format → Return it, won't work well**

---

## Step 2: Update Camera Resolution in Database

After confirming 4K works, update the database:

```bash
ssh naniwa@naniwatanacheck.local
cd /home/naniwa/ShelfEye

# Open database CLI
psql $DATABASE_URL

# Update your camera's resolution to 4K
UPDATE cameras 
SET resolution = '[3840, 2160]'::json 
WHERE device_path = '/dev/video0';

# Verify the change
SELECT id, name, resolution FROM cameras;

# Exit
\q
```

---

## Step 3: Re-Calibrate with 4K Camera

**IMPORTANT:** You MUST re-calibrate after changing cameras. The homography matrix is tied to the camera resolution.

1. Go to web UI: `http://naniwatanacheck.local:5000`
2. Navigate to **Calibration** page
3. Select your camera
4. Choose resolution: **3840x2160**
5. Print the ArUco markers (if not already printed)
6. Run calibration
7. Verify all 4 corner markers are detected
8. Create/update template slots

---

## Step 4: Test QR Validation

After calibration, test that QR detection works:

1. Place QR codes in slots
2. Run validation from web UI
3. Check validation time (should be **2-3 minutes** vs 5-10 currently)
4. Verify all QR codes are detected

Monitor the logs:
```bash
sudo journalctl -u shelfeye.service -f | grep -i "validation\|qr"
```

---

## Step 5: Monitor Performance

**First 24 hours after upgrade:**

Check system logs to ensure everything is stable:
```bash
# Watch for errors
sudo journalctl -u shelfeye.service -f

# Check memory usage (4K images are larger)
free -h

# Check disk space (might fill faster with 4K debug images)
df -h
```

**Expected changes:**
- ✅ Faster validation (2-3 min)
- ✅ Higher QR detection success rate
- ⚠️ Slightly higher memory usage (larger images)
- ⚠️ Debug images 4x larger (monitor disk space)

---

## Step 6: Optimization Phase (After Confirming It Works)

Once you've confirmed the 4K camera works well for 1-2 weeks, we can **simplify the code** by removing redundant post-processing:

### Current Post-Processing (Kept for Now):
1. ✅ Multi-scale detection (1x, 2x, 3x upscaling)
2. ✅ Multiple detection methods (binary, grayscale, adaptive thresholds)
3. ✅ Sharpness-based frame selection (captures 5 frames, picks sharpest)

### What We Can Potentially Remove (After Testing):
1. ⚠️ **3x upscaling** - Probably unnecessary with 4K native resolution
2. ⚠️ **Some threshold methods** - Might detect on first try with higher res
3. ⚠️ **Extra frame captures** - May not need 5 frames if quality is good

**We'll evaluate this after you have real-world data from the 4K camera.**

---

## Troubleshooting

### Camera Not Detected at 4K

**Check actual capabilities:**
```bash
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

If 4K not listed → camera doesn't support it (false advertising)

### Calibration Fails at 4K

**Memory issue** - 4K calibration uses more RAM:
```bash
# Check available memory
free -h

# If low, temporarily stop other processes
sudo systemctl stop shelfeye.service

# Run calibration manually
# Then restart service
sudo systemctl start shelfeye.service
```

### Validation Times Haven't Improved

Possible causes:
1. Camera still falling back to 1920x1080 (check logs for actual resolution)
2. Need to remove redundant post-processing (Step 6 above)
3. Pi CPU bottleneck (less likely, but check `top` during validation)

---

## Quick Reference Commands

```bash
# Check what camera supports
v4l2-ctl --device=/dev/video0 --list-formats-ext

# Update camera resolution in database
psql $DATABASE_URL -c "UPDATE cameras SET resolution = '[3840, 2160]'::json WHERE device_path = '/dev/video0';"

# View current camera config
psql $DATABASE_URL -c "SELECT id, name, resolution FROM cameras;"

# Monitor validation performance
sudo journalctl -u shelfeye.service -f | grep -i "validation\|detected"

# Check system resources
free -h && df -h
```

---

## Expected Timeline

- **Day 1:** Camera arrives, verify 4K support, update database
- **Day 2:** Re-calibrate with 4K, test validation
- **Week 1:** Monitor performance and stability
- **Week 2-4:** Evaluate if we can simplify post-processing
- **Month 2+:** Fully optimized system with simplified code

---

## What NOT to Do

❌ Don't skip re-calibration (old homography won't work with new camera)  
❌ Don't assume 4K works in MJPG (verify with v4l2-ctl first)  
❌ Don't remove post-processing immediately (wait for real-world data)  
❌ Don't forget to update database resolution (or Python will fall back to defaults)

---

## Questions?

After you buy the camera and test it, let me know:
1. What model did you get?
2. Does `v4l2-ctl` show 3840x2160 in MJPG?
3. What's the actual validation time after upgrade?

Then we can optimize further based on real performance data!
