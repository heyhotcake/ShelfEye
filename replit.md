# Tool Tracking System - Development Guide

## Overview

A Raspberry Pi-based automated tool monitoring system that uses computer vision, QR codes, and ArUco marker calibration (4 corner markers) to track tools across multiple cameras. The system provides real-time detection, HMAC-signed QR validation, temporal smoothing for presence detection, and multi-channel alerting (email, Google Sheets, sound). Features a React-based web dashboard for calibration, slot configuration, analytics, and system management. The number of tool slots is fully configurable based on your workshop needs.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React with TypeScript for type safety
- Vite as the build tool and dev server
- TanStack Query for server state management with optimistic updates
- Wouter for client-side routing (lightweight alternative to React Router)
- Tailwind CSS with custom dark theme design system
- shadcn/ui component library (Radix UI primitives)

**Key Design Patterns:**
- Component-based architecture with separation between pages, layouts, and UI components
- Modal-driven interactions for focused tasks (calibration, QR generation, configuration)
- Canvas API for interactive slot drawing with zoom/pan controls and ArUco marker overlays
- Configurable canvas aspect ratios for ISO A-series paper sizes (A5, A4, A3, multiple sheets)
- Dual version management system using localStorage:
  - Template versions: Saves rectangles, categories, and paper size configurations
  - Slot versions: Saves slot region configurations for camera overlays
- Recharts for analytics visualization and time-series data
- Real-time polling for live dashboard updates (30-second intervals)

**State Management Strategy:**
- Server state via TanStack Query with automatic background refetching
- Local component state for UI interactions (drawing, forms)
- No global state management needed - query cache serves as source of truth

### Backend Architecture

**Framework & Runtime:**
- Express.js server running on Node.js
- TypeScript throughout for type consistency
- ESM module system for modern JavaScript
- Session-based state (potential for auth in future)

**API Design:**
- RESTful endpoints organized by resource type
- JSON request/response format
- Child process spawning for Python CV operations
- File system operations for image storage and manifest tracking

**Key API Endpoints:**
- `/api/cameras` - Camera CRUD operations
- `/api/calibrate/:cameraId` - ArUco calibration trigger
- `/api/slots` - Slot configuration management
- `/api/detection-logs` - Historical detection data
- `/api/alert-rules` - Alert configuration
- `/api/qr-generate` - QR code generation with HMAC

**Python Integration:**
- OpenCV-based computer vision modules executed as child processes
- ArUco GridBoard calibration for perspective correction
- SSIM (Structural Similarity Index) for presence detection
- Multi-scale QR decoding with pyzbar fallback
- Homography computation and storage per camera

### Data Storage

**Database:**
- PostgreSQL via Neon serverless (configured in drizzle.config.ts)
- Drizzle ORM for type-safe database queries
- Schema-first approach with TypeScript types generated from schema
- Persistent storage - tool categories, template rectangles, and all data survives app restarts

**Schema Design:**
```
cameras: id, name, deviceIndex, resolution, homographyMatrix, calibrationTimestamp, isActive
slots: id, slotId, cameraId, toolName, expectedQrId, priority, regionCoords, allowCheckout, graceWindow
detectionLogs: id, slotId, timestamp, status, qrId, workerName, ssimScore, poseQuality, imagePath, alertTriggered
alertRules: id, name, ruleType, isEnabled, verificationWindow, businessHoursOnly, priority, conditions
alertQueue: id, alertType, message, status, retryCount, scheduledAt, sentAt
systemConfig: key, value, description
```

**File Storage Strategy:**
- Baseline images: `data/<slot_id>_EMPTY.png` and `data/<slot_id>_FULL.png`
- Live preview: `data/<slot_id>_last.png`
- ROI archive: `data/rois/<slot_id>/<YYYY-MM>/<timestamp>_<slot_id>.png`
- Append-only CSV manifest: `data/manifest.csv`

### External Dependencies

**Third-Party Services:**
- **Neon Serverless Postgres** - Cloud database with connection pooling via `@neondatabase/serverless`
- **SMTP Email Server** - Alert delivery (configured via system config)
- **Google Sheets API** - Secondary logging destination (optional)

**Computer Vision Libraries:**
- **OpenCV (opencv-contrib-python-headless)** - ArUco detection, image processing, homography
- **scikit-image** - SSIM computation for presence detection
- **pyzbar** - Primary QR code decoder
- **zxing-cpp** - Fallback QR decoder (mentioned in docs)

**UI Component Libraries:**
- **Radix UI Primitives** - Accessible, unstyled components (@radix-ui/react-*)
- **Recharts** - Declarative charting library for analytics
- **cmdk** - Command palette component
- **embla-carousel-react** - Touch-friendly carousel

**Utility Libraries:**
- **date-fns** - Date manipulation and formatting
- **clsx & tailwind-merge** - Conditional className handling
- **zod** - Runtime type validation for API contracts
- **drizzle-zod** - Zod schema generation from Drizzle tables

**Development Tools:**
- **tsx** - TypeScript execution for dev server
- **esbuild** - Fast bundling for production server
- **drizzle-kit** - Database migrations and schema push
- **Replit plugins** - Error overlay, cartographer, dev banner

**Detection & Alert System:**
- **State Machine**: EMPTY → ITEM_PRESENT → CHECKED_OUT → OCCUPIED_NO_QR → TRAINING_ERROR
- **Temporal Smoothing**: k-of-n voting over 5-minute verification window
- **Business Rules Engine**: Time-based monitoring with configurable grace periods
- **Queue-based Alerts**: Offline resilience with retry logic and rate limiting
- **HMAC Signature Validation**: Prevents QR spoofing with SHA-256 signatures

**Image Processing Pipeline:**
- ArUco GridBoard detection → Homography computation → Perspective warp → ROI extraction → QR decode + SSIM analysis → State decision with hysteresis thresholds