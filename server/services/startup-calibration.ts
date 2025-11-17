/**
 * Startup Calibration Service
 * Automatically runs calibration on server startup using the last successful configuration
 * Flashes red LED if calibration fails or is missing
 */

import { spawn } from 'child_process';
import path from 'path';
import { storage } from '../storage.js';
import { setWhiteLight, turnOffLED, startRedFlash, stopRedFlash } from '../utils/led-control.js';
import { cameraSessionManager } from '../camera-session-manager.js';
import { subprocessManager } from '../subprocess-manager.js';

export class StartupCalibrationService {
  private isRunning = false;

  async initialize(): Promise<void> {
    if (this.isRunning) {
      console.log('[StartupCalibration] Already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('[StartupCalibration] Starting startup calibration check for ALL cameras...');

    try {
      // Get all cameras
      const allCameras = await storage.getCameras();
      
      // Filter for cameras that have been calibrated (have homography and paperSize)
      const calibratedCameras = allCameras.filter(cam => 
        cam.homographyMatrix && cam.homographyMatrix.length > 0 && cam.paperSize
      );

      if (calibratedCameras.length === 0) {
        console.warn('[StartupCalibration] No calibrated cameras found - flashing red LED');
        await this.flashRedLED('No cameras calibrated');
        return;
      }

      console.log(`[StartupCalibration] Found ${calibratedCameras.length} calibrated camera(s) to validate`);

      // Check if any camera is currently calibrating (respect global lock)
      const globalLockStatus = cameraSessionManager.isAnyCalibrationInProgress();
      if (globalLockStatus.inProgress) {
        console.log(`[StartupCalibration] Camera ${globalLockStatus.cameraId} is already calibrating - skipping startup calibration`);
        return;
      }

      // Validate each camera sequentially
      const results: { camera: any; success: boolean }[] = [];
      
      for (const camera of calibratedCameras) {
        // Try to acquire global calibration lock for this camera
        if (!cameraSessionManager.acquireGlobalCalibrationLock(camera.id)) {
          console.log(`[StartupCalibration] Could not acquire lock for camera ${camera.name} - skipping`);
          results.push({ camera, success: false });
          continue;
        }

        try {
          const paperSizeFormat = camera.paperSize || 'A4-landscape';
          const deviceInfo = camera.devicePath || `Index ${camera.deviceIndex}`;
          
          console.log(`[StartupCalibration] Validating camera: ${camera.name} (${deviceInfo})`);
          console.log(`[StartupCalibration] Paper size: ${paperSizeFormat}`);

          // Run calibration (validation mode - checks corner markers only)
          const success = await this.runCalibration(camera, paperSizeFormat);
          results.push({ camera, success });

          if (success) {
            console.log(`[StartupCalibration] ✓ Camera ${camera.name} validated successfully`);
          } else {
            console.error(`[StartupCalibration] ✗ Camera ${camera.name} validation failed`);
          }
        } finally {
          // Release lock for this camera
          cameraSessionManager.releaseGlobalCalibrationLock(camera.id);
        }
      }

      // Determine overall result
      const failedCameras = results.filter(r => !r.success);
      
      if (failedCameras.length > 0) {
        const failedNames = failedCameras.map(r => r.camera.name).join(', ');
        console.error(`[StartupCalibration] ${failedCameras.length}/${results.length} camera(s) failed validation: ${failedNames}`);
        await this.flashRedLED(`Camera validation failed: ${failedNames}`);
      } else {
        console.log(`[StartupCalibration] ✓ All ${results.length} camera(s) validated successfully!`);
        // Stop any existing alert LED
        await stopRedFlash();
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
      // Turn on LED light for consistent illumination during calibration (unified controller)
      await setWhiteLight();
      
      // Small delay to ensure LED process completes and releases stdout
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get paper dimensions from format
      const { getPaperDimensions } = await import('../utils/paper-size.js');
      const paperDims = getPaperDimensions(paperSizeFormat);

      const args = [
        path.join(process.cwd(), 'python/aruco_calibrator.py'),
        '--camera-id', camera.id,
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

      // Track this calibration process
      subprocessManager.trackProcess(pythonProcess, 'aruco_calibrator.py', 'python', `Startup calibration: ${camera.name}`);

      let result = '';
      let error = '';

      pythonProcess.on('error', async (err) => {
        console.error('[StartupCalibration] Python process error:', err);
        // Turn off LED since Python failed to spawn (close event won't fire)
        await turnOffLED();
        resolve(false);
      });

      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', async (code) => {
        if (code === 0) {
          try {
            const calibrationData = JSON.parse(result);
            const homographyMatrix = calibrationData.homography_matrix;
            
            if (!homographyMatrix || calibrationData.markers_detected !== 4) {
              console.error(`[StartupCalibration] Invalid calibration: ${calibrationData.markers_detected}/4 markers detected`);
              await turnOffLED();
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

            // Recreate slots from templates (use the camera-specific paperSize passed to this function)
            // paperSizeFormat parameter already contains camera.paperSize with fallback to global config
            const templateRectangles = await storage.getTemplateRectanglesByPaperSize(paperSizeFormat);
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
                  xCm: template.xCm,
                  yCm: template.yCm,
                  widthCm: category.widthCm,
                  heightCm: category.heightCm,
                  rotationDeg: template.rotation || 0,
                  allowCheckout: true,
                  graceWindow: '08:00-17:00',
                });

                // Update template rectangle with slot ID and simplified numbered QR code
                await storage.updateTemplateRectangle(template.id, {
                  slotId: slot.id,
                  autoQrId: slot.slotNumber.toString(), // Use simplified slot number for QR codes
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
            
            // Turn off LED light after SUCCESSFUL calibration
            await turnOffLED();
            
            resolve(true);

          } catch (parseError) {
            console.error('[StartupCalibration] Failed to parse calibration result:', parseError);
            // Turn off LED light on error
            await turnOffLED();
            resolve(false);
          }
        } else {
          console.error('[StartupCalibration] Calibration process failed with code', code, ':', error);
          // DON'T turn off LED on failure - red flash should continue
          // The finally block was killing the flash process
          resolve(false);
        }
      });
    });
  }

  private async flashRedLED(reason: string): Promise<void> {
    console.warn(`[StartupCalibration] Flashing red LED - ${reason}`);
    try {
      await startRedFlash(); // Unified controller handles continuous red flash
    } catch (error) {
      console.error('[StartupCalibration] Failed to flash red LED:', error);
    }
  }
}

// Export singleton instance
export const startupCalibrationService = new StartupCalibrationService();
