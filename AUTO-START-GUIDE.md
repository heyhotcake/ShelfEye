# ShelfEye Auto-Start & Auto-Update Guide

## Overview

This guide sets up your Raspberry Pi to automatically:
- ✅ Check for GitHub updates on boot
- ✅ Pull and install updates if available  
- ✅ Start the ShelfEye application automatically
- ✅ Restart the app if it crashes
- ✅ Keep logs for troubleshooting

## Quick Setup (5 minutes)

### 1. Push Changes to GitHub (from Replit)

```bash
git add .
git commit -m "Add auto-start and auto-update system"
git push
```

### 2. SSH to Raspberry Pi

```bash
ssh naniwa@naniwatanacheck.local
cd ~/ShelfEye
```

### 3. Pull Latest Changes

```bash
git pull origin main
```

### 4. Run Installation Script

```bash
chmod +x install-autostart.sh
./install-autostart.sh
```

That's it! ✨ The system is now fully automated.

## What Happens on Boot

1. **Update Check**: Compares local code with GitHub
2. **Auto-Update** (if new version): Pulls changes, runs `npm install` if needed
3. **Database Sync**: Ensures database schema is current
4. **App Start**: Launches the application on port 5000

## Management Commands

### View Service Status
```bash
sudo systemctl status shelfeye
```

### View Live Logs
```bash
# System logs
sudo journalctl -u shelfeye -f

# Application startup logs
tail -f ~/ShelfEye/logs/startup.log
```

### Restart Service
```bash
sudo systemctl restart shelfeye
```

### Stop Service
```bash
sudo systemctl stop shelfeye
```

### Disable Auto-Start
```bash
sudo systemctl disable shelfeye
sudo systemctl stop shelfeye
```

### Re-enable Auto-Start
```bash
sudo systemctl enable shelfeye
sudo systemctl start shelfeye
```

## Manual Update (Force Update)

If you want to manually trigger an update without rebooting:

```bash
sudo systemctl restart shelfeye
```

The service will check for updates and restart with the latest code.

## Troubleshooting

### Service Won't Start

1. Check status:
   ```bash
   sudo systemctl status shelfeye
   ```

2. Check logs:
   ```bash
   sudo journalctl -u shelfeye -n 50
   ```

3. Check startup log:
   ```bash
   tail -100 ~/ShelfEye/logs/startup.log
   ```

### Update Not Pulling

1. Check Git status:
   ```bash
   cd ~/ShelfEye
   git status
   git fetch origin main
   ```

2. If there are local changes:
   ```bash
   git stash
   git pull origin main
   ```

### Port Already in Use

If port 5000 is already taken:

```bash
# Find what's using port 5000
sudo lsof -i :5000

# Kill the process (replace PID)
sudo kill -9 <PID>

# Restart service
sudo systemctl restart shelfeye
```

## Files Created

- `pi-startup.sh` - Main startup script (checks updates, starts app)
- `shelfeye.service` - Systemd service configuration
- `install-autostart.sh` - One-time installation script
- `logs/startup.log` - Application startup logs

## Uninstall Auto-Start

To remove the auto-start service:

```bash
sudo systemctl stop shelfeye
sudo systemctl disable shelfeye
sudo rm /etc/systemd/system/shelfeye.service
sudo systemctl daemon-reload
```

## How It Works

### pi-startup.sh
- Checks GitHub for new commits
- Compares local vs remote version
- Pulls updates if available
- Installs dependencies if `package.json` changed
- Syncs database schema
- Starts the application

### shelfeye.service
- Systemd unit file
- Runs `pi-startup.sh` on boot
- Restarts app if it crashes
- Captures logs to systemd journal

### Update Detection
```bash
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
    # Update available!
fi
```

## Best Practices

1. **Always test updates in Replit first** before pushing to GitHub
2. **Monitor startup logs** after each reboot: `tail -f ~/ShelfEye/logs/startup.log`
3. **Use manual restart** to test updates: `sudo systemctl restart shelfeye`
4. **Check service health** regularly: `sudo systemctl status shelfeye`

## Access After Setup

- **Web Dashboard**: http://naniwatanacheck.local:5000
- **Startup Logs**: `~/ShelfEye/logs/startup.log`
- **System Logs**: `sudo journalctl -u shelfeye`

---

**Questions?** Contact: t-azuma@fs-naniwa.co.jp
