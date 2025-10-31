import { spawn, exec } from 'child_process';
import path from 'path';
import { storage } from '../storage';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Unified LED Control Utility
 * 
 * DISABLED: All LED functions disabled - hardware disconnected to prevent GPIO crashes
 */

/**
 * Turn LED strip to WHITE (for validation/calibration lighting)
 * DISABLED: Hardware disconnected
 */
export async function setWhiteLight(killStuckFirst = false): Promise<boolean> {
  console.log('[LED] setWhiteLight DISABLED - hardware disconnected');
  return false;
}

/**
 * Turn OFF LED strip
 * DISABLED: Hardware disconnected
 */
export async function turnOffLED(): Promise<void> {
  console.log('[LED] turnOffLED DISABLED - hardware disconnected');
  return;
}

/**
 * Start RED FLASH alert (highest priority)
 * DISABLED: Hardware disconnected
 */
export async function startRedFlash(pattern: 'fast' | 'slow' | 'pulse' = 'slow'): Promise<boolean> {
  console.log('[LED] startRedFlash DISABLED - hardware disconnected');
  return false;
}

/**
 * Stop RED FLASH alert and turn off LEDs
 * DISABLED: Hardware disconnected
 */
export async function stopRedFlash(): Promise<boolean> {
  console.log('[LED] stopRedFlash DISABLED - hardware disconnected');
  return false;
}
