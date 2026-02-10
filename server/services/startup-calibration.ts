/**
 * Startup Calibration Service
 * Automatically runs calibration on server startup using the last successful configuration
 * Flashes red LED if calibration fails or is missing
 */

import path from 'path';
import { storage } from '../storage.js';
import { setWhiteLight, turnOffLED, startRedFlash, stopRedFlash } from '../utils/led-control.js';
import { cameraSessionManager } from '../camera-session-manager.js';
import { spawnTracked } from '../subprocess-manager.js';

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
        '--paper-size', `${paperDims.widthCm}x${paperDims.heightCm}`,
        '--paper-size-name', paperSizeFormat
      ];

      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        args.push('--device-path', camera.devicePath);
        console.log(`[StartupCalibration] Using device path: ${camera.devicePath}`);
      } else {
        args.push('--camera', camera.deviceIndex?.toString() || '0');
        console.log(`[StartupCalibration] Using camera index: ${camera.deviceIndex || 0}`);
      }

      const pythonProcess = spawnTracked(
        'python3',
        args,
        'aruco_calibrator.py',
        'python',
        `Startup calibration: ${camera.name}`
      );

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

            await storage.updateCamera(camera.id, {
              homographyMatrix: homographyMatrix,
              calibrationTimestamp: new Date(),
            });

            await storage.setConfig('last_calibration_camera_id', camera.id, 'Last successfully calibrated camera ID');
            await storage.setConfig('last_calibration_timestamp', new Date().toISOString(), 'Last successful calibration timestamp');

            console.log(`[StartupCalibration] Validation completed: ${calibrationData.markers_detected}/4 markers, error: ${calibrationData.reprojection_error.toFixed(2)}px`);
            console.log(`[StartupCalibration] Homography updated. Existing slots preserved (no slot recreation on startup).`);
            
            await turnOffLED();
            
            resolve(true);

          } catch (parseError) {
            console.error('[StartupCalibration] Failed to parse calibration result:', parseError);
            await turnOffLED();
            resolve(false);
          }
        } else {
          console.error('[StartupCalibration] Calibration process failed with code', code, ':', error);
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
