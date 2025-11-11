# Tool Tracking System - Compressed Development Guide

## Overview
The Tool Tracking System is a Raspberry Pi-based solution for real-time tool monitoring in workshops. It uses computer vision and ArUco markers to track tool presence and checkout status, aiming to prevent tool loss and improve accountability. Key features include ArUco marker validation, temporal smoothing, multi-channel alerting (email, Google Sheets, sound), and a React web dashboard for calibration, slot management, analytics, and administration. The system supports 4K cameras with intelligent dual-resolution modes and worker tracking via ArUco-enabled identification tags.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **Deployment Context**: User runs the application on a Raspberry Pi at `http://naniwatanacheck.local:5000`. **ALL debugging, testing, and issue reports refer to the Pi deployment, NOT the Replit web preview.** The Replit environment is for code development only; actual hardware features (camera, GPIO) only work on the Raspberry Pi. When user reports issues or provides screenshots, they are ALWAYS from the Pi, not from Replit webview.

## System Architecture

### Frontend Architecture
The frontend uses React with TypeScript, Vite, TanStack Query, Wouter, and Tailwind CSS with shadcn/ui. It features a component-based design, modal-driven interactions, and utilizes the Canvas API for interactive slot drawing with zoom/pan and ArUco overlays. It supports configurable canvas aspect ratios for ISO A-series paper sizes and uses Recharts for analytics. Server state is managed via TanStack Query, with local component state for UI.

### Backend Architecture
The backend is built with Express.js on Node.js using TypeScript and ESM modules. It provides RESTful JSON APIs and manages child processes for Python-based computer vision operations and file system interactions.

### Data Storage
PostgreSQL (Neon serverless) is used for persistent storage via Drizzle ORM, storing camera configurations, slots, detection logs, alert rules, system settings, and worker data. File system storage is used for live previews, ROI archives (per-camera subdirectories), and rectified calibration images, with camera ID namespacing. Data retention policies include 3 years for detection logs, 2 months for ROI images, and 30 days for sent alerts, with daily and disk-usage-triggered cleanup.

### System Design Choices
The UI/UX for calibration uses paper-size formats (e.g., "A4-landscape") with a rectified preview featuring grid and template overlays. A 6-Page multi-sheet template system allows for large area coverage with automated slot creation. The system includes auto-start/update via systemd, GPIO LED strip integration for lighting and visual alerts, and a robust detection and alert system with a state machine, binary ArUco marker visibility logic, and time-based monitoring with grace periods.

ArUco marker IDs are allocated as: 1-50 for tool slots, 51-95 for worker identification (max 45 workers), and 96-99 for corner calibration, all using the DICT_4X4_100 dictionary. Slot ROIs are scanned for optimal accuracy.

**Diagnostic & Startup Checks**: Both the startup calibration (on system boot) and scheduled diagnostic checks (30 minutes before each capture) validate ONLY the 4 corner ArUco markers (IDs 96-99). Slot markers (IDs 1-50) are NOT checked since they are normally covered by tools. This ensures the camera position is stable without requiring tools to be removed.

### Camera Configuration (CRITICAL)
Cameras must be forced to MJPEG format for optimal performance (7-10fps at 4K, 15-60fps at 1080p), preventing YUYV throttling. A dual-resolution strategy is employed: 1920x1080 for previews and 3840x2160 for high-accuracy calibration/validation (single frame). Default camera settings are configured for bright, natural images with auto-exposure and auto-focus. A 10-second warmup period is implemented for auto-exposure convergence. The post-processing pipeline includes multi-frame sharpness selection, auto brightness/contrast, gamma correction, and sharpening. Memory is optimized with a buffer size of 1 and immediate grayscale conversion. All Python scripts must explicitly force MJPEG.

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