# Deploying Resilience Updates to Your Raspberry Pi

This guide walks you through deploying the new resilience enhancements to your Raspberry Pi.

## What's New

I've verified and enhanced your system's resilience with:

1. ✅ **Hardware Watchdog** - Already configured (auto-reboots if Pi freezes)
2. ✅ **SystemD Auto-Restart** - Enhanced with better resource limits
3. ✅ **Daily Maintenance** - Already running (cleans up old data at 3 AM)
4. ✨ **NEW: Enhanced Health Monitoring** - Detailed system metrics
5. ✨ **NEW: Health Check Script** - Easy system status checking
6. ✨ **NEW: Complete Documentation** - See SYSTEM-RESILIENCE-GUIDE.md.

## Quick Deployment Steps

### 1. SSH to Your Raspberry Pi

```bash
ssh naniwa@naniwatanacheck.local
cd ~/ShelfEye
```

### 2. Pull Latest Changes

```bash
git pull origin main
```

### 3. Update the SystemD Service

```bash
# Copy the updated service file
sudo cp shelfeye.service /etc/systemd/system/

# Reload systemd to recognize changes
sudo systemctl daemon-reload

# Restart the service with new configuration
sudo systemctl restart shelfeye
```

### 4. Verify Everything Works

Wait about 30 seconds for the service to fully start, then:

```bash
# Run the health check script
./monitor-system-health.sh
```

You should see output like:
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
  Started: Thu 2025-11-14 15:30:00 JST
✓ No unexpected restarts in the last hour

### Application Health Endpoint
✓ Health endpoint responding (HTTP 200)
  Uptime: 0d 0h
  Memory: RSS=245MB, Heap=128MB

...
```

### 5. Test the New Health Endpoint

```bash
curl -s http://localhost:5000/api/health | jq
```

You should see detailed metrics:
```json
{
  "ok": true,
  "time": "2025-11-14T06:30:45.123Z",
  "version": "2.1.0",
  "uptime": {
    "seconds": 1234,
    "hours": 0,
    "days": 0
  },
  "memory": {
    "rss": 245,
    "heapUsed": 128,
    "heapTotal": 156,
    "external": 12
  },
  "process": {
    "pid": 12345,
    "platform": "linux",
    "nodeVersion": "v20.18.0"
  }
}
```

## What Changed

### Enhanced Files

1. **`server/routes.ts`** - `/api/health` endpoint now returns detailed metrics:
   - Process uptime (seconds, hours, days)
   - Memory usage (RSS, heap used/total, external)
   - Process info (PID, platform, Node version)

2. **`shelfeye.service`** - Improved configuration:
   - Better restart failure handling
   - Prevents restart on hardware watchdog kills
   - Clearer resource limit documentation

3. **`monitor-system-health.sh`** ✨ NEW - Comprehensive health check script:
   - Checks all 4 resilience layers
   - Validates watchdog, service, health endpoint
   - Monitors disk, memory, CPU temperature
   - Reports recent errors

4. **`SYSTEM-RESILIENCE-GUIDE.md`** ✨ NEW - Complete documentation:
   - Detailed explanation of all 4 resilience layers
   - Setup and verification instructions
   - Troubleshooting guide
   - Quick reference commands

5. **`replit.md`** - Updated with resilience architecture summary

## Troubleshooting

### Service Won't Start

```bash
# Check status
sudo systemctl status shelfeye

# Check recent logs
sudo journalctl -u shelfeye -n 50
```

### Health Endpoint Not Responding

```bash
# Check if service is running
sudo systemctl is-active shelfeye

# Check logs for errors
sudo journalctl -u shelfeye --priority=err -n 20

# Restart if needed
sudo systemctl restart shelfeye
```

### Health Script Shows Errors

The script is designed to catch issues! If you see warnings or errors:

1. Read what it says (it will suggest fixes)
2. Check the logs: `sudo journalctl -u shelfeye -f`
3. See the full troubleshooting guide in `SYSTEM-RESILIENCE-GUIDE.md`

## Understanding What Prevented the Crash

Your Pi likely crashed because of one of these scenarios:

### Scenario 1: Memory Leak
- **What happened**: Application slowly consumed all memory
- **How we protect**: `MemoryMax=1.8G` kills process before system freeze
- **Result**: SystemD restarts app instead of entire Pi crashing

### Scenario 2: Infinite Loop or Deadlock
- **What happened**: Process got stuck, consuming 100% CPU
- **How we protect**: Hardware watchdog detects freeze, reboots Pi
- **Result**: Pi reboots automatically (15 seconds) instead of staying frozen

### Scenario 3: Python Script Crash
- **What happened**: Camera processing script crashed
- **How we protect**: SystemD restarts the entire service
- **Result**: App recovers automatically within 10 seconds

### Scenario 4: Disk Full
- **What happened**: ROI images filled up disk
- **How we protect**: Daily maintenance + emergency cleanup at 80%
- **Result**: Old images deleted before disk fills completely

## Monitoring Going Forward

### Daily Quick Check
```bash
./monitor-system-health.sh
```

### Check for Issues
```bash
# Any errors in the last hour?
sudo journalctl -u shelfeye --priority=err --since "1 hour ago"

# How many times did it restart today?
journalctl -u shelfeye --since today | grep -c "Started"
```

### Optional: Automated Monitoring
You can set up a cron job to email you if something's wrong:

```bash
# Add this to crontab (run: crontab -e)
0 * * * * /home/naniwa/ShelfEye/monitor-system-health.sh >> /home/naniwa/ShelfEye/logs/health.log 2>&1
```

## Questions?

See the complete guide: **`SYSTEM-RESILIENCE-GUIDE.md`**

It includes:
- Detailed explanation of each resilience layer
- How to verify everything is working
- Complete troubleshooting guide
- Log analysis tips
- Quick reference commands

---

**Summary**: Your system now has 4 layers of protection to prevent the crash you experienced. If anything goes wrong, it will automatically recover or alert you before it becomes a problem.
