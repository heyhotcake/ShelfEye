# Tool Tracking System - Compressed Development Guide

## Overview
The Tool Tracking System is a Raspberry Pi-based solution for real-time tool monitoring in workshops. It uses computer vision and ArUco markers to track tool presence and checkout status, aiming to prevent tool loss and improve accountability. Key features include ArUco marker validation, temporal smoothing, multi-channel alerting (email, Google Sheets, sound), and a React web dashboard for calibration, slot management, analytics, and administration. The system supports 4K cameras with intelligent dual-resolution modes and worker tracking via ArUco-enabled identification tags.

**Production Reliability (Phase 1 - Completed Nov 17, 2025):**
- Database resilience with exponential retry (3 attempts, 2s→4s→8s backoff) on critical operations
- Comprehensive subprocess tracking with enhanced zombie/D-state detection  
- Bulletproof spawn enforcement (ALL 13+ spawn calls use spawnTracked())
- Persistent cleanup with exit verification (prevents premature process removal)

## User Preferences
- Preferred communication style: Simple, everyday language.
- **Deployment Context**: User runs the application on a Raspberry Pi at `http://naniwatanacheck.local:5000`. **ALL debugging, testing, and issue reports refer to the Pi deployment, NOT the Replit web preview.** The Replit environment is for code development only; actual hardware features (camera, GPIO) only work on the Raspberry Pi. When user reports issues or provides screenshots, they are ALWAYS from the Pi, not from Replit webview.
- **SSH Access to Pi**: `ssh naniwa@192.168.59.249 -p 5555`

## System Architecture

### System Resilience
ShelfEye includes 4 layers of protection for long-term reliability:
1. **Hardware Watchdog** (`enable-watchdog.sh`): Auto-reboot on complete system freeze (15s timeout via bcm2835_wdt)
2. **SystemD Auto-Restart** (`shelfeye.service`): Restarts on crash (10s delay, max 5 attempts in 10min), with resource limits (CPU: 380%, Memory: 1.8GB max)
3. **Daily Maintenance** (scheduler at 3AM JST): Auto-cleanup of logs (3yr retention), alerts (30d), ROI images (60d), plus emergency disk cleanup at 80%+ usage
4. **Health Monitoring** (`/api/health`, `monitor-system-health.sh`): Real-time metrics (uptime, memory, disk, temperature, errors)

### Frontend Architecture
The frontend uses React with TypeScript, Vite, TanStack Query, Wouter, and Tailwind CSS with shadcn/ui. It features a component-based design, modal-driven interactions, and utilizes the Canvas API for interactive slot drawing with zoom/pan and ArUco overlays. It supports configurable canvas aspect ratios for ISO A-series paper sizes and uses Recharts for analytics. Server state is managed via TanStack Query, with local component state for UI.

### Backend Architecture
The backend is built with Express.js on Node.js using TypeScript and ESM modules. It provides RESTful JSON APIs and manages child processes for Python-based computer vision operations and file system interactions.

### Data Storage
PostgreSQL (Neon serverless) is used for persistent storage via Drizzle ORM, storing camera configurations, slots, detection logs, alert rules, system settings, and worker data. File system storage is used for live previews, ROI archives (per-camera subdirectories), and rectified calibration images, with camera ID namespacing. Data retention policies include 3 years for detection logs, 2 months for ROI images, and 30 days for sent alerts, with daily and disk-usage-triggered cleanup.

### System Design Choices
The UI/UX for calibration uses paper-size formats (e.g., "A4-landscape") with a rectified preview featuring grid and template overlays. A 6-Page multi-sheet template system allows for large area coverage with automated slot creation. The system includes auto-start/update via systemd, GPIO LED strip integration for lighting and visual alerts, and a robust detection and alert system with a state machine, binary ArUco marker visibility logic, and time-based monitoring with grace periods.

ArUco marker IDs are allocated as: 1-50 for tool slots, 51-95 for worker identification (max 45 workers), and 96-99 for corner calibration, all using the DICT_4X4_100 dictionary. Slot ROIs are scanned for optimal accuracy.

