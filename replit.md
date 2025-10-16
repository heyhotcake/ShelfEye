# Tool Tracking System - Compressed Development Guide

## Overview

A Raspberry Pi-based automated tool monitoring system utilizing computer vision, QR codes, and ArUco markers for real-time tool tracking across multiple cameras. It features HMAC-signed QR validation, temporal smoothing for presence detection, and multi-channel alerting (email, Google Sheets, sound). The system includes a React web dashboard for calibration, configurable slot management, analytics, and system administration. Its core purpose is to prevent tool loss and improve accountability in workshops by tracking tool presence and checkout status.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

- **Rectified Preview with Template Overlay (Oct 2025)**: Implemented visualization of template slot positions overlaid on the rectified camera view for alignment verification. Python script (`rectified_preview.py`) creates a top-down rectified image using homography transformation with proper coordinate mapping (M = H @ S_inv where S_inv scales output pixels to cm). Templates are rendered as magenta rectangles with rotation support, scaled using the same transformation as the warp for pixel-perfect alignment. Backend (`/api/rectified-preview/:cameraId`) fetches template rectangles with category dimensions and rotation angles, retrieves paper size from calibration config, and passes all data to Python. Frontend displays rectified preview with loading states and error handling. Transformation chain: output_pixel → cm (via S_inv) → camera_pixel (via H), ensuring template overlays match physical positions. Supports rotated templates via rotation matrix applied in cm space before pixel conversion. Production-ready with comprehensive logging and error handling.

- **Google OAuth2 Migration for Standalone Operation (Oct 2025)**: Migrated from Replit-dependent Google service connectors to standard OAuth2 for standalone Raspberry Pi operation. Implemented complete OAuth2 authorization code flow with refresh token support for Gmail API (email alerts) and Google Sheets API (logging). Created `googleOAuthCredentials` database table with `redirectUri` field for proper callback handling. Built OAuth client services (`gmail-client-oauth.ts`, `sheets-client-oauth.ts`) with automatic token refresh. Frontend provides dedicated `/google-oauth` setup page with credential configuration, authorization flow, and status display. Backend routes handle OAuth setup (`/api/oauth/google/setup`), authorization URL generation, and callback processing (`/api/oauth/google/callback`). Updated email-alerts and sheets-logger services to use new OAuth clients. Comprehensive setup documentation (GOOGLE_OAUTH_SETUP.md) guides users through Google Cloud Console configuration, API enablement, OAuth credential creation, and system authorization. System validates redirect URI consistency across all components and stores user-configured redirect URI in database. Production-ready with proper error handling and security.

- **Two-Step Calibration Validation (Oct 2025)**: Implemented comprehensive QR code validation during calibration to ensure proper setup. The calibration process now has three steps: (1) ArUco corner marker detection and homography calculation, (2) Validation that all slot QR codes are readable when slots are empty, (3) Validation that QR codes are properly covered when tools are placed. Python validation script (`validate_slot_qrs.py`) decodes QR codes from rectified camera view, validates HMAC signatures using same algorithm as QR generation, and matches against expected slot identifiers. Backend provides two validation endpoints (`/validate-qrs-visible` and `/validate-qrs-covered`) that pass `slot.expectedQrId` to match QR payload `id` field. Frontend guides users through step-by-step process with clear instructions, real-time validation feedback, and detailed error messages showing which slots are missing or visible. Includes reset functionality to restart calibration process. Production-ready with comprehensive error handling.

- **Paper Size Format Support for Calibration (Oct 2025)**: Refactored calibration system to use paper size formats (e.g., "6-page-3x2", "A4-landscape") instead of camera resolution for ArUco marker positioning. Intelligent template selection: single-template cameras auto-use paper size, multi-template cameras require user selection with validation. Frontend resets template selection on camera change, validates templates belong to active camera, and blocks calibration with clear errors when multi-template cameras have no selection. Backend validates paper size format with detailed error messages, converts format to physical dimensions (cm) for Python calibrator. System stores `last_calibration_paper_size_format` in config for startup re-calibration. Supports all scenarios: single/multi/no templates, camera switching, multi-camera setups. Production-ready with comprehensive error handling and validation.

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
- `data/<slot_id>_last.png` for live previews.
- `data/rois/<slot_id>/<YYYY-MM>/<timestamp>_<slot_id>.png` for ROI archives.

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

**Detection & Alert System:**
- **State Machine**: ITEM_PRESENT → EMPTY → CHECKED_OUT.
- **QR Type System**: "slot" and "worker" types.
- **Binary Detection Logic**: Based on QR visibility and type.
- **Worker Validation**: Database lookup for worker QR codes to track checkouts and identify unauthorized removals.
- **Checkout Tracking**: Detection logs include worker ID for relational tracking and historical reports.
- **Business Rules Engine**: Time-based monitoring with grace periods.
- **Queue-based Alerts**: Offline resilience with retry logic.
- **HMAC Signature Validation**: Prevents QR spoofing.

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