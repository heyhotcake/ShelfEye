#!/bin/bash
# Debugging script to capture crash information

echo "=== Starting Debug Session ==="
date

# Capture initial system state
echo "=== Memory Before ==="
free -h

echo "=== Disk Space ==="
df -h /

echo "=== GPIO State ==="
ls -la /sys/class/gpio/ 2>/dev/null || echo "No GPIO exports"

echo "=== Running Processes ==="
ps aux | grep -E "python|node|tsx" | grep -v grep

echo "=== Kernel Messages (last 50 lines) ==="
sudo dmesg | tail -50

echo "=== Starting minimal test server ==="
cat > /tmp/test_server.js << 'EOF'
const http = require('http');
const PORT = 5001;

console.log('Creating HTTP server...');

const server = http.createServer((req, res) => {
  console.log(`Got request: ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK\n');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Test server running on port ${PORT}`);
});

// Catch all errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
EOF

# Run minimal server
echo "Starting minimal server on port 5001..."
node /tmp/test_server.js &
SERVER_PID=$!

sleep 2

echo "=== Testing minimal server ==="
curl -v http://localhost:5001 2>&1 || echo "Curl failed"

echo "=== Checking if server still running ==="
ps -p $SERVER_PID > /dev/null && echo "Server still running" || echo "Server crashed"

# Kill test server
kill $SERVER_PID 2>/dev/null

echo "=== Kernel messages after test ==="
sudo dmesg | tail -20

echo "=== Debug complete ==="