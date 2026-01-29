# Tool Tracking System - Compressed Development Guide

## Overview
The Tool Tracking System is a Raspberry Pi-based solution for real-time tool monitoring in workshops. It utilizes computer vision and ArUco markers for tracking tool presence and checkout status to prevent loss and improve accountability. Key capabilities include ArUco marker validation, multi-channel alerting (email, Google Sheets, sound), and a React web dashboard for calibration, slot management, analytics, and administration. The system supports 4K cameras with intelligent dual-resolution modes and worker tracking. The project aims for high production reliability and comprehensive error handling.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **UI Language**: Japanese (日本語) - Complete UI translation completed Jan 22, 2026. All pages, modals, buttons, form labels, toast messages, status badges, and error messages are in Japanese.
- **Deployment Context**: User runs the application on a Raspberry Pi at `http://naniwatanacheck.local:5000`. **ALL debugging, testing, and issue reports refer to the Pi deployment, NOT the Replit web preview.** The Replit environment is for code development only; actual hardware features (camera, GPIO) only work on the Raspberry Pi. When user reports issues or provides screenshots, they are ALWAYS from the Pi, not from Replit webview.
- **SSH Access to Pi**: `ssh naniwa@192.168.59.249 -p 5555`

### Japanese UI Terminology Reference
Key translations used throughout the application:
- Dashboard → ダッシュボード
- Calibration → キャリブレーション
- Template Design → テンプレート設計
- Print Preview → 印刷プレビュー
- Configuration → 設定
- Scheduler → スケジューラー
- Alerts → アラート
- Analytics → 分析
- Detection Logs → 検出ログ
- Workers → 作業者
- Tool → 備品
- Slot → スロット
- Camera → カメラ
- Save → 保存
- Cancel → キャンセル
- Delete → 削除
- Present → 存在
- Empty → 空
- Checked Out → 貸出中
- Pending → 保留中
- Sent → 送信済み
- Failed → 失敗

## System Architecture

### System Resilience
The system incorporates hardware watchdog, SystemD auto-restart, daily maintenance routines (log/alert/ROI cleanup), and real-time health monitoring (`/api/health`, `monitor-system-health.sh`) to ensure long-term reliability.

### Frontend Architecture
The frontend is a React application using TypeScript, Vite, TanStack Query, Wouter, and Tailwind CSS with shadcn/ui. It features a component-based design, modal interactions, and utilizes the Canvas API for interactive slot drawing with zoom/pan and ArUco overlays. It supports configurable canvas aspect ratios, uses Recharts for analytics, and manages server state via TanStack Query.

### Backend Architecture
The backend is built with Express.js on Node.js using TypeScript and ESM modules. It provides RESTful JSON APIs and manages child processes for Python-based computer vision operations and file system interactions.

### Data Storage
PostgreSQL (Neon serverless) is used for persistent storage via Drizzle ORM, storing configurations, slots, detection logs, alert rules, and worker data. File system storage handles live previews, ROI archives, and rectified calibration images. Data retention policies are in place for logs, ROI images, and alerts.

### System Design Choices
The UI/UX for calibration uses paper-size formats with a rectified preview featuring grid and template overlays. A multi-sheet template system enables large area coverage with automated slot creation. The system includes auto-start/update via systemd, GPIO LED strip integration for lighting and visual alerts, and a robust detection and alert system with a state machine and time-based monitoring.

ArUco marker IDs are allocated for tool slots (1-50), worker identification (51-95), and corner calibration (96-99), using the DICT_4X4_100 dictionary.

**Real-Time Homography Adjustment**: During each scheduled capture, the system detects corner ArUco markers (96-99) to calculate a fresh homography matrix. This compensates for minor camera/template movement, ensuring slot alignment. The raw camera frame is rectified to a top-down view, and slot coordinates are calculated in rectified space from stored cm values.

**Diagnostic & Capture Checks**: Corner ArUco markers (IDs 96-99) are validated at system startup, 30 minutes before each scheduled capture, and during each scheduled capture. Failure to detect four corner markers marks the camera as "failed," differentiating between missing templates and checked-out tools.

**Environment Monitoring**: DHT20 temperature/humidity sensor readings are logged to Google Sheets during each scheduled capture.

### Camera Configuration
Cameras are configured for MJPEG format (7-10fps at 4K, 15-60fps at 1080p) to prevent throttling. A dual-resolution strategy uses 1920x1080 for previews and 3840x2160 for calibration/validation. Default camera settings ensure bright, natural images with auto-exposure and auto-focus. A 10-second warmup period is implemented for auto-exposure. The post-processing pipeline includes multi-frame sharpness selection, auto brightness/contrast, gamma correction, and sharpening. All Python scripts explicitly force MJPEG.

### LED Control Architecture
LED control uses a daemon-based client-server model to eliminate DMA channel conflicts. The `led_manager_service.py` daemon runs as a systemd service with exclusive DMA access. A `led_control_client.py` CLI tool communicates with the daemon via named pipes. A TypeScript interface (`server/utils/led-control.ts`) provides a high-level API. The system includes a priority system for LED states (RED_FLASH, WHITE, OFF) and persistent state management to restore LED status after reboots. LED count and brightness are database-configurable.

### GPIO Pin Mapping (Raspberry Pi)

| Physical Pin | BCM GPIO | Function | Connection |
|-------------|----------|----------|------------|
| PP 1 | - | 3.3V Power | DHT20 sensor power |
| PP 2 | - | 5V Power | LED strip power (+) |
| PP 3 | GPIO 2 | I2C1 SDA | DHT20 data |
| PP 4 | - | 5V Power | Fan case power |
| PP 5 | GPIO 3 | I2C1 SCL | DHT20 clock |
| PP 6 | - | Ground | Fan case ground |
| PP 9 | - | Ground | LED strip ground (-) |
| PP 11 | GPIO 17 | Output | Buzzer signal (Ario 2401) |
| PP 12 | GPIO 18 | PWM | LED strip data |
| PP 14 | - | Ground | DHT20 ground |
| PP 20 | - | Ground | Buzzer ground |

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
- **jsPDF**: PDF generation for template printing with embedded Noto Sans JP fonts.

### Utility Libraries
- **date-fns**: Date manipulation.
- **clsx & tailwind-merge**: Conditional className handling.
- **zod**: Runtime type validation.
- **drizzle-zod**: Zod schema generation.

## Production Security & Reliability (Added Jan 2026)

### API Authentication
- All `/api` routes are protected by Bearer token authentication when `SHELFEYE_API_KEY` is set
- Health endpoints (`/api/health`, `/api/ping`) are excluded from auth for monitoring
- In production (`NODE_ENV=production`), the API key is **required** - startup will fail without it
- In development, missing API key shows a warning but allows startup

### Environment Validation
- Startup validates required environment variables before the app starts
- `DATABASE_URL`: Required for database connection
- `SHELFEYE_API_KEY`: Required in production, optional in development
- Google integrations: Optional but recommended for email alerts

### Camera Auto-Mode Initialization
- USB cameras now use `v4l2-ctl` for reliable auto-mode enabling (focus, exposure, white balance)
- This mimics laptop camera behavior where auto modes are enabled by default
- Falls back to OpenCV settings if v4l2-ctl is unavailable
- Addresses inconsistent autofocus/white balance on Linux

### Log Sanitization
- Sensitive data (passwords, tokens, API keys, credentials) is redacted from logs
- Response bodies are sanitized before logging

### Resource Cleanup
- SubprocessManager tracks all Python/LED processes with zombie detection
- Graceful shutdown on SIGTERM/SIGINT kills all child processes
- Python scripts use try/finally blocks for camera release