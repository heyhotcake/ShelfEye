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

# Timeout: reboot if no heartbeat for 240 seconds (4 minutes)
# Typical startup: 60-90s (git 5s + npm 30s + db 10s + app 15s + calibration 45s)
# Slow startup: 150-200s (slow network + fresh npm install + retries)
# 240s provides comfortable margin while still protecting against real freezes
watchdog-timeout = 240

# Test interval: ping every 1 second
interval = 1

# Load average triggers DISABLED for computer vision workloads
# (OpenCV calibration routinely spikes >9 on 4-core Pi during startup)
# Watchdog only monitors for complete system freeze, not high load
# max-load-1 = 0
# max-load-5 = 0
# max-load-15 = 0

# Reboot if network interface goes down (optional, comment out if not needed)
# interface = wlan0

# Enable logging
log-dir = /var/log/watchdog

# Realtime priority (ensures watchdog daemon gets CPU during heavy loads)
realtime = yes
priority = 5

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
echo "🐕 Your Pi will now automatically reboot if it freezes for more than 4 minutes!"
echo ""
echo "⚠️  Load average triggers are DISABLED to prevent false reboots during calibration."
echo "    The watchdog only protects against complete system freezes, not high CPU usage."
echo ""
echo "📊 Startup typically takes 60-90 seconds (git + npm + calibration)."
echo "    Worst case with slow network: ~180-240 seconds."
echo "    The 240s timeout provides comfortable safety margin."
echo ""
echo "To test (WARNING: this will reboot your Pi):"
echo "  sudo sh -c 'echo 1 > /proc/sys/kernel/sysrq'"
echo "  sudo sh -c 'echo c > /proc/sysrq-trigger'"
echo ""
