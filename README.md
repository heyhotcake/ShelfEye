# Tool Tracking System

A Raspberry Pi-based automated tool monitoring system using QR codes, ArUco grid calibration, and computer vision to track 60 tools across multiple cameras with email alerts and comprehensive logging.

## Features

### Core Functionality
- **Camera-based Tool Detection**: OpenCV-powered computer vision for real-time tool presence detection
- **QR Code Recognition**: Secure QR code detection with HMAC signature verification
- **ArUco GridBoard Calibration**: Precise perspective correction using ArUco markers
- **Multi-slot Monitoring**: Support for 60+ tool slots with configurable grid layouts
- **Real-time Analytics**: Live dashboard with detection statistics and trends

### Detection States
- **EMPTY**: No tool detected in slot
- **ITEM_PRESENT**: Correct tool detected via QR code
- **CHECKED_OUT**: Worker badge detected (tool legitimately removed)
- **OCCUPIED_NO_QR**: Tool present but QR code unreadable
- **TRAINING_ERROR**: System calibration or detection issues

### Smart Features
- **SSIM-based Presence Detection**: Structural similarity analysis for accurate detection
- **Temporal Smoothing**: 5-minute verification window with k-of-n voting
- **Business Rules Engine**: Time-based monitoring (strict 8AM/5PM, lenient 11AM/2PM)
- **Hysteresis Thresholds**: Prevents detection flapping
- **Pose Quality Assessment**: Image quality metrics for reliable detection

### Alert System
- **Multi-channel Alerts**: Email (SMTP), Google Sheets logging, local sound alerts
- **Queue-based Delivery**: Offline resilience with retry logic
- **Configurable Rules**: Custom alert conditions per tool/slot
- **Rate Limiting**: Prevents alert spam

### Web Interface
- **React Dashboard**: Modern SPA with real-time updates
- **Calibration Interface**: Interactive ArUco calibration with live preview
- **Slot Drawing Tool**: Canvas-based ROI definition with zoom/pan
- **QR Code Generator**: Signed QR code generation for tools and worker badges
- **Analytics Dashboard**: Charts and metrics with Recharts
- **Configuration Management**: YAML/JSON export/import

## Architecture

### Frontend (React + TypeScript)
- Modern React SPA with TypeScript
- Tailwind CSS with dark theme design
- TanStack Query for API state management
- Canvas API for interactive slot drawing
- Recharts for analytics visualization

### Backend (Node.js + Express)
- Express.js REST API
- SQLite database with Drizzle ORM
- Python subprocess integration for CV tasks
- Session-based authentication
- Structured JSON logging

### Computer Vision (Python)
- OpenCV for camera capture and image processing
- ArUco marker detection for calibration
- pyzbar + OpenCV QRCodeDetector for QR recognition
- scikit-image SSIM for presence analysis
- Numpy for efficient array operations

### Deployment
- Systemd service with auto-restart
- Raspberry Pi optimized configuration
- Log rotation and health monitoring
- Environment-based configuration
- Automated installation script

## Installation

### Quick Install (Raspberry Pi)
```bash
curl -sSL https://raw.githubusercontent.com/your-org/tool-tracker/main/scripts/install.sh | bash
