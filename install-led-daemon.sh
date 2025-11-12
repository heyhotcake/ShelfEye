#!/bin/bash
#
# LED Manager Daemon Installation Script
# Deploys the daemon-based LED control system to Raspberry Pi
#
# Usage:
#   ./install-led-daemon.sh
#

set -e

APP_DIR="/home/naniwa/ShelfEye"
STATE_DIR="$APP_DIR/state"

echo "========================================="
echo "LED Manager Daemon Installation"
echo "========================================="
echo ""

# Check if running on Raspberry Pi
if [ ! -f /proc/device-tree/model ]; then
    echo "⚠️  Warning: This doesn't appear to be a Raspberry Pi"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Check if we're in the correct directory
if [ ! -f "led-manager.service" ]; then
    echo "❌ ERROR: led-manager.service not found"
    echo "   Make sure you're in the ShelfEye directory"
    exit 1
fi

# Check for stuck LED processes first
echo "0️⃣  Checking for stuck LED processes..."
STUCK_PROCESSES=$(ps aux | grep -E "(alert_led|gpio_controller|unified_led_controller)" | grep -v grep || true)
if [ -n "$STUCK_PROCESSES" ]; then
    echo "⚠️  WARNING: Found stuck LED processes!"
    echo "$STUCK_PROCESSES"
    echo ""
    echo "Please run ./kill-stuck-led-processes.sh first to clean up"
    echo "Then run this installer again."
    exit 1
fi
echo "✅ No stuck processes found"
echo ""

echo "1️⃣  Creating state directory..."
mkdir -p "$STATE_DIR"
echo "✅ State directory created: $STATE_DIR"

echo ""
echo "2️⃣  Generating daemon configuration..."
cat > "$STATE_DIR/led_daemon_config.json" << EOF
{
  "num_leds": 99,
  "brightness": 100,
  "gpio_pin": 18,
  "dma_channel": 10,
  "freq_hz": 800000,
  "invert": false
}
EOF
echo "✅ Configuration generated"

echo ""
echo "3️⃣  Installing systemd service..."
sudo cp led-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
echo "✅ Service installed"

echo ""
echo "4️⃣  Ensuring rpi_ws281x library is installed..."
if ! python3 -c "import rpi_ws281x" 2>/dev/null; then
    echo "Installing WS2812B LED library..."
    sudo pip3 install rpi_ws281x --break-system-packages
    echo "✅ Library installed"
else
    echo "✅ Library already installed"
fi

echo ""
echo "5️⃣  Starting LED Manager Daemon..."
sudo systemctl enable led-manager.service
sudo systemctl restart led-manager.service

# Wait a moment for service to start
sleep 2

echo ""
echo "6️⃣  Verifying daemon status..."
if sudo systemctl is-active --quiet led-manager.service; then
    echo "✅ LED Manager Daemon is running"
    echo ""
    echo "Service status:"
    sudo systemctl status led-manager.service --no-pager -l | head -10
else
    echo "❌ LED Manager Daemon failed to start"
    echo ""
    echo "Error logs:"
    sudo journalctl -u led-manager.service -n 20 --no-pager
    exit 1
fi

echo ""
echo "7️⃣  Testing LED control client..."
if sudo python3 $APP_DIR/python/led_control_client.py status >/dev/null 2>&1; then
    echo "✅ LED control client can communicate with daemon"
else
    echo "⚠️  LED control client test failed (daemon may not be fully ready yet)"
fi

echo ""
echo "========================================="
echo "✨ LED Manager Daemon Installation Complete!"
echo "========================================="
echo ""
echo "Daemon Status:"
echo "  Service: led-manager.service"
echo "  Status:  sudo systemctl status led-manager"
echo "  Logs:    sudo journalctl -u led-manager -f"
echo "  Control: sudo systemctl {start|stop|restart} led-manager"
echo ""
echo "Command Pipe: $STATE_DIR/led_command_pipe"
echo "State File:   $STATE_DIR/led_state.json"
echo "Config File:  $STATE_DIR/led_daemon_config.json"
echo ""
echo "Testing Commands:"
echo "  sudo python3 $APP_DIR/python/led_control_client.py status"
echo "  sudo python3 $APP_DIR/python/led_control_client.py white --brightness 100"
echo "  sudo python3 $APP_DIR/python/led_control_client.py off"
echo ""
