#!/bin/bash
#
# Raspberry Pi Auto-Update and Startup Script
# Checks for GitHub updates and starts the application
#

set -e  # Exit on error
set -o pipefail  # Catch errors in pipes

# Configuration
APP_DIR="/home/naniwa/ShelfEye"
LOG_DIR="/home/naniwa/ShelfEye/logs"
LOG_FILE="$LOG_DIR/startup.log"
REPO_URL="https://github.com/heyhotcake/ShelfEye.git"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "========================================="
log "Starting ShelfEye Auto-Update System"
log "========================================="

# Change to app directory
cd "$APP_DIR" || {
    log "ERROR: Cannot access $APP_DIR"
    exit 1
}

# Load environment variables from .env.pi if it exists
if [ -f ".env.pi" ]; then
    log "Loading environment variables from .env.pi..."
    set -a  # Export all variables
    source .env.pi
    set +a
else
    log "⚠️  WARNING: .env.pi file not found! Database connection may fail."
    log "   Create .env.pi with DATABASE_URL and SESSION_SECRET"
fi

# Fetch latest changes from GitHub
log "Checking for updates from GitHub..."
git fetch origin main 2>&1 | tee -a "$LOG_FILE"

# Check if updates are available
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    log "✨ New version found! Updating..."
    
    # Stash any local changes (if there are any)
    if [ -n "$(git status --porcelain)" ]; then
        log "Stashing local changes..."
        git stash 2>&1 | tee -a "$LOG_FILE"
    else
        log "No local changes to stash"
    fi
    
    # Pull latest changes
    git pull origin main 2>&1 | tee -a "$LOG_FILE"
    
    # Check if package.json changed
    if git diff --name-only HEAD@{1} HEAD | grep -q "package.json"; then
        log "📦 Dependencies changed, running npm install..."
        npm install --include=dev 2>&1 | tee -a "$LOG_FILE"
    fi
    
    # Check if Python requirements changed (future-proofing)
    if [ -f "requirements.txt" ] && git diff --name-only HEAD@{1} HEAD | grep -q "requirements.txt"; then
        log "🐍 Python dependencies changed, running pip install..."
        pip3 install -r requirements.txt 2>&1 | tee -a "$LOG_FILE"
    fi
    
    log "✅ Update completed successfully!"
else
    log "✓ Already up to date (commit: ${LOCAL:0:7})"
fi

# Ensure WS2812B LED library is installed (runs on every boot)
if ! python3 -c "import rpi_ws281x" 2>/dev/null; then
    log "🔦 Installing WS2812B LED library..."
    sudo pip3 install rpi_ws281x --break-system-packages 2>&1 | tee -a "$LOG_FILE"
else
    log "✓ WS2812B LED library already installed"
fi

# Generate LED daemon configuration
log "Configuring LED Manager Daemon..."
mkdir -p "$APP_DIR/state"
cat > "$APP_DIR/state/led_daemon_config.json" << EOF
{
  "num_leds": 99,
  "brightness": 100,
  "gpio_pin": 18,
  "dma_channel": 10,
  "freq_hz": 800000,
  "invert": false
}
EOF
log "✓ LED daemon config generated"

# Ensure LED Manager Daemon is installed and running
if [ -f "$APP_DIR/led-manager.service" ]; then
    log "Installing LED Manager Daemon service..."
    sudo cp "$APP_DIR/led-manager.service" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable led-manager.service 2>&1 | tee -a "$LOG_FILE"
    sudo systemctl restart led-manager.service 2>&1 | tee -a "$LOG_FILE"
    
    # Check daemon status
    if sudo systemctl is-active --quiet led-manager.service; then
        log "✅ LED Manager Daemon is running"
    else
        log "⚠️  LED Manager Daemon failed to start - check: sudo journalctl -u led-manager"
    fi
else
    log "⚠️  LED Manager Daemon service file not found"
fi

# Database schema sync (if needed)
log "Syncing database schema..."
npm run db:push 2>&1 | tee -a "$LOG_FILE" || {
    log "⚠️  Database sync warning (this is normal if schema unchanged)"
}

# Start the application
log "🚀 Starting ShelfEye application..."
log "Access at: http://naniwatanacheck.local:5000"
log "========================================="

# Run the application
exec npm run dev 2>&1 | tee -a "$LOG_FILE"
