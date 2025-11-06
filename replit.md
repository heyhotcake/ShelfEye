# Tool Tracking System - Compressed Development Guide

## Overview
A Raspberry Pi-based automated tool monitoring system utilizing computer vision and ArUco markers for real-time tool tracking across multiple cameras. Its core purpose is to prevent tool loss and improve accountability in workshops by tracking tool presence and checkout status. Key features include ArUco marker validation, temporal smoothing for presence detection, multi-channel alerting (email, Google Sheets, sound), and a React web dashboard for calibration, configurable slot management, analytics, and system administration. The system supports 4K cameras with intelligent dual-resolution modes for live preview and high-accuracy calibration/capture. Worker tracking uses ArUco markers (IDs 51-95) with printable 5cm×15cm identification tags.

## Recent Changes

### Nov 6, 2025 - Multi-Camera Support: Phases 0-2 Complete

- **Phase 0 (Database Schema)**: Added `paperSize` field to cameras table to store per-camera template format preferences
- **Phase 1 (File Isolation & Namespacing)**: Complete file isolation with camera ID namespacing
  - All Python scripts accept `--camera-id` parameter
  - File paths namespaced: `latest_calibration_rectified_{cameraId}.png`, `validation_roi_{cameraId}_{slotId}.jpg`
  - Backend routes pass `--camera-id` to all Python scripts
  - ROI archives organized in per-camera subdirectories: `data/rois/{cameraId}/`
  - Retention service handles per-camera cleanup via recursive directory scanning
  
- **Phase 2 (Backend Sequencing)**: Global calibration lock enforces 2GB RAM constraint
  - Added global calibration lock to CameraSessionManager (5-minute timeout)
  - Only ONE camera can calibrate at a time across entire system
  - Concurrent calibration attempts rejected with HTTP 409 Conflict
  - Startup calibration service respects global lock
  - Successfully tested with two cameras (Camera 1: 4K at /dev/video0, Camera 2: 2K at /dev/video1)
  
- **Data Retention Update**: ROI image retention reduced from 3 months (90 days) to 2 months (60 days) to account for doubled storage usage with two cameras

- **Camera Configuration**: 
  - Camera 1 (Wide Shelf): 4K resolution (3840×2160) at /dev/video0
  - Camera 2 (Shelf 2): 2K resolution (1920×1080) at /dev/video1
  - Both cameras physically connected and configured in database

### Nov 6, 2025 - Integrated Calibration+Validation Architecture & Smart Recalibration Flow
- **Breakthrough: Raw Frame ArUco Detection**: Successfully resolved ArUco marker detection failures by detecting slot markers on the RAW camera frame (before warpPerspective transformation), eliminating interpolation artifacts that were corrupting marker bit patterns.
  - **Root Cause Identified**: cv2.warpPerspective with ANY interpolation mode (bilinear, bicubic, or INTER_NEAREST) corrupts 3cm ArUco markers at 31.8 px/cm density, breaking bit decoding (0 markers found, 20-1433 rejected candidates).
  - **Solution**: Integrated slot marker validation directly into calibration step using inverse homography to map slot positions (cm) → raw pixel coordinates, then extract ROIs from raw frame.
  - **Architecture**: Single calibration process now: (1) Captures 4K raw frame, (2) Detects 4 corner markers, (3) Calculates homography, (4) Validates ALL slot markers on same raw frame, (5) Generates rectified preview for UI.
  - **Result**: 100% detection success (7/7 slot markers) with zero false positives/negatives on first deployment test.
  
- **Performance Optimizations**: Reduced warmup times (40s→20s for calibration, 10s→5s for preview). Uses single camera capture for both calibration and validation. Maintains 140+ frames at 4K for auto-exposure convergence.

- **Smart Calibration Flow with Recalibration**: Adaptive 2-step flow that handles detection failures gracefully:
  - **Step 0**: Run ArUco Calibration → auto validates slot markers
  - **Success Path** (all slots detected): Auto-advance to Step 2 (verify tools cover markers)
  - **Failure Path** (missing slots): Show Step 1 (Rectified Preview with Template Overlay for manual adjustment)
  - **Step 1 Recalibration**: User adjusts slot positions on rectified preview → clicks "Recalibrate" → saves adjustments to DB + re-runs full corner+slot validation → loops back to success/failure path
  - **Step 2**: Verify tools cover markers (final validation step)
  
