#!/bin/bash
# Emergency fix: Disable camera preview auto-polling to stop Pi crashes
# This fixes the crash loop caused by 4K camera preview polling

echo "🔧 Disabling camera preview auto-polling..."

# Navigate to ShelfEye directory
cd /home/naniwa/ShelfEye || { echo "❌ ShelfEye directory not found"; exit 1; }

# Backup the original file
cp client/src/pages/calibration.tsx client/src/pages/calibration.tsx.backup
echo "✅ Backup created: calibration.tsx.backup"

# Replace the preview polling lines
sed -i 's/enabled: !!activeCamera?.id && !isCameraLocked,/enabled: false, \/\/ DISABLED: Auto-polling causes Pi crashes with 4K camera/g' client/src/pages/calibration.tsx
sed -i 's/refetchInterval: isCameraLocked ? false : 3000,/refetchInterval: false, \/\/ No auto-refresh/g' client/src/pages/calibration.tsx

echo "✅ Preview auto-polling disabled"
echo "🔄 Restarting service..."

# Restart the service
sudo systemctl restart shelfeye.service

echo "✅ Service restarted!"
echo ""
echo "The calibration page will no longer auto-poll the camera."
echo "The camera will only be accessed when you click 'Start ArUco Calibration'."
echo ""
echo "To check service status: sudo systemctl status shelfeye.service"
