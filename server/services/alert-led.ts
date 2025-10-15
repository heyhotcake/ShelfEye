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

      // Wait for startup confirmation or error
      const startupResult = await new Promise<boolean>((resolve) => {
        let resolved = false;

        // Read the first line of stdout to confirm startup
        this.currentFlashProcess.stdout.once('data', (data: Buffer) => {
          if (resolved) return;
          try {
            const result = JSON.parse(data.toString());
            if (result.success) {
              console.log(`[Alert LED] Started flashing (${pattern} pattern)`);
              resolved = true;
              resolve(true);
            } else {
              console.error('[Alert LED] Python script reported failure:', result.error);
              resolved = true;
              resolve(false);
            }
          } catch (err) {
            console.error('[Alert LED] Failed to parse startup response');
            resolved = true;
            resolve(false);
          }
        });

        // Handle process errors
        this.currentFlashProcess.on('error', (error: Error) => {
          if (resolved) return;
          console.error('[Alert LED] Process error:', error);
          this.currentFlashProcess = null;
          resolved = true;
          resolve(false);
        });

        // Handle unexpected early exit
        this.currentFlashProcess.on('close', (code: number) => {
          if (resolved) return;
          if (code !== 0) {
            console.error('[Alert LED] Process exited with code:', code);
            this.currentFlashProcess = null;
            resolved = true;
            resolve(false);
          }
        });

        // Timeout after 2 seconds
        setTimeout(() => {
          if (resolved) return;
          console.error('[Alert LED] Startup timeout');
          if (this.currentFlashProcess) {
            this.currentFlashProcess.kill('SIGTERM');
            this.currentFlashProcess = null;
          }
          resolved = true;
          resolve(false);
        }, 2000);
      });

      // Set up long-running process handlers
      if (startupResult && this.currentFlashProcess) {
        this.currentFlashProcess.on('close', () => {
          console.log('[Alert LED] Flash process ended');
          this.currentFlashProcess = null;
        });
      }

      return startupResult;
    } catch (error) {
      console.error('[Alert LED] Failed to start flash:', error);
      if (this.currentFlashProcess) {
        this.currentFlashProcess.kill('SIGTERM');
        this.currentFlashProcess = null;
      }
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
