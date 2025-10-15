#!/bin/bash
#
# Raspberry Pi Auto-Update and Startup Script
# Checks for GitHub updates and starts the application
#

set -e  # Exit on error

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

# Fetch latest changes from GitHub
log "Checking for updates from GitHub..."
git fetch origin main 2>&1 | tee -a "$LOG_FILE"

# Check if updates are available
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    log "✨ New version found! Updating..."
    
    # Stash any local changes
    git stash 2>&1 | tee -a "$LOG_FILE"
    
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
