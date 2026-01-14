# ShelfEye System Resilience Guide

This guide documents all the resilience features built into ShelfEye to prevent crashes, handle failures gracefully, and ensure long-term reliability on Raspberry Pi.

## Overview

ShelfEye includes multiple layers of protection to ensure the system remains operational even during hardware issues, memory problems, or software crashes:

1. **Hardware Watchdog** - Automatic reboot on system freeze
2. **SystemD Auto-Restart** - Automatic service restart on crashes with resource limits
3. **Automatic Maintenance** - Daily cleanup and disk space management 
4. **Health Monitoring** - Real-time system status tracking

---

## 1. Hardware Watchdog (Auto-Reboot on Freeze)

### What It Does
The hardware watchdog monitors the Pi at the kernel level. If the system becomes completely unresponsive (frozen, locked up), it automatically reboots the Pi after 4 minutes.

### How It Works
- **Watchdog Timer**: Hardware timer that must be "kicked" every second
- **Kernel Module**: `bcm2835_wdt` provides the watchdog device  
- **Watchdog Daemon**: Sends heartbeats to `/dev/watchdog` every second
- **Auto-Reboot**: If heartbeat stops for 240+ seconds, hardware forces a reboot

### Configuration
Located in `/etc/watchdog.conf` (created by `enable-watchdog.sh`):
```bash
watchdog-device = /dev/watchdog
watchdog-timeout = 240     # Reboot after 240 seconds (4 minutes) of no response
interval = 1               # Check every 1 second

# Load-average triggers DISABLED for computer vision workloads
# (OpenCV calibration routinely spikes >9 on 4-core Pi during startup)
# The lines below are commented out in the actual config file:
# max-load-1 = 0
# max-load-5 = 0  
# max-load-15 = 0

realtime = yes             # High priority scheduling
priority = 5               # Ensures daemon gets CPU during heavy loads
```

**Note**: The enable-watchdog.sh script writes the load-average lines as comments. This completely disables load-based triggers - the watchdog only monitors for complete system freezes.

### Why 240 Seconds?
ShelfEye's startup process includes:
- Git sync (network operations)
- npm/pip dependency installs
- Database schema push
- Node.js application startup
- Camera calibration validation (42-48s per camera)

**Typical startup**: 60-90 seconds  
**Slow startup** (slow WiFi, fresh install): 150-200 seconds  
**240s timeout provides comfortable margin** while still protecting against real freezes

### Why Load Triggers Are Disabled
During startup calibration, OpenCV processing causes CPU load to spike above 9.0 on the 4-core Raspberry Pi. This is normal and expected behavior, NOT a system freeze. With load triggers enabled, the watchdog would falsely interpret high CPU usage as a hang and trigger unnecessary reboots.

**The watchdog now ONLY reboots on complete system freezes**, not on high CPU usage.

### Setup Instructions

#### Check If Already Installed
```bash
./check_watchdog.sh
```

#### Install Watchdog
```bash
./enable-watchdog.sh
```

This script will:
1. Install the watchdog package
2. Load the kernel module
3. Configure `/etc/watchdog.conf`
4. Enable and start the service

#### Verify It's Working
```bash
# Check service status
sudo systemctl status watchdog

# Verify device exists
ls -l /dev/watchdog

# Check module is loaded
lsmod | grep bcm2835_wdt
```

**Expected Output:**
```
● watchdog.service - watchdog daemon
   Loaded: loaded
   Active: active (running)
```

### Startup Timing Instrumentation
Every boot, the startup script records timing data to `/home/naniwa/ShelfEye/state/startup-timing.json`:

```json
{
  "timestamp": "2025-11-14T09:15:42+09:00",
  "total_startup_time": 87,
  "phases": {
    "git-check": 3,
    "led-library-install": 0,
    "db-push": 12,
    "pre-app-complete": 87
  }
}
```

**Check startup timing:**
```bash
cat /home/naniwa/ShelfEye/state/startup-timing.json | jq
```

**Note**: This instrumentation tracks the bash script phases (git, npm, db) but stops before Node.js application startup and calibration. For complete timing including calibration, check the application logs:
```bash
sudo journalctl -u shelfeye -b | grep "Phase\|Calibration\|StartupCalibration"
```

This helps diagnose slow startups and ensure the system stays within the watchdog timeout.

