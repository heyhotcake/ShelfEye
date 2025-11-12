#!/bin/bash
#
# GPIO Permissions Setup Script
# Configures passwordless sudo for WS2812B LED control
#

set -e

echo "========================================="
echo "GPIO Permissions Setup"
echo "========================================="
echo ""

# Check if running on Raspberry Pi
if [ ! -f /proc/device-tree/model ]; then
    echo "⚠️  Warning: This doesn't appear to be a Raspberry Pi"
    echo "   GPIO permissions setup may not be necessary"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Check if sudoers-gpio file exists
if [ ! -f "sudoers-gpio" ]; then
    echo "❌ ERROR: sudoers-gpio file not found"
    echo "   Make sure you're in the ShelfEye directory"
    exit 1
fi

echo "📋 Installing GPIO sudoers configuration..."
sudo cp sudoers-gpio /etc/sudoers.d/gpio
sudo chmod 0440 /etc/sudoers.d/gpio
echo "✅ Sudoers configuration installed"

echo ""
echo "📋 Verifying configuration..."
if sudo -n python3 /home/naniwa/ShelfEye/python/led_control_client.py --help >/dev/null 2>&1; then
    echo "✅ Passwordless sudo verified for LED client"
else
    echo "⚠️  Verification failed - you may need to logout and login again"
fi

echo ""
echo "📋 Checking LED Manager Daemon..."
if systemctl is-active --quiet led-manager.service 2>/dev/null; then
    echo "✅ LED Manager Daemon is running"
elif [ -f "/etc/systemd/system/led-manager.service" ]; then
    echo "⚠️  LED Manager Daemon service installed but not running"
    echo "   Start it with: sudo systemctl start led-manager"
else
    echo "ℹ️  LED Manager Daemon not installed yet"
    echo "   It will be installed automatically by pi-startup.sh"
fi

echo ""
echo "========================================="
echo "✨ GPIO Permissions Setup Complete!"
echo "========================================="
echo ""
echo "The naniwa user can now control GPIO without passwords."
echo "This enables LED light strip control for the application."
echo ""
