# 🚀 Raspberry Pi Setup - Quick Reference

## 📋 What You Need

- **Raspberry Pi 4** (SSH enabled)
- **USB Camera** connected
- **Database URL** from Replit/Neon
- **GitHub repo**: `heyhotcake/NaniwaTanaCheck`

---

## ⚡ Quick Deploy (5 Minutes)

### Step 1: SSH to Your Pi
```bash
ssh naniwa@naniwatanacheck.local
```

### Step 2: Run Deployment Script
```bash
curl -fsSL https://raw.githubusercontent.com/heyhotcake/NaniwaTanaCheck/main/deploy-to-pi.sh | bash
```

The script will:
1. Install Node.js 20 ✅
2. Install Python dependencies ✅
3. Clone the repo ✅
4. Install packages ✅
5. Set up .env file (you'll provide DATABASE_URL) ✅
6. Test camera ✅
7. Setup database ✅

### Step 3: Start the App
```bash
cd NaniwaTanaCheck

# Option A: Development mode (for testing)
npm run dev

# Option B: Production mode
npm run build && npm start

# Option C: Install as service (runs automatically)
./pi-quickstart.sh install-service
./pi-quickstart.sh start
```

### Step 4: Access Dashboard
- Local: http://localhost:5000
- Network: http://naniwatanacheck.local:5000

---

## 🛠️ Useful Commands

### Service Management
```bash
./pi-quickstart.sh start      # Start service
./pi-quickstart.sh stop       # Stop service
./pi-quickstart.sh restart    # Restart service
./pi-quickstart.sh status     # Check status
./pi-quickstart.sh logs       # View live logs
```

### Camera Testing
```bash
./pi-quickstart.sh test-camera
# or
python3 python/test_camera.py
```

### Update Application
```bash
cd NaniwaTanaCheck
git pull
npm install
npm run db:push
./pi-quickstart.sh restart
```

---

## 📁 Files Created

| File | Purpose |
|------|---------|
| `deploy-to-pi.sh` | Automated deployment script |
| `PI-DEPLOYMENT.md` | Complete deployment guide |
| `pi-quickstart.sh` | Service management shortcuts |
| `tool-tracker.service` | Systemd service template |
| `.env.example` | Environment variables template |
| `python/test_camera.py` | Camera testing utility |

---

## 🔧 Configuration

### .env File Structure
```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
NODE_ENV=production
SESSION_SECRET=$(openssl rand -base64 32)
PORT=5000
```

### Get Your DATABASE_URL
1. From Replit: Check Secrets tab → DATABASE_URL
2. From Neon: Dashboard → Connection String

---

## 🎯 System Architecture

```
┌─────────────────────────────────────────┐
│         Raspberry Pi 4                  │
│  ┌────────────────────────────────────┐ │
│  │  USB Camera (Device 0)             │ │
│  └────────────────────────────────────┘ │
│               ↓                         │
│  ┌────────────────────────────────────┐ │
│  │  Python CV Pipeline                │ │
│  │  - ArUco Detection                 │ │
│  │  - QR Decoding                     │ │
│  │  - Worker Validation               │ │
│  └────────────────────────────────────┘ │
│               ↓                         │
│  ┌────────────────────────────────────┐ │
│  │  Node.js Express Server            │ │
│  │  - API Routes                      │ │
│  │  - Scheduled Captures (Cron)       │ │
│  │  - Alert System                    │ │
│  └────────────────────────────────────┘ │
│               ↓                         │
│  ┌────────────────────────────────────┐ │
│  │  React Dashboard (Port 5000)       │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│     Neon PostgreSQL (Cloud)             │
│  - Detection Logs                       │
│  - Workers Database                     │
│  - Slot Configuration                   │
└─────────────────────────────────────────┘
```

---

## 📊 Scheduled Captures (JST)

The system runs automated captures:
- **08:00** - Morning shift start
- **11:00** - Mid-morning check
- **14:00** - Afternoon check
- **17:00** - End of shift

Each capture:
1. Pre-diagnostic (30 min before)
2. Captures all slots
3. Validates worker QR codes
4. Sends alerts if tools missing
5. Logs to database + Google Sheets

---

## 🔍 Troubleshooting

### Camera Not Found
```bash
v4l2-ctl --list-devices
sudo usermod -a -G video naniwa
# Then reboot
```

### Port 5000 in Use
```bash
sudo lsof -ti:5000 | xargs kill -9
```

### Database Connection Failed
- Check DATABASE_URL in .env
- Test: `npm run db:push`

### Service Won't Start
```bash
sudo journalctl -u tool-tracker -n 50
```

---

## 📈 Next Steps After Deployment

1. **Add Cameras**: Settings → Cameras → Add Camera
2. **Calibrate**: Upload ArUco template → Calibrate
3. **Configure Slots**: Draw slot regions → Save
4. **Add Workers**: Workers tab → Register workers
5. **Test Capture**: Trigger manual capture
6. **Configure Alerts**: Set email recipients

---

## 📞 Support

- **Full Guide**: See `PI-DEPLOYMENT.md`
- **Email**: t-azuma@fs-naniwa.co.jp
- **GitHub**: https://github.com/heyhotcake/NaniwaTanaCheck

---

**Pro Tip**: Run the deployment script first, then read `PI-DEPLOYMENT.md` for advanced configuration and troubleshooting.
