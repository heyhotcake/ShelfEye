# Production Deployment Guide for ShelfEye

This document outlines the steps to deploy ShelfEye in production mode on your Raspberry Pi.

## What Changed

### 1. Production Build (instead of dev server)
- **pi-startup.sh** now runs `npm run build` before starting the server
- The app runs from compiled `dist/index.js` instead of tsx/vite dev mode
- Benefits: Lower memory usage, no HMR overhead, faster startup after first build

### 2. Infinite Database Reconnection
- **server/db.ts** now uses exponential backoff (5s → 5min cap) with unlimited retries
- The app will survive extended network/database outages without requiring manual restart
- Previously: Gave up after 10 attempts (~1 minute)

### 3. Extended Alert Retry Window
- **server/services/alert-queue.ts** now retries alerts for up to 7 days (was 24 hours)
- Maximum 100 retries (was 10) with exponential backoff
- Ensures alerts are not lost during multi-day email/sheets service issues

### 4. Log Rotation
- **shelfeye-logrotate.conf** rotates logs at 5MB, keeps 7 rotated files
- Prevents startup.log from growing indefinitely

---

## Pi Deployment Steps

### Step 1: Update the Code
```bash
cd /home/naniwa/ShelfEye
git pull origin main
```

### Step 2: Install Log Rotation
```bash
sudo cp shelfeye-logrotate.conf /etc/logrotate.d/shelfeye
sudo logrotate -d /etc/logrotate.d/shelfeye  # Test (dry run)
```

### Step 3: Update systemd Service (Optional but Recommended)
Add these improvements to `/etc/systemd/system/shelfeye.service`:

```ini
[Service]
# ... existing settings ...

# Load environment file
EnvironmentFile=-/home/naniwa/ShelfEye/.env.pi

# Graceful shutdown
TimeoutStopSec=30s
KillMode=mixed

# Explicit production mode
Environment=NODE_ENV=production
```

Then reload:
```bash
sudo systemctl daemon-reload
```

### Step 4: Disable Legacy Services (if they exist)
```bash
sudo systemctl disable tool-tracker.service 2>/dev/null || true
sudo systemctl stop tool-tracker.service 2>/dev/null || true
```

### Step 5: Restart ShelfEye
```bash
sudo systemctl restart shelfeye
```

### Step 6: Verify Production Mode
```bash
# Check logs - should NOT show "tsx" or "vite" dev messages
journalctl -u shelfeye -f

# Verify health endpoint
curl -s http://localhost:5000/api/health | jq
```

---

## Environment Variables Checklist

Ensure these are set in `/home/naniwa/ShelfEye/.env.pi`:

```bash
DATABASE_URL=postgres://...         # Required
SESSION_SECRET=...                  # Required
NODE_ENV=production                 # Recommended
# SHELFEYE_API_KEY=...             # Optional on secure networks
```

---

## Verification Checklist

- [ ] `journalctl -u shelfeye` shows "production mode" not dev/tsx
- [ ] `curl http://localhost:5000/api/health` returns HTTP 200
- [ ] Build phase completed successfully (check startup.log)
- [ ] Log rotation test passed: `sudo logrotate -d /etc/logrotate.d/shelfeye`
- [ ] LED manager service running: `systemctl status led-manager`
