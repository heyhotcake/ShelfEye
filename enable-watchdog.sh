#!/bin/bash
# Enable Raspberry Pi Hardware Watchdog for Auto-Reboot on Freeze
# This reboots the Pi automatically if it becomes unresponsive

set -e

echo "🐕 Enabling Raspberry Pi Hardware Watchdog..."

# 1. Install watchdog daemon
echo "Installing watchdog package..."
sudo apt-get update
sudo apt-get install -y watchdog

# 2. Load watchdog kernel module
echo "Loading bcm2835_wdt kernel module..."
sudo modprobe bcm2835_wdt
echo "bcm2835_wdt" | sudo tee -a /etc/modules

# 3. Configure watchdog daemon
echo "Configuring /etc/watchdog.conf..."
sudo tee /etc/watchdog.conf > /dev/null <<EOF
# Hardware watchdog device
watchdog-device = /dev/watchdog

# Timeout: reboot if no heartbeat for 15 seconds
watchdog-timeout = 15

# Test interval: ping every 1 second
interval = 1

# Maximum load average (1-min, 5-min, 15-min) before reboot
# For 4-core Pi: 8.0 = 200% load per core
max-load-1 = 8
max-load-5 = 6
max-load-15 = 4

# Reboot if network interface goes down (optional, comment out if not needed)
# interface = wlan0

# Enable logging
log-dir = /var/log/watchdog

# Realtime priority (makes watchdog less likely to freeze)
realtime = yes
priority = 1

# Test /dev/watchdog is writable
test-binary = /usr/bin/test
EOF

# 4. Enable and start watchdog service
echo "Enabling watchdog service..."
sudo systemctl enable watchdog
sudo systemctl start watchdog

# 5. Verify watchdog is running
echo ""
echo "✅ Watchdog Configuration Complete!"
echo ""
echo "Status:"
sudo systemctl status watchdog --no-pager | head -10
echo ""
echo "Watchdog device:"
ls -l /dev/watchdog
echo ""
echo "🐕 Your Pi will now automatically reboot if it freezes for more than 15 seconds!"
echo ""
echo "To test (WARNING: this will reboot your Pi):"
echo "  sudo sh -c 'echo 1 > /proc/sys/kernel/sysrq'"
echo "  sudo sh -c 'echo c > /proc/sysrq-trigger'"
echo ""
