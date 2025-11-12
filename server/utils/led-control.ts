import { spawn, exec } from 'child_process';
import path from 'path';
import { storage } from '../storage';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * LED Control Utility
 * 
 * Uses python/led_control_client.py to communicate with LED Manager Daemon
 * via named pipe IPC. This eliminates DMA channel conflicts by ensuring
 * only one process (the daemon) controls the LED hardware.
 * 
 * Priority management: RED FLASH > WHITE > OFF
 */

/**
 * No longer needed with daemon architecture - daemon manages all LED state
 * Keeping function for backward compatibility but it's a no-op
 */
async function killStuckLEDProcesses(): Promise<void> {
  // No-op: daemon architecture eliminates stuck processes
  console.log('[LED] Using daemon architecture - no stuck processes to kill');
}

/**
 * Turn LED strip to WHITE (for validation/calibration lighting)
 * Communicates with LED daemon via client
 */
export async function setWhiteLight(killStuckFirst = false): Promise<boolean> {
  try {
    const numLedsConfig = await storage.getConfigByKey('led_strip_num_leds');
    const brightnessConfig = await storage.getConfigByKey('led_strip_brightness');
    
    const numLeds = numLedsConfig ? parseInt(numLedsConfig.value as string) : 99;
    const brightness = brightnessConfig ? parseInt(brightnessConfig.value as string) : 100;

    return new Promise<boolean>((resolve) => {
      const ledProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/led_control_client.py'),
        'white',
        '--num-leds', numLeds.toString(),
        '--brightness', brightness.toString()
      ]);

      let result = '';
      let error = '';

      ledProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      ledProcess.stderr.on('data', (data) => {
        error += data.toString();
        console.error('[LED] Client stderr:', data.toString());
      });

      ledProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const response = JSON.parse(result);
            if (response.status === 'blocked') {
              console.log('[LED] White light request blocked:', response.message);
              resolve(false);
            } else if (response.status === 'success') {
              console.log('[LED] White light turned ON');
              resolve(true);
            } else {
              console.error('[LED] Unexpected response:', response);
              resolve(false);
            }
          } catch (e) {
            console.error('[LED] Failed to parse response:', result);
            resolve(false);
          }
        } else {
          console.error('[LED] Client failed:', error);
          resolve(false);
        }
      });

      ledProcess.on('error', (err) => {
        console.error('[LED] Failed to spawn client:', err);
        resolve(false);
      });

      // Timeout after 5 seconds (daemon communication)
      setTimeout(() => {
        ledProcess.kill('SIGTERM');
        resolve(false);
      }, 5000);
    });
  } catch (err) {
    console.error('[LED] setWhiteLight error:', err);
    return false;
  }
}

/**
 * Turn OFF LED strip
 * Communicates with LED daemon via client
 */
export async function turnOffLED(): Promise<void> {
  try {
    const numLedsConfig = await storage.getConfigByKey('led_strip_num_leds');
    const numLeds = numLedsConfig ? parseInt(numLedsConfig.value as string) : 99;

    await new Promise<void>((resolve) => {
      const ledProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/led_control_client.py'),
        'off',
        '--num-leds', numLeds.toString()
      ]);

      let result = '';

      ledProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      ledProcess.stderr.on('data', (data) => {
        console.error('[LED] Client stderr:', data.toString());
      });

      ledProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const response = JSON.parse(result);
            if (response.status === 'success') {
              console.log('[LED] LED light turned OFF');
            } else {
              console.log('[LED] LED off response:', response);
            }
          } catch (e) {
            console.error('[LED] Failed to parse response:', result);
          }
        }
        resolve();
      });

      ledProcess.on('error', (err) => {
        console.error('[LED] LED off error:', err);
        resolve();
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        ledProcess.kill('SIGTERM');
        resolve();
      }, 5000);
    });
  } catch (err) {
    console.error('[LED] Failed to turn off LED light:', err);
  }
}

/**
 * Start RED FLASH alert (highest priority)
 * Communicates with LED daemon via client
 */
export async function startRedFlash(pattern: 'fast' | 'slow' | 'pulse' = 'slow'): Promise<boolean> {
  try {
    const numLedsConfig = await storage.getConfigByKey('led_strip_num_leds');
    const numLeds = numLedsConfig ? parseInt(numLedsConfig.value as string) : 99;

    return new Promise<boolean>((resolve) => {
      const ledProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/led_control_client.py'),
        'start-red-flash',
        '--num-leds', numLeds.toString()
      ]);

      let result = '';

      ledProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      ledProcess.stderr.on('data', (data) => {
        console.error('[LED] Client stderr:', data.toString());
      });

      ledProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const response = JSON.parse(result);
            if (response.status === 'success') {
              console.log('[LED] RED FLASH started');
              resolve(true);
            } else {
              console.error('[LED] Failed to start flash:', response.message);
              resolve(false);
            }
          } catch (e) {
            console.error('[LED] Failed to parse response:', result);
            resolve(false);
          }
        } else {
          console.error('[LED] Client failed with code:', code);
          resolve(false);
        }
      });

      ledProcess.on('error', (err) => {
        console.error('[LED] Failed to start RED FLASH:', err);
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        ledProcess.kill('SIGTERM');
        resolve(false);
      }, 5000);
    });
  } catch (err) {
    console.error('[LED] startRedFlash error:', err);
    return false;
  }
}

/**
 * Stop RED FLASH alert and turn off LEDs
 * Communicates with LED daemon via client
 */
export async function stopRedFlash(): Promise<boolean> {
  try {
    const numLedsConfig = await storage.getConfigByKey('led_strip_num_leds');
    const numLeds = numLedsConfig ? parseInt(numLedsConfig.value as string) : 99;

    return new Promise<boolean>((resolve) => {
      const ledProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/led_control_client.py'),
        'stop-red-flash',
        '--num-leds', numLeds.toString()
      ]);

      let result = '';

      ledProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      ledProcess.stderr.on('data', (data) => {
        console.error('[LED] Client stderr:', data.toString());
      });

      ledProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const response = JSON.parse(result);
            if (response.status === 'success') {
              console.log('[LED] RED FLASH stopped');
              resolve(true);
            } else {
              console.error('[LED] Failed to stop flash:', response.message);
              resolve(false);
            }
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

      // Timeout after 5 seconds
      setTimeout(() => {
        ledProcess.kill('SIGTERM');
        resolve(false);
      }, 5000);
    });
  } catch (err) {
    console.error('[LED] stopRedFlash error:', err);
    return false;
  }
}