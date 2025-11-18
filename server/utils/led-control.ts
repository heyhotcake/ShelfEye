import { exec } from 'child_process';
import path from 'path';
import { storage } from '../storage';
import { promisify } from 'util';
import { spawnTracked } from '../subprocess-manager';

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
 * Retry configuration for LED daemon communication
 * Handles startup race condition where daemon may not be ready yet
 */
const LED_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 5000,
  backoffMultiplier: 2
};

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 * Handles "Daemon not running" errors during startup
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= LED_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      const isDaemonNotRunningError = 
        error instanceof Error && 
        (error.message.includes('Daemon not running') || 
         error.message.includes('pipe not found'));
      
      if (!isDaemonNotRunningError || attempt === LED_RETRY_CONFIG.maxRetries) {
        throw error;
      }
      
      const delayMs = Math.min(
        LED_RETRY_CONFIG.initialDelayMs * Math.pow(LED_RETRY_CONFIG.backoffMultiplier, attempt),
        LED_RETRY_CONFIG.maxDelayMs
      );
      
      console.log(
        `[LED] ${operationName} failed (attempt ${attempt + 1}/${LED_RETRY_CONFIG.maxRetries + 1}), ` +
        `retrying in ${delayMs}ms: ${error.message}`
      );
      
      await sleep(delayMs);
    }
  }
  
  throw lastError || new Error(`${operationName} failed after retries`);
}

/**
 * No longer needed with daemon architecture - daemon manages all LED state
 * Keeping function for backward compatibility but it's a no-op
 */
async function killStuckLEDProcesses(): Promise<void> {
  // No-op: daemon architecture eliminates stuck processes
  console.log('[LED] Using daemon architecture - no stuck processes to kill');
}

/**
 * Internal function to execute LED command
 */
async function executeLEDCommand(
  command: string,
  args: string[],
  operationName: string
): Promise<{ success?: boolean; status?: string; blocked?: boolean; message?: string }> {
  return new Promise((resolve, reject) => {
    const ledProcess = spawnTracked(
      'sudo',
      ['python3', path.join(process.cwd(), 'python/led_control_client.py'), command, ...args],
      'led_control_client.py',
      'led',
      `LED: ${operationName}`
    );

    let result = '';
    let error = '';

    ledProcess.stdout.on('data', (data) => {
      result += data.toString();
    });

    ledProcess.stderr.on('data', (data) => {
      error += data.toString();
    });

    ledProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const response = JSON.parse(result);
          resolve(response);
        } catch (e) {
          console.error(`[LED] Failed to parse ${operationName} response:`, result);
          resolve({ success: false });
        }
      } else {
        const errorMsg = error.trim();
        if (errorMsg.includes('Daemon not running') || errorMsg.includes('pipe not found')) {
          reject(new Error(`Daemon not running (pipe not found)`));
        } else {
          console.error(`[LED] ${operationName} failed:`, errorMsg);
          resolve({ success: false });
        }
      }
    });

    ledProcess.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      ledProcess.kill('SIGTERM');
      resolve({ success: false });
    }, 5000);
  });
}

/**
 * Turn LED strip to WHITE (for validation/calibration lighting)
 * Communicates with LED daemon via client with retry logic
 */
export async function setWhiteLight(killStuckFirst = false): Promise<boolean> {
  try {
    const numLedsConfig = await storage.getConfigByKey('led_strip_num_leds');
    const brightnessConfig = await storage.getConfigByKey('led_strip_brightness');
    
    const numLeds = numLedsConfig ? parseInt(numLedsConfig.value as string) : 99;
    const brightness = brightnessConfig ? parseInt(brightnessConfig.value as string) : 100;

    const response = await retryWithBackoff(
      () => executeLEDCommand(
        'white',
        ['--num-leds', numLeds.toString(), '--brightness', brightness.toString()],
        'setWhiteLight'
      ),
      'setWhiteLight'
    );

    if (response.blocked) {
      console.log('[LED] White light request blocked:', response.message);
      return false;
    } else if (response.success || response.status === 'success') {
      console.log('[LED] White light turned ON');
      return true;
    } else {
      console.error('[LED] Unexpected response:', response);
      return false;
    }
  } catch (err) {
    console.error('[LED] setWhiteLight error:', err);
    return false;
  }
}

/**
 * Turn OFF LED strip
 * Communicates with LED daemon via client with retry logic
 */
export async function turnOffLED(): Promise<void> {
  try {
    const numLedsConfig = await storage.getConfigByKey('led_strip_num_leds');
    const numLeds = numLedsConfig ? parseInt(numLedsConfig.value as string) : 99;

    const response = await retryWithBackoff(
      () => executeLEDCommand('off', ['--num-leds', numLeds.toString()], 'turnOffLED'),
      'turnOffLED'
    );

    if (response.success || response.status === 'success') {
      console.log('[LED] LED light turned OFF');
    } else {
      console.log('[LED] LED off response:', response);
    }
  } catch (err) {
    console.error('[LED] Failed to turn off LED light:', err);
  }
}

/**
 * Start RED FLASH alert (highest priority)
 * Communicates with LED daemon via client with retry logic
 */
export async function startRedFlash(pattern: 'fast' | 'slow' | 'pulse' = 'slow'): Promise<boolean> {
  try {
    const numLedsConfig = await storage.getConfigByKey('led_strip_num_leds');
    const numLeds = numLedsConfig ? parseInt(numLedsConfig.value as string) : 99;

    const response = await retryWithBackoff(
      () => executeLEDCommand('start-red-flash', ['--num-leds', numLeds.toString()], 'startRedFlash'),
      'startRedFlash'
    );

    if (response.success || response.status === 'success') {
      console.log('[LED] RED FLASH started');
      return true;
    } else {
      console.error('[LED] Failed to start flash:', response.message);
      return false;
    }
  } catch (err) {
    console.error('[LED] startRedFlash error:', err);
    return false;
  }
}

/**
 * Stop RED FLASH alert and turn off LEDs
 * Communicates with LED daemon via client with retry logic
 */
export async function stopRedFlash(): Promise<boolean> {
  try {
    const numLedsConfig = await storage.getConfigByKey('led_strip_num_leds');
    const numLeds = numLedsConfig ? parseInt(numLedsConfig.value as string) : 99;

    const response = await retryWithBackoff(
      () => executeLEDCommand('stop-red-flash', ['--num-leds', numLeds.toString()], 'stopRedFlash'),
      'stopRedFlash'
    );

    if (response.success || response.status === 'success') {
      console.log('[LED] RED FLASH stopped');
      return true;
    } else {
      console.error('[LED] Failed to stop flash:', response.message);
      return false;
    }
  } catch (err) {
    console.error('[LED] stopRedFlash error:', err);
    return false;
  }
}