### When It Helps
- **Complete System Freeze**: Pi becomes totally unresponsive to keyboard/SSH
- **Kernel Panic**: Low-level kernel crashes  
- **Hardware Lock-up**: USB/camera driver causing system hang
- **Infinite hang**: Process stuck waiting for network/hardware indefinitely

### Limitations
- Won't help with application-level bugs (use SystemD restart for that)
- Won't prevent data corruption if process is killed mid-write
- 240-second delay before reboot (trade-off for preventing false reboots)

---

## 2. SystemD Auto-Restart

### What It Does
If the ShelfEye application crashes or exits unexpectedly, SystemD automatically restarts it within 10 seconds.

### How It Works
SystemD monitors the ShelfEye service process. If it exits with any status code (crash, error, killed), SystemD waits 10 seconds and restarts it.

### Configuration
Located in `shelfeye.service`:

```ini
[Service]
Restart=always              # Always restart on exit
RestartSec=10              # Wait 10 seconds before restart
RestartPreventExitStatus=SIGKILL  # Don't restart if hardware watchdog killed it

# Prevent infinite restart loops
StartLimitBurst=5          # Max 5 restart attempts
StartLimitIntervalSec=600  # Within 10 minutes
# If app crashes 5 times in 10 min, systemd gives up
```

### Resource Limits
Prevents runaway processes from consuming all system resources:

```ini
# CPU Limits
CPUQuota=380%              # Use max 3.8 out of 4 cores (leaves 0.2 for OS)

# Memory Limits
MemoryHigh=1.5G            # Soft limit - triggers warning
MemoryMax=1.8G             # Hard limit - process killed if exceeded

# File Limits
LimitNOFILE=65536          # Max open files
```

### Setup Instructions

#### Update Service Configuration
After modifying `shelfeye.service`:
```bash
# Copy updated service file
sudo cp shelfeye.service /etc/systemd/system/

# Reload systemd configuration
sudo systemctl daemon-reload

# Restart service with new config
sudo systemctl restart shelfeye
```

#### Verify Configuration
```bash
# Check service status
sudo systemctl status shelfeye

# View full service configuration
systemctl show shelfeye
```

### When It Helps
- **Application Crashes**: Node.js process exits unexpectedly
- **Unhandled Exceptions**: JavaScript errors that kill the process
- **Memory Leaks**: Process killed when exceeding memory limit
- **Python Script Failures**: Camera processing scripts crashing

### Monitoring Restarts
```bash
# Check for recent restarts
journalctl -u shelfeye --since "1 hour ago" | grep "Started"

# Count restarts today
journalctl -u shelfeye --since today | grep -c "Started"
```

**If you see many restarts (>5/hour)**, investigate the logs:
```bash
sudo journalctl -u shelfeye --priority=err --since "1 hour ago"
```

---

## 3. Automatic Maintenance

### What It Does
Runs daily at 3:00 AM JST to:
- Clean up old detection logs (keeps 3 years)
- Delete old sent alerts (keeps 30 days)
- Remove old ROI images (keeps 2 months)
- Check disk space and free up space if needed
- Emergency cleanup if disk >90% full

### How It Works
Node-cron scheduler runs `maintenanceService.runDailyMaintenance()` every day at 3 AM.

### Configuration
Located in `server/scheduler.ts`:

```typescript
scheduleDailyMaintenance() {
  // Cron: 0 3 * * * = 3:00 AM every day
  const task = cron.schedule('0 3 * * *', async () => {
    await maintenanceService.runDailyMaintenance();
  }, {
    timezone: 'Asia/Tokyo'
  });
}
```

### Data Retention Policies
| Data Type | Retention Period | Location |
|-----------|------------------|----------|
| Detection Logs | 3 years (1095 days) | PostgreSQL database |
| Sent Alerts | 30 days | PostgreSQL database |
| ROI Images | 2 months (60 days) | `data/rois/` directory |

### Emergency Disk Cleanup
If disk usage exceeds thresholds, automatic cleanup runs:

| Disk Usage | Action |
|------------|--------|
| < 80% | Normal operation |
| 80-89% | Accelerated cleanup (delete ROI images >60 days old) |
| ≥ 90% | Emergency cleanup (delete ROI images >30 days old) |

### Manual Maintenance

