import { spawn, exec } from 'child_process';
import path from 'path';
import { storage } from '../storage';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Unified LED Control Utility
 * 
 * Uses python/unified_led_controller.py to manage WS2812B LED strip
 * with proper priority management (RED FLASH > WHITE > OFF)
 * and DMA channel resource cleanup
 */

/**
 * Kill any stuck LED controller processes to ensure clean state
 * Used before calibration to prevent stuck processes from blocking white light
 */
async function killStuckLEDProcesses(): Promise<void> {
  try {
    // Kill any stuck unified_led_controller.py processes
    await execAsync('sudo pkill -9 -f unified_led_controller.py || true');
    console.log('[LED] Killed any stuck LED processes');
    // Small delay to ensure processes are fully terminated
    await new Promise(resolve => setTimeout(resolve, 200));
  } catch (err) {
    console.error('[LED] Error killing stuck processes:', err);
  }
}

/**
 * Turn LED strip to WHITE (for validation/calibration lighting)
 * Will be denied if RED FLASH alert is active (priority system)
 * Kills stuck processes first to ensure clean state
 */
export async function setWhiteLight(killStuckFirst = false): Promise<boolean> {
  // Kill stuck LED processes if requested (for calibration)
  if (killStuckFirst) {
    await killStuckLEDProcesses();
  }
  try {
    const lightConfig = await storage.getConfigByKey('light_strip_gpio_pin');
    if (!lightConfig) {
      console.log('[LED] Light strip GPIO pin not configured');
      return false;
    }

    const pin = parseInt(lightConfig.value as string);

    return new Promise<boolean>((resolve) => {
      const ledProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/unified_led_controller.py'),
        '--pin', pin.toString(),
        '--action', 'white',
        '--brightness', '100'  // Reduced brightness for new 4K camera
      ]);

      let result = '';
      let error = '';

      ledProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      ledProcess.stderr.on('data', (data) => {
        error += data.toString();
        console.error('[LED] Unified controller stderr:', data.toString());
      });

      ledProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const response = JSON.parse(result);
            if (response.priority_denied) {
              console.log('[LED] White light request denied - RED FLASH has priority');
            } else {
              console.log('[LED] White light turned ON');
            }
            resolve(response.success);
          } catch (e) {
            console.error('[LED] Failed to parse response:', result);
            resolve(false);
          }
        } else {
          console.error('[LED] Unified controller failed:', error);
          resolve(false);
        }
      });

      ledProcess.on('error', (err) => {
        console.error('[LED] Failed to spawn unified controller:', err);
        resolve(false);
      });

      // Timeout after 2 seconds
      setTimeout(() => {
        ledProcess.kill('SIGTERM');
        resolve(false);
      }, 2000);
    });
  } catch (err) {
    console.error('[LED] setWhiteLight error:', err);
    return false;
  }
}

/**
 * Turn OFF LED strip
 * Will be denied if RED FLASH alert is active (priority system)
 */
export async function turnOffLED(): Promise<void> {
  try {
    const lightConfig = await storage.getConfigByKey('light_strip_gpio_pin');
    if (!lightConfig) {
      return;
    }

    const pin = parseInt(lightConfig.value as string);

    // Wait for LED to turn off and release hardware resources
    await new Promise<void>((resolve) => {
      const ledProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/unified_led_controller.py'),
        '--pin', pin.toString(),
        '--action', 'off'
      ]);

      let result = '';

      ledProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      ledProcess.stderr.on('data', (data) => {
        console.error('[LED] Unified controller stderr:', data.toString());
      });

      ledProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const response = JSON.parse(result);
            if (response.priority_denied) {
              console.log('[LED] OFF request denied - RED FLASH has priority');
            } else {
              console.log('[LED] LED light turned OFF');
            }
          } catch (e) {
            console.error('[LED] Failed to parse response:', result);
          }
        }
        resolve();
      });

      ledProcess.on('error', (err) => {
        console.error('[LED] LED off error:', err);
        resolve(); // Continue even if error
      });

      // Timeout after 2 seconds
      setTimeout(() => {
        ledProcess.kill('SIGTERM');
        resolve();
      }, 2000);
    });

    // Small delay to ensure DMA channel is released
    await new Promise(resolve => setTimeout(resolve, 200));
  } catch (err) {
    console.error('[LED] Failed to turn off LED light:', err);
  }
}

