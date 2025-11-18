#!/bin/bash
echo "=== Checking Watchdog Status ==="

# Check if watchdog is running
echo "Watchdog service status:"
sudo systemctl status watchdog --no-pager | head -20

echo ""
echo "=== Watchdog processes ==="
ps aux | grep -i watchdog | grep -v grep

echo ""
echo "=== Watchdog config ==="
cat /etc/watchdog.conf 2>/dev/null | grep -v "^#" | grep -v "^$" | head -20

echo ""
echo "=== Kernel watchdog modules ==="
lsmod | grep -i watchdog

echo ""
echo "=== To disable watchdog temporarily ==="
echo "sudo systemctl stop watchdog"
echo "sudo systemctl disable watchdog"