# Tool Tracking System - Development Guide

## Overview

A Raspberry Pi-based automated tool monitoring system that uses computer vision, QR codes, and ArUco marker calibration (4 corner markers) to track tools across multiple cameras. The system provides real-time detection, HMAC-signed QR validation, temporal smoothing for presence detection, and multi-channel alerting (email, Google Sheets, sound). Features a React-based web dashboard for calibration, slot configuration, analytics, and system management. The number of tool slots is fully configurable based on your workshop needs.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

- **Simplified QR-Based Detection Logic (Oct 2025)**: Removed complex SSIM image analysis in favor of slot QR code as binary sensor. Slot QR visible = tool missing (alarm), worker QR visible = checked out, no QR visible = tool present. QR type changed from "tool" to "slot" for clarity.
- **Gmail & Google Sheets Alert Integration (Oct 2025)**: Implemented complete multi-channel alert system using Replit's native connectors. Gmail sends formatted emails on capture/diagnostic failures. Google Sheets automatically logs all alerts, captures, and diagnostics with auto-created spreadsheet. Alert configuration UI manages email recipients and displays sheets URL.
- **ArUco Marker Positioning (Oct 2025)**: ArUco corner markers (IDs 17-20) are now positioned at the extreme corners of the printable area (0cm from edges) across all paper sizes, maximizing usable template space since printers have natural margins anyway.
- **Unified Template-to-Slot Workflow (Oct 2025)**: Templates can be designed before calibration. Calibration automatically creates slots from templates using homography transformation. Manual polygon drawing removed.

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
- Multi-scale QR decoding with pyzbar and OpenCV fallback
- Homography computation and storage per camera
- Slot QR code visibility as binary sensor for presence detection

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
- Live preview: `data/<slot_id>_last.png`
- ROI archive: `data/rois/<slot_id>/<YYYY-MM>/<timestamp>_<slot_id>.png`
- Future SSIM baselines (optional): `data/<slot_id>_EMPTY.png` and `data/<slot_id>_FULL.png`

### External Dependencies

**Third-Party Services:**
- **Neon Serverless Postgres** - Cloud database with connection pooling via `@neondatabase/serverless`
- **SMTP Email Server** - Alert delivery (configured via system config)
- **Google Sheets API** - Secondary logging destination (optional)

**Computer Vision Libraries:**
- **OpenCV (opencv-contrib-python-headless)** - ArUco detection, image processing, homography, QR decoding
- **pyzbar** - Primary QR code decoder with multi-scale preprocessing
- **scikit-image** - (Reserved for future SSIM validation layer)

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
- **Simplified State Machine**: ITEM_PRESENT (tool covering slot QR) → EMPTY (slot QR visible, alarm) → CHECKED_OUT (worker QR visible)
- **QR Type System**: "slot" type for slot QR codes, "worker" type for worker badge QR codes
- **Binary Detection Logic**: 
  - Slot QR visible → EMPTY + Alert (tool missing without authorization)
  - Worker QR visible → CHECKED_OUT (tool signed out by worker)
  - No QR visible → ITEM_PRESENT (tool covering slot QR, normal state)
- **Business Rules Engine**: Time-based monitoring with configurable grace periods
- **Queue-based Alerts**: Offline resilience with retry logic and rate limiting
- **HMAC Signature Validation**: Prevents QR spoofing with SHA-256 signatures

**Image Processing Pipeline:**
- ArUco GridBoard detection → Homography computation → Perspective warp → ROI extraction → QR decode with multi-scale preprocessing → State decision based on QR visibility