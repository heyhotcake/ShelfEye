#!/usr/bin/env python3
"""
GPIO Controller for LED Light Strip and Alert Hardware
Controls GPIO pins for consistent lighting during captures
"""

import sys
import argparse
import json

try:
    import RPi.GPIO as GPIO
    GPIO_AVAILABLE = True
except ImportError:
    GPIO_AVAILABLE = False
    print("WARNING: RPi.GPIO not available (not on Raspberry Pi)", file=sys.stderr)

class GPIOController:
    def __init__(self):
        """Initialize GPIO controller"""
        if GPIO_AVAILABLE:
            GPIO.setmode(GPIO.BCM)  # Use BCM pin numbering
            GPIO.setwarnings(False)  # Suppress warnings for already-configured pins
    
    def setup_pin(self, pin: int, mode: str = "out"):
        """Setup a GPIO pin for input or output"""
        if not GPIO_AVAILABLE:
            return False
        
        try:
            if mode.lower() == "out":
                GPIO.setup(pin, GPIO.OUT)
            else:
                GPIO.setup(pin, GPIO.IN)
            return True
        except Exception as e:
            print(f"Error setting up GPIO pin {pin}: {e}", file=sys.stderr)
            return False
    
    def set_pin(self, pin: int, state: bool):
        """Set GPIO pin high (True) or low (False)"""
        if not GPIO_AVAILABLE:
            print(f"GPIO not available - would set pin {pin} to {state}", file=sys.stderr)
            return False
        
        try:
            self.setup_pin(pin, "out")
            GPIO.output(pin, GPIO.HIGH if state else GPIO.LOW)
            return True
        except Exception as e:
            print(f"Error setting GPIO pin {pin}: {e}", file=sys.stderr)
            return False
    
    def get_pin(self, pin: int) -> bool:
        """Read GPIO pin state"""
        if not GPIO_AVAILABLE:
            return False
        
        try:
            self.setup_pin(pin, "in")
            return GPIO.input(pin) == GPIO.HIGH
        except Exception as e:
            print(f"Error reading GPIO pin {pin}: {e}", file=sys.stderr)
            return False
    
    def cleanup(self):
        """Cleanup GPIO pins (optional - pins stay in last state)"""
        if GPIO_AVAILABLE:
            # Don't cleanup - we want pins to maintain state
            pass

def main():
    parser = argparse.ArgumentParser(description="GPIO Controller for LED light strip and alerts")
    parser.add_argument("--pin", type=int, required=True, help="GPIO pin number (BCM)")
    parser.add_argument("--action", choices=["on", "off", "read"], required=True, help="Action to perform")
    
    args = parser.parse_args()
    
    controller = GPIOController()
    
    if args.action == "on":
        success = controller.set_pin(args.pin, True)
        result = {"success": success, "pin": args.pin, "state": "HIGH" if success else "UNKNOWN"}
    elif args.action == "off":
        success = controller.set_pin(args.pin, False)
        result = {"success": success, "pin": args.pin, "state": "LOW" if success else "UNKNOWN"}
    elif args.action == "read":
        state = controller.get_pin(args.pin)
        result = {"success": True, "pin": args.pin, "state": "HIGH" if state else "LOW"}
    
    print(json.dumps(result))
    return 0 if result["success"] else 1

if __name__ == "__main__":
    sys.exit(main())
