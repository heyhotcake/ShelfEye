#!/bin/bash

# Tool Tracking System Installation Script
# Run with: curl -sSL https://install.tool-tracker.com | bash
# Or: wget -qO- https://install.tool-tracker.com | bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/tool-tracker"
SERVICE_USER="pi"
PYTHON_VERSION="3.9"
NODE_VERSION="18"

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

check_root() {
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root. Run as user '$SERVICE_USER' instead."
    fi
}

check_system() {
    log "Checking system requirements..."
    
    # Check if running on Raspberry Pi
    if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
        warn "Not running on Raspberry Pi. Some features may not work correctly."
    fi
    
    # Check OS
    if ! command -v apt-get &> /dev/null; then
        error "This installer requires a Debian-based system with apt-get"
    fi
    
    # Check available disk space (need at least 2GB)
    available=$(df / | awk 'NR==2 {print $4}')
    if [[ $available -lt 2097152 ]]; then
        error "Insufficient disk space. At least 2GB required, only $((available/1024/1024))GB available."
    fi
    
    log "System requirements check passed"
}

install_system_dependencies() {
    log "Installing system dependencies..."
    
    sudo apt-get update
    sudo apt-get install -y \
        curl \
        wget \
        git \
        build-essential \
        cmake \
        pkg-config \
        libssl-dev \
        libffi-dev \
        libatlas-base-dev \
        libjpeg-dev \
        libpng-dev \
        libtiff-dev \
        libavcodec-dev \
        libavformat-dev \
        libswscale-dev \
        libv4l-dev \
        libxvidcore-dev \
        libx264-dev \
        libgtk-3-dev \
        libcanberra-gtk-module \
        libcanberra-gtk3-module \
        python3-dev \
        python3-pip \
        python3-venv \
        zbar-tools \
        libzbar0 \
        libzbar-dev
    
    log "System dependencies installed successfully"
}

install_nodejs() {
    log "Installing Node.js $NODE_VERSION..."
    
    # Install Node.js using NodeSource repository
    if ! command -v node &> /dev/null || [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt $NODE_VERSION ]]; then
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    
    # Verify installation
    node_version=$(node -v)
    npm_version=$(npm -v)
    log "Node.js $node_version and npm $npm_version installed successfully"
}

create_installation_directory() {
    log "Creating installation directory..."
    
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    # Create subdirectories
    mkdir -p "$INSTALL_DIR"/{data,logs,config,credentials,python}
    mkdir -p "$INSTALL_DIR/data"/{rois,baselines}
    
    log "Installation directory created: $INSTALL_DIR"
}

install_python_dependencies() {
    log "Setting up Python virtual environment and dependencies..."
    
    # Create virtual environment
    python3 -m venv "$INSTALL_DIR/venv"
    source "$INSTALL_DIR/venv/bin/activate"
    
    # Upgrade pip
    pip install --upgrade pip setuptools wheel
    
    # Install Python packages
    pip install -r "$INSTALL_DIR/python/requirements.txt"
    
    deactivate
    log "Python dependencies installed successfully"
}

download_application() {
    log "Downloading application files..."
    
    # In a real deployment, this would download from a release or git repository
    # For now, we'll create the directory structure
    
    cd "$INSTALL_DIR"
    
    # Copy application files (this would be done differently in real deployment)
    log "Application files downloaded to $INSTALL_DIR"
}

build_application() {
    log "Building application..."
    
    cd "$INSTALL_DIR"
    
    # Install npm dependencies
    npm ci --only=production
    
    # Build the application
    npm run build
    
    log "Application built successfully"
}

setup_systemd_service() {
    log "Setting up systemd service..."
    
    sudo cp "$INSTALL_DIR/systemd/tool-tracker.service" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable tool-tracker.service
    
    log "Systemd service configured"
}

setup_environment() {
    log "Setting up environment configuration..."
    
    # Create .env file
    cat > "$INSTALL_DIR/.env" << EOF
NODE_ENV=production
PORT=5000
DATABASE_URL=sqlite://$INSTALL_DIR/data/tool-tracker.db
QR_SECRET_KEY=$(openssl rand -hex 32)
SMTP_USERNAME=
SMTP_PASSWORD=
GOOGLE_SHEETS_ID=
SESSION_SECRET=$(openssl rand -hex 32)
EOF
    
    # Set appropriate permissions
    chmod 600 "$INSTALL_DIR/.env"
    
    log "Environment configuration created"
}

setup_camera_permissions() {
    log "Setting up camera permissions..."
    
    # Add user to video group
    sudo usermod -a -G video "$SERVICE_USER"
    
    # Create udev rule for camera access
    sudo tee /etc/udev/rules.d/99-camera.rules > /dev/null << EOF
SUBSYSTEM=="video4linux", GROUP="video", MODE="0664"
KERNEL=="video[0-9]*", GROUP="video", MODE="0664"
EOF
    
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    
    log "Camera permissions configured"
}

setup_log_rotation() {
    log "Setting up log rotation..."
    
    sudo tee /etc/logrotate.d/tool-tracker > /dev/null << EOF
$INSTALL_DIR/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    notifempty
    create 0644 $SERVICE_USER $SERVICE_USER
    postrotate
        systemctl reload tool-tracker.service
    endscript
}
EOF
    
    log "Log rotation configured"
}

create_default_config() {
    log "Creating default configuration..."
    
    cp "$INSTALL_DIR/config/default.yaml" "$INSTALL_DIR/config/production.yaml"
    
    log "Default configuration created"
}

start_services() {
    log "Starting services..."
    
    sudo systemctl start tool-tracker.service
    
    # Wait a moment and check status
    sleep 5
    if sudo systemctl is-active --quiet tool-tracker.service; then
        log "Tool Tracker service started successfully"
    else
        warn "Service may have failed to start. Check: sudo systemctl status tool-tracker.service"
    fi
}

show_completion_message() {
    log "Installation completed successfully!"
    echo
    echo -e "${BLUE}Tool Tracking System has been installed to: $INSTALL_DIR${NC}"
    echo -e "${BLUE}Service status: sudo systemctl status tool-tracker.service${NC}"
    echo -e "${BLUE}View logs: sudo journalctl -u tool-tracker.service -f${NC}"
    echo -e "${BLUE}Configuration: $INSTALL_DIR/config/production.yaml${NC}"
    echo -e "${BLUE}Environment: $INSTALL_DIR/.env${NC}"
    echo
    echo -e "${GREEN}Next steps:${NC}"
    echo "1. Configure camera settings in config/production.yaml"
    echo "2. Set up SMTP credentials in .env file for email alerts"
    echo "3. Configure Google Sheets integration if needed"
    echo "4. Access the web interface at http://$(hostname -I | awk '{print $1}'):5000"
    echo "5. Run camera calibration and set up tool slots"
    echo
    echo -e "${YELLOW}Important:${NC}"
    echo "- Reboot the system to ensure all permissions take effect"
    echo "- Camera permissions require the user to be in the 'video' group"
    echo "- Check firewall settings if remote access is needed"
    echo
}

main() {
    log "Starting Tool Tracking System installation..."
    
    check_root
    check_system
    install_system_dependencies
    install_nodejs
    create_installation_directory
    download_application
    install_python_dependencies
    build_application
    setup_environment
    setup_systemd_service
    setup_camera_permissions
    setup_log_rotation
    create_default_config
    start_services
    show_completion_message
}

# Run main function
main "$@"
