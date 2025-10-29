# Tool Tracking System - Compressed Development Guide

## Overview

A Raspberry Pi-based automated tool monitoring system utilizing computer vision, QR codes, and ArUco markers for real-time tool tracking across multiple cameras. It features simple QR code validation, temporal smoothing for presence detection, and multi-channel alerting (email, Google Sheets, sound). The system includes a React web dashboard for calibration, configurable slot management, analytics, and system administration. Its core purpose is to prevent tool loss and improve accountability in workshops by tracking tool presence and checkout status.

## User Preferences

- Preferred communication style: Simple, everyday language.
- **Deployment Context**: User runs the application on a Raspberry Pi at `http://naniwatanacheck.local:5000`. **ALL debugging, testing, and issue reports refer to the Pi deployment, NOT the Replit web preview.** The Replit environment is for code development only; actual hardware features (camera, GPIO) only work on the Raspberry Pi. When user reports issues or provides screenshots, they are ALWAYS from the Pi, not from Replit webview.

## Raspberry Pi Service Management

**Systemd Service Name**: `shelfeye.service` (NOT `shelfeye-app.service`)

**Project Location**: `/home/naniwa/ShelfEye`

**Common Commands:**
- Check status: `sudo systemctl status shelfeye.service`
- View logs: `sudo journalctl -u shelfeye.service -f`
- Restart service: `sudo systemctl restart shelfeye.service`
- Update code and restart:
  ```bash
  cd /home/naniwa/ShelfEye
  git pull origin main
  sudo systemctl daemon-reload  # Reload if service file changed
  sudo systemctl restart shelfeye.service
  ```

**Important**: The service includes auto-update functionality that pulls latest code from GitHub on startup.

**Resource Limits (Long-Term Reliability):**
- CPU: 380% (3.8 cores out of 4, leaves 0.2 for OS)
- Memory Soft Limit: 1.5GB (triggers swapping/slowdown warning)
- Memory Hard Limit: 1.8GB (process killed if exceeded, auto-restarts)
- Restart Safety: Max 5 restarts in 10 minutes (prevents infinite loops)
- On memory kill: 10-second gap, then auto-restart with fresh memory state

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React with TypeScript, Vite, TanStack Query, Wouter.
- Tailwind CSS with a custom dark theme and shadcn/ui.

**Key Design Patterns:**
- Component-based architecture with modal-driven interactions.
- Canvas API for interactive slot drawing with zoom/pan and ArUco overlays.
- Configurable canvas aspect ratios for ISO A-series paper sizes and multi-sheet templates.
- Dual version management (template and slot configurations) using localStorage.
- Recharts for analytics visualization.
- Real-time polling for dashboard updates (30-second intervals).
- Detection logs display diagnostic data (detection method, SSIM score, pose quality) for troubleshooting random detection failures.

**State Management Strategy:**
- Server state managed via TanStack Query.
- Local component state for UI interactions.

### Backend Architecture

**Framework & Runtime:**
- Express.js server on Node.js with TypeScript and ESM modules.

**API Design:**
- RESTful endpoints, JSON format, child process spawning for Python CV operations, file system operations.
- Key APIs for cameras, calibration, slots, detection logs, alert rules, QR generation, workers, and GPIO control.

**Python Integration:**
- OpenCV-based computer vision modules (ArUco calibration, QR decoding, homography).
- Executed as child processes for perspective correction and slot QR visibility detection.

### Data Storage

**Database:**
- PostgreSQL (Neon serverless) using Drizzle ORM for type-safe queries.
- Persistent storage for cameras, slots, detection logs, alert rules, system config, and workers.

**File Storage Strategy:**
- `data/<slot_id>_last.png` for live previews (overwritten each capture).
- `data/rois/<slot_id>/<YYYY-MM>/<timestamp>_<slot_id>.png` for ROI archives.
- `data/latest_calibration_rectified.jpg` for high-res rectified image from ArUco calibration (reused for QR validation).

**Data Retention & Cleanup:**
- Detection logs: 3 years (1,095 days)
- ROI images: 3 months (90 days)
- Sent alerts: 30 days
- Daily maintenance: Runs at 3:00 AM JST
- Emergency cleanup: Triggered at 90% disk usage (reduces retention to 30 days)
- Accelerated cleanup: Triggered at 80% disk usage (reduces retention to 60 days)

### System Design Choices

**UI/UX:**
- Calibration system uses paper size formats (e.g., "A4-landscape") for ArUco marker positioning.
- Rectified preview with grid overlay and template slot overlays for alignment verification after calibration.
- Template overlays rendered as magenta rectangles with labels, supporting rotation and accurate positioning.
- 6-Page (3x2 A4) multi-sheet template system for large areas, with edge-to-edge alignment and ArUco markers on corner sheets.
- Automated slot creation from templates after calibration, removing manual polygon drawing.
- Alert LED visual notifications using WS2812B strip (flashing red for alerts, white for photo illumination).