**Real-Time Homography Adjustment (Implemented Jan 2026)**: During each scheduled capture, the system detects corner ArUco markers (96-99) and calculates a fresh homography matrix from the current marker positions. This compensates for minor camera/template movement between calibration and capture, ensuring slots remain properly aligned. The raw camera frame is rectified to a top-down view using this homography, and slot coordinates are calculated in rectified space from stored cm values (xCm, yCm, widthCm, heightCm). Key functions in `process_cameras.py`:
- `detect_corner_markers()`: Finds ArUco markers 96-99, returns their centers
- `calculate_homography_from_corners()`: Builds cm→pixel mapping using 2.5cm corner offset
- `rectify_frame()`: Warps camera frame to top-down view at 31.8 px/cm
- `calculate_rectified_region_coords()`: Converts slot cm values to rectified pixel coordinates

**Diagnostic & Capture Checks**: Corner ArUco markers (IDs 96-99) are validated at multiple points:
1. **Startup Validation**: On system boot, ALL calibrated cameras are validated sequentially; red LED flash triggers if ANY camera fails.
2. **Pre-Capture Diagnostics**: 30 minutes before each scheduled capture, corner markers are validated.
3. **During Capture**: Each scheduled capture validates all 4 corner markers BEFORE processing slots. If fewer than 4 markers are detected, the camera is marked as "failed" and Google Sheets shows red ✕ instead of numbers. This differentiates between "template sheets not in place" vs "all tools checked out".

Slot markers (IDs 1-50) are NOT checked since they are normally covered by tools.

**Environment Monitoring (Added Jan 2026)**: DHT20 temperature/humidity sensor readings are logged to Google Sheets during each scheduled capture:
- Row 19: Temperature in °C (e.g., "23.5°C")
- Row 20: Humidity in % (e.g., "65%")
- Sensor failures display red ✕ with the same formatting as camera failures

### Camera Configuration (CRITICAL)
Cameras must be forced to MJPEG format for optimal performance (7-10fps at 4K, 15-60fps at 1080p), preventing YUYV throttling. A dual-resolution strategy is employed: 1920x1080 for previews and 3840x2160 for high-accuracy calibration/validation (single frame). Default camera settings are configured for bright, natural images with auto-exposure and auto-focus. A 10-second warmup period is implemented for auto-exposure convergence. The post-processing pipeline includes multi-frame sharpness selection, auto brightness/contrast, gamma correction, and sharpening. Memory is optimized with a buffer size of 1 and immediate grayscale conversion. All Python scripts must explicitly force MJPEG.

### LED Control Architecture (CRITICAL)

**Hardware**: WS2812B LED strip (99 LEDs default) on GPIO 18, DMA channel 10, controlled via rpi_ws281x library.

### GPIO Pin Mapping (Raspberry Pi)

| Physical Pin | BCM GPIO | Function | Connection |
|-------------|----------|----------|------------|
| PP 1 | - | 3.3V Power | DHT20 sensor power |
| PP 2 | - | 5V Power | LED strip power (+) |
| PP 3 | GPIO 2 | I2C SDA | DHT20 data |
| PP 4 | - | 5V Power | Fan case power |
| PP 5 | GPIO 3 | I2C SCL | DHT20 clock |
| PP 6 | - | Ground | Fan case ground |
| PP 9 | - | Ground | LED strip ground (-) |
| PP 12 | GPIO 18 | PWM | LED strip data |
| PP 14 | - | Ground | DHT20 ground |
| PP 17 | - | 3.3V Power | Buzzer power (Ario 2401) |
| PP 20 | - | Ground | Buzzer ground |

**Notes**: Visual alerts use the LED strip (red flash mode). The DHT20 uses I2C for temperature/humidity readings. The Ario 2401 buzzer is power-only (no GPIO control).

