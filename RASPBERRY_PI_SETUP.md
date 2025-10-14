# Raspberry Pi Setup Guide

## Current Status
✅ Raspberry Pi OS Lite installed  
✅ SSH connection working  
✅ 1 USB camera connected  

---

## Step 1: Test Camera Device Index

SSH into your Pi and run these commands to check if the camera is detected:

```bash
# List all video devices
ls -l /dev/video*

# Expected output:
# /dev/video0
# /dev/video1  (sometimes cameras create multiple device nodes)
```

### Test Camera with Simple Capture

Install v4l-utils to test the camera:

```bash
# Install video utilities
sudo apt-get update
sudo apt-get install -y v4l-utils

# Check camera capabilities
v4l2-ctl --list-devices

# Example output:
# USB Camera (usb-0000:01:00.0):
#     /dev/video0
#     /dev/video1

# Test if camera can capture
v4l2-ctl --device=/dev/video0 --all
```

### Take a Test Photo

```bash
# Install fswebcam (simple webcam tool)
sudo apt-get install -y fswebcam

# Capture a test image
fswebcam -r 1280x720 --no-banner test_photo.jpg

# View the file size (should be >0 if successful)
ls -lh test_photo.jpg
```

**Result:** If you get a test_photo.jpg file with a reasonable size (>50KB), your camera is working on `/dev/video0`

---

## Step 2: Install All Dependencies on Raspberry Pi

Run these commands **on your Raspberry Pi via SSH**:

### 2.1 Install System Dependencies

```bash
# Update package list
sudo apt-get update

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be v20.x
npm --version   # Should be 10.x

# Install Python 3 and pip (usually pre-installed on Raspberry Pi OS)
sudo apt-get install -y python3 python3-pip python3-dev

# Verify Python
python3 --version  # Should be 3.9+ or 3.11+
```

### 2.2 Install OpenCV and Computer Vision Libraries

```bash
# Install OpenCV dependencies
sudo apt-get install -y \
    libopencv-dev \
    python3-opencv \
    libatlas-base-dev \
    libjasper-dev \
    libqt4-test \
    libqtgui4

# Install Python CV packages (this takes 5-10 minutes on Pi)
pip3 install --break-system-packages opencv-contrib-python-headless pyzbar scikit-image numpy

# Verify OpenCV installation
python3 -c "import cv2; print(cv2.__version__)"
```

**Note:** The `--break-system-packages` flag is needed on newer Raspberry Pi OS versions that use externally managed Python environments.

### 2.3 Install PostgreSQL Client (for database connection)

```bash
# Install PostgreSQL client libraries
sudo apt-get install -y postgresql-client libpq-dev
```

---

## Step 3: Transfer Your Application to Raspberry Pi

You have several options:

### Option A: Git Clone (Recommended)

If your code is on GitHub/GitLab:

```bash
# On Raspberry Pi
cd ~
git clone <your-repository-url> tool-tracking
cd tool-tracking
```

### Option B: SCP from Your PC

If you want to copy from your local machine:

```bash
# On your PC (not the Pi)
# Assuming your code is in current directory
scp -r ./* pi@<raspberry-pi-ip>:~/tool-tracking/

# Example:
# scp -r ./* pi@192.168.1.100:~/tool-tracking/
```

### Option C: Direct from Replit

Create a download package and transfer:

```bash
# On Raspberry Pi
wget <replit-download-link> -O app.zip
unzip app.zip
cd tool-tracking
```

---

## Step 4: Install Application Dependencies on Pi

```bash
# On Raspberry Pi, in your project directory
cd ~/tool-tracking

# Install Node.js packages
npm install

# Note: This will take 5-15 minutes on Raspberry Pi
```

---

## Step 5: Configure Environment Variables

Create a `.env` file on your Raspberry Pi:

```bash
# On Raspberry Pi
cd ~/tool-tracking
nano .env
```

Add these variables (replace with your actual values):

```bash
DATABASE_URL=postgresql://username:password@host:port/database
PGHOST=your-database-host
PGPORT=5432
PGUSER=your-db-user
PGPASSWORD=your-db-password
PGDATABASE=your-db-name
SESSION_SECRET=your-random-secret-key

# For Replit integrations (if using)
REPLIT_CONNECTORS_HOSTNAME=your-hostname
REPL_IDENTITY=your-token
```

Save and exit (Ctrl+X, then Y, then Enter)

---

## Step 6: Setup Database Schema

```bash
# On Raspberry Pi
cd ~/tool-tracking

# Push database schema
npm run db:push
# If that fails with data loss warning:
npm run db:push -- --force
```

---

## Step 7: Create Required Directories

```bash
# On Raspberry Pi
cd ~/tool-tracking

# Create data directory for images
mkdir -p data/rois

# Set permissions
chmod 755 data
chmod 755 data/rois
```

---

## Step 8: Test Python Scripts

Before running the full app, test if Python scripts work:

```bash
# Test camera access with Python
python3 -c "import cv2; cap = cv2.VideoCapture(0); print('Camera opened:', cap.isOpened()); cap.release()"

# Expected output: Camera opened: True
```

If you get "Camera opened: False", your camera might be on a different device index:

```bash
# Try different indices
python3 -c "import cv2; cap = cv2.VideoCapture(1); print('Camera on /dev/video1:', cap.isOpened()); cap.release()"
```

---

## Step 9: Run the Application

### Development Mode (with auto-reload)

```bash
# On Raspberry Pi
cd ~/tool-tracking
npm run dev
```

### Production Mode

```bash
# Build the frontend first
npm run build

# Start the server
npm start
```

---

## Step 10: Access the Web Dashboard

From your PC, open a browser and go to:

```
http://<raspberry-pi-ip>:5000
```

Example: `http://192.168.1.100:5000`

---

## Troubleshooting

### Issue: "Cannot find module 'xyz'"
**Solution:** Run `npm install` again

### Issue: "Camera not opening"
**Solution:** 
- Check `/dev/video*` exists
- Try different device indices (0, 1, 2)
- Check camera permissions: `sudo usermod -aG video pi`
- Reboot: `sudo reboot`

### Issue: "Database connection failed"
**Solution:** 
- Verify DATABASE_URL is correct
- Test connection: `psql $DATABASE_URL`
- Check firewall allows PostgreSQL port

### Issue: "Python script error"
**Solution:**
- Verify OpenCV: `python3 -c "import cv2; print(cv2.__version__)"`
- Check permissions on python scripts: `chmod +x python/*.py`

### Issue: "Permission denied on /dev/video0"
**Solution:**
```bash
# Add user to video group
sudo usermod -aG video $USER
# Log out and back in, or reboot
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Check camera | `ls -l /dev/video*` |
| Test camera | `fswebcam test.jpg` |
| Start app | `npm run dev` |
| View logs | `journalctl -f` |
| Check running processes | `ps aux | grep node` |
| Stop app | `Ctrl+C` or `pkill node` |

---

## Next Steps After App is Running

1. ✅ Access web dashboard at `http://<pi-ip>:5000`
2. ✅ Go to Settings → Cameras → Add Camera
3. ✅ Set device index to `0` (or whichever works from Step 1)
4. ✅ Print ArUco calibration template
5. ✅ Run calibration from dashboard
6. ✅ Configure scheduler and alerts

---

## Need Help?

If you get stuck, provide:
1. Error message (full text)
2. Output of: `uname -a`
3. Output of: `python3 --version`
4. Output of: `node --version`
5. Output of: `ls -l /dev/video*`
