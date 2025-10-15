#!/usr/bin/env python3
"""
Alert LED Controller - Flashing Red Light for System Alerts
Provides visual indication of errors and anomalies
"""

import sys
import argparse
import json
import time
import threading
import signal

try:
    import RPi.GPIO as GPIO
    GPIO_AVAILABLE = True
except ImportError:
    GPIO_AVAILABLE = False
    print("WARNING: RPi.GPIO not available (not on Raspberry Pi)", file=sys.stderr)

class AlertLED:
    """Controller for flashing alert LED"""
    
    def __init__(self, pin: int):
        """
        Initialize alert LED controller
        
        Args:
            pin: GPIO pin number (BCM)
        """
        self.pin = pin
        self.flashing = False
        self.flash_thread = None
        
        if GPIO_AVAILABLE:
            GPIO.setmode(GPIO.BCM)
            GPIO.setwarnings(False)
            GPIO.setup(pin, GPIO.OUT)
            GPIO.output(pin, GPIO.LOW)
    
    def start_flash(self, pattern: str = "fast"):
        """
        Start flashing the LED
        
        Args:
            pattern: Flash pattern - "fast" (0.25s), "slow" (1s), "pulse" (variable)
        """
        if self.flashing:
            return True
        
        self.flashing = True
        
        if pattern == "fast":
            on_time = 0.25
            off_time = 0.25
        elif pattern == "slow":
            on_time = 1.0
            off_time = 1.0
        elif pattern == "pulse":
            on_time = 0.1
            off_time = 0.9
        else:
            on_time = 0.5
            off_time = 0.5
        
        def flash_loop():
            while self.flashing:
                if GPIO_AVAILABLE:
                    GPIO.output(self.pin, GPIO.HIGH)
                time.sleep(on_time)
                
                if not self.flashing:
                    break
                
                if GPIO_AVAILABLE:
                    GPIO.output(self.pin, GPIO.LOW)
                time.sleep(off_time)
        
        self.flash_thread = threading.Thread(target=flash_loop)
        self.flash_thread.start()
        return True
    
    def stop_flash(self):
        """Stop flashing and turn off LED"""
        self.flashing = False
        if self.flash_thread:
            self.flash_thread.join(timeout=2)
        
        if GPIO_AVAILABLE:
            GPIO.output(self.pin, GPIO.LOW)
        
        return True
    
    def is_flashing(self):
        """Check if LED is currently flashing"""
        return self.flashing
    
    def set_state(self, state: bool):
        """Set LED to constant on or off"""
        self.stop_flash()
        
        if GPIO_AVAILABLE:
            GPIO.output(self.pin, GPIO.HIGH if state else GPIO.LOW)
        
        return True


def main():
    parser = argparse.ArgumentParser(description="Alert LED Controller")
    parser.add_argument("--pin", type=int, required=True, help="GPIO pin number (BCM)")
    parser.add_argument("--action", choices=["flash", "stop", "on", "off", "status"], required=True, help="Action to perform")
    parser.add_argument("--pattern", choices=["fast", "slow", "pulse"], default="fast", help="Flash pattern (for flash action)")
    parser.add_argument("--duration", type=int, help="Flash duration in seconds (optional)")
    
    args = parser.parse_args()
    
    led = AlertLED(args.pin)
    
    # Setup signal handler for graceful shutdown
    def signal_handler(sig, frame):
        led.stop_flash()
        sys.exit(0)
    
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    if args.action == "flash":
        success = led.start_flash(args.pattern)
        
        # If duration specified, flash for that long then stop
        if args.duration:
            time.sleep(args.duration)
            led.stop_flash()
            result = {
                "success": success,
                "pin": args.pin,
                "action": "flash",
                "pattern": args.pattern,
                "flashing": False
            }
        else:
            # Output result immediately and flush before blocking
            result = {
                "success": success,
                "pin": args.pin,
                "action": "flash",
                "pattern": args.pattern,
                "flashing": led.is_flashing()
            }
            print(json.dumps(result), flush=True)
            
            # Keep process alive by joining the thread
            # This blocks until the thread is signaled to stop
            if led.flash_thread:
                led.flash_thread.join()
            
            # Clean up on exit
            led.stop_flash()
            return 0
    
    elif args.action == "stop":
        success = led.stop_flash()
        result = {
            "success": success,
            "pin": args.pin,
            "action": "stop",
            "flashing": False
        }
    
    elif args.action == "on":
        success = led.set_state(True)
        result = {
            "success": success,
            "pin": args.pin,
            "action": "on",
            "state": "HIGH"
        }
    
    elif args.action == "off":
        success = led.set_state(False)
        result = {
            "success": success,
            "pin": args.pin,
            "action": "off",
            "state": "LOW"
        }
    
    elif args.action == "status":
        result = {
            "success": True,
            "pin": args.pin,
            "action": "status",
            "flashing": led.is_flashing()
        }
    
    print(json.dumps(result))
    return 0 if result.get("success", False) else 1


if __name__ == "__main__":
    sys.exit(main())
