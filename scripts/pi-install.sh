#!/bin/bash
# Raspberry Pi Installation Script
# Run this on your Raspberry Pi to install all dependencies

set -e  # Exit on error

echo "========================================="
echo "Tool Tracking System - Pi Installation"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    echo -e "${YELLOW}Warning: This doesn't appear to be a Raspberry Pi${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "Step 1: Updating system packages..."
sudo apt-get update

echo ""
echo "Step 2: Installing Node.js 20.x..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "${GREEN}✓ Node.js installed${NC}"
else
    echo -e "${GREEN}✓ Node.js already installed ($(node --version))${NC}"
fi

echo ""
echo "Step 3: Installing Python development tools..."
sudo apt-get install -y python3 python3-pip python3-dev
echo -e "${GREEN}✓ Python installed ($(python3 --version))${NC}"

echo ""
echo "Step 4: Installing OpenCV and dependencies..."
sudo apt-get install -y \
    libopencv-dev \
    python3-opencv \
    libatlas-base-dev \
    libjasper-dev \
    libqtgui4 \
    libqt4-test \
    libhdf5-dev \
    libilmbase-dev \
    libopenexr-dev

echo -e "${GREEN}✓ OpenCV system libraries installed${NC}"

echo ""
echo "Step 5: Installing Python computer vision packages..."
echo "This may take 5-10 minutes on Raspberry Pi..."
pip3 install --break-system-packages \
    opencv-contrib-python-headless \
    pyzbar \
    scikit-image \
    numpy

echo -e "${GREEN}✓ Python CV packages installed${NC}"

echo ""
echo "Step 6: Installing PostgreSQL client..."
sudo apt-get install -y postgresql-client libpq-dev
echo -e "${GREEN}✓ PostgreSQL client installed${NC}"

echo ""
echo "Step 7: Installing camera testing tools..."
sudo apt-get install -y v4l-utils fswebcam
echo -e "${GREEN}✓ Camera tools installed${NC}"

echo ""
echo "Step 8: Checking for cameras..."
if ls /dev/video* 1> /dev/null 2>&1; then
    echo -e "${GREEN}✓ Camera devices found:${NC}"
    ls -l /dev/video*
else
    echo -e "${YELLOW}! No camera devices found. Please connect a USB camera.${NC}"
fi

echo ""
echo "Step 9: Adding user to video group..."
sudo usermod -aG video $USER
echo -e "${GREEN}✓ User added to video group${NC}"
echo -e "${YELLOW}  Note: Log out and back in for this to take effect${NC}"

echo ""
echo "Step 10: Testing Python OpenCV..."
if python3 -c "import cv2; print('OpenCV version:', cv2.__version__)" 2>&1; then
    echo -e "${GREEN}✓ OpenCV working correctly${NC}"
else
    echo -e "${RED}✗ OpenCV test failed${NC}"
    exit 1
fi

echo ""
echo "Step 11: Testing camera access..."
if python3 -c "import cv2; cap = cv2.VideoCapture(0); result = cap.isOpened(); cap.release(); exit(0 if result else 1)" 2>&1; then
    echo -e "${GREEN}✓ Camera accessible from Python${NC}"
else
    echo -e "${YELLOW}! Camera not accessible (may need to log out/in or reboot)${NC}"
fi

echo ""
echo "========================================="
echo -e "${GREEN}Installation Complete!${NC}"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Copy your application code to this Raspberry Pi"
echo "2. Run 'npm install' in your app directory"
echo "3. Create .env file with your database credentials"
echo "4. Run 'npm run db:push' to setup database"
echo "5. Run 'npm run dev' to start the application"
echo ""
echo "See RASPBERRY_PI_SETUP.md for detailed instructions"
echo ""
