import { spawn } from 'child_process';
import path from 'path';
import type { IStorage } from '../storage';

export class AlertLEDController {
  private storage: IStorage;
  private currentFlashProcess: any = null;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Start flashing the alert LED
   */
  async startFlash(pattern: 'fast' | 'slow' | 'pulse' = 'fast'): Promise<boolean> {
    try {
      // Get alert LED GPIO pin from config
      const config = await this.storage.getConfigByKey('alert_led_gpio_pin');
      if (!config) {
        console.log('[Alert LED] GPIO pin not configured');
        return false;
      }

      const pin = parseInt(config.value as string);

      // Stop any existing flash
      await this.stopFlash();

      // Start new flash process (keeps running in background)
      this.currentFlashProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/alert_led.py'),
        '--pin', pin.toString(),
        '--action', 'flash',
        '--pattern', pattern
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Read the first line of stdout to confirm startup
      let startupConfirmed = false;
      this.currentFlashProcess.stdout.once('data', (data: Buffer) => {
        try {
          const result = JSON.parse(data.toString());
          if (result.success) {
            startupConfirmed = true;
            console.log(`[Alert LED] Started flashing (${pattern} pattern)`);
          }
        } catch (err) {
          console.error('[Alert LED] Failed to parse startup response');
        }
      });

      // Handle process errors
      this.currentFlashProcess.on('error', (error: Error) => {
        console.error('[Alert LED] Process error:', error);
        this.currentFlashProcess = null;
      });

      this.currentFlashProcess.on('close', () => {
        console.log('[Alert LED] Flash process ended');
        this.currentFlashProcess = null;
      });

      // Wait a moment for startup
      await new Promise(resolve => setTimeout(resolve, 100));

      return true;
    } catch (error) {
      console.error('[Alert LED] Failed to start flash:', error);
      return false;
    }
  }

  /**
   * Stop flashing the alert LED
   */
  async stopFlash(): Promise<boolean> {
    try {
      // Kill the current flash process if it exists
      if (this.currentFlashProcess) {
        this.currentFlashProcess.kill('SIGTERM');
        this.currentFlashProcess = null;
        
        // Also run the stop command to ensure LED is off
        const config = await this.storage.getConfigByKey('alert_led_gpio_pin');
        if (config) {
          const pin = parseInt(config.value as string);
          
          const pythonProcess = spawn('sudo', [
            'python3',
            path.join(process.cwd(), 'python/alert_led.py'),
            '--pin', pin.toString(),
            '--action', 'stop'
          ]);

          await new Promise<boolean>((resolve) => {
            pythonProcess.on('close', (code) => {
              console.log('[Alert LED] Stopped flashing');
              resolve(code === 0);
            });

            pythonProcess.on('error', () => {
              resolve(false);
            });
          });
        }
        
        return true;
      }

      return true;
    } catch (error) {
      console.error('[Alert LED] Error stopping flash:', error);
      return false;
    }
  }

  /**
   * Flash LED for a specific duration then stop
   */
  async flashFor(duration: number, pattern: 'fast' | 'slow' | 'pulse' = 'fast'): Promise<boolean> {
    try {
      const config = await this.storage.getConfigByKey('alert_led_gpio_pin');
      if (!config) {
        return false;
      }

      const pin = parseInt(config.value as string);

      const pythonProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/alert_led.py'),
        '--pin', pin.toString(),
        '--action', 'flash',
        '--pattern', pattern,
        '--duration', duration.toString()
      ]);

      return new Promise((resolve) => {
        pythonProcess.on('close', (code) => {
          console.log(`[Alert LED] Flashed for ${duration}s`);
          resolve(code === 0);
        });

        pythonProcess.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
      console.error('[Alert LED] Error flashing:', error);
      return false;
    }
  }

  /**
   * Set LED to constant on or off
   */
  async setConstant(state: boolean): Promise<boolean> {
    try {
      const config = await this.storage.getConfigByKey('alert_led_gpio_pin');
      if (!config) {
        return false;
      }

      const pin = parseInt(config.value as string);

      const pythonProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/alert_led.py'),
        '--pin', pin.toString(),
        '--action', state ? 'on' : 'off'
      ]);

      return new Promise((resolve) => {
        pythonProcess.on('close', (code) => {
          resolve(code === 0);
        });

        pythonProcess.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
      console.error('[Alert LED] Error setting constant:', error);
      return false;
    }
  }
}

// Singleton instance
let alertLEDController: AlertLEDController | null = null;

export function getAlertLEDController(storage: IStorage): AlertLEDController {
  if (!alertLEDController) {
    alertLEDController = new AlertLEDController(storage);
  }
  return alertLEDController;
}