**Architecture**: Daemon-based client-server model that eliminates DMA channel conflicts:
- **LED Manager Daemon** (`python/led_manager_service.py`): Long-running systemd service with exclusive DMA hardware access. Runs as root, starts automatically on boot.
- **LED Control Client** (`python/led_control_client.py`): CLI tool called by Node.js backend via sudo. Communicates with daemon via named pipes (IPC).
- **TypeScript Interface** (`server/utils/led-control.ts`): High-level API for LED operations. Reads LED count and brightness from database config.

**IPC Protocol**: JSON commands sent via named pipe (`/home/naniwa/ShelfEye/state/led_command_pipe`) with temporary response pipes for replies. 5-second timeout for daemon communication.

**Priority System**:
1. **RED_FLASH** (Priority 2): Alert state, flashes red continuously. Cannot be overridden.
2. **WHITE** (Priority 1): Calibration/validation lighting. Blocked during alerts.
3. **OFF** (Priority 0): Default state. Always succeeds.

**State Management**: Daemon maintains persistent state in `/home/naniwa/ShelfEye/state/led_state.json` with automatic restoration on startup. LED state (white/red_flash/off) is saved on every change and restored within 24 hours after crashes/reboots, ensuring alerts and calibration lighting persist through system restarts. Flash thread uses lock-release-join pattern to prevent deadlocks during state transitions.

**Configuration**: Database-driven LED count (default 99) and brightness (default 100, 0-255 range). Values dynamically propagated from UI → Database → TypeScript → Client → Daemon. Brightness updates apply immediately; LED count changes require daemon restart.

**Thread Safety**: All LED state changes protected by `state_lock` mutex. Flash thread stops gracefully by checking `flash_active` flag every 500ms. Join operations always happen with lock released to prevent deadlock.

**Installation**:
```bash
# Step 1: Kill any stuck LED processes (if LEDs are stuck on)
./kill-stuck-led-processes.sh

# Step 2: Install GPIO permissions
./install-gpio-permissions.sh

# Step 3: Install daemon (manual)
./install-led-daemon.sh

# Automatic install (via startup script)
./pi-startup.sh  # Installs daemon and starts service
```

**Daemon Management**:
```bash
# Control service
sudo systemctl {start|stop|restart|status} led-manager

# View logs
sudo journalctl -u led-manager -f

# Test client
sudo python3 python/led_control_client.py status
sudo python3 python/led_control_client.py white --brightness 100
```

**Migration from Legacy**: Old scripts (`alert_led.py`, `gpio_controller.py`) removed. `unified_led_controller.py` kept for backward compatibility but deprecated. All LED control now flows through daemon architecture.

**Troubleshooting**:
- **LED commands timeout (5s)**: Daemon not running or named pipe missing. Check `systemctl status led-manager`.
- **Daemon fails to start**: Check `journalctl -u led-manager` for errors. Verify rpi_ws281x library installed.
- **Flash won't stop**: Deadlock bug fixed in Phase 2 refactor. Ensure latest daemon code deployed.
- **Config not applied**: Ensure database values populated. Check `/home/naniwa/ShelfEye/state/led_daemon_config.json`.

## External Dependencies

### Third-Party Services
- **Neon Serverless Postgres**: Cloud database.
- **SMTP Email Server**: For alert delivery.
- **Google Sheets API**: Secondary logging destination.

### Computer Vision Libraries
- **OpenCV**: ArUco marker detection, image processing, homography, perspective correction.
- **pyzbar**: Legacy QR code decoder.

### UI Component Libraries
- **Radix UI Primitives**: Accessible UI components.
- **Recharts**: Charting library for analytics.
- **cmdk**: Command palette.
- **embla-carousel-react**: Carousel component.
- **jsPDF**: PDF generation for template printing with embedded Noto Sans JP fonts (13MB variable + 22MB bold OTF) for proper Japanese character rendering.

### Utility Libraries
- **date-fns**: Date manipulation.
- **clsx & tailwind-merge**: Conditional className handling.
- **zod**: Runtime type validation.
- **drizzle-zod**: Zod schema generation.

### Development Tools
- **tsx**: TypeScript execution.
- **esbuild**: Fast bundling.
- **drizzle-kit**: Database migrations.