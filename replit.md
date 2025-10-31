# Tool Tracking System - Compressed Development Guide

## Overview
A Raspberry Pi-based automated tool monitoring system utilizing computer vision, QR codes, and ArUco markers for real-time tool tracking across multiple cameras. Its core purpose is to prevent tool loss and improve accountability in workshops by tracking tool presence and checkout status. Key features include QR code validation, temporal smoothing for presence detection, multi-channel alerting (email, Google Sheets, sound), and a React web dashboard for calibration, configurable slot management, analytics, and system administration. The system supports 4K cameras with intelligent dual-resolution modes for live preview and high-accuracy calibration/capture.

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
- **Python Integration**: OpenCV-based computer vision modules (ArUco calibration, QR decoding, homography) executed as child processes for perspective correction and slot QR visibility detection.

### Data Storage
- **Database**: PostgreSQL (Neon serverless) using Drizzle ORM for persistent storage of cameras, slots, detection logs, alert rules, system config, and workers.
- **File Storage Strategy**: Live previews, ROI archives, and rectified calibration images are stored on the file system.
- **Data Retention & Cleanup**: Detection logs (3 years), ROI images (3 months), sent alerts (30 days). Daily maintenance runs at 3:00 AM JST. Emergency/accelerated cleanup triggered by disk usage thresholds.

### System Design Choices
- **UI/UX**: Calibration system uses paper size formats (e.g., "A4-landscape"). Rectified preview with grid and template overlays. 6-Page multi-sheet template system for large areas with automated slot creation.
- **Technical Implementations**: Auto-start and auto-update via systemd services. GPIO LED light strip integration for dual-purpose lighting and visual alerts. Worker QR validation against a database for checkout tracking. Simplified QR-based detection logic.
- **LED Strip Configuration**: Two WS2812B LED strips (99 total LEDs) on GPIO 18 (BCM), requiring an external 5V power supply and a 3.3V to 5V logic level shifter for data signal.
- **Detection & Alert System**: State machine for tool presence. Binary detection logic based on QR visibility. Worker validation. Time-based monitoring with grace periods. Queue-based alerts with retry logic. Simple ID payloads for QR codes.

## External Dependencies

### Third-Party Services
- **Neon Serverless Postgres**: Cloud database.
- **SMTP Email Server**: For alert delivery.
- **Google Sheets API**: Secondary logging destination.

### Computer Vision Libraries
- **OpenCV**: ArUco detection, image processing, homography, QR decoding.
- **pyzbar**: Primary QR code decoder.

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