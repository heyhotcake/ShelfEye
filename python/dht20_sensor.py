#!/usr/bin/env python3
"""
DHT20 Temperature/Humidity Sensor Reader
Uses Adafruit CircuitPython AHTx0 library for reliable readings
"""

import sys
import time
import json
import argparse

ADAFRUIT_AVAILABLE = False
SMBUS_AVAILABLE = False

try:
    import board
    import adafruit_ahtx0
    ADAFRUIT_AVAILABLE = True
except ImportError:
    pass

try:
    import smbus2
    SMBUS_AVAILABLE = True
except ImportError:
    pass

DHT20_I2C_ADDRESS = 0x38
I2C_BUS = 1


class DHT20Sensor:
    def __init__(self, bus_number=I2C_BUS, address=DHT20_I2C_ADDRESS):
        self.address = address
        self.sensor = None
        self.use_adafruit = False
        self.bus = None
        
        if ADAFRUIT_AVAILABLE:
            try:
                i2c = board.I2C()
                self.sensor = adafruit_ahtx0.AHTx0(i2c)
                self.use_adafruit = True
            except Exception as e:
                print(f"Adafruit library init failed: {e}", file=sys.stderr)
        
        if not self.use_adafruit and SMBUS_AVAILABLE:
            try:
                self.bus = smbus2.SMBus(bus_number)
                time.sleep(0.1)
                self._initialize()
            except Exception as e:
                print(f"Error initializing I2C: {e}", file=sys.stderr)
                self.bus = None
    
    def _initialize(self):
        """Initialize the DHT20 sensor (fallback method)"""
        if not self.bus:
            return False
        
        try:
            time.sleep(0.04)
            status = self.bus.read_byte(self.address)
            
            if (status & 0x18) != 0x18:
                self.bus.write_i2c_block_data(self.address, 0xBE, [0x08, 0x00])
                time.sleep(0.01)
            
            return True
        except Exception as e:
            print(f"Initialization error: {e}", file=sys.stderr)
            return False
    
    def _calculate_crc(self, data):
        """Calculate CRC8 for data validation"""
        crc = 0xFF
        for byte in data:
            crc ^= byte
            for _ in range(8):
                if crc & 0x80:
                    crc = (crc << 1) ^ 0x31
                else:
                    crc = crc << 1
                crc &= 0xFF
        return crc
    
    def _trigger_measurement(self):
        """Trigger a measurement"""
        if not self.bus:
            return False
        
        try:
            self.bus.write_i2c_block_data(self.address, 0xAC, [0x33, 0x00])
            return True
        except Exception as e:
            print(f"Trigger error: {e}", file=sys.stderr)
            return False
    
    def _wait_for_measurement(self, timeout=0.5):
        """Wait for measurement to complete"""
        if not self.bus:
            return False
        
        start = time.time()
        while time.time() - start < timeout:
            try:
                status = self.bus.read_byte(self.address)
                if not (status & 0x80):
                    return True
                time.sleep(0.01)
            except Exception:
                time.sleep(0.01)
        
        return False
    
    def _read_raw_data(self):
        """Read raw sensor data"""
        if not self.bus:
            return None
        
        try:
            msg = smbus2.i2c_msg.read(self.address, 7)
            self.bus.i2c_rdwr(msg)
            return list(msg)
        except Exception as e:
            print(f"Read error: {e}", file=sys.stderr)
            return None
    
    def read(self):
        """Read temperature and humidity from DHT20"""
        
        # Use Adafruit library if available
        if self.use_adafruit and self.sensor:
            try:
                temperature_c = self.sensor.temperature
                humidity = self.sensor.relative_humidity
                temperature_f = temperature_c * 9.0 / 5.0 + 32.0
                
                return {
                    'ok': True,
                    'temperature_c': round(temperature_c, 1),
                    'temperature_f': round(temperature_f, 1),
                    'humidity': round(humidity, 1),
                    'timestamp': time.time(),
                    'library': 'adafruit'
                }
            except Exception as e:
                return {'ok': False, 'error': str(e)}
        
        # Fallback to manual implementation
        if not self.bus:
            return {
                'ok': False,
                'error': 'No sensor library available. Install: pip3 install adafruit-circuitpython-ahtx0'
            }
        
        try:
            if not self._trigger_measurement():
                return {'ok': False, 'error': 'Failed to trigger measurement'}
            
            time.sleep(0.08)
            
            if not self._wait_for_measurement():
                return {'ok': False, 'error': 'Measurement timeout'}
            
            data = self._read_raw_data()
            if not data or len(data) < 7:
                return {'ok': False, 'error': 'Invalid data received'}
            
            expected_crc = self._calculate_crc(data[:6])
            if expected_crc != data[6]:
                return {'ok': False, 'error': f'CRC mismatch: expected {expected_crc}, got {data[6]}'}
            
            if data[0] & 0x80:
                return {'ok': False, 'error': 'Sensor still busy after wait'}
            
            temperature_raw = ((data[3] & 0x0F) << 16) + (data[4] << 8) + data[5]
            humidity_raw = ((data[3] & 0xF0) >> 4) + (data[1] << 12) + (data[2] << 4)
            
            temperature_c = float(temperature_raw) / 5242.88 - 50.0
            humidity = float(humidity_raw) / 0x100000 * 100.0
            temperature_f = temperature_c * 9.0 / 5.0 + 32.0
            
            return {
                'ok': True,
                'temperature_c': round(temperature_c, 1),
                'temperature_f': round(temperature_f, 1),
                'humidity': round(humidity, 1),
                'timestamp': time.time(),
                'library': 'smbus2'
            }
        
        except Exception as e:
            return {'ok': False, 'error': str(e)}
    
    def close(self):
        """Close I2C bus"""
        if self.bus:
            try:
                self.bus.close()
            except:
                pass


def main():
    parser = argparse.ArgumentParser(description='DHT20 Temperature/Humidity Sensor Reader')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    parser.add_argument('--continuous', action='store_true', help='Continuous reading mode')
    parser.add_argument('--interval', type=float, default=2.0, help='Reading interval in seconds')
    args = parser.parse_args()
    
    if not ADAFRUIT_AVAILABLE and not SMBUS_AVAILABLE:
        result = {'ok': False, 'error': 'No I2C library available. Install: pip3 install adafruit-circuitpython-ahtx0'}
        if args.json:
            print(json.dumps(result))
        else:
            print(f"Error: {result['error']}")
        sys.exit(1)
    
    sensor = DHT20Sensor()
    
    try:
        if args.continuous:
            while True:
                reading = sensor.read()
                if args.json:
                    print(json.dumps(reading))
                else:
                    if reading['ok']:
                        lib = reading.get('library', 'unknown')
                        print(f"Temperature: {reading['temperature_c']}°C ({reading['temperature_f']}°F) | Humidity: {reading['humidity']}% [{lib}]")
                    else:
                        print(f"Error: {reading['error']}")
                time.sleep(args.interval)
        else:
            reading = sensor.read()
            if args.json:
                print(json.dumps(reading))
            else:
                if reading['ok']:
                    lib = reading.get('library', 'unknown')
                    print(f"Temperature: {reading['temperature_c']}°C ({reading['temperature_f']}°F) [{lib}]")
                    print(f"Humidity: {reading['humidity']}%")
                else:
                    print(f"Error: {reading['error']}")
                    sys.exit(1)
    
    except KeyboardInterrupt:
        print("\nStopped")
    finally:
        sensor.close()


if __name__ == '__main__':
    main()