#### Run Maintenance Manually
```bash
curl -X POST http://localhost:5000/api/maintenance/run
```

#### Check Maintenance Stats
```bash
curl -s http://localhost:5000/api/maintenance/stats | jq
```

**Output:**
```json
{
  "diskUsage": {
    "total": 29.2,
    "used": 8.5,
    "free": 20.7,
    "percentUsed": 29
  },
  "oldestLog": "2025-01-15T09:30:00.000Z",
  "totalLogs": 125847,
  "totalAlerts": 342
}
```

#### Check Disk Usage
```bash
curl -s http://localhost:5000/api/maintenance/disk-usage | jq
```

### Logs
Maintenance activity is logged to:
```bash
sudo journalctl -u shelfeye | grep Maintenance
```

**Example log output:**
```
[Maintenance] Starting daily maintenance
[Maintenance] Disk status: ok
[Maintenance] Deleted 1253 detection logs (>3 years old)
[Maintenance] Deleted 45 sent alerts (>30 days old)
[Maintenance] Deleted 892 ROI images, freed 1.25 GB
[Maintenance] Daily maintenance completed in 4230ms
```

---

## 4. Health Monitoring

### Health Check Endpoint
**Endpoint:** `GET /api/health`

Returns detailed system metrics:
```json
{
  "ok": true,
  "time": "2025-11-14T15:30:45.123Z",
  "version": "2.1.0",
  "uptime": {
    "seconds": 345678,
    "hours": 96,
    "days": 4
  },
  "memory": {
    "rss": 245,      // MB - Resident Set Size
    "heapUsed": 128, // MB - JavaScript heap in use
    "heapTotal": 156,// MB - Total heap allocated
    "external": 12   // MB - C++ objects bound to JS
  },
  "process": {
    "pid": 1234,
    "platform": "linux",
    "nodeVersion": "v20.18.0"
  }
}
```

### System Health Monitoring Script

Run the comprehensive health check script:
```bash
./monitor-system-health.sh
```

**This script checks:**
- ✓ Hardware watchdog status
- ✓ ShelfEye service status
- ✓ Application health endpoint
- ✓ Disk space usage
- ✓ System memory usage
- ✓ CPU temperature
- ✓ Maintenance service status
- ✓ Recent error count

**Example output:**
```
======================================
  ShelfEye System Health Report
  2025-11-14 15:30:45
======================================

### Hardware Watchdog (Auto-Reboot on Freeze)
✓ Watchdog service is running
✓ Watchdog device exists: /dev/watchdog
✓ Watchdog kernel module loaded

### ShelfEye Application Service
✓ ShelfEye service is running
  Started: Thu 2025-11-10 08:00:15 JST
✓ No unexpected restarts in the last hour

### Application Health Endpoint
✓ Health endpoint responding (HTTP 200)
  Uptime: 4d 96h
  Memory: RSS=245MB, Heap=128MB

### Disk Space
✓ Disk space OK (29% used, 20.7GB free)

### System Memory
✓ Memory usage: 45% (901MB/2048MB used)

### CPU Temperature
✓ Temperature: 52°C

### Maintenance & Cleanup
✓ Daily maintenance scheduled at 3:00 AM JST
  Detection logs: 125847
  Alert queue: 342

### Recent Errors (Last Hour)
✓ No errors in the last hour

======================================
Health check complete!
======================================
```

### Automated Monitoring (Optional)

You can schedule the health check to run periodically and send alerts if issues are detected.

**Create a cron job:**
```bash
# Run health check every hour and log results
0 * * * * /home/naniwa/ShelfEye/monitor-system-health.sh >> /home/naniwa/ShelfEye/logs/health.log 2>&1
```

---

## 5. Troubleshooting Guide

### Reboot Loop (System Keeps Rebooting)

**Symptoms:**
- Pi reboots repeatedly every 3-4 minutes
- Can briefly SSH in but connection drops
- Web interface becomes inaccessible after a few minutes

**Cause:**
Startup is taking longer than the watchdog timeout (240 seconds), causing the watchdog to falsely detect a freeze and trigger a reboot.

**Diagnosis:**
1. Check startup timing:
   ```bash
   cat /home/naniwa/ShelfEye/state/startup-timing.json | jq
   ```
   
2. Check journalctl for timing clues:
   ```bash
   sudo journalctl -u shelfeye -b | grep "Phase"
   ```

