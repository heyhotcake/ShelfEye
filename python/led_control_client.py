#!/usr/bin/env python3
"""
LED Control Client - Command-line interface for LED Manager Daemon

This client matches the exact CLI contract of unified_led_controller.py
but communicates with the daemon via named pipe instead of directly
controlling hardware, eliminating DMA conflicts.

Usage:
    python3 led_control_client.py white --num-leds 99 --brightness 100
    python3 led_control_client.py off --num-leds 99
    python3 led_control_client.py start-red-flash --num-leds 99
    python3 led_control_client.py stop-red-flash --num-leds 99
    python3 led_control_client.py status
"""

import os
import sys
import json
import time
import argparse
import tempfile
from typing import Dict, Any, Optional

# Configuration
COMMAND_PIPE = '/home/naniwa/ShelfEye/state/led_command_pipe'
TIMEOUT = 5.0  # seconds

def send_command(action: str, brightness: Optional[int] = None, num_leds: Optional[int] = None, timeout: float = TIMEOUT) -> Dict[str, Any]:
    """
    Send command to LED daemon and wait for response
    
    Args:
        action: Command action (white, off, start_flash, stop_flash, status)
        brightness: Optional brightness value (0-255)
        num_leds: Optional number of LEDs
        timeout: Maximum time to wait for response (seconds)
    
    Returns:
        Response dictionary from daemon
    """
    # Create temporary response pipe
    response_pipe = None
    try:
        # Create unique response pipe
        fd, response_pipe = tempfile.mkstemp(suffix='.pipe', prefix='led_response_')
        os.close(fd)
        os.remove(response_pipe)
        os.mkfifo(response_pipe)
        os.chmod(response_pipe, 0o666)
        
        # Build command
        command = {
            'action': action,
            'response_pipe': response_pipe,
            'timestamp': time.time(),
        }
        
        # Add optional parameters
        if brightness is not None:
            command['brightness'] = brightness
        if num_leds is not None:
            command['num_leds'] = num_leds
        
        # Send command to daemon
        try:
            with open(COMMAND_PIPE, 'w') as pipe:
                json.dump(command, pipe)
        except FileNotFoundError:
            return {
                'status': 'error',
                'message': f'Daemon not running (pipe not found: {COMMAND_PIPE})',
            }
        except Exception as e:
            return {
                'status': 'error',
                'message': f'Failed to send command: {e}',
            }
        
        # Wait for response with timeout
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                with open(response_pipe, 'r') as resp:
                    response_str = resp.read()
                    if response_str:
                        return json.loads(response_str)
            except FileNotFoundError:
                time.sleep(0.1)
            except json.JSONDecodeError as e:
                return {
                    'status': 'error',
                    'message': f'Invalid response from daemon: {e}',
                }
        
        return {
            'status': 'error',
            'message': f'Timeout waiting for daemon response ({timeout}s)',
        }
    
    finally:
        # Clean up response pipe
        if response_pipe and os.path.exists(response_pipe):
            try:
                os.remove(response_pipe)
            except Exception:
                pass


def cmd_white(args) -> int:
    """Set LEDs to white light"""
    response = send_command('white', brightness=args.brightness, num_leds=args.num_leds)
    
    if response['status'] == 'success':
        print(json.dumps({'status': 'success', 'message': 'White light turned on'}))
        return 0
    elif response['status'] == 'blocked':
        print(json.dumps({'status': 'blocked', 'message': response['message']}))
        return 1
    else:
        print(json.dumps({'status': 'error', 'message': response.get('message', 'Unknown error')}), file=sys.stderr)
        return 1


def cmd_off(args) -> int:
    """Turn off LEDs"""
    response = send_command('off', num_leds=args.num_leds)
    
    if response['status'] == 'success':
        print(json.dumps({'status': 'success', 'message': 'LEDs turned off'}))
        return 0
    else:
        print(json.dumps({'status': 'error', 'message': response.get('message', 'Unknown error')}), file=sys.stderr)
        return 1


def cmd_start_flash(args) -> int:
    """Start red flashing"""
    response = send_command('start_flash', num_leds=args.num_leds)
    
    if response['status'] == 'success':
        print(json.dumps({'status': 'success', 'message': 'Red flash started'}))
        return 0
    else:
        print(json.dumps({'status': 'error', 'message': response.get('message', 'Unknown error')}), file=sys.stderr)
        return 1


def cmd_stop_flash(args) -> int:
    """Stop red flashing"""
    response = send_command('stop_flash', num_leds=args.num_leds)
    
    if response['status'] == 'success':
        print(json.dumps({'status': 'success', 'message': 'Red flash stopped'}))
        return 0
    else:
        print(json.dumps({'status': 'error', 'message': response.get('message', 'Unknown error')}), file=sys.stderr)
        return 1


def cmd_status(args) -> int:
    """Get current LED status"""
    response = send_command('status')
    
    if response['status'] == 'success':
        print(json.dumps({
            'status': 'success',
            'mode': response.get('mode', 'unknown'),
            'priority': response.get('priority', 0),
            'flash_active': response.get('flash_active', False),
        }))
        return 0
    else:
        print(json.dumps({'status': 'error', 'message': response.get('message', 'Unknown error')}), file=sys.stderr)
        return 1


def main():
    """Entry point for LED control client"""
    parser = argparse.ArgumentParser(
        description='LED Control Client - Send commands to LED Manager Daemon'
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Command to execute')
    
    # White light command
    white_parser = subparsers.add_parser('white', help='Set LEDs to white light')
    white_parser.add_argument('--num-leds', type=int, help='Number of LEDs (ignored, for compatibility)')
    white_parser.add_argument('--brightness', type=int, help='Brightness (ignored, for compatibility)')
    white_parser.set_defaults(func=cmd_white)
    
    # Off command
    off_parser = subparsers.add_parser('off', help='Turn off LEDs')
    off_parser.add_argument('--num-leds', type=int, help='Number of LEDs (ignored, for compatibility)')
    off_parser.set_defaults(func=cmd_off)
    
    # Start red flash command
    start_flash_parser = subparsers.add_parser('start-red-flash', help='Start red flashing')
    start_flash_parser.add_argument('--num-leds', type=int, help='Number of LEDs (ignored, for compatibility)')
    start_flash_parser.set_defaults(func=cmd_start_flash)
    
    # Stop red flash command
    stop_flash_parser = subparsers.add_parser('stop-red-flash', help='Stop red flashing')
    stop_flash_parser.add_argument('--num-leds', type=int, help='Number of LEDs (ignored, for compatibility)')
    stop_flash_parser.set_defaults(func=cmd_stop_flash)
    
    # Status command
    status_parser = subparsers.add_parser('status', help='Get current LED status')
    status_parser.set_defaults(func=cmd_status)
    
    # Parse arguments
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return 1
    
    # Execute command
    try:
        return args.func(args)
    except Exception as e:
        print(json.dumps({'status': 'error', 'message': str(e)}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
