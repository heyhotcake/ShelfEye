#!/bin/bash
#
# Install Auto-Start Service for ShelfEye
# Sets up systemd service to auto-update and start on boot
#

set -e

APP_DIR="/home/naniwa/ShelfEye"
SERVICE_FILE="shelfeye.service"

echo "========================================="
echo "ShelfEye Auto-Start Installation"
echo "========================================="

# Check if running as naniwa user
if [ "$USER" != "naniwa" ]; then
    echo "❌ ERROR: Please run as naniwa user"
    echo "   Run: sudo -u naniwa $0"
    exit 1
fi

# Navigate to app directory
cd "$APP_DIR" || {
    echo "❌ ERROR: Cannot access $APP_DIR"
    exit 1
}

echo ""
echo "📋 Step 1: Making startup script executable..."
chmod +x pi-startup.sh
echo "✅ Startup script ready"

echo ""
echo "📋 Step 2: Installing systemd service..."
sudo cp "$SERVICE_FILE" /etc/systemd/system/
echo "✅ Service file copied to /etc/systemd/system/"

echo ""
echo "📋 Step 3: Reloading systemd daemon..."
sudo systemctl daemon-reload
echo "✅ Systemd reloaded"

echo ""
echo "📋 Step 4: Enabling service to start on boot..."
sudo systemctl enable shelfeye.service
echo "✅ Service enabled"

echo ""
echo "📋 Step 5: Starting service now..."
sudo systemctl start shelfeye.service
echo "✅ Service started"

echo ""
echo "========================================="
echo "✨ Installation Complete!"
echo "========================================="
echo ""
echo "The system is now set to:"
echo "  ✓ Check for GitHub updates on boot"
echo "  ✓ Auto-update if new version found"
echo "  ✓ Start ShelfEye automatically"
echo ""
echo "Useful commands:"
echo "  View status:  sudo systemctl status shelfeye"
echo "  View logs:    sudo journalctl -u shelfeye -f"
echo "  Restart:      sudo systemctl restart shelfeye"
echo "  Stop:         sudo systemctl stop shelfeye"
echo "  Disable:      sudo systemctl disable shelfeye"
echo ""
echo "Access the app at: http://naniwatanacheck.local:5000"
echo "========================================="
