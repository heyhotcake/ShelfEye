#!/usr/bin/env python3
"""
Unified LED Controller - Single source of truth for WS2812B LED strip control
Implements priority system: RED FLASH > WHITE LIGHT
Prevents DMA channel conflicts by managing a single strip instance
"""

import sys
import argparse
import json
import time
import threading
import signal
import os

try:
    from rpi_ws281x import PixelStrip, Color
    WS2812_AVAILABLE = True
except ImportError:
    WS2812_AVAILABLE = False
    print("WARNING: rpi_ws281x not available (not on Raspberry Pi)", file=sys.stderr)

# Global state file for cross-process communication
STATE_FILE = '/tmp/led_state.json'
LOCK_FILE = '/tmp/led_controller.lock'

class UnifiedLEDController:
    """Single controller for WS2812B strip with priority management"""
    
    def __init__(self, pin: int, num_leds: int = 27, brightness: int = 100):
        self.pin = pin
        self.num_leds = num_leds
        self.brightness = brightness
        self.strip = None
        self.flashing = False
        self.flash_thread = None
        self.current_mode = 'off'
        
        if WS2812_AVAILABLE:
            try:
                self.strip = PixelStrip(
                    num_leds,
                    pin,
                    800000,  # 800kHz
                    10,      # DMA channel
                    False,   # Invert
                    brightness,  # Configurable brightness (default 100 for 4K camera)
                    0,       # Channel
                    0x00081000  # WS2812
                )
                self.strip.begin()
            except Exception as e:
                print(f"Error initializing LED strip: {e}", file=sys.stderr)
                self.strip = None
    
    def _set_all(self, r: int, g: int, b: int):
        """Set all LEDs to color"""
        if not self.strip:
            return False
        try:
            for i in range(self.num_leds):
                self.strip.setPixelColor(i, Color(r, g, b))
            self.strip.show()
            return True
        except Exception as e:
            print(f"Error setting LEDs: {e}", file=sys.stderr)
            return False
    
    def _save_state(self, mode: str):
        """Save current mode to state file for cross-process awareness"""
        try:
            with open(STATE_FILE, 'w') as f:
                json.dump({'mode': mode, 'pid': os.getpid()}, f)
        except:
            pass
    
    def _load_state(self):
        """Load current mode from state file"""
        try:
            if os.path.exists(STATE_FILE):
                with open(STATE_FILE, 'r') as f:
                    return json.load(f)
        except:
            pass
        return {'mode': 'off', 'pid': None}
    
    def set_white(self):
        """Set white light (ONLY if not flashing red)"""
        state = self._load_state()
        if state['mode'] == 'red_flash':
            print("[LED] RED FLASH has priority - white light request denied", file=sys.stderr)
            return False
        
        self.flashing = False
        success = self._set_all(255, 255, 255)
        if success:
            self._save_state('white')
            self.current_mode = 'white'
        return success
    
    def set_off(self):
        """Turn off LEDs (ONLY if not flashing red)"""
        state = self._load_state()
        if state['mode'] == 'red_flash':
            print("[LED] RED FLASH active - cannot turn off", file=sys.stderr)
            return False
        
        self.flashing = False
        success = self._set_all(0, 0, 0)
        if success:
            self._save_state('off')
            self.current_mode = 'off'
        return success
    
    def start_red_flash(self, pattern: str = 'slow'):
        """Start flashing RED - HIGHEST PRIORITY"""
        # Stop any existing flash
        self.stop_red_flash()
        
        self.flashing = True
        self._save_state('red_flash')
        self.current_mode = 'red_flash'
        
        if pattern == 'fast':
            on_time, off_time = 0.25, 0.25
        elif pattern == 'slow':
            on_time, off_time = 1.0, 1.0
        elif pattern == 'pulse':
            on_time, off_time = 0.1, 0.9
        else:
            on_time, off_time = 0.5, 0.5
        
        def flash_loop():
            while self.flashing:
                self._set_all(255, 0, 0)  # RED
                time.sleep(on_time)
                if not self.flashing:
                    break
                self._set_all(0, 0, 0)  # OFF
                time.sleep(off_time)
        
        self.flash_thread = threading.Thread(target=flash_loop, daemon=False)
        self.flash_thread.start()
        return True
    
    def stop_red_flash(self):
        """Stop red flash and turn off"""
        self.flashing = False
        if self.flash_thread:
            self.flash_thread.join(timeout=2)
        
        self._set_all(0, 0, 0)
        self._save_state('off')
        self.current_mode = 'off'
        return True
    
    def get_status(self):
        """Get current LED status"""
        state = self._load_state()
        return {
            'mode': state['mode'],
            'flashing': self.flashing,
            'current_pid': os.getpid(),
            'state_pid': state.get('pid')
        }

def main():
    parser = argparse.ArgumentParser(description="Unified LED Controller with Priority")
    parser.add_argument("--pin", type=int, required=True, help="GPIO pin (BCM)")
    parser.add_argument("--action", choices=["white", "off", "red_flash_start", "red_flash_stop", "status"], required=True)
    parser.add_argument("--pattern", choices=["fast", "slow", "pulse"], default="slow", help="Flash pattern")
    parser.add_argument("--num-leds", type=int, default=27, help="Number of LEDs")
    parser.add_argument("--brightness", type=int, default=100, help="LED brightness 0-255 (default 100 for new 4K camera)")
    parser.add_argument("--duration", type=int, help="Duration in seconds (for timed actions)")
    
    args = parser.parse_args()
    
    led = UnifiedLEDController(args.pin, args.num_leds, args.brightness)
    
    # Signal handler for graceful shutdown
    def signal_handler(sig, frame):
        if led.flashing:
            led.stop_red_flash()
        sys.exit(0)
    
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    if args.action == "white":
        success = led.set_white()
        result = {"success": success, "pin": args.pin, "mode": "white", "priority_denied": not success}
    
    elif args.action == "off":
        success = led.set_off()
        result = {"success": success, "pin": args.pin, "mode": "off", "priority_denied": not success}
    
    elif args.action == "red_flash_start":
        success = led.start_red_flash(args.pattern)
        
        # If duration specified, flash then stop
        if args.duration:
            time.sleep(args.duration)
            led.stop_red_flash()
            result = {"success": success, "pin": args.pin, "mode": "red_flash", "pattern": args.pattern, "flashing": False}
        else:
            # Output result and keep running
            result = {"success": success, "pin": args.pin, "mode": "red_flash", "pattern": args.pattern, "flashing": True}
            print(json.dumps(result), flush=True)
            
            # Keep process alive
            if led.flash_thread:
                led.flash_thread.join()
            
            led.stop_red_flash()
            return 0
    
    elif args.action == "red_flash_stop":
        success = led.stop_red_flash()
        result = {"success": success, "pin": args.pin, "mode": "off", "flashing": False}
    
    elif args.action == "status":
        status = led.get_status()
        result = {"success": True, "pin": args.pin, **status}
    
    print(json.dumps(result))
    return 0 if result.get("success", False) else 1

if __name__ == "__main__":
    sys.exit(main())