/**
 * Start RED FLASH alert (highest priority)
 * Cannot be overridden by white light or off commands
 */
export async function startRedFlash(pattern: 'fast' | 'slow' | 'pulse' = 'slow'): Promise<boolean> {
  try {
    const lightConfig = await storage.getConfigByKey('light_strip_gpio_pin');
    if (!lightConfig) {
      console.log('[LED] Light strip GPIO pin not configured');
      return false;
    }

    const pin = parseInt(lightConfig.value as string);

    return new Promise<boolean>((resolve) => {
      const ledProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/unified_led_controller.py'),
        '--pin', pin.toString(),
        '--action', 'red_flash_start',
        '--pattern', pattern
      ], {
        detached: true, // Keep running in background
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let resolved = false;

      // Read the first line to confirm startup
      ledProcess.stdout.once('data', (data: Buffer) => {
        if (resolved) return;
        try {
          const result = JSON.parse(data.toString());
          if (result.success) {
            console.log(`[LED] RED FLASH started (${pattern} pattern)`);
            ledProcess.unref(); // Let it run independently
            resolved = true;
            resolve(true);
          } else {
            console.error('[LED] Python script reported failure:', result.error);
            resolved = true;
            resolve(false);
          }
        } catch (err) {
          console.error('[LED] Failed to parse startup response');
          resolved = true;
          resolve(false);
        }
      });

      ledProcess.on('error', (err) => {
        if (resolved) return;
        console.error('[LED] Failed to start RED FLASH:', err);
        resolved = true;
        resolve(false);
      });

      ledProcess.on('close', (code) => {
        if (resolved) return;
        console.error('[LED] RED FLASH process exited early with code:', code);
        resolved = true;
        resolve(false);
      });

      // Timeout after 2 seconds
      setTimeout(() => {
        if (resolved) return;
        console.error('[LED] RED FLASH startup timeout');
        ledProcess.kill('SIGTERM');
        resolved = true;
        resolve(false);
      }, 2000);
    });
  } catch (err) {
    console.error('[LED] startRedFlash error:', err);
    return false;
  }
}

/**
 * Stop RED FLASH alert and turn off LEDs
 */
export async function stopRedFlash(): Promise<boolean> {
  try {
    const lightConfig = await storage.getConfigByKey('light_strip_gpio_pin');
    if (!lightConfig) {
      return false;
    }

    const pin = parseInt(lightConfig.value as string);

    return new Promise<boolean>((resolve) => {
      const ledProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/unified_led_controller.py'),
        '--pin', pin.toString(),
        '--action', 'red_flash_stop'
      ]);

      let result = '';

      ledProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      ledProcess.stderr.on('data', (data) => {
        console.error('[LED] Unified controller stderr:', data.toString());
      });

      ledProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const response = JSON.parse(result);
            console.log('[LED] RED FLASH stopped');
            resolve(response.success);
          } catch (e) {
            console.error('[LED] Failed to parse response:', result);
            resolve(false);
          }
        } else {
          resolve(false);
        }
      });

      ledProcess.on('error', (err) => {
        console.error('[LED] stopRedFlash error:', err);
        resolve(false);
      });

      // Timeout after 2 seconds
      setTimeout(() => {
        ledProcess.kill('SIGTERM');
        resolve(false);
      }, 2000);
    });
  } catch (err) {
    console.error('[LED] stopRedFlash error:', err);
    return false;
  }
}