- **UI/UX Improvements**: 
  - Removed legacy /validate-markers-visible endpoint (215 lines)
  - Fixed worker checkbox selection bug: Changed state from `Set<string>` to `string[]` array for proper React re-rendering
  - Camera preview polling automatically pauses during calibration via isCameraLocked flag with 1-second delay to prevent "Pipeline handler in use by another" race condition
  - Error state banner with clear instructions for recalibration
  - Dynamic button text: "Recalibrate" (no adjustments) or "Save Adjustments & Recalibrate" (with adjustments)
  
- **Worker Tag Printing**: 
  - 3cm × 3cm ArUco markers on 5cm × 15cm tags (A4 layout, 3 tags per page)
  - Browser print function supports Japanese characters (PDF download removed due to jsPDF limitations)
  - Worker tags include ArUco marker, name, team, and scissor-cut corner guides
  - Fixed ArUco generation: Must specify `mode: 'single'` in API request
  
- **Remaining Legacy Code**: validate_slot_qrs.py (679 lines) still used by /validate-markers-covered endpoint. Will be removed when covered validation is reworked to use raw-frame detection.

### Nov 5, 2025
- **Worker Tracking System with ArUco Markers**: Implemented comprehensive worker identification system using ArUco markers for tool usage tracking.
  - **Worker ArUco IDs**: Auto-assigned from 51-95 range (max 45 workers), unique across all camera stations, reusable after deletion
  - **Worker Registration**: Japanese name (required) + optional team field, auto-generated worker codes (W001, W002, etc.)
  - **Printable Worker Tags**: 5cm×15cm tags with ArUco marker, name, team, and scissor-cut corner guides
  - **Tag Printing**: A4 layout with 3cm safety margins, 3 tags per page, multi-page support for bulk printing
  - **Worker Management UI**: Checkbox selection, bulk Print Tags button, streamlined registration form
  - **Database Schema**: Added arucoId (integer, unique) and team fields to workers table
  - **Detection Logic**: Worker ArUco at slot = tool in use, visible slot marker = ERROR (missing tool without worker tag)

- **Completed QR-to-ArUco Migration Cleanup** (Nov 4, 2025): Fully transitioned from QR code-based slot identification to ArUco marker system.
  - **ArUco Marker IDs**: Corner markers (96-99), Slot markers (1-50), Dictionary (DICT_4X4_100)
  - **API Endpoints**: Renamed `/validate-qrs-*` to `/validate-markers-*` for clarity
  - **Frontend**: Updated all UI labels, toast messages, and mutation names to reflect ArUco marker terminology
  - **Database Schema**: Added clarifying comments to legacy columns (expectedQrId, qrId, autoQrId now store ArUco marker IDs)
  - **Code Cleanup**: Removed unused QR detection Python scripts
  - **Backward Compatibility**: Database column names preserved to avoid breaking existing data

## User Preferences
- Preferred communication style: Simple, everyday language.
- **Deployment Context**: User runs the application on a Raspberry Pi at `http://naniwatanacheck.local:5000`. **ALL debugging, testing, and issue reports refer to the Pi deployment, NOT the Replit web preview.** The Replit environment is for code development only; actual hardware features (camera, GPIO) only work on the Raspberry Pi. When user reports issues or provides screenshots, they are ALWAYS from the Pi, not from Replit webview.

## System Architecture

### Frontend Architecture
- **Technology Stack**: React with TypeScript, Vite, TanStack Query, Wouter, Tailwind CSS with shadcn/ui.
- **Key Design Patterns**: Component-based, modal-driven interactions, Canvas API for interactive slot drawing with zoom/pan and ArUco overlays. Configurable canvas aspect ratios for ISO A-series paper sizes. Dual version management for templates and slots using localStorage. Recharts for analytics. Real-time polling for dashboard updates.
- **State Management**: Server state via TanStack Query; local component state for UI.

### Backend Architecture
- **Framework & Runtime**: Express.js on Node.js with TypeScript and ESM modules.
- **API Design**: RESTful endpoints in JSON format, handling child process spawning for Python CV operations and file system operations.
- **Python Integration**: OpenCV-based computer vision modules (ArUco calibration, ArUco marker detection, homography) executed as child processes for perspective correction and slot marker visibility detection.

