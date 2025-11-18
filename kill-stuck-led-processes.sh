#!/bin/bash
# Kill all stuck LED-related Python processes
# Run this before installing the new LED daemon

set -e

echo "🔍 Looking for stuck LED processes..."
echo ""

# Find all Python processes running LED-related scripts
LED_PROCESSES=$(ps aux | grep -E "(alert_led|gpio_controller|unified_led_controller)" | grep -v grep || true)

if [ -z "$LED_PROCESSES" ]; then
    echo "✅ No stuck LED processes found!"
else
    echo "Found stuck processes:"
    echo "$LED_PROCESSES"
    echo ""
    
    # Kill them
    echo "🔪 Killing stuck LED processes..."
    pkill -f "alert_led.py" 2>/dev/null || true
    pkill -f "gpio_controller.py" 2>/dev/null || true
    pkill -f "unified_led_controller.py" 2>/dev/null || true
    
    sleep 1
    
    # Verify they're gone
    REMAINING=$(ps aux | grep -E "(alert_led|gpio_controller|unified_led_controller)" | grep -v grep || true)
    if [ -z "$REMAINING" ]; then
        echo "✅ All stuck processes killed successfully!"
    else
        echo "⚠️  Some processes still running. Trying force kill..."
        pkill -9 -f "alert_led.py" 2>/dev/null || true
        pkill -9 -f "gpio_controller.py" 2>/dev/null || true
        pkill -9 -f "unified_led_controller.py" 2>/dev/null || true
        sleep 1
        echo "✅ Force kill complete!"
    fi
fi

echo ""
echo "🎯 Next steps:"
echo "1. Run: ./install-led-daemon.sh"
echo "2. The new daemon will take control of the LEDs"
