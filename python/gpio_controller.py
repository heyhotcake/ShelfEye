#!/usr/bin/env python3
"""
GPIO Controller for LED Light Strip and Alert Hardware
Controls GPIO pins for consistent lighting during captures
Supports both simple GPIO and addressable WS2812B LED strips
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

try:
    from rpi_ws281x import PixelStrip, Color
    WS2812_AVAILABLE = True
except ImportError:
    WS2812_AVAILABLE = False

class LEDStripController:
    """Controller for WS2812B addressable LED strips"""
    def __init__(self, pin: int, num_leds: int = 30, brightness: int = 255):
        """Initialize LED strip controller
        
        Args:
            pin: GPIO pin for data line (BCM numbering)
            num_leds: Number of LEDs in the strip (default 30)
            brightness: Brightness level 0-255 (default 255 for max)
        """
        self.pin = pin
        self.num_leds = num_leds
        self.brightness = brightness
        self.strip = None
        
        if WS2812_AVAILABLE:
            try:
                self.strip = PixelStrip(
                    num_leds,
                    pin,
                    800000,  # LED signal frequency in Hz (800kHz for WS2812)
                    10,      # DMA channel
                    False,   # Invert signal
                    brightness,
                    0,       # Channel (0 or 1)
                    0x00081000  # Strip type WS2812
                )
                self.strip.begin()
            except Exception as e:
                print(f"Error initializing LED strip: {e}", file=sys.stderr)
                self.strip = None
    
    def set_all(self, color: tuple = (255, 255, 255)):
        """Set all LEDs to a specific color (R, G, B)"""
        if not self.strip:
            return False
        
        try:
            r, g, b = color
            for i in range(self.num_leds):
                self.strip.setPixelColor(i, Color(r, g, b))
            self.strip.show()
            return True
        except Exception as e:
            print(f"Error setting LED colors: {e}", file=sys.stderr)
            return False
    
    def turn_on(self):
        """Turn on all LEDs (bright white for workshop lighting)"""
        return self.set_all((255, 255, 255))
    
    def turn_off(self):
        """Turn off all LEDs"""
        return self.set_all((0, 0, 0))

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
    parser.add_argument("--led-count", type=int, default=30, help="Number of LEDs in strip (for WS2812B)")
    parser.add_argument("--use-ws2812", action="store_true", help="Use WS2812B addressable LED mode")
    
    args = parser.parse_args()
    
    # Check if this should use LED strip controller (WS2812B mode)
    # Auto-detect: if WS2812 library is available and action is on/off, use it
    use_led_strip = args.use_ws2812 or (WS2812_AVAILABLE and args.action in ["on", "off"])
    
    if use_led_strip and args.action != "read":
        # Use LED strip controller for addressable LEDs
        led_strip = LEDStripController(args.pin, args.led_count)
        
        if args.action == "on":
            success = led_strip.turn_on()
            result = {"success": success, "pin": args.pin, "state": "HIGH" if success else "UNKNOWN", "mode": "ws2812"}
        elif args.action == "off":
            success = led_strip.turn_off()
            result = {"success": success, "pin": args.pin, "state": "LOW" if success else "UNKNOWN", "mode": "ws2812"}
    else:
        # Use simple GPIO controller
        controller = GPIOController()
        
        if args.action == "on":
            success = controller.set_pin(args.pin, True)
            result = {"success": success, "pin": args.pin, "state": "HIGH" if success else "UNKNOWN", "mode": "gpio"}
        elif args.action == "off":
            success = controller.set_pin(args.pin, False)
            result = {"success": success, "pin": args.pin, "state": "LOW" if success else "UNKNOWN", "mode": "gpio"}
        elif args.action == "read":
            state = controller.get_pin(args.pin)
            result = {"success": True, "pin": args.pin, "state": "HIGH" if state else "LOW", "mode": "gpio"}
    
    print(json.dumps(result))
    return 0 if result["success"] else 1

if __name__ == "__main__":
    sys.exit(main())