**Technical Implementations:**
- Auto-start and auto-update system using systemd services and GitHub for Raspberry Pi deployments.
- GPIO LED light strip integration for dual-purpose lighting (consistent image capture and visual alerts).
- Comprehensive Raspberry Pi deployment package for automated setup.
- Worker QR validation against a database for checkout tracking, logging valid workers and treating invalid ones as EMPTY.
- Simplified QR-based detection: Slot QR visible = tool missing; Worker QR visible = checked out; No QR visible = tool present.
- Gmail and Google Sheets integration for multi-channel alerts and logging.
- ArUco corner markers (IDs 17-20) positioned at extreme corners of the printable area.
- **Long-term reliability systems**: Automated daily maintenance, disk space monitoring, graceful degradation on low storage, systemd resource limits (CPU 380%, Memory 1.5GB/1.8GB).

**Detection & Alert System:**
- **State Machine**: ITEM_PRESENT → EMPTY → CHECKED_OUT.
- **QR Type System**: "slot" and "worker" types with simple ID strings.
- **Binary Detection Logic**: Based on QR visibility and type.
- **Worker Validation**: Database lookup for worker QR codes to track checkouts and identify unauthorized removals.
- **Checkout Tracking**: Detection logs include worker ID for relational tracking and historical reports.
- **Detection Method Logging**: Tracks which detection method/scale was used (e.g., "pyzbar_adaptive_x2") for diagnosing random detection failures and identifying lighting vs resolution issues.
- **Business Rules Engine**: Time-based monitoring with grace periods.
- **Queue-based Alerts**: Offline resilience with retry logic.
- **QR Code Format**: Simple ID payloads (e.g., "pen-001", "worker-john") optimized for 40mm scanning reliability.

## External Dependencies

**Third-Party Services:**
- **Neon Serverless Postgres**: Cloud database.
- **SMTP Email Server**: For alert delivery.
- **Google Sheets API**: Secondary logging destination.

**Computer Vision Libraries:**
- **OpenCV**: ArUco detection, image processing, homography, QR decoding.
- **pyzbar**: Primary QR code decoder.

**UI Component Libraries:**
- **Radix UI Primitives**: Accessible UI components.
- **Recharts**: Charting library for analytics.
- **cmdk**: Command palette.
- **embla-carousel-react**: Carousel component.

**Utility Libraries:**
- **date-fns**: Date manipulation.
- **clsx & tailwind-merge**: Conditional className handling.
- **zod**: Runtime type validation.
- **drizzle-zod**: Zod schema generation.

**Development Tools:**
- **tsx**: TypeScript execution.
- **esbuild**: Fast bundling.
- **drizzle-kit**: Database migrations.

## Troubleshooting & Debugging

### QR Validation Errors

**Issue**: QR validation fails but no error message appears in the UI on the Raspberry Pi deployment.

**Fix Applied** (Oct 29, 2025):
- Enhanced error logging in `server/routes.ts` to capture Python script failures
- Backend now returns detailed error messages to the UI toast notifications
- Server logs show full Python output when validation fails

**How to Debug QR Detection:**

1. **View Real-Time Validation Logs** (SSH into Raspberry Pi):
   ```bash
   # Monitor live validation output
   sudo journalctl -u shelfeye.service -f | grep -i "validation\|qr"
   ```

2. **Check Which QR Codes Were Detected** (SSH into Raspberry Pi):
   ```bash
   cd /home/naniwa/ShelfEye
   
   # Run validation manually to see all detected QRs
   sudo python3 python/validate_slot_qrs.py \
     --resolution "2560x1440" \
     --should-detect "true" \
     --use-saved-rectified
   ```
   
   Output shows:
   - Total QR codes detected
   - Specific QR IDs found (e.g., "pen-001", "worker-john")
   - Expected QRs that are missing
   - Position information for each QR

3. **Check Server Logs for Detailed Errors**:
   ```bash
   # View last 100 lines of logs
   sudo journalctl -u shelfeye.service -n 100 --no-pager
   
   # Search for validation errors
   sudo journalctl -u shelfeye.service | grep -i "validation failed"
   ```

4. **Test Camera Directly**:
   ```bash
   cd /home/naniwa/ShelfEye
   
   # Capture a test image to verify camera is working
   python3 python/camera_preview.py 0 2560 1440
   ```

### Alert System Failures

**Issue**: Camera diagnostic failures don't trigger alarms (LED, email, sheets).

**Fix Applied** (Oct 29, 2025):
- Alert type naming mismatch corrected in `server/scheduler.ts`
- Changed uppercase alert types (`'DIAGNOSTIC_ERROR'`) to lowercase (`'diagnostic_failure'`)
- Added backward compatibility for legacy uppercase types
- Added warning logging for unknown alert types

**Alert Types:**
- `diagnostic_failure` - Camera diagnostic failures
- `capture_failure` - Capture processing failures
- `camera_offline` - Camera offline/unavailable
- `test_alert` - Manual test alerts

**Test Alert System**:
```bash
# Check if alerts are being triggered in logs
sudo journalctl -u shelfeye.service -f | grep -i "alert\|led"
```

### Rectified Preview vs Actual Detection Quality

**Understanding**: The rectified preview shown in the UI is **downscaled to 800x600** for display purposes only. The actual QR detection uses the **full camera resolution (2560x1440)** without downscaling.

**Why Preview Looks Blurry**:
- Preview: 800x600 pixels (for UI display)
- Actual QR Detection: Uses full 2560x1440 resolution directly from camera
- No quality loss in actual detection process

**Camera Resolution Settings**:
- Current: 2560x1440 (QHD)
- Upgrade to 4K: 3840x2160 (requires 4K-capable camera and recalibration)
- Stored in database per-camera in `cameras.resolution` field