### Data Storage
- **Database**: PostgreSQL (Neon serverless) using Drizzle ORM for persistent storage of cameras, slots, detection logs, alert rules, system config, and workers.
- **File Storage Strategy**: Live previews, ROI archives (per-camera subdirectories), and rectified calibration images are stored on the file system with camera ID namespacing.
- **Data Retention & Cleanup**: Detection logs (3 years), ROI images (2 months), sent alerts (30 days). Daily maintenance runs at 3:00 AM JST. Emergency/accelerated cleanup triggered by disk usage thresholds.

### System Design Choices
- **UI/UX**: Calibration system uses paper size formats (e.g., "A4-landscape"). Rectified preview with grid and template overlays. 6-Page multi-sheet template system for large areas with automated slot creation. Dual-image calibration output: clean version for marker validation (no overlays) and labeled version for user download (with grid/labels).
- **Technical Implementations**: Auto-start and auto-update via systemd services. GPIO LED light strip integration for dual-purpose lighting and visual alerts. Worker ArUco markers (IDs 51-95) for checkout tracking. Binary ArUco marker detection logic for slot monitoring.
- **LED Strip Configuration**: Two WS2812B LED strips (99 total LEDs) on GPIO 18 (BCM), requiring an external 5V power supply and a 3.3V to 5V logic level shifter for data signal.
- **Detection & Alert System**: State machine for tool presence. Binary detection logic based on ArUco marker visibility. Worker validation using ArUco markers (IDs 51-95). Time-based monitoring with grace periods. Queue-based alerts with retry logic.
- **ArUco Marker Strategy**: Per-slot ROI (Region of Interest) scanning for optimal accuracy with up to 50 slots. ArUco ID allocation: 1-50 for tool slots, 51-95 for worker identification (max 45 workers), 96-99 for corner calibration. Dictionary: DICT_4X4_100. Each slot is identified by a unique ArUco marker with per-template-design sequential numbering (1-X for each saved design). Corner markers are used for calibration and perspective correction. Worker markers enable tool usage tracking.

### Camera Configuration (CRITICAL)
- **Format**: MJPEG (Motion-JPEG) format MUST be forced on all camera captures. YUYV format at high resolutions throttles to 0.1fps, preventing auto-exposure convergence. MJPEG achieves 7-10fps at 4K and 15-60fps at 1080p.
- **Resolution Strategy**: Dual-resolution mode to prevent RAM overload on 2GB Raspberry Pi:
  - Preview: 1920x1080 (~6MB per frame, safe for RAM)
  - Calibration/Validation: 3840x2160 (high accuracy, single frame only)
- **Camera Settings** (defaults that produce bright, natural images):
  - Brightness: 128 (default)
  - Contrast: 28 (default)
  - Gain: 0 (auto)
  - Auto-exposure: Mode 3 (Aperture Priority)
  - Auto-focus: Enabled
  - Auto white balance: Enabled
- **Warmup**: 10 seconds continuous frame capture to allow auto-exposure convergence (152+ frames at 1920x1080, 70-100 frames at 4K)
- **Post-processing Pipeline**: Multi-frame sharpness selection → auto brightness/contrast → gamma correction (1.15) → sharpening
- **Memory Optimization**: Buffer size = 1, single-frame calibration, immediate grayscale conversion for validation
- **ALL Python scripts** must force MJPEG: camera_preview.py, aruco_calibrator.py, validate_slot_qrs.py, camera_manager.py, rectified_preview.py, process_cameras.py, camera_diagnostic.py

## External Dependencies

### Third-Party Services
- **Neon Serverless Postgres**: Cloud database.
- **SMTP Email Server**: For alert delivery.
- **Google Sheets API**: Secondary logging destination.

### Computer Vision Libraries
- **OpenCV**: ArUco marker detection, image processing, homography, perspective correction.
- **pyzbar**: Legacy QR code decoder (may be deprecated in future).

### UI Component Libraries
- **Radix UI Primitives**: Accessible UI components.
- **Recharts**: Charting library for analytics.
- **cmdk**: Command palette.
- **embla-carousel-react**: Carousel component.

### Utility Libraries
- **date-fns**: Date manipulation.
- **clsx & tailwind-merge**: Conditional className handling.
- **zod**: Runtime type validation.
- **drizzle-zod**: Zod schema generation.

### Development Tools
- **tsx**: TypeScript execution.
- **esbuild**: Fast bundling.
- **drizzle-kit**: Database migrations.