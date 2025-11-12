#!/usr/bin/env python3
"""
LED Manager Service - Long-running daemon for WS2812B LED strip control

This daemon runs continuously and accepts commands via named pipe (FIFO),
eliminating DMA channel conflicts by ensuring only one process controls the LED hardware.

Architecture:
- Single daemon process with exclusive DMA channel 10 access
- Named pipe IPC for command reception
- JSON-based command/response protocol
- Priority-based LED state management
- Graceful shutdown handling

Usage:
    sudo systemctl start led-manager
    sudo systemctl stop led-manager
    sudo systemctl status led-manager
"""

import os
import sys
import json
import time
import signal
import fcntl
import threading
import traceback
from pathlib import Path
from typing import Optional, Dict, Any

# Try to import WS281x library (only available on Raspberry Pi)
try:
    from rpi_ws281x import PixelStrip, Color
    WS2812_AVAILABLE = True
except ImportError:
    WS2812_AVAILABLE = False
    print("WARNING: rpi_ws281x not available (not on Raspberry Pi)", file=sys.stderr)

# Configuration
CONFIG_FILE = '/home/naniwa/ShelfEye/state/led_daemon_config.json'
COMMAND_PIPE = '/home/naniwa/ShelfEye/state/led_command_pipe'
STATE_FILE = '/home/naniwa/ShelfEye/state/led_state.json'
LOCK_FILE = '/home/naniwa/ShelfEye/state/led_manager.lock'

# LED State priorities (higher = more important)
PRIORITY_OFF = 0
PRIORITY_WHITE = 1
PRIORITY_RED_FLASH = 2

