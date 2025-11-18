# Raspberry Pi Deployment Guide
## Tool Tracking System - Production Setup

This guide will help you deploy the Tool Tracking System to your Raspberry Pi 4.

---

## 🎯 Prerequisites

- Raspberry Pi 4 (2GB+ RAM recommended)
- Raspberry Pi OS (64-bit recommended)
- USB Camera connected
- Internet connection
- SSH access enabled

---

## 🚀 Quick Start (Automated)

### Option 1: One-Command Setup

SSH into your Pi and run:

```bash
curl -fsSL https://raw.githubusercontent.com/heyhotcake/NaniwaTanaCheck/main/deploy-to-pi.sh | bash
```

### Option 2: Manual Download and Run

```bash
# Download the script
wget https://raw.githubusercontent.com/heyhotcake/NaniwaTanaCheck/main/deploy-to-pi.sh

# Make it executable
chmod +x deploy-to-pi.sh

# Run the script
./deploy-to-pi.sh
```

**What the script does:**
1. ✅ Installs Node.js 20
2. ✅ Installs Python dependencies (OpenCV, pyzbar, scikit-image)
3. ✅ Clones the repository from GitHub
4. ✅ Installs Node.js packages
5. ✅ Creates `.env` file with your DATABASE_URL
6. ✅ Tests the camera
7. ✅ Syncs database schema

---

## 📝 Manual Setup (Step by Step)

If you prefer manual setup or the script fails:

### 1. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # Should show v20.x.x
```

### 2. Install Python Dependencies

```bash
sudo apt-get update
sudo apt-get install -y python3-pip python3-dev libzbar0
pip3 install opencv-contrib-python-headless pyzbar scikit-image --break-system-packages
```

### 3. Clone Repository

```bash
git clone https://github.com/heyhotcake/NaniwaTanaCheck.git
cd NaniwaTanaCheck
```

### 4. Install Node Packages

```bash
npm install
```

### 5. Configure Environment

Create a `.env` file:

```bash
nano .env
```

Add this content (replace with your actual values):

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
NODE_ENV=production
SESSION_SECRET=your-random-secret-here
PORT=5000
```

To generate a secure SESSION_SECRET:
```bash
openssl rand -base64 32
```

### 6. Test Camera

```bash
python3 -c "import cv2; cap = cv2.VideoCapture(0); ret, frame = cap.read(); cap.release(); print('✓ Camera OK' if ret else '✗ Camera failed')"
```

### 7. Setup Database

```bash
npm run db:push
```

If you get a data-loss warning:
```bash
npm run db:push -- --force
```

---

## 🎬 Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
# Build the application
npm run build

# Start the server
npm start
```

### Run as Background Service (Recommended)

Create a systemd service:

```bash
sudo nano /etc/systemd/system/tool-tracker.service
```

Add this content:

```ini
[Unit]
Description=Tool Tracking System
After=network.target

[Service]
Type=simple
User=naniwa
WorkingDirectory=/home/naniwa/NaniwaTanaCheck
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl enable tool-tracker
sudo systemctl start tool-tracker
sudo systemctl status tool-tracker
```

View logs:
```bash
sudo journalctl -u tool-tracker -f
```

---

## 🌐 Access the Dashboard

Once running, access the dashboard at:

- **Local**: http://localhost:5000
- **Network**: http://naniwatanacheck.local:5000
- **IP Address**: http://[your-pi-ip]:5000

To find your Pi's IP address:
```bash
hostname -I | awk '{print $1}'
```

---

## 🔧 Troubleshooting

### Camera Not Working

```bash
# List video devices
v4l2-ctl --list-devices

# Test with different device index
python3 -c "import cv2; cap = cv2.VideoCapture(1); ret, _ = cap.read(); cap.release(); print(ret)"
```

### Port Already in Use

```bash
# Find and kill process using port 5000
sudo lsof -ti:5000 | xargs kill -9
```

### Permission Denied for Camera

```bash
# Add user to video group
sudo usermod -a -G video $USER

# Log out and back in for changes to take effect
```

### Database Connection Issues

1. Check DATABASE_URL in `.env`
2. Verify internet connection
3. Test connection:
   ```bash
   npm run db:push
   ```

### Memory Issues on Pi

If you run out of memory during npm install:

```bash
# Increase swap size
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # Change CONF_SWAPSIZE to 2048
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

---

## 📋 System Requirements

- **OS**: Raspberry Pi OS (Bullseye or newer)
- **RAM**: 2GB minimum, 4GB+ recommended
- **Storage**: 8GB+ free space
- **Camera**: USB camera (compatible with V4L2)
- **Network**: Stable internet for database connection

---

## 🔄 Updating the Application

```bash
cd NaniwaTanaCheck
git pull
npm install
npm run db:push
sudo systemctl restart tool-tracker  # If using systemd
```

---

## 📊 Monitoring

### Check Application Status
```bash
sudo systemctl status tool-tracker
```

### View Live Logs
```bash
sudo journalctl -u tool-tracker -f
```

### Check Disk Space
```bash
df -h
```

### Check Memory Usage
```bash
free -h
```

---

## 🆘 Support

If you encounter issues:

1. Check the logs: `sudo journalctl -u tool-tracker -n 100`
2. Verify all environment variables in `.env`
3. Test camera separately: `python3 python/test_camera.py`
4. Ensure database is accessible

---

## 📞 Contact

- **Email**: t-azuma@fs-naniwa.co.jp
- **GitHub**: https://github.com/heyhotcake/NaniwaTanaCheck

---

*Last Updated: October 2025*