3. Look for watchdog reboot messages:
   ```bash
   sudo journalctl -k | grep watchdog
   ```

**Solutions:**

1. **Temporary fix** - Disable watchdog until startup is optimized:
   ```bash
   sudo systemctl stop watchdog
   sudo systemctl disable watchdog
   ```

2. **Permanent fix** - Increase watchdog timeout if startup legitimately takes longer:
   ```bash
   # Edit watchdog config
   sudo nano /etc/watchdog.conf
   
   # Change: watchdog-timeout = 240
   # To:     watchdog-timeout = 300  (5 minutes)
   
   # Restart watchdog
   sudo systemctl restart watchdog
   ```

3. **Optimize startup** - Reduce startup time:
   ```bash
   # Skip git fetch on every boot (edit pi-startup.sh)
   # Use cached dependencies instead of fresh installs
   # Defer calibration until after app is running
   ```

### System Won't Start After Reboot

**Symptoms:**
- Can't SSH to the Pi
- Web interface not accessible
- Pi seems frozen

**Steps:**
1. Wait 4-5 minutes for full boot (startup can take time)
2. SSH in and check:
   ```bash
   # Check if watchdog is running
   sudo systemctl status watchdog
   
   # Check if ShelfEye is running
   sudo systemctl status shelfeye
   
   # Check for errors
   sudo journalctl -u shelfeye --since "10 minutes ago" --priority=err
   ```

3. Check startup timing:
   ```bash
   cat /home/naniwa/ShelfEye/state/startup-timing.json | jq
   ```

4. If watchdog isn't running:
   ```bash
   ./enable-watchdog.sh
   ```

5. If ShelfEye isn't running:
   ```bash
   sudo systemctl restart shelfeye
   ```

### Frequent Restarts

**Symptoms:**
- Service restarts multiple times per hour
- `monitor-system-health.sh` shows restart warnings

**Steps:**
1. Check logs for errors:
   ```bash
   sudo journalctl -u shelfeye --priority=err --since "1 hour ago"
   ```

2. Check memory usage:
   ```bash
   free -h
   ./monitor-system-health.sh
   ```

3. Check disk space:
   ```bash
   df -h
   curl -s http://localhost:5000/api/maintenance/disk-usage | jq
   ```

4. If memory is high (>80%), check for memory leaks:
   ```bash
   # Monitor memory over time
   watch -n 5 'free -h'
   ```

### Disk Space Critical

**Symptoms:**
- `monitor-system-health.sh` shows disk space warning/critical
- System running slowly

**Steps:**
1. Check current usage:
   ```bash
   df -h
   du -sh ~/ShelfEye/data/*
   ```

2. Run emergency cleanup:
   ```bash
   curl -X POST http://localhost:5000/api/maintenance/run
   ```

3. Manually delete old ROI images if needed:
   ```bash
   # Delete ROI images older than 30 days
   find ~/ShelfEye/data/rois -type f -mtime +30 -delete
   ```

### High CPU Temperature

**Symptoms:**
- Temperature >70°C
- System throttling (slow performance)

**Steps:**
1. Check current temperature:
   ```bash
   vcgencmd measure_temp
   # or
   ./monitor-system-health.sh
   ```

2. Improve cooling:
   - Ensure Pi has adequate airflow
   - Add heatsinks if not present
   - Add a fan (5V fan on GPIO pins)

3. Reduce CPU usage:
   - Check for runaway processes: `top`
   - Reduce capture frequency in scheduler settings

---

## 6. Verification Checklist

Use this checklist after deploying to the Pi or after any major changes:

### Initial Setup
- [ ] Hardware watchdog installed: `./check_watchdog.sh`
- [ ] ShelfEye service enabled: `sudo systemctl is-enabled shelfeye`
- [ ] Service running: `sudo systemctl is-active shelfeye`
- [ ] Health endpoint responding: `curl http://localhost:5000/api/health`

### Daily Checks (or use cron)
- [ ] Run health monitor: `./monitor-system-health.sh`
- [ ] No recent errors: `sudo journalctl -u shelfeye --priority=err --since "1 hour ago"`
- [ ] Disk space OK (< 80%): `df -h`
- [ ] Memory OK (< 80%): `free -h`
- [ ] Temperature OK (< 70°C): `vcgencmd measure_temp`

