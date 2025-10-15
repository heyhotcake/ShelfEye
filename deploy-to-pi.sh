#!/bin/bash
# Deployment Script for Raspberry Pi 4
# Tool Tracking System - Automated Setup

set -e  # Exit on any error

echo "================================================"
echo "Tool Tracking System - Raspberry Pi Deployment"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Install Node.js 20
echo -e "${YELLOW}[1/7] Installing Node.js 20...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v) != v20* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "${GREEN}✓ Node.js 20 installed${NC}"
else
    echo -e "${GREEN}✓ Node.js 20 already installed${NC}"
fi

# Step 2: Install Python dependencies
echo -e "${YELLOW}[2/7] Installing Python dependencies...${NC}"
sudo apt-get update
sudo apt-get install -y python3-pip python3-dev libzbar0
pip3 install opencv-contrib-python-headless pyzbar scikit-image --break-system-packages
echo -e "${GREEN}✓ Python dependencies installed${NC}"

# Step 3: Clone repository
echo -e "${YELLOW}[3/7] Cloning repository...${NC}"
if [ -d "NaniwaTanaCheck" ]; then
    echo "Repository already exists. Pulling latest changes..."
    cd NaniwaTanaCheck
    git pull
else
    git clone https://github.com/heyhotcake/NaniwaTanaCheck.git
    cd NaniwaTanaCheck
fi
echo -e "${GREEN}✓ Repository ready${NC}"

# Step 4: Install Node.js dependencies
echo -e "${YELLOW}[4/7] Installing Node.js dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Node.js dependencies installed${NC}"

# Step 5: Set up environment file
echo -e "${YELLOW}[5/7] Setting up .env file...${NC}"
if [ ! -f ".env" ]; then
    read -p "Enter your DATABASE_URL (from Neon/Replit): " DATABASE_URL
    cat > .env << EOF
DATABASE_URL="${DATABASE_URL}"
NODE_ENV=production
SESSION_SECRET=$(openssl rand -base64 32)
PORT=5000
EOF
    echo -e "${GREEN}✓ .env file created${NC}"
else
    echo -e "${GREEN}✓ .env file already exists${NC}"
fi

# Step 6: Test camera
echo -e "${YELLOW}[6/7] Testing camera...${NC}"
if python3 -c "import cv2; cap = cv2.VideoCapture(0); ret, _ = cap.read(); cap.release(); exit(0 if ret else 1)"; then
    echo -e "${GREEN}✓ Camera is working${NC}"
else
    echo -e "${RED}✗ Camera test failed. Please check USB camera connection.${NC}"
    exit 1
fi

# Step 7: Push database schema
echo -e "${YELLOW}[7/7] Setting up database...${NC}"
npm run db:push
echo -e "${GREEN}✓ Database schema synced${NC}"

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "To start the application:"
echo "  cd NaniwaTanaCheck"
echo "  npm run dev          # Development mode"
echo "  npm run build        # Production build"
echo "  npm start            # Production mode"
echo ""
echo "Access the dashboard at:"
echo "  http://naniwatanacheck.local:5000"
echo "  http://$(hostname -I | awk '{print $1}'):5000"
echo ""