class LEDManagerDaemon:
    """Daemon service managing WS2812B LED strip with command pipe interface"""
    
    def __init__(self, config_path: str = CONFIG_FILE):
        """Initialize daemon with configuration"""
        self.config = self._load_config(config_path)
        self.strip: Optional[PixelStrip] = None
        self.running = False
        self.current_state = {
            'mode': 'off',
            'priority': PRIORITY_OFF,
            'flash_active': False,
            'flash_thread': None,
        }
        self.state_lock = threading.Lock()
        
        # Create state directory
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        
        # Initialize hardware
        if WS2812_AVAILABLE:
            try:
                self._init_hardware()
                print(f"✅ LED hardware initialized: {self.config['num_leds']} LEDs, brightness {self.config['brightness']}")
            except Exception as e:
                print(f"❌ Failed to initialize LED hardware: {e}", file=sys.stderr)
                raise
        else:
            print("⚠️  Running in simulation mode (no hardware)")
    
    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """Load daemon configuration from JSON file"""
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
            
            # Validate required fields
            required = ['num_leds', 'brightness', 'gpio_pin', 'dma_channel']
            for field in required:
                if field not in config:
                    raise ValueError(f"Missing required config field: {field}")
            
            return config
        except FileNotFoundError:
            # Default configuration
            print(f"⚠️  Config file not found: {config_path}, using defaults")
            return {
                'num_leds': 99,
                'brightness': 100,
                'gpio_pin': 18,
                'dma_channel': 10,
                'freq_hz': 800000,
                'invert': False,
            }
        except Exception as e:
            print(f"❌ Error loading config: {e}", file=sys.stderr)
            raise
    
    def _init_hardware(self):
        """Initialize WS2812B LED strip hardware"""
        if not WS2812_AVAILABLE:
            return
        
        self.strip = PixelStrip(
            num=self.config['num_leds'],
            pin=self.config['gpio_pin'],
            freq_hz=self.config.get('freq_hz', 800000),
            dma=self.config['dma_channel'],
            invert=self.config.get('invert', False),
            brightness=self.config['brightness'],
            channel=0,
            strip_type=0x00081000,  # WS2812 (critical for hardware compatibility)
        )
        self.strip.begin()
        
        # Turn off all LEDs initially
        self._clear_strip()
    
    def _clear_strip(self):
        """Turn off all LEDs"""
        if not self.strip:
            return
        
        try:
            for i in range(self.strip.numPixels()):
                self.strip.setPixelColor(i, Color(0, 0, 0))
            self.strip.show()
        except Exception as e:
            print(f"⚠️  Hardware error in _clear_strip: {e}", file=sys.stderr)
    
    def _set_all_leds(self, color: tuple):
        """Set all LEDs to a specific RGB color"""
        if not self.strip:
            return
        
        try:
            r, g, b = color
            for i in range(self.strip.numPixels()):
                self.strip.setPixelColor(i, Color(r, g, b))
            self.strip.show()
        except Exception as e:
            print(f"⚠️  Hardware error in _set_all_leds: {e}", file=sys.stderr)
    
    def _flash_red_thread(self):
        """Background thread for red flashing (runs until stopped)"""
        try:
            while True:
                with self.state_lock:
                    if not self.current_state['flash_active']:
                        break
                
                # Flash on
                self._set_all_leds((255, 0, 0))
                time.sleep(0.5)
                
                with self.state_lock:
                    if not self.current_state['flash_active']:
                        break
                
                # Flash off
                self._clear_strip()
                time.sleep(0.5)
        except Exception as e:
            print(f"❌ Flash thread error: {e}", file=sys.stderr)
        finally:
            print("🔴 Flash thread stopped")
    
    def _update_config(self, num_leds: Optional[int] = None, brightness: Optional[int] = None) -> bool:
        """Update LED strip configuration dynamically"""
        if not self.strip:
            return False
        
        changed = False
        
        if num_leds is not None and num_leds != self.config['num_leds']:
            # Cannot change LED count on live strip - would require re-initialization
            # Just log and skip for now
            print(f"⚠️  Warning: LED count change ({self.config['num_leds']} -> {num_leds}) requires restart", file=sys.stderr)
        
        if brightness is not None and brightness != self.config['brightness']:
            self.strip.setBrightness(brightness)
            self.strip.show()
            self.config['brightness'] = brightness
            changed = True
            print(f"✓ Brightness updated to {brightness}")
        
        return changed
    
    def _handle_command(self, command: Dict[str, Any]) -> Dict[str, Any]:
        """Process a command and return response"""
        action = command.get('action')
        
        try:
            # Update config if brightness or num_leds specified
            brightness = command.get('brightness')
            num_leds = command.get('num_leds')
            if brightness is not None or num_leds is not None:
                self._update_config(num_leds, brightness)
            
            if action == 'white':
                return self._cmd_white()
            elif action == 'off':
                return self._cmd_off()
            elif action == 'start_flash':
                return self._cmd_start_flash()
            elif action == 'stop_flash':
                return self._cmd_stop_flash()
            elif action == 'status':
                return self._cmd_status()
            elif action == 'shutdown':
                self.running = False
                return {'status': 'success', 'message': 'Daemon shutting down'}
            else:
                return {'status': 'error', 'message': f'Unknown action: {action}'}
        except Exception as e:
            return {'status': 'error', 'message': str(e), 'traceback': traceback.format_exc()}
    
    def _cmd_white(self) -> Dict[str, Any]:
        """Set LEDs to white light (if priority allows)"""
        # Check priority and get thread reference while holding lock
        with self.state_lock:
            if self.current_state['priority'] > PRIORITY_WHITE:
                return {
                    'status': 'blocked',
                    'message': f"Higher priority mode active: {self.current_state['mode']}"
                }
            
            flash_thread = self.current_state['flash_thread'] if self.current_state['flash_active'] else None
            self.current_state['flash_active'] = False
        
        # Join thread without holding lock (prevents deadlock)
        if flash_thread:
            flash_thread.join(timeout=2)
        
        # Update state
        with self.state_lock:
            self._set_all_leds((255, 255, 255))
            self.current_state['mode'] = 'white'
            self.current_state['priority'] = PRIORITY_WHITE
            self.current_state['flash_thread'] = None
            self._save_state()
            
            return {'status': 'success', 'message': 'LEDs set to white'}
    
    def _cmd_off(self) -> Dict[str, Any]:
        """Turn off LEDs (always succeeds, clears all states)"""
        # Get thread reference while holding lock
        with self.state_lock:
            flash_thread = self.current_state['flash_thread'] if self.current_state['flash_active'] else None
            self.current_state['flash_active'] = False
        
        # Join thread without holding lock (prevents deadlock)
        if flash_thread:
            flash_thread.join(timeout=2)
        
        # Update state
        with self.state_lock:
            self._clear_strip()
            self.current_state['mode'] = 'off'
            self.current_state['priority'] = PRIORITY_OFF
            self.current_state['flash_thread'] = None
            self._save_state()
            
            return {'status': 'success', 'message': 'LEDs turned off'}
    
    def _cmd_start_flash(self) -> Dict[str, Any]:
        """Start red flashing (highest priority)"""
        # Get existing thread reference while holding lock
        with self.state_lock:
            old_thread = self.current_state['flash_thread'] if self.current_state['flash_active'] else None
            self.current_state['flash_active'] = False
        
        # Stop old thread without holding lock (prevents deadlock)
        if old_thread:
            old_thread.join(timeout=2)
        
        # Start new flash thread
        with self.state_lock:
            self.current_state['flash_active'] = True
            self.current_state['mode'] = 'red_flash'
            self.current_state['priority'] = PRIORITY_RED_FLASH
            self.current_state['flash_thread'] = threading.Thread(
                target=self._flash_red_thread,
                daemon=True
            )
            self.current_state['flash_thread'].start()
            self._save_state()
            
            return {'status': 'success', 'message': 'Red flash started'}
    
    def _cmd_stop_flash(self) -> Dict[str, Any]:
        """Stop red flashing"""
        # Get thread reference while holding lock
        with self.state_lock:
            if not self.current_state['flash_active']:
                return {'status': 'success', 'message': 'No flash active'}
            
            flash_thread = self.current_state['flash_thread']
            self.current_state['flash_active'] = False
        
        # Join thread without holding lock (prevents deadlock)
        if flash_thread:
            flash_thread.join(timeout=2)
        
        # Update state
        with self.state_lock:
            self._clear_strip()
            self.current_state['mode'] = 'off'
            self.current_state['priority'] = PRIORITY_OFF
            self.current_state['flash_thread'] = None
            self._save_state()
            
            return {'status': 'success', 'message': 'Red flash stopped'}
    
    def _cmd_status(self) -> Dict[str, Any]:
        """Get current LED status"""
        with self.state_lock:
            return {
                'status': 'success',
                'mode': self.current_state['mode'],
                'priority': self.current_state['priority'],
                'flash_active': self.current_state['flash_active'],
            }
    
    def _save_state(self):
        """Save current state to file"""
        try:
            with open(STATE_FILE, 'w') as f:
                json.dump({
                    'mode': self.current_state['mode'],
                    'priority': self.current_state['priority'],
                    'flash_active': self.current_state['flash_active'],
                    'timestamp': time.time(),
                }, f)
        except Exception as e:
            print(f"⚠️  Failed to save state: {e}", file=sys.stderr)
    
    def _setup_command_pipe(self):
        """Create named pipe for command reception"""
        try:
            # Remove old pipe if it exists
            if os.path.exists(COMMAND_PIPE):
                os.remove(COMMAND_PIPE)
            
            # Create new pipe
            os.makedirs(os.path.dirname(COMMAND_PIPE), exist_ok=True)
            os.mkfifo(COMMAND_PIPE)
            os.chmod(COMMAND_PIPE, 0o666)  # Allow all users to write
            print(f"✅ Command pipe created: {COMMAND_PIPE}")
        except Exception as e:
            print(f"❌ Failed to create command pipe: {e}", file=sys.stderr)
            raise
    
    def _handle_signal(self, signum, frame):
        """Handle shutdown signals gracefully"""
        print(f"\n🛑 Received signal {signum}, shutting down...")
        self.running = False
    
    def run(self):
        """Main daemon loop - listen for commands on named pipe"""
        # Set up signal handlers
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)
        
        # Create command pipe
        self._setup_command_pipe()
        
        # Main loop
        self.running = True
        print("🚀 LED Manager Daemon started, listening for commands...")
        
        try:
            while self.running:
                try:
                    # Open pipe for reading (blocks until writer opens)
                    with open(COMMAND_PIPE, 'r') as pipe:
                        # Read command in blocking mode (completes when writer closes)
                        command_str = pipe.read()
                        if not command_str:
                            continue
                        
                        # Parse and handle command
                        try:
                            command = json.loads(command_str)
                            print(f"📨 Received command: {command.get('action')}")
                            
                            response = self._handle_command(command)
                            
                            # Write response if response pipe specified
                            response_pipe = command.get('response_pipe')
                            if response_pipe:
                                try:
                                    with open(response_pipe, 'w') as resp:
                                        json.dump(response, resp)
                                except Exception as e:
                                    print(f"⚠️  Failed to send response: {e}", file=sys.stderr)
                            
                        except json.JSONDecodeError as e:
                            print(f"⚠️  Invalid JSON command: {e}", file=sys.stderr)
                
                except OSError as e:
                    print(f"⚠️  Pipe error: {e}", file=sys.stderr)
                    time.sleep(0.1)
        
        except Exception as e:
            print(f"❌ Fatal error: {e}", file=sys.stderr)
            traceback.print_exc()
        
        finally:
            self._shutdown()
    
    def _shutdown(self):
        """Clean shutdown - stop threads, clear LEDs, remove pipe"""
        print("🧹 Cleaning up...")
        
        # Get flash thread reference while holding lock
        with self.state_lock:
            flash_thread = self.current_state['flash_thread'] if self.current_state['flash_active'] else None
            self.current_state['flash_active'] = False
        
        # Join thread without holding lock (prevents deadlock)
        if flash_thread:
            flash_thread.join(timeout=2)
        
        # Clear LEDs and finalize state
        with self.state_lock:
            self._clear_strip()
            self.current_state['flash_thread'] = None
        
        # Remove command pipe
        try:
            if os.path.exists(COMMAND_PIPE):
                os.remove(COMMAND_PIPE)
        except Exception as e:
            print(f"⚠️  Failed to remove command pipe: {e}", file=sys.stderr)
        
        print("✅ LED Manager Daemon stopped")


def main():
    """Entry point for daemon service"""
    # Acquire exclusive lock to prevent multiple instances
    lock_file = None
    try:
        os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
        lock_file = open(LOCK_FILE, 'w')
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except IOError:
        print("❌ Another instance of LED Manager Daemon is already running", file=sys.stderr)
        sys.exit(1)
    
    try:
        daemon = LEDManagerDaemon()
        daemon.run()
    except KeyboardInterrupt:
        print("\n🛑 Interrupted by user")
    except Exception as e:
        print(f"❌ Fatal error: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
    finally:
        if lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            lock_file.close()


if __name__ == '__main__':
    main()
