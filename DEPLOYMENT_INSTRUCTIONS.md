# Production Deployment Instructions for Raspberry Pi

## Service File Updates

The following service files have been updated to fix the startup race condition:
- `led-manager.service`
- `shelfeye.service`

### To Apply Service File Changes on Raspberry Pi:

```bash
# Copy updated service files to systemd directory
sudo cp /home/naniwa/ShelfEye/led-manager.service /etc/systemd/system/
sudo cp /home/naniwa/ShelfEye/shelfeye.service /etc/systemd/system/

# Reload systemd to recognize changes
sudo systemctl daemon-reload

# Restart services in correct order
sudo systemctl restart led-manager.service
sudo systemctl restart shelfeye.service

# Verify both services are running
sudo systemctl status led-manager.service
sudo systemctl status shelfeye.service

# Check that LED pipe exists
ls -la /home/naniwa/ShelfEye/state/led_command_pipe
```

### Changes Made:

**led-manager.service:**
- Added `Before=shelfeye.service` to ensure LED daemon starts first

**shelfeye.service:**
- Added `After=led-manager.service` to wait for LED daemon
- Added `Wants=led-manager.service` to ensure LED daemon is running

This ensures the main application waits for the LED daemon to be ready, eliminating the "pipe not found" errors during startup.

## Code Changes Summary

### 1. TypeScript Compilation Fix
- Fixed Set iteration error in `server/routes.ts` line 2218
- Changed from spread operator to `Array.from()` for ES5 compatibility

### 2. LED Retry Logic
- Added exponential backoff retry logic to all LED functions
- Handles startup race condition gracefully
- Retry configuration: 3 attempts with 1s, 2s, 4s delays
- Automatically detects "Daemon not running" errors and retries

### Next Steps:
1. Apply service file updates (see commands above)
2. Configure database with slot definitions
3. Add missing configuration keys
4. Test end-to-end capture flow
