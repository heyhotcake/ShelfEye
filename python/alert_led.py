#!/usr/bin/env python3
"""
Alert LED Controller - Flashing Red Light for System Alerts
Uses WS2812B addressable LED strip to show red flashing alerts
"""

import sys
import argparse
import json
import time
import threading
import signal

try:
    from rpi_ws281x import PixelStrip, Color
    WS2812_AVAILABLE = True
except ImportError:
    WS2812_AVAILABLE = False
    print("WARNING: rpi_ws281x not available (not on Raspberry Pi)", file=sys.stderr)

class AlertLED:
    """Controller for flashing alert LED using WS2812B strip"""
    
    def __init__(self, pin: int, num_leds: int = 27):
        """
        Initialize alert LED controller for WS2812B strip
        
        Args:
            pin: GPIO pin number (BCM) - should be 18 for WS2812B
            num_leds: Number of LEDs in the strip (default 27)
        """
        self.pin = pin
        self.num_leds = num_leds
        self.flashing = False
        self.flash_thread = None
        self.strip = None
        
        if WS2812_AVAILABLE:
            try:
                self.strip = PixelStrip(
                    num_leds,
                    pin,
                    800000,  # 800kHz for WS2812
                    10,      # DMA channel
                    False,   # Invert signal
                    255,     # Max brightness
                    0,       # Channel
                    0x00081000  # WS2812 strip type
                )
                self.strip.begin()
            except Exception as e:
                print(f"Error initializing LED strip: {e}", file=sys.stderr)
                self.strip = None
    
    def _set_all_color(self, r: int, g: int, b: int):
        """Set all LEDs to a specific color"""
        if not self.strip:
            return False
        try:
            for i in range(self.num_leds):
                self.strip.setPixelColor(i, Color(r, g, b))
            self.strip.show()
            return True
        except Exception as e:
            print(f"Error setting LED color: {e}", file=sys.stderr)
            return False
    
    def start_flash(self, pattern: str = "fast"):
        """
        Start flashing the LED strip RED
        
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
                # Turn RED
                self._set_all_color(255, 0, 0)
                time.sleep(on_time)
                
                if not self.flashing:
                    break
                
                # Turn OFF
                self._set_all_color(0, 0, 0)
                time.sleep(off_time)
        
        self.flash_thread = threading.Thread(target=flash_loop)
        self.flash_thread.start()
        return True
    
    def stop_flash(self):
        """Stop flashing and turn off LED strip"""
        self.flashing = False
        if self.flash_thread:
            self.flash_thread.join(timeout=2)
        
        # Turn off all LEDs
        self._set_all_color(0, 0, 0)
        
        return True
    
    def is_flashing(self):
        """Check if LED is currently flashing"""
        return self.flashing
    
    def set_state(self, state: bool):
        """Set LED strip to constant RED (on) or OFF"""
        self.stop_flash()
        
        if state:
            self._set_all_color(255, 0, 0)  # RED for alerts
        else:
            self._set_all_color(0, 0, 0)  # OFF
        
        return True


def main():
    parser = argparse.ArgumentParser(description="Alert LED Controller - WS2812B RGB LED Strip")
    parser.add_argument("--pin", type=int, required=True, help="GPIO pin number (BCM) - should be 18 for WS2812B")
    parser.add_argument("--action", choices=["flash", "stop", "on", "off", "status"], required=True, help="Action to perform")
    parser.add_argument("--pattern", choices=["fast", "slow", "pulse"], default="fast", help="Flash pattern (for flash action)")
    parser.add_argument("--duration", type=int, help="Flash duration in seconds (optional)")
    parser.add_argument("--num-leds", type=int, default=27, help="Number of LEDs in the strip (default 27)")
    
    args = parser.parse_args()
    
    led = AlertLED(args.pin, args.num_leds)
    
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
