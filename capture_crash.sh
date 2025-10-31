#!/bin/bash
# Script to capture crash details when running the actual app

echo "=== Pre-crash kernel log ==="
sudo dmesg -c > /tmp/pre_crash.log

echo "=== Starting app with strace ==="
# Use timeout to prevent hanging
timeout 30 sudo strace -o /tmp/strace.log -f npm run dev &
STRACE_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 15

echo "=== Server should be running, checking ==="
ps aux | grep tsx

echo "=== Attempting curl ==="
curl -v http://localhost:5000 2>&1 || echo "Curl failed"

echo "=== Post-crash kernel log ==="
sudo dmesg > /tmp/post_crash.log

echo "=== Checking for coredumps ==="
ls -la /var/crash/ 2>/dev/null || echo "No crash directory"

echo "=== Last 100 lines of strace ==="
tail -100 /tmp/strace.log 2>/dev/null || echo "No strace log"

echo "=== Kernel log diff ==="
sudo dmesg | tail -50

# Kill any remaining processes
sudo pkill -f "npm run dev"
sudo pkill -f tsx