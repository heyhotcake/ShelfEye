import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { CaptureScheduler } from "./scheduler";
import { sendTestAlert } from "./services/email-alerts";
import { getAlertLEDController } from "./services/alert-led";
import { startupCalibrationService } from "./services/startup-calibration";
import { cameraSessionManager } from "./camera-session-manager";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import QRCode from "qrcode";
import crypto from "crypto";
import { z } from "zod";
import { insertCameraSchema, insertSlotSchema, insertDetectionLogSchema, insertAlertRuleSchema, insertToolCategorySchema, insertTemplateRectangleSchema, insertWorkerSchema, insertCaptureRunSchema } from "@shared/schema";

// Helper function to get camera device source (path or index)
function getCameraDeviceSource(camera: { devicePath?: string | null; deviceIndex?: number | null }): string {
  if (camera.devicePath) {
    return camera.devicePath;
  }
  if (camera.deviceIndex !== null && camera.deviceIndex !== undefined) {
    return camera.deviceIndex.toString();
  }
  throw new Error('Camera has neither devicePath nor deviceIndex configured');
}

// Global scheduler instance
let scheduler: CaptureScheduler;

export async function registerRoutes(app: Express): Promise<Server> {
  scheduler = new CaptureScheduler(storage);
  await scheduler.initialize();
  
  // Run startup calibration
  await startupCalibrationService.initialize();
  // Health check
  app.get("/api/health", (_req, res) => {
    try {
      res.json({
        ok: true,
        time: new Date().toISOString(),
        version: "2.1.0"
      });
    } catch (error) {
      res.status(500).json({ message: "Health check failed", error });
    }
  });

  // Camera management routes
  app.get("/api/cameras", async (_req, res) => {
    try {
      const cameras = await storage.getCameras();
      res.json(cameras);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cameras", error });
    }
  });

  app.get("/api/cameras/:id", async (req, res) => {
    try {
      const camera = await storage.getCamera(req.params.id);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      res.json(camera);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch camera", error });
    }
  });

  app.post("/api/cameras", async (req, res) => {
    try {
      const cameraData = insertCameraSchema.parse(req.body);
      const camera = await storage.createCamera(cameraData);
      res.json(camera);
    } catch (error) {
      res.status(400).json({ message: "Invalid camera data", error });
    }
  });

  app.put("/api/cameras/:id", async (req, res) => {
    try {
      const updates = insertCameraSchema.partial().parse(req.body);
      const camera = await storage.updateCamera(req.params.id, updates);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      res.json(camera);
    } catch (error) {
      res.status(400).json({ message: "Invalid camera data", error });
    }
  });

  app.delete("/api/cameras/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteCamera(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Camera not found" });
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete camera", error });
    }
  });

  // Helper function to turn off LED light safely
  const turnOffLED = async () => {
    try {
      const lightConfig = await storage.getConfigByKey('light_strip_gpio_pin');
      if (lightConfig) {
        const pin = parseInt(lightConfig.value as string);
        spawn('sudo', ['python3', path.join(process.cwd(), 'python/gpio_controller.py'), '--pin', pin.toString(), '--action', 'off']);
        console.log('[LED] Light turned OFF');
      }
    } catch (err) {
      console.error('[LED] Failed to turn off light:', err);
    }
  };

  // Calibration routes
  app.post("/api/calibrate/:cameraId", async (req, res) => {
    const { cameraId } = req.params;
    let lockAcquired = false;
    
    try {
      const { paperSize } = req.body; // Expected: "6-page-3x2", "A4-landscape", etc.
      
      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      // Get paper dimensions from format with validation
      const { getPaperDimensions } = await import('./utils/paper-size.js');
      const paperSizeFormat = paperSize || 'A4-landscape';
      
      let paperDims;
      try {
        paperDims = getPaperDimensions(paperSizeFormat);
        if (!paperDims || paperDims.widthCm <= 0 || paperDims.heightCm <= 0) {
          return res.status(400).json({ 
            message: `Invalid paper size format: ${paperSizeFormat}. Must be a supported format like "A4-landscape" or "6-page-3x2"` 
          });
        }
      } catch (err) {
        return res.status(400).json({ 
          message: `Invalid paper size format: ${paperSizeFormat}`,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }

      // Acquire exclusive camera lock AFTER validation succeeds
      // This includes a 10-second delay to ensure any preview process has fully released the camera
      await cameraSessionManager.acquireExclusiveLock(cameraId);
      lockAcquired = true;

      // Turn on LED light for consistent illumination during calibration
      const lightStripConfig = await storage.getConfigByKey('light_strip_gpio_pin');
      if (lightStripConfig) {
        const pin = parseInt(lightStripConfig.value as string);
        const ledProcess = spawn('sudo', ['python3', path.join(process.cwd(), 'python/gpio_controller.py'), '--pin', pin.toString(), '--action', 'on']);
        
        // Log LED control output for debugging
        ledProcess.stdout.on('data', (data) => {
          console.log(`[Calibration] LED control output: ${data}`);
        });
        ledProcess.stderr.on('data', (data) => {
          console.error(`[Calibration] LED control error: ${data}`);
        });
        
        console.log('[Calibration] LED light turned ON for calibration');
        
        // Wait a moment for LED to fully turn on
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Get template rectangles with category dimensions for preview overlay
      // IMPORTANT: Filter by paper size to match the selected template design
      const allTemplates = await storage.getTemplateRectanglesByCamera(cameraId);
      const templateRectanglesForPreview = allTemplates.filter(t => t.paperSize === paperSizeFormat);
      const templatesWithDimensions = [];
      
      console.log(`[Calibration] Found ${allTemplates.length} total templates, ${templateRectanglesForPreview.length} matching paper size: ${paperSizeFormat}`);
      
      for (const template of templateRectanglesForPreview) {
        const category = await storage.getToolCategory(template.categoryId);
        if (category) {
          templatesWithDimensions.push({
            x: template.xCm,
            y: template.yCm,
            width: category.widthCm,
            height: category.heightCm,
            rotation: template.rotation,
            categoryName: category.name
          });
        }
      }

      // Call Python calibration script with paper size and preview generation
      const deviceSource = getCameraDeviceSource(camera);
      const calibrationArgs = [
        path.join(process.cwd(), 'python/aruco_calibrator.py'),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--paper-size', `${paperDims.widthCm}x${paperDims.heightCm}`,
        '--generate-preview',
        '--preview-output-size', '800x600',
        '--templates', JSON.stringify(templatesWithDimensions)
      ];
      
      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        calibrationArgs.push('--device-path', camera.devicePath);
        console.log(`[Calibration] Using device path: ${camera.devicePath}`);
      } else {
        calibrationArgs.push('--camera', camera.deviceIndex?.toString() || '0');
        console.log(`[Calibration] Using camera index: ${camera.deviceIndex || 0}`);
      }
      
      const pythonProcess = spawn('python3', calibrationArgs);

      let result = '';
      let error = '';
      let responseSent = false;

      pythonProcess.on('error', async (err) => {
        if (!responseSent) {
          responseSent = true;
          if (lockAcquired) cameraSessionManager.releaseLock(cameraId);
          lockAcquired = false;
          // Python failed to spawn - turn off LED since 'close' won't fire
          await turnOffLED();
          res.status(503).json({ 
            message: "Python environment not available. This feature requires hardware setup on Raspberry Pi.", 
            error: err.message 
          });
        }
      });

      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', async (code) => {
        if (responseSent) return;
        
        try {
          if (code === 0) {
            try {
              const calibrationData = JSON.parse(result);
              const homographyMatrix = calibrationData.homography_matrix;
              const cameraMatrix = calibrationData.camera_matrix || null;
              const distCoeffs = calibrationData.dist_coeffs || null;
              
              await storage.updateCamera(cameraId, {
                homographyMatrix: homographyMatrix,
                cameraMatrix: cameraMatrix,
                distCoeffs: distCoeffs,
                calibrationTimestamp: new Date(),
              });

              // Get template rectangles filtered by the selected paper size
              const allTemplatesForSlots = await storage.getTemplateRectanglesByCamera(cameraId);
              const templateRectangles = allTemplatesForSlots.filter(t => t.paperSize === paperSizeFormat);
              const createdSlots: any[] = [];
              
              console.log(`[Calibration] Creating slots for ${templateRectangles.length} templates (paper size: ${paperSizeFormat})`);

              const { transformTemplateToPixels } = await import('./utils/coordinate-transform.js');

              for (const template of templateRectangles) {
                try {
                  const category = await storage.getToolCategory(template.categoryId);
                  if (!category) {
                    console.warn(`Tool category ${template.categoryId} not found for template ${template.id}`);
                    continue;
                  }

                  const pixelCoords = transformTemplateToPixels({
                    xCm: template.xCm,
                    yCm: template.yCm,
                    widthCm: category.widthCm,
                    heightCm: category.heightCm,
                    rotation: template.rotation,
                  }, homographyMatrix);

                  const slot = await storage.createSlot({
                    slotId: template.autoQrId || `${category.name}_${template.id.slice(0, 4)}`,
                    cameraId: cameraId,
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

                  createdSlots.push(slot);
                } catch (slotError) {
                  console.warn(`Failed to create slot for template ${template.id}:`, slotError);
                }
              }

              // Store last successful calibration configuration
              await storage.setConfig('last_calibration_camera_id', cameraId, 'Last successfully calibrated camera ID');
              await storage.setConfig('last_calibration_timestamp', new Date().toISOString(), 'Last successful calibration timestamp');
              await storage.setConfig('last_calibration_paper_size_format', paperSize || 'A4-landscape', 'Last calibration paper size format (e.g., 6-page-3x2)');

              const response: any = {
                ok: true,
                homographyMatrix: homographyMatrix,
                reprojectionError: calibrationData.reprojection_error,
                markersDetected: calibrationData.markers_detected,
                slotsCreated: createdSlots.length,
              };
              
              // Include rectified preview if generated
              if (calibrationData.rectified_preview) {
                response.rectifiedPreview = calibrationData.rectified_preview;
              }

              res.json(response);
            } catch (parseError) {
              res.status(500).json({ message: "Failed to parse calibration result", error: parseError });
            }
          } else {
            res.status(500).json({ message: "Calibration failed", error });
          }
        } finally {
          // Always release lock when calibration completes (if it was acquired)
          if (lockAcquired) {
            cameraSessionManager.releaseLock(cameraId);
            lockAcquired = false;
          }
          
          // Turn off LED light after calibration
          turnOffLED().catch(err => console.error('[Calibration] LED turnoff error:', err));
        }
      });

    } catch (error) {
      // Release lock on error (if it was acquired)
      if (lockAcquired) {
        cameraSessionManager.releaseLock(cameraId);
      }
      // Turn off LED on unexpected errors
      await turnOffLED();
      res.status(500).json({ message: "Calibration error", error });
    }
  });

  // Two-step calibration validation routes
  app.post("/api/calibrate/:cameraId/validate-qrs-visible", async (req, res) => {
    const { cameraId } = req.params;
    let lockAcquired = false;
    
    try {
      const camera = await storage.getCamera(cameraId);
      
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      
      if (!camera.homographyMatrix) {
        return res.status(400).json({ message: "Camera not calibrated. Run ArUco calibration first." });
      }
      
      // Get slots for this camera
      const slots = await storage.getSlotsByCamera(cameraId);
      if (slots.length === 0) {
        return res.status(400).json({ message: "No slots configured for this camera" });
      }
      
      // Get HMAC secret
      const secretConfig = await storage.getConfigByKey('QR_SECRET_KEY');
      const secret = secretConfig?.value as string || 'default-secret-key';
      
      // Prepare expected slots data - use expectedQrId to match against QR payload
      const expectedSlots = slots.map(slot => ({
        id: slot.expectedQrId, // This matches the 'id' field in QR payload
        slotId: slot.slotId,
        toolName: slot.toolName
      }));

      // Acquire exclusive camera lock AFTER validation succeeds
      // This includes a 10-second delay to ensure any preview process has fully released the camera
      await cameraSessionManager.acquireExclusiveLock(cameraId);
      lockAcquired = true;
      
      // Turn on LED light for consistent illumination during validation
      const lightConfig = await storage.getConfigByKey('light_strip_gpio_pin');
      if (lightConfig) {
        const pin = parseInt(lightConfig.value as string);
        const ledProcess = spawn('sudo', ['python3', path.join(process.cwd(), 'python/gpio_controller.py'), '--pin', pin.toString(), '--action', 'on']);
        
        // Log LED control output for debugging
        ledProcess.stdout.on('data', (data) => {
          console.log(`[Validation] LED control output: ${data}`);
        });
        ledProcess.stderr.on('data', (data) => {
          console.error(`[Validation] LED control error: ${data}`);
        });
        
        console.log('[Validation] LED light turned ON');
      }
      
      // Call Python validation script
      const validationArgs = [
        path.join(process.cwd(), 'python/validate_slot_qrs.py'),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--homography', JSON.stringify(camera.homographyMatrix),
        '--slots', JSON.stringify(expectedSlots),
        '--secret', secret,
        '--should-detect', 'true' // Step 1: QRs should be visible
      ];
      
      // Add camera calibration parameters if available
      if (camera.cameraMatrix && camera.distCoeffs) {
        validationArgs.push('--camera-matrix', camera.cameraMatrix.join(','));
        validationArgs.push('--dist-coeffs', camera.distCoeffs.join(','));
        console.log(`[Validation] Using camera calibration parameters`);
      }
      
      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        validationArgs.push('--device-path', camera.devicePath);
        console.log(`[Validation] Using device path: ${camera.devicePath}`);
      } else {
        validationArgs.push('--camera', camera.deviceIndex?.toString() || '0');
        console.log(`[Validation] Using camera index: ${camera.deviceIndex || 0}`);
      }
      
      const pythonProcess = spawn('python3', validationArgs);
      
      let result = '';
      let error = '';
      let responseSent = false;
      
      pythonProcess.on('error', async (err) => {
        if (!responseSent) {
          responseSent = true;
          if (lockAcquired) cameraSessionManager.releaseLock(cameraId);
          lockAcquired = false;
          // Python failed to spawn - turn off LED since 'close' won't fire
          await turnOffLED();
          res.status(503).json({ message: "Validation failed", error: err.message });
        }
      });
      
      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (responseSent) return;
        
        try {
          if (code === 0) {
            try {
              const validationResult = JSON.parse(result);
              res.json(validationResult);
            } catch (parseError) {
              res.status(500).json({ message: "Failed to parse validation result", error: parseError });
            }
          } else {
            try {
              const validationResult = JSON.parse(result);
              res.status(400).json(validationResult);
            } catch {
              res.status(500).json({ message: "Validation failed", error });
            }
          }
        } finally {
          // Always release lock when validation completes (if it was acquired)
          if (lockAcquired) {
            cameraSessionManager.releaseLock(cameraId);
            lockAcquired = false;
          }
          
          // Turn off LED light after validation
          turnOffLED().catch(err => console.error('[Validation] LED turnoff error:', err));
        }
      });
      
    } catch (error) {
      // Release lock on error (if it was acquired)
      if (lockAcquired) {
        cameraSessionManager.releaseLock(cameraId);
      }
      // Turn off LED on unexpected errors
      await turnOffLED();
      res.status(500).json({ message: "Validation error", error });
    }
  });
  
  app.post("/api/calibrate/:cameraId/validate-qrs-covered", async (req, res) => {
    const { cameraId } = req.params;
    let lockAcquired = false;
    
    try {
      const camera = await storage.getCamera(cameraId);
      
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      
      if (!camera.homographyMatrix) {
        return res.status(400).json({ message: "Camera not calibrated. Run ArUco calibration first." });
      }
      
      // Get slots for this camera
      const slots = await storage.getSlotsByCamera(cameraId);
      if (slots.length === 0) {
        return res.status(400).json({ message: "No slots configured for this camera" });
      }
      
      // Get HMAC secret
      const secretConfig = await storage.getConfigByKey('QR_SECRET_KEY');
      const secret = secretConfig?.value as string || 'default-secret-key';
      
      // Prepare expected slots data - use expectedQrId to match against QR payload
      const expectedSlots = slots.map(slot => ({
        id: slot.expectedQrId, // This matches the 'id' field in QR payload
        slotId: slot.slotId,
        toolName: slot.toolName
      }));

      // Acquire exclusive camera lock AFTER validation succeeds
      // This includes a 10-second delay to ensure any preview process has fully released the camera
      await cameraSessionManager.acquireExclusiveLock(cameraId);
      lockAcquired = true;
      
      // Turn on LED light for consistent illumination during validation
      const lightConfig = await storage.getConfigByKey('light_strip_gpio_pin');
      if (lightConfig) {
        const pin = parseInt(lightConfig.value as string);
        const ledProcess = spawn('sudo', ['python3', path.join(process.cwd(), 'python/gpio_controller.py'), '--pin', pin.toString(), '--action', 'on']);
        
        // Log LED control output for debugging
        ledProcess.stdout.on('data', (data) => {
          console.log(`[Validation] LED control output: ${data}`);
        });
        ledProcess.stderr.on('data', (data) => {
          console.error(`[Validation] LED control error: ${data}`);
        });
        
        console.log('[Validation] LED light turned ON');
      }
      
      // Call Python validation script
      const validationArgs = [
        path.join(process.cwd(), 'python/validate_slot_qrs.py'),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--homography', JSON.stringify(camera.homographyMatrix),
        '--slots', JSON.stringify(expectedSlots),
        '--secret', secret,
        '--should-detect', 'false' // Step 2: QRs should NOT be visible
      ];
      
      // Add camera calibration parameters if available
      if (camera.cameraMatrix && camera.distCoeffs) {
        validationArgs.push('--camera-matrix', camera.cameraMatrix.join(','));
        validationArgs.push('--dist-coeffs', camera.distCoeffs.join(','));
        console.log(`[Validation] Using camera calibration parameters`);
      }
      
      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        validationArgs.push('--device-path', camera.devicePath);
        console.log(`[Validation] Using device path: ${camera.devicePath}`);
      } else {
        validationArgs.push('--camera', camera.deviceIndex?.toString() || '0');
        console.log(`[Validation] Using camera index: ${camera.deviceIndex || 0}`);
      }
      
      const pythonProcess = spawn('python3', validationArgs);
      
      let result = '';
      let error = '';
      let responseSent = false;
      
      pythonProcess.on('error', async (err) => {
        if (!responseSent) {
          responseSent = true;
          if (lockAcquired) cameraSessionManager.releaseLock(cameraId);
          lockAcquired = false;
          // Python failed to spawn - turn off LED since 'close' won't fire
          await turnOffLED();
          res.status(503).json({ message: "Validation failed", error: err.message });
        }
      });
      
      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (responseSent) return;
        
        try {
          if (code === 0) {
            try {
              const validationResult = JSON.parse(result);
              res.json(validationResult);
            } catch (parseError) {
              res.status(500).json({ message: "Failed to parse validation result", error: parseError });
            }
          } else {
            try {
              const validationResult = JSON.parse(result);
              res.status(400).json(validationResult);
            } catch {
              res.status(500).json({ message: "Validation failed", error });
            }
          }
        } finally {
          // Always release lock when validation completes (if it was acquired)
          if (lockAcquired) {
            cameraSessionManager.releaseLock(cameraId);
            lockAcquired = false;
          }
          
          // Turn off LED light after validation
          turnOffLED().catch(err => console.error('[Validation] LED turnoff error:', err));
        }
      });
      
    } catch (error) {
      // Release lock on error (if it was acquired)
      if (lockAcquired) {
        cameraSessionManager.releaseLock(cameraId);
      }
      // Turn off LED on unexpected errors
      await turnOffLED();
      res.status(500).json({ message: "Validation error", error });
    }
  });

  // Camera preview route
  app.get("/api/camera-preview/:cameraId", async (req, res) => {
    try {
      const { cameraId } = req.params;
      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      // Check if camera is exclusively locked
      const lockStatus = cameraSessionManager.getLockStatus(cameraId);
      if (lockStatus.locked && lockStatus.type === 'exclusive') {
        return res.status(423).json({ 
          ok: false,
          message: "Camera is busy", 
          reason: lockStatus.reason || 'camera_locked'
        });
      }

      // Acquire preview lock
      const lockAcquired = cameraSessionManager.acquirePreviewLock(cameraId);
      if (!lockAcquired) {
        return res.status(423).json({ 
          ok: false,
          message: "Camera is busy", 
          reason: 'calibration_in_progress'
        });
      }

      // Call Python preview script
      // Use device path if available, otherwise use device index
      const deviceSource = camera.devicePath || camera.deviceIndex?.toString() || '0';
      const pythonProcess = spawn('python3', [
        path.join(process.cwd(), 'python/camera_preview.py'),
        deviceSource,
        camera.resolution[0].toString(),
        camera.resolution[1].toString()
      ]);

      let result = '';
      let error = '';
      let responseSent = false;

      pythonProcess.on('error', (err) => {
        if (!responseSent) {
          responseSent = true;
          res.status(503).json({ 
            message: "Camera preview not available", 
            error: err.message 
          });
        }
      });

      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (responseSent) return;
        
        // Note: Preview lock is auto-expired after 5 seconds, so no explicit release needed
        // The lock will be cleaned up automatically by the session manager
        
        if (code === 0) {
          try {
            const previewData = JSON.parse(result);
            res.json(previewData);
          } catch (parseError) {
            res.status(500).json({ message: "Failed to parse preview result", error: parseError });
          }
        } else {
          res.status(500).json({ message: "Preview failed", error });
        }
      });

    } catch (error) {
      res.status(500).json({ message: "Preview error", error });
    }
  });

  // Rectified preview route
  app.get("/api/rectified-preview/:cameraId", async (req, res) => {
    try {
      const { cameraId } = req.params;
      const { templateTimestamp } = req.query; // Optional: specific template to show
      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      if (!camera.homographyMatrix || camera.homographyMatrix.length !== 9) {
        return res.status(400).json({ 
          message: "Camera not calibrated. Please calibrate the camera first." 
        });
      }

      // Get paper size from last calibration config
      const paperSizeConfig = await storage.getConfigByKey('last_calibration_paper_size_format');
      let paperSizeFormat = 'A4-landscape'; // default
      if (paperSizeConfig && paperSizeConfig.value) {
        paperSizeFormat = paperSizeConfig.value as string;
      }

      // Get template rectangles for this camera to overlay on rectified view
      // IMPORTANT: Filter by paper size to match the calibration paper size
      const allTemplates = await storage.getTemplateRectanglesByCamera(cameraId);
      const templates = allTemplates.filter(t => t.paperSize === paperSizeFormat);
      
      console.log(`[Rectified Preview] Found ${allTemplates.length} total templates, ${templates.length} matching paper size: ${paperSizeFormat}`);
      
      // Get categories for dimensions and names
      const categories = await storage.getToolCategories();
      const categoryMap = new Map(categories.map(c => [c.id, c]));
      
      const templateData = templates.map(t => {
        const category = categoryMap.get(t.categoryId);
        return {
          x: t.xCm,
          y: t.yCm,
          width: category?.widthCm || 0,
          height: category?.heightCm || 0,
          rotation: t.rotation || 0,
          categoryName: category?.name || 'Unknown'
        };
      });
      
      console.log(`[Rectified Preview] Template data:`, JSON.stringify(templateData, null, 2));
      
      // Convert paper size format to dimensions in cm
      const { getPaperDimensions } = await import('./utils/paper-size.js');
      const paperDimensions = getPaperDimensions(paperSizeFormat);

      // Call Python rectified preview script
      const homographyStr = camera.homographyMatrix.join(',');
      
      // Calculate output size based on paper dimensions
      // Use a scale factor to get a reasonable display size (e.g., 10 pixels per cm)
      const pixelsPerCm = 10;
      const outputWidth = Math.round(paperDimensions.widthCm * pixelsPerCm);
      const outputHeight = Math.round(paperDimensions.heightCm * pixelsPerCm);
      
      console.log(`[Rectified Preview] Paper: ${paperDimensions.widthCm}x${paperDimensions.heightCm} cm`);
      console.log(`[Rectified Preview] Output: ${outputWidth}x${outputHeight} px (${pixelsPerCm} px/cm)`);
      
      const args = [
        path.join(process.cwd(), 'python/rectified_preview.py'),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--homography', homographyStr,
        '--output-size', `${outputWidth}x${outputHeight}`,
        '--paper-size', `${paperDimensions.widthCm}x${paperDimensions.heightCm}`
      ];
      
      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        args.push('--device-path', camera.devicePath);
        console.log(`[Rectified Preview] Using device path: ${camera.devicePath}`);
      } else {
        args.push('--camera', camera.deviceIndex?.toString() || '0');
        console.log(`[Rectified Preview] Using camera index: ${camera.deviceIndex || 0}`);
      }
      
      // Add templates if available
      if (templateData.length > 0) {
        args.push('--templates', JSON.stringify(templateData));
      }
      
      // Add camera calibration parameters for lens distortion correction
      if (camera.cameraMatrix && camera.distCoeffs) {
        args.push('--camera-matrix', camera.cameraMatrix.join(','));
        args.push('--dist-coeffs', camera.distCoeffs.join(','));
        console.log(`[Rectified Preview] Using camera calibration for undistortion`);
      } else {
        console.log(`[Rectified Preview] No camera calibration parameters - skipping undistortion`);
      }
      
      const pythonProcess = spawn('python3', args);

      let result = '';
      let error = '';
      let responseSent = false;

      pythonProcess.on('error', (err) => {
        if (!responseSent) {
          responseSent = true;
          res.status(503).json({ 
            message: "Rectified preview not available", 
            error: err.message 
          });
        }
      });

      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (responseSent) return;
        
        if (code === 0) {
          try {
            const previewData = JSON.parse(result);
            res.json(previewData);
          } catch (parseError) {
            console.error('[Rectified Preview] Parse error:', parseError);
            res.status(500).json({ message: "Failed to parse rectified preview result", error: parseError });
          }
        } else {
          console.error('[Rectified Preview] Python script failed with code', code);
          console.error('[Rectified Preview] Error output:', error);
          console.error('[Rectified Preview] Stdout output:', result);
          res.status(500).json({ message: "Rectified preview failed", error });
        }
      });

    } catch (error) {
      res.status(500).json({ message: "Rectified preview error", error });
    }
  });

  // Manual capture route
  app.post("/api/capture", async (req, res) => {
    try {
      const cameras = await storage.getCameras();
      const activeCamera = cameras.find(c => c.isActive);
      
      if (!activeCamera) {
        return res.status(400).json({ message: "No active camera found" });
      }

      const slots = await storage.getSlotsByCamera(activeCamera.id);

      // Call Python capture and analysis script
      const pythonProcess = spawn('python3', [
        path.join(process.cwd(), 'python/camera_manager.py'),
        '--camera', activeCamera.deviceIndex?.toString() || '0',
        '--slots', JSON.stringify(slots.map(s => ({
          id: s.slotId,
          coords: s.regionCoords,
          expectedQr: s.expectedQrId
        }))),
        '--homography', JSON.stringify(activeCamera.homographyMatrix || [])
      ]);

      let result = '';
      let error = '';
      let responseSent = false;

      pythonProcess.on('error', (err) => {
        if (!responseSent) {
          responseSent = true;
          res.status(503).json({ 
            message: "Python environment not available. This feature requires hardware setup on Raspberry Pi.", 
            error: err.message 
          });
        }
      });

      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', async (code) => {
        if (responseSent) return;
        
        if (code === 0) {
          try {
            const captureResults = JSON.parse(result);
            const statuses: Record<string, any> = {};

            // Process each slot result
            for (const slotResult of captureResults.slots) {
              const slot = slots.find(s => s.slotId === slotResult.slot_id);
              if (!slot) continue;

              // Validate worker checkout if status is CHECKED_OUT
              let workerId: string | null = null;
              let workerName: string | null = null;
              let finalStatus = slotResult.status;

              if (slotResult.status === 'CHECKED_OUT' && slotResult.qr_id) {
                // Look up worker by workerCode (qr_id contains the workerCode for worker QRs)
                const worker = await storage.getWorkerByCode(slotResult.qr_id);
                
                if (worker && worker.isActive) {
                  // Valid worker checkout
                  workerId = worker.id;
                  workerName = worker.name;
                } else {
                  // Invalid/inactive worker - treat as unauthorized removal
                  finalStatus = 'EMPTY';
                  console.log(`[SECURITY] Unauthorized checkout attempt with QR: ${slotResult.qr_id}`);
                }
              }

              // Create detection log
              await storage.createDetectionLog({
                slotId: slot.id,
                status: finalStatus,
                qrId: slotResult.qr_id || null,
                workerId,
                workerName,
                ssimScore: slotResult.ssim_score || null,
                poseQuality: slotResult.pose_quality || null,
                imagePath: slotResult.image_path || null,
                alertTriggered: slotResult.alert_triggered || false,
                rawDetectionData: slotResult,
              });

              statuses[slotResult.slot_id] = {
                state: finalStatus,
                present: finalStatus === 'ITEM_PRESENT',
                correct_item: slotResult.correct_item || false,
                scores: {
                  s_empty: slotResult.s_empty || 0,
                  s_full: slotResult.s_full || 0
                },
                pose_quality: slotResult.pose_quality || 0,
                qr_id: finalStatus === 'CHECKED_OUT' ? slotResult.qr_id : null,
                worker_name: workerName,
                roi_path: slotResult.image_path ? `/api/roi/${slotResult.slot_id}.png` : null
              };
            }

            res.json({
              ok: true,
              time: new Date().toISOString(),
              camera: activeCamera.name,
              statuses
            });

          } catch (parseError) {
            res.status(500).json({ message: "Failed to parse capture results", error: parseError });
          }
        } else {
          res.status(500).json({ message: "Capture failed", error });
        }
      });

    } catch (error) {
      res.status(500).json({ message: "Capture error", error });
    }
  });

  // Slot management routes
  app.get("/api/slots", async (req, res) => {
    try {
      const { cameraId } = req.query;
      const slots = cameraId 
        ? await storage.getSlotsByCamera(cameraId as string)
        : await storage.getSlots();
      res.json(slots);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch slots", error });
    }
  });

  app.post("/api/slots", async (req, res) => {
    try {
      const slotData = insertSlotSchema.parse(req.body);
      const slot = await storage.createSlot(slotData);
      res.json(slot);
    } catch (error) {
      res.status(400).json({ message: "Invalid slot data", error });
    }
  });

  app.put("/api/slots/:id", async (req, res) => {
    try {
      const updates = insertSlotSchema.partial().parse(req.body);
      const slot = await storage.updateSlot(req.params.id, updates);
      if (!slot) {
        return res.status(404).json({ message: "Slot not found" });
      }
      res.json(slot);
    } catch (error) {
      res.status(400).json({ message: "Invalid slot data", error });
    }
  });

  app.delete("/api/slots/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteSlot(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Slot not found" });
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete slot", error });
    }
  });

  // Detection logs routes
  app.get("/api/detection-logs", async (req, res) => {
    try {
      // Validate and sanitize query parameters
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 1000); // Between 1-1000
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0); // Non-negative
      const { slotId, startDate, endDate } = req.query;

      let logs;
      if (slotId) {
        logs = await storage.getDetectionLogsBySlot(slotId as string, limit);
      } else if (startDate && endDate) {
        // Validate date parameters
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return res.status(400).json({ message: "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)" });
        }
        
        if (start > end) {
          return res.status(400).json({ message: "Start date must be before end date" });
        }
        
        logs = await storage.getDetectionLogsByDateRange(start, end);
      } else {
        logs = await storage.getDetectionLogs(limit, offset);
      }

      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch detection logs", error });
    }
  });

  // Alert management routes
  app.get("/api/alert-rules", async (_req, res) => {
    try {
      const rules = await storage.getAlertRules();
      res.json(rules);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch alert rules", error });
    }
  });

  app.post("/api/alert-rules", async (req, res) => {
    try {
      const ruleData = insertAlertRuleSchema.parse(req.body);
      const rule = await storage.createAlertRule(ruleData);
      res.json(rule);
    } catch (error) {
      res.status(400).json({ message: "Invalid alert rule data", error });
    }
  });

  app.get("/api/alert-queue", async (_req, res) => {
    try {
      const queue = await storage.getAlertQueue();
      res.json(queue);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch alert queue", error });
    }
  });

  app.get("/api/alert-queue/pending", async (_req, res) => {
    try {
      const pending = await storage.getPendingAlerts();
      res.json(pending);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pending alerts", error });
    }
  });

  app.get("/api/alert-queue/failed", async (_req, res) => {
    try {
      const failed = await storage.getFailedAlerts();
      res.json(failed);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch failed alerts", error });
    }
  });

  // QR code generation route
  app.post("/api/qr-generate", async (req, res) => {
    try {
      const { type, id, errorCorrection = 'L', moduleSize = 25 } = req.body;

      // Validate input parameters
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: "ID is required and must be a string" });
      }
      
      if (!type || !['slot', 'worker'].includes(type)) {
        return res.status(400).json({ message: "Type must be 'slot' or 'worker'" });
      }
      
      if (!['L', 'M', 'Q', 'H'].includes(errorCorrection)) {
        return res.status(400).json({ message: "Error correction must be L, M, Q, or H" });
      }
      
      const moduleNum = parseInt(moduleSize);
      if (isNaN(moduleNum) || moduleNum < 1 || moduleNum > 100) {
        return res.status(400).json({ message: "Module size must be between 1 and 100" });
      }

      // SIMPLIFIED QR CODE: Just encode the numeric ID
      // Database lookup will retrieve slot/worker details
      const qrData = id;
      
      // Simple payload for reference
      const payload = { type, id };
      
      // Map error correction levels
      const errorCorrectionMap: Record<string, QRCode.QRCodeErrorCorrectionLevel> = {
        'L': 'L',  // Low = larger modules = easier scanning
        'M': 'M',
        'Q': 'Q',
        'H': 'H'
      };

      const qrOptions = {
        errorCorrectionLevel: errorCorrectionMap[errorCorrection] || 'L',
        type: 'image/png' as const,
        quality: 1,
        margin: 1,
        width: moduleSize * 10, // Scale based on module size
      };

      // Generate QR code as base64
      const qrCodeBase64 = await QRCode.toDataURL(qrData, qrOptions);
      
      // Extract base64 data without the data URL prefix
      const base64Data = qrCodeBase64.split(',')[1];

      res.json({
        ok: true,
        payload,
        qrCode: base64Data,
        dimensions: { width: qrOptions.width, height: qrOptions.width }
      });

    } catch (error) {
      res.status(500).json({ message: "QR generation error", error });
    }
  });

  // ArUco marker generation route
  app.post("/api/aruco-generate", async (req, res) => {
    try {
      const { 
        mode = 'grid', 
        markerId = 0, 
        markersX = 6, 
        markersY = 10,
        markerLengthCm = 5.0,
        markerSeparationCm = 1.0
      } = req.body;

      const pythonScript = path.join(process.cwd(), 'python', 'aruco_generator.py');
      const args = [
        pythonScript,
        '--mode', mode,
        '--markers-x', markersX.toString(),
        '--markers-y', markersY.toString(),
        '--marker-length-cm', markerLengthCm.toString(),
        '--marker-separation-cm', markerSeparationCm.toString()
      ];

      if (mode === 'single') {
        args.push('--marker-id', markerId.toString());
      }

      const result = await new Promise((resolve, reject) => {
        const process = spawn('python3', args);
        let output = '';
        let errorOutput = '';

        process.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        process.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        process.on('close', (code: number) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(output));
            } catch (e) {
              reject(new Error(`Failed to parse Python output: ${output}`));
            }
          } else {
            reject(new Error(`Python process failed: ${errorOutput}`));
          }
        });

        process.on('error', (error: Error) => {
          reject(error);
        });
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        ok: false, 
        message: "ArUco generation error", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // System configuration routes
  app.get("/api/config", async (_req, res) => {
    try {
      const config = await storage.getSystemConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch config", error });
    }
  });

  app.get("/api/config/:key", async (req, res) => {
    try {
      const config = await storage.getConfigByKey(req.params.key);
      if (!config) {
        return res.status(404).json({ message: "Configuration key not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch config key", error });
    }
  });

  app.post("/api/config", async (req, res) => {
    try {
      const { key, value, description } = req.body;
      const config = await storage.setConfig(key, value, description);
      res.json(config);
    } catch (error) {
      res.status(400).json({ message: "Invalid configuration data", error });
    }
  });

  // Google OAuth2 routes
  app.get("/api/oauth/google/status", async (_req, res) => {
    try {
      const gmailCred = await storage.getGoogleOAuthCredential('gmail');
      const sheetsCred = await storage.getGoogleOAuthCredential('sheets');
      
      res.json({
        gmail: {
          configured: gmailCred?.isConfigured || false,
          hasClientCredentials: !!(gmailCred?.clientId && gmailCred?.clientSecret)
        },
        sheets: {
          configured: sheetsCred?.isConfigured || false,
          hasClientCredentials: !!(sheetsCred?.clientId && sheetsCred?.clientSecret)
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get OAuth status", error });
    }
  });

  app.post("/api/oauth/google/setup", async (req, res) => {
    try {
      const { service, clientId, clientSecret, redirectUri } = req.body;
      
      if (!['gmail', 'sheets'].includes(service)) {
        return res.status(400).json({ message: "Invalid service. Must be 'gmail' or 'sheets'" });
      }
      
      if (!clientId || !clientSecret || !redirectUri) {
        return res.status(400).json({ message: "Client ID, Client Secret, and Redirect URI are required" });
      }

      await storage.setGoogleOAuthCredential(service, {
        service,
        clientId,
        clientSecret,
        redirectUri,
        isConfigured: false // Will be set to true after OAuth callback
      });

      res.json({ ok: true, message: `${service} OAuth credentials saved` });
    } catch (error) {
      res.status(500).json({ message: "Failed to save OAuth credentials", error });
    }
  });

  app.get("/api/oauth/google/auth-url/:service", async (req, res) => {
    try {
      const { service } = req.params;
      
      if (!['gmail', 'sheets'].includes(service)) {
        return res.status(400).json({ message: "Invalid service" });
      }

      let authUrl: string;
      if (service === 'gmail') {
        const { getGmailOAuthUrl } = await import('./services/gmail-client-oauth.js');
        authUrl = await getGmailOAuthUrl();
      } else {
        const { getSheetsOAuthUrl } = await import('./services/sheets-client-oauth.js');
        authUrl = await getSheetsOAuthUrl();
      }

      res.json({ authUrl });
    } catch (error) {
      res.status(500).json({ 
        message: "Failed to generate auth URL", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  app.get("/api/oauth/google/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      
      if (!code || typeof code !== 'string') {
        return res.status(400).send('Missing authorization code');
      }

      const service = state as string;
      
      if (service === 'gmail') {
        const { handleGmailOAuthCallback } = await import('./services/gmail-client-oauth.js');
        await handleGmailOAuthCallback(code);
      } else if (service === 'sheets') {
        const { handleSheetsOAuthCallback } = await import('./services/sheets-client-oauth.js');
        await handleSheetsOAuthCallback(code);
      } else {
        return res.status(400).send('Invalid state parameter');
      }

      // Redirect to Google OAuth setup page with success message
      res.redirect('/google-oauth?oauth=success&service=' + service);
    } catch (error) {
      console.error('[OAuth Callback Error]:', error);
      res.redirect('/google-oauth?oauth=error&message=' + encodeURIComponent(error instanceof Error ? error.message : 'OAuth failed'));
    }
  });

  // Alert configuration and testing routes
  app.get("/api/alerts/sheets-url", async (_req, res) => {
    try {
      const sheetsUrl = scheduler.getSheetsUrl();
      res.json({ url: sheetsUrl });
    } catch (error) {
      res.status(500).json({ message: "Failed to get sheets URL", error });
    }
  });

  app.post("/api/alerts/test", async (_req, res) => {
    try {
      const result = await sendTestAlert();
      if (result) {
        res.json({ 
          ok: true, 
          message: "Test alert sent successfully" 
        });
      } else {
        res.status(500).json({ 
          ok: false, 
          message: "Failed to send test alert. Check email configuration." 
        });
      }
    } catch (error) {
      res.status(500).json({ 
        ok: false, 
        message: "Error sending test alert", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // ROI image serving
  app.get("/api/roi/:slotId.png", async (req, res) => {
    try {
      const imagePath = path.join(process.cwd(), 'data', 'rois', `${req.params.slotId}_last.png`);
      const imageBuffer = await fs.readFile(imagePath);
      res.set('Content-Type', 'image/png');
      res.send(imageBuffer);
    } catch (error) {
      res.status(404).json({ message: "ROI image not found" });
    }
  });

  // Tool category routes
  app.get("/api/tool-categories", async (_req, res) => {
    try {
      const categories = await storage.getToolCategories();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tool categories", error });
    }
  });

  app.get("/api/tool-categories/:id", async (req, res) => {
    try {
      const category = await storage.getToolCategory(req.params.id);
      if (!category) {
        return res.status(404).json({ message: "Tool category not found" });
      }
      res.json(category);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tool category", error });
    }
  });

  app.post("/api/tool-categories", async (req, res) => {
    try {
      const categoryData = insertToolCategorySchema.parse(req.body);
      const category = await storage.createToolCategory(categoryData);
      res.json(category);
    } catch (error) {
      res.status(400).json({ message: "Invalid tool category data", error });
    }
  });

  app.put("/api/tool-categories/:id", async (req, res) => {
    try {
      const updates = insertToolCategorySchema.partial().parse(req.body);
      const category = await storage.updateToolCategory(req.params.id, updates);
      if (!category) {
        return res.status(404).json({ message: "Tool category not found" });
      }
      res.json(category);
    } catch (error) {
      res.status(400).json({ message: "Invalid update data", error });
    }
  });

  app.delete("/api/tool-categories/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteToolCategory(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Tool category not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete tool category", error });
    }
  });

  // Template rectangle routes
  app.get("/api/template-rectangles", async (req, res) => {
    try {
      const { paperSize } = req.query;
      if (paperSize && typeof paperSize === 'string') {
        const rectangles = await storage.getTemplateRectanglesByPaperSize(paperSize);
        return res.json(rectangles);
      }
      const rectangles = await storage.getTemplateRectangles();
      res.json(rectangles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch template rectangles", error });
    }
  });

  app.get("/api/template-rectangles/:id", async (req, res) => {
    try {
      const rectangle = await storage.getTemplateRectangle(req.params.id);
      if (!rectangle) {
        return res.status(404).json({ message: "Template rectangle not found" });
      }
      res.json(rectangle);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch template rectangle", error });
    }
  });

  app.post("/api/template-rectangles", async (req, res) => {
    try {
      const rectangleData = insertTemplateRectangleSchema.parse(req.body);
      
      const camera = await storage.getCamera(rectangleData.cameraId);
      if (!camera) {
        return res.status(400).json({ message: "Camera not found" });
      }
      
      const category = await storage.getToolCategory(rectangleData.categoryId);
      if (!category) {
        return res.status(400).json({ message: "Tool category not found" });
      }
      
      const rectangle = await storage.createTemplateRectangle(rectangleData);
      res.json(rectangle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid template rectangle data", errors: error.errors });
      }
      
      console.error('Error creating template rectangle:', error);
      res.status(500).json({ message: "Failed to create template rectangle. Please try again." });
    }
  });

  app.put("/api/template-rectangles/:id", async (req, res) => {
    try {
      const updates = insertTemplateRectangleSchema.partial().parse(req.body);
      const rectangle = await storage.updateTemplateRectangle(req.params.id, updates);
      
      if (!rectangle) {
        return res.status(404).json({ message: "Template rectangle not found" });
      }
      
      res.json(rectangle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid update data", errors: error.errors });
      }
      
      console.error('Error updating template rectangle:', error);
      res.status(500).json({ message: "Failed to update template rectangle. Please try again." });
    }
  });

  app.delete("/api/template-rectangles/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTemplateRectangle(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Template rectangle not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete template rectangle", error });
    }
  });

  // Scheduler configuration routes
  app.get("/api/schedule-config", async (_req, res) => {
    try {
      const captureTimesConfig = await storage.getConfigByKey("capture_times");
      const timezoneConfig = await storage.getConfigByKey("timezone");
      const schedulerPausedConfig = await storage.getConfigByKey("scheduler_paused");

      res.json({
        capture_times: captureTimesConfig?.value || ["08:00", "11:00", "14:00", "17:00"],
        timezone: timezoneConfig?.value || "UTC",
        scheduler_paused: schedulerPausedConfig?.value || false,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get schedule config", error });
    }
  });

  app.post("/api/schedule-config", async (req, res) => {
    try {
      const { capture_times, timezone, scheduler_paused } = req.body;

      if (capture_times !== undefined) {
        await storage.setConfig("capture_times", capture_times, "Scheduled capture times");
      }
      if (timezone !== undefined) {
        await storage.setConfig("timezone", timezone, "System timezone");
      }
      if (scheduler_paused !== undefined) {
        await storage.setConfig("scheduler_paused", scheduler_paused, "Scheduler paused state");
      }

      await scheduler.reload();

      res.json({
        ok: true,
        message: "Schedule configuration updated successfully",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update schedule config", error });
    }
  });

  app.post("/api/schedule-config/reload", async (_req, res) => {
    try {
      await scheduler.reload();
      res.json({
        ok: true,
        message: "Scheduler reloaded successfully",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to reload scheduler", error });
    }
  });

  app.get("/api/schedule-config/next-runs", async (_req, res) => {
    try {
      const nextRuns = await scheduler.getNextRuns();
      res.json(nextRuns);
    } catch (error) {
      res.status(500).json({ message: "Failed to get next runs", error });
    }
  });

  // Capture now route
  app.post("/api/capture-now", async (_req, res) => {
    try {
      const result = await scheduler.triggerCaptureNow();
      res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      res.status(500).json({ 
        message: "Capture error", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Diagnostic check route
  app.post("/api/diagnostic-check", async (_req, res) => {
    try {
      const result = await scheduler.triggerDiagnosticNow();
      res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      res.status(500).json({ 
        message: "Diagnostic check error", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Worker management routes
  app.get("/api/workers", async (_req, res) => {
    try {
      const workers = await storage.getWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get workers", error });
    }
  });

  app.get("/api/workers/active", async (_req, res) => {
    try {
      const workers = await storage.getActiveWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get active workers", error });
    }
  });

  app.get("/api/workers/:id", async (req, res) => {
    try {
      const worker = await storage.getWorker(req.params.id);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      res.json(worker);
    } catch (error) {
      res.status(500).json({ message: "Failed to get worker", error });
    }
  });

  app.post("/api/workers", async (req, res) => {
    try {
      const workerData = insertWorkerSchema.parse(req.body);
      const worker = await storage.createWorker(workerData);
      res.json(worker);
    } catch (error) {
      res.status(400).json({ message: "Invalid worker data", error });
    }
  });

  app.put("/api/workers/:id", async (req, res) => {
    try {
      const updates = insertWorkerSchema.partial().parse(req.body);
      const worker = await storage.updateWorker(req.params.id, updates);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      res.json(worker);
    } catch (error) {
      res.status(400).json({ message: "Failed to update worker", error });
    }
  });

  app.delete("/api/workers/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteWorker(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Worker not found" });
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker", error });
    }
  });

  app.post("/api/workers/:id/generate-qr", async (req, res) => {
    try {
      const worker = await storage.getWorker(req.params.id);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }

      // SIMPLIFIED QR CODE: Just encode the worker code (numeric ID)
      // Database lookup will retrieve worker details
      const qrData = worker.workerCode;

      // Generate QR code as PNG with higher error correction for simpler, larger modules
      const qrCodeBuffer = await QRCode.toBuffer(qrData, {
        errorCorrectionLevel: 'L', // Low error correction = larger modules = easier scanning
        margin: 1,
        width: 300,
        type: 'png',
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Convert to base64
      const qrCodeBase64 = qrCodeBuffer.toString('base64');

      // Store simple payload for reference
      const payload = { id: worker.workerCode, type: 'worker' };
      await storage.updateWorker(worker.id, { qrPayload: payload });

      res.json({
        ok: true,
        payload,
        qrCode: qrCodeBase64,
        dimensions: { width: 300, height: 300 }
      });

    } catch (error) {
      res.status(500).json({ message: "QR generation error", error });
    }
  });

  // Capture runs history route
  app.get("/api/capture-runs", async (req, res) => {
    try {
      // Validate and sanitize limit parameter
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 500); // Between 1-500
      const runs = await storage.getCaptureRuns(limit);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get capture runs", error });
    }
  });

  // Worker checkout report route - shows which worker has which tool at a specific time
  app.get("/api/reports/checkouts", async (req, res) => {
    try {
      // Validate timestamp if provided
      let timestamp = new Date();
      if (req.query.timestamp) {
        timestamp = new Date(req.query.timestamp as string);
        if (isNaN(timestamp.getTime())) {
          return res.status(400).json({ message: "Invalid timestamp format. Use ISO 8601 format" });
        }
      }
      const slots = await storage.getSlots();
      const checkouts = [];

      for (const slot of slots) {
        // Get the most recent detection log for this slot at or before the timestamp
        const latestLog = await storage.getLatestDetectionLogBySlotBeforeTime(slot.id, timestamp);
        
        if (latestLog && latestLog.status === 'CHECKED_OUT' && latestLog.workerId) {
          const worker = await storage.getWorker(latestLog.workerId);
          
          if (worker) {
            checkouts.push({
              slotId: slot.slotId,
              toolName: slot.toolName,
              workerId: worker.id,
              workerCode: worker.workerCode,
              workerName: worker.name,
              department: worker.department,
              checkedOutAt: latestLog.timestamp,
              qrId: latestLog.qrId,
            });
          }
        }
      }

      res.json({
        ok: true,
        timestamp: timestamp.toISOString(),
        totalCheckouts: checkouts.length,
        checkouts,
      });

    } catch (error) {
      res.status(500).json({ message: "Failed to generate checkout report", error });
    }
  });

  // GPIO Light Control route (for testing)
  app.post("/api/gpio/light", async (req, res) => {
    try {
      const { action } = req.body;
      
      if (!action || !['on', 'off'].includes(action)) {
        return res.status(400).json({ message: "Invalid action. Use 'on' or 'off'" });
      }

      // Get light strip GPIO pin from config
      const lightStripConfig = await storage.getConfigByKey('light_strip_gpio_pin');
      if (!lightStripConfig) {
        return res.status(400).json({ message: "Light strip GPIO pin not configured" });
      }

      const pin = parseInt(lightStripConfig.value as string);

      // Call Python GPIO controller with sudo (required for WS2812B /dev/mem access)
      const pythonProcess = spawn('sudo', [
        'python3',
        path.join(process.cwd(), 'python/gpio_controller.py'),
        '--pin', pin.toString(),
        '--action', action
      ]);

      let result = '';
      let error = '';
      let responseSent = false;

      pythonProcess.on('error', (err) => {
        if (!responseSent) {
          responseSent = true;
          res.status(503).json({ 
            message: "GPIO control not available", 
            error: err.message 
          });
        }
      });

      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (responseSent) return;
        responseSent = true;

        if (code === 0) {
          try {
            const gpioResult = JSON.parse(result);
            res.json({
              ok: true,
              ...gpioResult,
              message: `Light ${action === 'on' ? 'turned on' : 'turned off'} successfully`
            });
          } catch (e) {
            res.status(500).json({ 
              message: "Failed to parse GPIO response", 
              error: result 
            });
          }
        } else {
          res.status(500).json({ 
            message: "GPIO control failed", 
            error 
          });
        }
      });

    } catch (error) {
      res.status(500).json({ 
        message: "Light control error", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Alert LED Control routes
  app.post("/api/alert-led/flash", async (req, res) => {
    try {
      const { pattern, duration } = req.body;
      const alertLED = getAlertLEDController(storage);
      
      let success = false;
      if (duration) {
        success = await alertLED.flashFor(parseInt(duration), pattern || 'fast');
      } else {
        success = await alertLED.startFlash(pattern || 'fast');
      }
      
      if (success) {
        res.json({
          ok: true,
          message: duration 
            ? `Alert LED flashing for ${duration}s`
            : 'Alert LED started flashing'
        });
      } else {
        res.status(500).json({
          ok: false,
          message: 'Failed to start alert LED'
        });
      }
    } catch (error) {
      res.status(500).json({
        message: 'Alert LED control error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/alert-led/stop", async (_req, res) => {
    try {
      const alertLED = getAlertLEDController(storage);
      const success = await alertLED.stopFlash();
      
      if (success) {
        res.json({
          ok: true,
          message: 'Alert LED stopped'
        });
      } else {
        res.status(500).json({
          ok: false,
          message: 'Failed to stop alert LED'
        });
      }
    } catch (error) {
      res.status(500).json({
        message: 'Alert LED control error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/alert-led/test", async (_req, res) => {
    try {
      const alertLED = getAlertLEDController(storage);
      const success = await alertLED.flashFor(5, 'fast'); // Flash for 5 seconds
      
      if (success) {
        res.json({
          ok: true,
          message: 'Alert LED test completed'
        });
      } else {
        res.status(500).json({
          ok: false,
          message: 'Failed to test alert LED'
        });
      }
    } catch (error) {
      res.status(500).json({
        message: 'Alert LED test error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Analytics routes
  app.get("/api/analytics/summary", async (_req, res) => {
    try {
      const slots = await storage.getSlots();
      const recentLogs = await storage.getDetectionLogs(1000); // Last 1000 logs

      // Calculate summary statistics
      const totalSlots = slots.length;
      const activeSlots = slots.filter(s => s.isActive).length;
      
      // Get latest status for each slot
      const slotStatuses = new Map();
      for (const log of recentLogs) {
        if (!slotStatuses.has(log.slotId)) {
          slotStatuses.set(log.slotId, log.status);
        }
      }

      const statusCounts = {
        present: 0,
        empty: 0,
        checkedOut: 0,
        occupied: 0,
        error: 0
      };

      for (const status of Array.from(slotStatuses.values())) {
        switch (status) {
          case 'ITEM_PRESENT':
            statusCounts.present++;
            break;
          case 'EMPTY':
            statusCounts.empty++;
            break;
          case 'CHECKED_OUT':
            statusCounts.checkedOut++;
            break;
          case 'TRAINING_ERROR':
            statusCounts.error++;
            break;
          default:
            statusCounts.occupied++;
        }
      }

      const pendingAlerts = await storage.getPendingAlerts();
      const failedAlerts = await storage.getFailedAlerts();

      res.json({
        totalSlots,
        activeSlots,
        statusCounts,
        alertCounts: {
          pending: pendingAlerts.length,
          failed: failedAlerts.length,
          active: pendingAlerts.filter(a => a.status === 'pending').length
        },
        lastUpdate: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch analytics summary", error });
    }
  });

  // Camera device detection endpoint
  app.get("/api/cameras/detect", async (_req, res) => {
    try {
      const pythonScript = path.join(process.cwd(), 'python', 'detect_cameras.py');
      const args = [pythonScript, '--max-index', '10'];

      const result = await new Promise<any>((resolve, reject) => {
        const childProcess = spawn('python3', args, {
          env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';
        let isResolved = false;

        // Timeout after 30 seconds to prevent hanging
        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            childProcess.kill();
            reject(new Error('Camera detection timed out after 30 seconds'));
          }
        }, 30000);

        childProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        childProcess.on('close', (code) => {
          clearTimeout(timeout);
          if (isResolved) return;
          isResolved = true;

          if (code !== 0) {
            console.error('Camera detection error:', stderr);
            reject(new Error(stderr || 'Camera detection failed'));
          } else {
            try {
              const result = JSON.parse(stdout);
              resolve(result);
            } catch (e) {
              reject(new Error('Failed to parse camera detection output'));
            }
          }
        });

        childProcess.on('error', (error) => {
          clearTimeout(timeout);
          if (isResolved) return;
          isResolved = true;
          reject(error);
        });
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to detect cameras',
        cameras: []
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
