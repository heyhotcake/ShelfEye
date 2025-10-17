/**
 * Startup Calibration Service
 * Automatically runs calibration on server startup using the last successful configuration
 * Flashes red LED if calibration fails or is missing
 */

import { spawn } from 'child_process';
import path from 'path';
import { storage } from '../storage.js';
import { getAlertLEDController } from './alert-led.js';

export class StartupCalibrationService {
  private isRunning = false;

  async initialize(): Promise<void> {
    if (this.isRunning) {
      console.log('[StartupCalibration] Already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('[StartupCalibration] Starting startup calibration check...');

    try {
      // Get last successful calibration configuration
      const lastCameraId = await storage.getConfigByKey('last_calibration_camera_id');
      const lastTimestamp = await storage.getConfigByKey('last_calibration_timestamp');
      const lastPaperSizeFormat = await storage.getConfigByKey('last_calibration_paper_size_format');

      if (!lastCameraId || !lastCameraId.value) {
        console.warn('[StartupCalibration] No previous calibration found - flashing red LED');
        await this.flashRedLED('No calibration configured');
        return;
      }

      const cameraId = lastCameraId.value as string;
      const camera = await storage.getCamera(cameraId);

      if (!camera) {
        console.warn(`[StartupCalibration] Last calibrated camera ${cameraId} not found - flashing red LED`);
        await this.flashRedLED('Calibrated camera not found');
        return;
      }

      const paperSizeFormat = (lastPaperSizeFormat?.value as string) || 'A4-landscape';

      const deviceInfo = camera.devicePath || `Index ${camera.deviceIndex}`;
      console.log(`[StartupCalibration] Running calibration for camera ${camera.name} (${deviceInfo})`);
      console.log(`[StartupCalibration] Paper size format: ${paperSizeFormat}`);
      console.log(`[StartupCalibration] Last calibration: ${lastTimestamp?.value || 'unknown'}`);

      // Run calibration
      const success = await this.runCalibration(camera, paperSizeFormat);

      if (!success) {
        console.error('[StartupCalibration] Calibration failed - flashing red LED');
        await this.flashRedLED('Calibration failed on startup');
      } else {
        console.log('[StartupCalibration] Calibration successful!');
        // Stop any existing alert LED
        const ledController = getAlertLEDController(storage);
        await ledController.stopFlash();
      }

    } catch (error) {
      console.error('[StartupCalibration] Error during startup calibration:', error);
      await this.flashRedLED('Startup calibration error');
    } finally {
      this.isRunning = false;
    }
  }

  private async runCalibration(camera: any, paperSizeFormat: string): Promise<boolean> {
    return new Promise(async (resolve) => {
      // Turn on LED light for consistent illumination during calibration
      const lightStripConfig = await storage.getConfigByKey('light_strip_gpio_pin');
      if (lightStripConfig) {
        const pin = parseInt(lightStripConfig.value as string);
        spawn('sudo', ['python3', path.join(process.cwd(), 'python/gpio_controller.py'), '--pin', pin.toString(), '--action', 'on']);
        console.log('[StartupCalibration] LED light turned ON for calibration');
      }

      // Get paper dimensions from format
      const { getPaperDimensions } = await import('../utils/paper-size.js');
      const paperDims = getPaperDimensions(paperSizeFormat);

      const args = [
        path.join(process.cwd(), 'python/aruco_calibrator.py'),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--paper-size', `${paperDims.widthCm}x${paperDims.heightCm}`
      ];

      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        args.push('--device-path', camera.devicePath);
        console.log(`[StartupCalibration] Using device path: ${camera.devicePath}`);
      } else {
        args.push('--camera', camera.deviceIndex?.toString() || '0');
        console.log(`[StartupCalibration] Using camera index: ${camera.deviceIndex || 0}`);
      }

      const pythonProcess = spawn('python3', args);

      let result = '';
      let error = '';

      pythonProcess.on('error', async (err) => {
        console.error('[StartupCalibration] Python process error:', err);
        // Turn off LED since Python failed to spawn (close event won't fire)
        await this.turnOffLED();
        resolve(false);
      });

      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', async (code) => {
        try {
          if (code === 0) {
            try {
              const calibrationData = JSON.parse(result);
              const homographyMatrix = calibrationData.homography_matrix;
              
              if (!homographyMatrix || calibrationData.markers_detected !== 4) {
                console.error(`[StartupCalibration] Invalid calibration: ${calibrationData.markers_detected}/4 markers detected`);
                resolve(false);
                return;
              }

              // Update camera with new homography
              await storage.updateCamera(camera.id, {
                homographyMatrix: homographyMatrix,
                calibrationTimestamp: new Date(),
              });

              // Delete existing slots for this camera
              const existingSlots = await storage.getSlotsByCamera(camera.id);
              for (const slot of existingSlots) {
                // First delete all detection logs for this slot to avoid foreign key constraint
                await storage.deleteDetectionLogsBySlotId(slot.id);
                await storage.deleteSlot(slot.id);
              }

              // Recreate slots from templates
              const templateRectangles = await storage.getTemplateRectanglesByCamera(camera.id);
              const { transformTemplateToPixels } = await import('../utils/coordinate-transform.js');

              for (const template of templateRectangles) {
                try {
                  const category = await storage.getToolCategory(template.categoryId);
                  if (!category) continue;

                  const pixelCoords = transformTemplateToPixels({
                    xCm: template.xCm,
                    yCm: template.yCm,
                    widthCm: category.widthCm,
                    heightCm: category.heightCm,
                    rotation: template.rotation,
                  }, homographyMatrix);

                  const slot = await storage.createSlot({
                    slotId: template.autoQrId || `${category.name}_${template.id.slice(0, 4)}`,
                    cameraId: camera.id,
                    toolName: category.name,
                    expectedQrId: template.autoQrId || '',
                    priority: 'high',
                    regionCoords: pixelCoords,
                    allowCheckout: true,
                    graceWindow: '08:00-17:00',
                  });

                  await storage.updateTemplateRectangle(template.id, {
                    slotId: slot.id,
                  });

                } catch (slotError) {
                  console.warn(`[StartupCalibration] Failed to create slot for template ${template.id}:`, slotError);
                }
              }

              // Update last calibration config
              await storage.setConfig('last_calibration_camera_id', camera.id, 'Last successfully calibrated camera ID');
              await storage.setConfig('last_calibration_timestamp', new Date().toISOString(), 'Last successful calibration timestamp');
              await storage.setConfig('last_calibration_paper_size_format', paperSizeFormat, 'Last calibration paper size format (e.g., 6-page-3x2)');

              console.log(`[StartupCalibration] Calibration completed: ${calibrationData.markers_detected}/4 markers, error: ${calibrationData.reprojection_error.toFixed(2)}px`);
              resolve(true);

            } catch (parseError) {
              console.error('[StartupCalibration] Failed to parse calibration result:', parseError);
              resolve(false);
            }
          } else {
            console.error('[StartupCalibration] Calibration process failed with code', code, ':', error);
            resolve(false);
          }
        } finally {
          // Turn off LED light after calibration completes
          await this.turnOffLED();
        }
      });
    });
  }

  private async turnOffLED(): Promise<void> {
    try {
      const lightStripConfig = await storage.getConfigByKey('light_strip_gpio_pin');
      if (lightStripConfig) {
        const pin = parseInt(lightStripConfig.value as string);
        spawn('sudo', ['python3', path.join(process.cwd(), 'python/gpio_controller.py'), '--pin', pin.toString(), '--action', 'off']);
        console.log('[StartupCalibration] LED light turned OFF');
      }
    } catch (err) {
      console.error('[StartupCalibration] Failed to turn off LED light:', err);
    }
  }

  private async flashRedLED(reason: string): Promise<void> {
    console.warn(`[StartupCalibration] Flashing red LED - ${reason}`);
    try {
      const ledController = getAlertLEDController(storage);
      await ledController.startFlash('slow'); // Continuous slow flash for startup calibration failure
    } catch (error) {
      console.error('[StartupCalibration] Failed to flash red LED:', error);
    }
  }
}

// Export singleton instance
export const startupCalibrationService = new StartupCalibrationService();
