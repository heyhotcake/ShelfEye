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
TIMING_LOG="/home/naniwa/ShelfEye/state/startup-timing.json"
REPO_URL="https://github.com/heyhotcake/ShelfEye.git"
COMMAND_TIMEOUT=30  # 30 second timeout for network operations

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"
mkdir -p "/home/naniwa/ShelfEye/state"

# Timing instrumentation
START_TIME=$(date +%s)
declare -A PHASE_TIMES

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to record phase timing
record_phase() {
    local phase_name="$1"
    local duration=$(($(date +%s) - START_TIME))
    PHASE_TIMES["$phase_name"]=$duration
    log "⏱️  Phase '$phase_name' completed in ${duration}s (cumulative)"
}

# Function to run command with timeout
run_with_timeout() {
    local timeout=$1
    shift
    timeout --foreground "$timeout" "$@" 2>&1 | tee -a "$LOG_FILE"
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

# Fetch latest changes from GitHub (with timeout)
log "Checking for updates from GitHub..."
if run_with_timeout $COMMAND_TIMEOUT git fetch origin main; then
    record_phase "git-fetch"
    
    # Check if updates are available
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)

    if [ "$LOCAL" != "$REMOTE" ]; then
        log "✨ New version found! Updating..."
        
        # Stash any local changes (if there are any)
        if [ -n "$(git status --porcelain)" ]; then
            log "Stashing local changes..."
            run_with_timeout $COMMAND_TIMEOUT git stash
        else
            log "No local changes to stash"
        fi
        
        # Pull latest changes
        if run_with_timeout $COMMAND_TIMEOUT git pull origin main; then
            record_phase "git-pull"
            
            # Check if package.json changed
            if git diff --name-only HEAD@{1} HEAD | grep -q "package.json"; then
                log "📦 Dependencies changed, running npm install..."
                if run_with_timeout 180 npm install --include=dev; then
                    record_phase "npm-install"
                else
                    log "⚠️  npm install timeout - dependencies may be incomplete"
                    # Verify critical dependencies exist
                    if ! npm list express >/dev/null 2>&1; then
                        log "❌ FATAL: Core dependencies missing after timeout"
                        exit 1
                    fi
                    record_phase "npm-install-timeout"
                fi
            fi
            
            # Check if Python requirements changed (future-proofing)
            if [ -f "requirements.txt" ] && git diff --name-only HEAD@{1} HEAD | grep -q "requirements.txt"; then
                log "🐍 Python dependencies changed, running pip install..."
                run_with_timeout 60 pip3 install -r requirements.txt
                record_phase "pip-install"
            fi
            
            log "✅ Update completed successfully!"
        else
            log "⚠️  Git pull timeout or failed - continuing with current version"
        fi
    else
        log "✓ Already up to date (commit: ${LOCAL:0:7})"
        record_phase "git-check"
    fi
else
    log "⚠️  Git fetch timeout or failed - skipping update check"
    record_phase "git-fetch-skipped"
fi

# Ensure WS2812B LED library is installed (runs on every boot)
if ! python3 -c "import rpi_ws281x" 2>/dev/null; then
    log "🔦 Installing WS2812B LED library..."
    run_with_timeout 45 sudo pip3 install rpi_ws281x --break-system-packages || log "⚠️  LED library install failed"
    record_phase "led-library-install"
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
    
    # Only start if not already running (systemd handles startup via Before/After)
    if sudo systemctl is-active --quiet led-manager.service; then
        log "✅ LED Manager Daemon is already running"
    else
        log "Starting LED Manager Daemon..."
        sudo systemctl start led-manager.service 2>&1 | tee -a "$LOG_FILE"
        sleep 2
        if sudo systemctl is-active --quiet led-manager.service; then
            log "✅ LED Manager Daemon started successfully"
        else
            log "⚠️  LED Manager Daemon failed to start - check: sudo journalctl -u led-manager"
        fi
    fi
else
    log "⚠️  LED Manager Daemon service file not found"
fi

# Database schema sync - SKIP on Pi (drizzle-kit uses port 5432 which is blocked by firewall)
# Schema is managed from Replit dashboard instead
log "Skipping database schema sync (managed from Replit)"
record_phase "db-push-skipped"

# Save timing data
TOTAL_STARTUP_TIME=$(($(date +%s) - START_TIME))
record_phase "pre-app-complete"

# Write timing data to JSON
cat > "$TIMING_LOG" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "total_startup_time": $TOTAL_STARTUP_TIME,
  "phases": {
$(for phase in "${!PHASE_TIMES[@]}"; do
    echo "    \"$phase\": ${PHASE_TIMES[$phase]},"
done | sed '$ s/,$//')
  }
}
EOF

log "📊 Total pre-app startup: ${TOTAL_STARTUP_TIME}s"
log "   Timing details saved to: $TIMING_LOG"

# Build for production
log "🔨 Building production assets..."
if run_with_timeout 900 npm run build; then
    record_phase "build"
    log "✅ Production build completed successfully"
else
    log "❌ FATAL: Build failed"
    exit 1
fi

# Start the application
log "🚀 Starting ShelfEye application (production mode)..."
log "Access at: http://naniwatanacheck.local:5000"
log "========================================="

# Run the production server (compiled dist/index.js)
# Use process substitution so Node becomes the main PID for proper systemd signal handling
exec > >(tee -a "$LOG_FILE") 2>&1
exec npm start
