#!/usr/bin/env python3
"""
Direct LED strip test - bypasses the application
Run with: sudo python3 test_led_direct.py
"""

import sys
import time

try:
    from rpi_ws281x import PixelStrip, Color
    print("✓ rpi_ws281x library loaded successfully")
except ImportError as e:
    print(f"✗ ERROR: rpi_ws281x library not available: {e}")
    sys.exit(1)

# LED strip configuration
LED_COUNT = 99           # Number of LED pixels
LED_PIN = 18             # GPIO pin (BCM numbering)
LED_FREQ_HZ = 800000     # LED signal frequency (800kHz)
LED_DMA = 10             # DMA channel
LED_BRIGHTNESS = 100     # Brightness (0-255)
LED_INVERT = False       # Don't invert signal
LED_CHANNEL = 0          # Channel 0
LED_STRIP_TYPE = 0x00081000  # WS2812

print(f"\nLED Strip Configuration:")
print(f"  Count: {LED_COUNT} LEDs")
print(f"  GPIO Pin: {LED_PIN} (BCM)")
print(f"  Brightness: {LED_BRIGHTNESS}")
print(f"  Strip Type: WS2812B")

try:
    print("\n1. Initializing LED strip...")
    strip = PixelStrip(
        LED_COUNT,
        LED_PIN,
        LED_FREQ_HZ,
        LED_DMA,
        LED_INVERT,
        LED_BRIGHTNESS,
        LED_CHANNEL,
        LED_STRIP_TYPE
    )
    strip.begin()
    print("✓ LED strip initialized successfully")
    
    print("\n2. Testing RED color (all LEDs)...")
    for i in range(LED_COUNT):
        strip.setPixelColor(i, Color(255, 0, 0))
    strip.show()
    print("✓ RED command sent - LEDs should be RED now")
    time.sleep(3)
    
    print("\n3. Testing GREEN color (all LEDs)...")
    for i in range(LED_COUNT):
        strip.setPixelColor(i, Color(0, 255, 0))
    strip.show()
    print("✓ GREEN command sent - LEDs should be GREEN now")
    time.sleep(3)
    
    print("\n4. Testing BLUE color (all LEDs)...")
    for i in range(LED_COUNT):
        strip.setPixelColor(i, Color(0, 0, 255))
    strip.show()
    print("✓ BLUE command sent - LEDs should be BLUE now")
    time.sleep(3)
    
    print("\n5. Testing WHITE color (all LEDs)...")
    for i in range(LED_COUNT):
        strip.setPixelColor(i, Color(255, 255, 255))
    strip.show()
    print("✓ WHITE command sent - LEDs should be WHITE now")
    time.sleep(3)
    
    print("\n6. Turning OFF all LEDs...")
    for i in range(LED_COUNT):
        strip.setPixelColor(i, Color(0, 0, 0))
    strip.show()
    print("✓ OFF command sent - LEDs should be OFF now")
    
    print("\n✓ Test completed successfully!")
    print("\nIf you didn't see any colors, check:")
    print("  1. Power supply is ON and connected")
    print("  2. Data pin (GPIO 18) is connected to LED strip DIN")
    print("  3. Ground is shared between Pi and power supply")
    print("  4. LED strip is WS2812B (not a different type)")
    
except Exception as e:
    print(f"\n✗ ERROR: {e}")
    print("\nCommon issues:")
    print("  - Wrong GPIO pin number (should be BCM 18, physical pin 12)")
    print("  - Insufficient permissions (must run with sudo)")
    print("  - Another process using the DMA channel")
    print("  - LED strip type mismatch (this expects WS2812B)")
    sys.exit(1)