### Weekly Checks
- [ ] Check restart count: `journalctl -u shelfeye --since "7 days ago" | grep -c "Started"`
- [ ] Verify maintenance ran: `journalctl -u shelfeye | grep "Daily maintenance completed"`
- [ ] Database size reasonable: `du -sh ~/ShelfEye/data/`

### After Code Updates
- [ ] Service restarted: `sudo systemctl restart shelfeye`
- [ ] No errors in logs: `sudo journalctl -u shelfeye --since "5 minutes ago"`
- [ ] Health endpoint OK: `curl http://localhost:5000/api/health`
- [ ] Web interface accessible: Open browser to `http://naniwatanacheck.local:5000`

---

## 7. Log Analysis

### View Real-Time Logs
```bash
# All logs
sudo journalctl -u shelfeye -f

# Errors only
sudo journalctl -u shelfeye -f --priority=err

# Specific time range
sudo journalctl -u shelfeye --since "1 hour ago"
```

### Search for Specific Issues
```bash
# Find crashes
journalctl -u shelfeye | grep -i "crash\|killed\|exit"

# Find memory issues
journalctl -u shelfeye | grep -i "memory\|oom"

# Find restarts
journalctl -u shelfeye | grep "Started ShelfEye"

# Find maintenance runs
journalctl -u shelfeye | grep "Daily maintenance"
```

### Export Logs for Analysis
```bash
# Last 24 hours to file
journalctl -u shelfeye --since "24 hours ago" > ~/shelfeye-logs-24h.txt

# Last 100 errors
journalctl -u shelfeye --priority=err -n 100 > ~/shelfeye-errors.txt
```

---

## 8. Summary

ShelfEye has **4 layers of resilience**:

1. **Hardware Watchdog** → Reboots Pi if completely frozen (240s/4-min timeout, load triggers disabled)
2. **SystemD Restart with Resource Limits** → Restarts app if it crashes (10s delay), prevents memory/CPU overload (1.8GB max)
3. **Daily Maintenance** → Cleans up old data at 3 AM daily
4. **Health Monitoring** → Tracks system status in real-time

### Key Configuration Details

| Layer | Setting | Value | Why |
|-------|---------|-------|-----|
| Watchdog | Timeout | 240s (4 min) | Allows for slow startups on network issues |
| Watchdog | Load Triggers | DISABLED | OpenCV calibration causes high load (>9.0) |
| Watchdog | Priority | 5 | Ensures heartbeat during heavy processing |
| SystemD | Memory Max | 1.8GB | Prevents runaway memory leaks |
| SystemD | CPU Quota | 380% | Leaves 0.2 cores for OS |
| Startup | Network Timeouts | 30-180s | Prevents infinite hangs on git/npm |

### Startup Timing Breakdown

| Phase | Typical | Slow | Maximum Timeout |
|-------|---------|------|-----------------|
| Git fetch/pull | 5s | 30s | 30s each |
| npm install | 30s | 120s | 180s |
| pip install | 0s (cached) | 30s | 45s |
| DB schema push | 10s | 30s | 45s |
| App startup | 15s | 20s | N/A |
| Calibration | 45s | 60s | N/A |
| **Total** | **60-90s** | **150-200s** | **240s watchdog** |

### Quick Reference Commands

| Task | Command |
|------|---------|
| Check overall health | `./monitor-system-health.sh` |
| Check watchdog | `./check_watchdog.sh` |
| Check service status | `sudo systemctl status shelfeye` |
| View logs | `sudo journalctl -u shelfeye -f` |
| Restart service | `sudo systemctl restart shelfeye` |
| Run maintenance | `curl -X POST http://localhost:5000/api/maintenance/run` |
| Check disk space | `curl http://localhost:5000/api/maintenance/disk-usage \| jq` |
| Check health | `curl http://localhost:5000/api/health \| jq` |

---

## Questions or Issues?

If you experience problems not covered by this guide, collect this information:

1. Output of `./monitor-system-health.sh`
2. Last 100 log lines: `sudo journalctl -u shelfeye -n 100`
3. System info: `uname -a` and `free -h` and `df -h`
4. Recent restart count: `journalctl -u shelfeye --since "24 hours ago" | grep -c "Started"`

Contact: t-azuma@fs-naniwa.co.jp
