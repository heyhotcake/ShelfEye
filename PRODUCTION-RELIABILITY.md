# Production Reliability Roadmap

## Overview
Critical reliability fixes required before and after production deployment. Core features (calibration, slot detection, LED alerts) are working. These fixes ensure multi-week uptime on Raspberry Pi hardware.

---

## Phase 1: Pre-Production Critical Fixes
**Must complete before deployment. System instability without these.**

### 1. Scheduled Capture Timeout Protection
- **Problem**: Capture process can hang forever, blocking all future scheduled runs
- **Impact**: System becomes non-functional until manual restart
- **Solution**: 
  - Add 10-minute timeout to `process_cameras.py` execution
  - Kill process if exceeded
  - Log failure and send email alert
  - Skip to next scheduled time (no retry)
- **Files**: `server/scheduler.ts`, `server/camera-session-manager.ts`

### 2. Database Connection Resilience  
- **Problem**: No retry/reconnect logic if PostgreSQL connection drops
- **Impact**: App crashes on any database hiccup
- **Solution**:
  - Add connection pool health checks
  - Auto-reconnect on connection loss
  - Retry transient errors with exponential backoff
  - Graceful degradation if database unavailable
- **Files**: `server/db.ts`, `server/storage.ts`

### 3. Python Subprocess Cleanup
- **Problem**: Spawned Python processes may not be properly cleaned up
- **Impact**: Zombie processes accumulate over weeks → memory leak → OOM crash
- **Solution**:
  - Track all child processes globally
  - Ensure termination in finally blocks
  - Add periodic zombie process detection/cleanup
  - Log subprocess lifecycle events
- **Files**: `server/camera-session-manager.ts`, `server/scheduler.ts`

---

## Phase 2: Post-Launch High Priority
**Deploy within first week of production operation.**

### 4. Per-Camera Error Handling
- **Problem**: Single camera failure crashes entire capture → lose data from all cameras
- **Impact**: One loose USB cable = total system failure for that time period
- **Solution**:
  - Process each camera independently in try/except blocks
  - Log per-camera successes/failures
  - Continue with remaining cameras if one fails
  - Alert shows which cameras failed vs succeeded
- **Files**: `python/process_cameras.py`, `python/camera_manager.py`

### 5. Alert Queue Persistence
- **Problem**: Email/Sheets API failures lose alerts permanently
- **Impact**: Critical alerts disappear if Google APIs down
- **Solution**:
  - Persist failed alerts to database with retry queue
  - Exponential backoff retry (5min, 15min, 1hr, 4hr)
  - Mark as "permanent failure" after 24 hours
  - Dashboard shows alert queue status
- **Files**: `server/services/email-alerts.ts`, `server/services/sheets-logger.ts`, `shared/schema.ts`

### 6. Disk Space Proactive Monitoring
- **Problem**: Emergency cleanup only at 90% usage - too late
- **Impact**: SD card fills suddenly, system instability, potential data loss
- **Solution**:
  - Warning alerts at 70% and 80% usage
  - More aggressive cleanup thresholds (start at 75%)
  - Email notification when space running low
  - Dashboard disk space indicator
- **Files**: `server/maintenance.ts`, `server/services/email-alerts.ts`

---

## Implementation Priority

### Week 0 (Before Launch):
- ✅ Core features: Calibration, slot detection, LED alerts
- ✅ LED flash reliability: Self-healing with watchdog
- 🔲 Phase 1 Task 1: Timeout protection
- 🔲 Phase 1 Task 2: Database resilience
- 🔲 Phase 1 Task 3: Subprocess cleanup

### Week 1 (After Launch):
- 🔲 Phase 2 Task 4: Per-camera error handling
- 🔲 Phase 2 Task 5: Alert queue persistence
- 🔲 Phase 2 Task 6: Disk space monitoring

---

## Testing Requirements

### Phase 1 Testing:
- **Timeout**: Simulate hanging capture (infinite sleep in Python), verify kill + alert within 10 minutes
- **Database**: Stop/restart PostgreSQL during operation, verify auto-reconnect and continued operation
- **Subprocess**: Run 100+ capture cycles, check `ps aux | grep python` for zombie processes

### Phase 2 Testing:
- **Per-Camera**: Unplug one USB camera during capture, verify other cameras continue successfully
- **Alert Queue**: Disable network interface, trigger alerts, restore network, verify retry and delivery
- **Disk Space**: Fill SD card to 75%, verify cleanup triggers and email alerts sent

---

## Success Metrics

### Phase 1 Complete When:
- ✅ System runs 7 days straight without manual intervention
- ✅ Scheduled captures succeed or fail gracefully (no hangs)
- ✅ Database restarts don't crash the app
- ✅ No zombie processes after 100+ capture cycles

### Phase 2 Complete When:
- ✅ Single camera failure doesn't affect other cameras
- ✅ Alerts retry successfully after transient failures
- ✅ Disk space warnings trigger before emergency cleanup
- ✅ System runs 30 days with <1% scheduled capture failures

---

## Hardware Context

**Raspberry Pi 4 (2GB RAM)**
- OS: Raspberry Pi OS Lite (64-bit)
- Storage: 32GB SD card
- Cameras: 4x USB cameras via powered hub
- LED: GPIO-controlled status indicator
- Uptime target: Weeks to months

**Resource Constraints:**
- Memory limit: 1.8GB (90% of 2GB)
- Disk space: ~28GB usable (4GB reserved for OS/system)
- Network: WiFi (can be intermittent)
- Power: Critical - clean shutdown required

---

## Rollback Plan

If any Phase 1 fix causes instability:
1. Git revert the specific commit
2. SystemD will auto-restart services
3. Hardware watchdog will reboot Pi if frozen (240s timeout)
4. Manual intervention: SSH access for emergency recovery

All changes are incremental and independently revertible.
