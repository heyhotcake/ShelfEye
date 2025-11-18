/**
 * Alert LED Service - Thin wrapper around unified LED controller
 * Manages alert LED flashing for system notifications
 */

import type { IStorage } from '../storage';
import { startRedFlash, stopRedFlash } from '../utils/led-control.js';

export class AlertLEDController {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Start flashing the alert LED (red flash via unified controller)
   */
  async startFlash(pattern: 'fast' | 'slow' | 'pulse' = 'fast'): Promise<boolean> {
    try {
      console.log(`[Alert LED] Starting red flash (${pattern} pattern)`);
      await startRedFlash();
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
      console.log('[Alert LED] Stopping red flash');
      await stopRedFlash();
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
      await startRedFlash(pattern);
      
      // Wait for duration, then stop
      await new Promise(resolve => setTimeout(resolve, duration * 1000));
      await stopRedFlash();
      
      console.log(`[Alert LED] Flashed for ${duration}s`);
      return true;
    } catch (error) {
      console.error('[Alert LED] Error flashing:', error);
      return false;
    }
  }

  /**
   * Set LED to constant on or off (delegates to unified controller)
   * Note: Red flash has priority, so this may not work if alerts are active
   */
  async setConstant(state: boolean): Promise<boolean> {
    try {
      if (state) {
        await startRedFlash();
      } else {
        await stopRedFlash();
      }
      return true;
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
