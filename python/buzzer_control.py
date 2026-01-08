#!/usr/bin/env python3
"""
Buzzer control via GPIO 17 (Physical Pin 11)
Controls an Ario 2401 or similar buzzer for alert notifications.
"""

import argparse
import json
import sys
import time

BUZZER_GPIO = 17

try:
    import RPi.GPIO as GPIO
    GPIO_AVAILABLE = True
except ImportError:
    GPIO_AVAILABLE = False

def setup_gpio():
    if not GPIO_AVAILABLE:
        return False
    try:
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        GPIO.setup(BUZZER_GPIO, GPIO.OUT)
        return True
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"GPIO setup failed: {e}"}))
        return False

def buzzer_on():
    if not GPIO_AVAILABLE:
        return {"ok": False, "error": "RPi.GPIO not available"}
    try:
        GPIO.output(BUZZER_GPIO, GPIO.HIGH)
        return {"ok": True, "state": "on"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def buzzer_off():
    if not GPIO_AVAILABLE:
        return {"ok": False, "error": "RPi.GPIO not available"}
    try:
        GPIO.output(BUZZER_GPIO, GPIO.LOW)
        return {"ok": True, "state": "off"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def buzzer_beep(duration_ms=500, count=3, interval_ms=200):
    if not GPIO_AVAILABLE:
        return {"ok": False, "error": "RPi.GPIO not available"}
    try:
        for i in range(count):
            GPIO.output(BUZZER_GPIO, GPIO.HIGH)
            time.sleep(duration_ms / 1000.0)
            GPIO.output(BUZZER_GPIO, GPIO.LOW)
            if i < count - 1:
                time.sleep(interval_ms / 1000.0)
        return {"ok": True, "beeps": count}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def cleanup():
    if GPIO_AVAILABLE:
        try:
            GPIO.output(BUZZER_GPIO, GPIO.LOW)
            GPIO.cleanup(BUZZER_GPIO)
        except:
            pass

def main():
    parser = argparse.ArgumentParser(description='Buzzer control via GPIO 17')
    parser.add_argument('command', choices=['on', 'off', 'beep', 'status'],
                        help='Command to execute')
    parser.add_argument('--duration', type=int, default=500,
                        help='Beep duration in ms (default: 500)')
    parser.add_argument('--count', type=int, default=3,
                        help='Number of beeps (default: 3)')
    parser.add_argument('--interval', type=int, default=200,
                        help='Interval between beeps in ms (default: 200)')
    parser.add_argument('--json', action='store_true',
                        help='Output as JSON')
    
    args = parser.parse_args()
    
    if not setup_gpio():
        if not GPIO_AVAILABLE:
            result = {"ok": False, "error": "RPi.GPIO not available (not on Raspberry Pi)"}
            print(json.dumps(result))
            sys.exit(1)
        sys.exit(1)
    
    try:
        if args.command == 'on':
            result = buzzer_on()
        elif args.command == 'off':
            result = buzzer_off()
        elif args.command == 'beep':
            result = buzzer_beep(args.duration, args.count, args.interval)
        elif args.command == 'status':
            result = {"ok": True, "gpio": BUZZER_GPIO, "available": GPIO_AVAILABLE}
        
        print(json.dumps(result))
        
        if args.command != 'on':
            cleanup()
            
    except KeyboardInterrupt:
        cleanup()
        print(json.dumps({"ok": False, "error": "Interrupted"}))
        sys.exit(1)
    except Exception as e:
        cleanup()
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
