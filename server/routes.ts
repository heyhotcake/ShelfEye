import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { CaptureScheduler } from "./scheduler";
import { sendTestAlert } from "./services/email-alerts";
import { getAlertLEDController } from "./services/alert-led";
import { startupCalibrationService } from "./services/startup-calibration";
import { cameraSessionManager } from "./camera-session-manager";
import { maintenanceService } from "./services/maintenance-service";
import { piSimulationService } from "./services/pi-simulation-service";
import { subprocessManager, spawnTracked } from "./subprocess-manager";
import multer from "multer";
import { spawn, exec } from "child_process";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import QRCode from "qrcode";
import crypto from "crypto";
import { z } from "zod";
import { insertCameraSchema, insertSlotSchema, insertDetectionLogSchema, insertAlertRuleSchema, insertToolCategorySchema, insertTemplateRectangleSchema, insertWorkerSchema, insertCaptureRunSchema } from "@shared/schema";
import { setWhiteLight, turnOffLED } from "./utils/led-control";

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

// Server-side boundary validation (mirrors client/src/lib/templateBounds.ts)
interface RectangleServer {
  xCm: number;
  yCm: number;
  widthCm: number;
  heightCm: number;
}

interface BoundaryViolationServer {
  edge: 'left' | 'right' | 'top' | 'bottom';
  amount: number;
}

function getMultiPageSafeBoundsServer(cols: number, rows: number): { minX: number; maxX: number; minY: number; maxY: number }[] {
  const a4WidthCm = 29.7;
  const a4HeightCm = 21.0;
  const safeMarginCm = 1.0;
  
  const sheetBounds = [];
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sheetOffsetX = col * a4WidthCm;
      const sheetOffsetY = row * a4HeightCm;
      
      sheetBounds.push({
        minX: sheetOffsetX + safeMarginCm,
        maxX: sheetOffsetX + a4WidthCm - safeMarginCm,
        minY: sheetOffsetY + safeMarginCm,
        maxY: sheetOffsetY + a4HeightCm - safeMarginCm,
      });
    }
  }
  
  return sheetBounds;
}

function get6PageSafeBoundsServer(): { minX: number; maxX: number; minY: number; maxY: number }[] {
  return getMultiPageSafeBoundsServer(3, 2);
}

function checkBoundaryViolationsServer(rect: RectangleServer, paperSize: string): BoundaryViolationServer[] {
  const violations: BoundaryViolationServer[] = [];
  
  const halfWidth = rect.widthCm / 2;
  const halfHeight = rect.heightCm / 2;
  
  const leftEdge = rect.xCm - halfWidth;
  const rightEdge = rect.xCm + halfWidth;
  const topEdge = rect.yCm - halfHeight;
  const bottomEdge = rect.yCm + halfHeight;
  
  if (paperSize === '6-page-3x2' || paperSize === '8-page-4x2') {
    const sheetSafeBounds = paperSize === '8-page-4x2'
      ? getMultiPageSafeBoundsServer(4, 2)
      : get6PageSafeBoundsServer();
    
    let fitsInAnySheet = false;
    for (const sheet of sheetSafeBounds) {
      if (leftEdge >= sheet.minX && rightEdge <= sheet.maxX &&
          topEdge >= sheet.minY && bottomEdge <= sheet.maxY) {
        fitsInAnySheet = true;
        break;
      }
    }
    
    if (!fitsInAnySheet) {
      const col = Math.floor(rect.xCm / 29.7);
      const row = Math.floor(rect.yCm / 21.0);
      const totalCols = paperSize === '8-page-4x2' ? 4 : 3;
      const maxIndex = paperSize === '8-page-4x2' ? 7 : 5;
      const sheetIndex = Math.min(Math.max(row * totalCols + col, 0), maxIndex);
      const sheet = sheetSafeBounds[sheetIndex];
      
      if (leftEdge < sheet.minX) violations.push({ edge: 'left', amount: sheet.minX - leftEdge });
      if (rightEdge > sheet.maxX) violations.push({ edge: 'right', amount: rightEdge - sheet.maxX });
      if (topEdge < sheet.minY) violations.push({ edge: 'top', amount: sheet.minY - topEdge });
      if (bottomEdge > sheet.maxY) violations.push({ edge: 'bottom', amount: bottomEdge - sheet.maxY });
    }
  } else {
    const safeMarginCm = 1.0;
    const paperBounds: Record<string, { widthCm: number; heightCm: number }> = {
      'A5-landscape': { widthCm: 21.0, heightCm: 14.8 },
      'A4-landscape': { widthCm: 29.7, heightCm: 21.0 },
      'A3-landscape': { widthCm: 42.0, heightCm: 29.7 },
      '2xA5-landscape': { widthCm: 42.0, heightCm: 14.8 },
      '3xA5-landscape': { widthCm: 63.0, heightCm: 14.8 },
      '8-page-4x2': { widthCm: 118.8, heightCm: 42.0 },
    };
    
    const bounds = paperBounds[paperSize];
    if (bounds) {
      const minX = safeMarginCm;
      const maxX = bounds.widthCm - safeMarginCm;
      const minY = safeMarginCm;
      const maxY = bounds.heightCm - safeMarginCm;
      
      if (leftEdge < minX) violations.push({ edge: 'left', amount: minX - leftEdge });
      if (rightEdge > maxX) violations.push({ edge: 'right', amount: rightEdge - maxX });
      if (topEdge < minY) violations.push({ edge: 'top', amount: minY - topEdge });
      if (bottomEdge > maxY) violations.push({ edge: 'bottom', amount: bottomEdge - maxY });
    }
  }
  
  return violations;
}

function clampToBoundsServer(rect: RectangleServer, paperSize: string): { xCm: number; yCm: number } {
  const halfWidth = rect.widthCm / 2;
  const halfHeight = rect.heightCm / 2;
  
  if (paperSize === '6-page-3x2' || paperSize === '8-page-4x2') {
    const sheetSafeBounds = paperSize === '8-page-4x2'
      ? getMultiPageSafeBoundsServer(4, 2)
      : get6PageSafeBoundsServer();
    
    const col = Math.floor(rect.xCm / 29.7);
    const row = Math.floor(rect.yCm / 21.0);
    const totalCols = paperSize === '8-page-4x2' ? 4 : 3;
    const maxIndex = paperSize === '8-page-4x2' ? 7 : 5;
    const sheetIndex = Math.min(Math.max(row * totalCols + col, 0), maxIndex);
    const sheet = sheetSafeBounds[sheetIndex];
    
    const minX = sheet.minX + halfWidth;
    const maxX = sheet.maxX - halfWidth;
    const minY = sheet.minY + halfHeight;
    const maxY = sheet.maxY - halfHeight;
    
    return {
      xCm: Math.max(minX, Math.min(maxX, rect.xCm)),
      yCm: Math.max(minY, Math.min(maxY, rect.yCm)),
    };
  } else {
    const safeMarginCm = 1.0;
    const paperBounds: Record<string, { widthCm: number; heightCm: number }> = {
      'A5-landscape': { widthCm: 21.0, heightCm: 14.8 },
      'A4-landscape': { widthCm: 29.7, heightCm: 21.0 },
      'A3-landscape': { widthCm: 42.0, heightCm: 29.7 },
      '2xA5-landscape': { widthCm: 42.0, heightCm: 14.8 },
      '3xA5-landscape': { widthCm: 63.0, heightCm: 14.8 },
      '8-page-4x2': { widthCm: 118.8, heightCm: 42.0 },
    };
    
    const bounds = paperBounds[paperSize];
    if (!bounds) return { xCm: rect.xCm, yCm: rect.yCm };
    
    const minX = safeMarginCm + halfWidth;
    const maxX = bounds.widthCm - safeMarginCm - halfWidth;
    const minY = safeMarginCm + halfHeight;
    const maxY = bounds.heightCm - safeMarginCm - halfHeight;
    
    return {
      xCm: Math.max(minX, Math.min(maxX, rect.xCm)),
      yCm: Math.max(minY, Math.min(maxY, rect.yCm)),
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  scheduler = new CaptureScheduler(storage);
  await scheduler.initialize();
  
  // Register shutdown handlers for graceful cleanup
  const gracefulShutdown = async (signal: string) => {
    console.log(`[Server] Received ${signal} - gracefully shutting down scheduler...`);
    scheduler.shutdown();
  };
  
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Run startup calibration
  await startupCalibrationService.initialize();
  // Health check with detailed system metrics
  app.get("/api/health", async (_req, res) => {
    try {
      const uptime = process.uptime();
      const memUsage = process.memoryUsage();
      
      res.json({
        ok: true,
        time: new Date().toISOString(),
        version: "2.1.0",
        uptime: {
          seconds: Math.floor(uptime),
          hours: Math.floor(uptime / 3600),
          days: Math.floor(uptime / 86400)
        },
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024), // MB
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memUsage.external / 1024 / 1024) // MB
        },
        process: {
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Health check failed", error });
    }
  });

  // Maintenance routes
  app.get("/api/maintenance/stats", async (_req, res) => {
    try {
      const stats = await maintenanceService.getMaintenanceStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch maintenance stats", error });
    }
  });

  app.post("/api/maintenance/run", async (_req, res) => {
    try {
      await maintenanceService.runDailyMaintenance(scheduler.getAlertQueue());
      res.json({ message: "Maintenance completed successfully" });
    } catch (error) {
      res.status(500).json({ message: "Maintenance failed", error });
    }
  });

  app.get("/api/maintenance/disk-usage", async (_req, res) => {
    try {
      const diskCheck = await maintenanceService.checkDiskSpace(scheduler.getAlertQueue());
      res.json(diskCheck);
    } catch (error) {
      res.status(500).json({ message: "Failed to check disk usage", error });
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

  // Check camera capabilities (supported resolutions)
  app.get("/api/cameras/:cameraId/capabilities", async (req, res) => {
    try {
      const { cameraId } = req.params;
      const camera = await storage.getCamera(cameraId);
      
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      
      const cameraIndex = camera.deviceIndex || 0;
      const pythonProcess = spawnTracked(
        'python3',
        [path.join(process.cwd(), 'python/check_camera_capabilities.py'), '--camera', cameraIndex.toString()],
        'check_camera_capabilities.py',
        'python',
        `Check capabilities: ${camera.name}`
      );
      
      let output = '';
      let error = '';
      
      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          res.json({ ok: true, output, cameraName: camera.name });
        } else {
          res.status(500).json({ 
            ok: false, 
            message: "Failed to check camera capabilities", 
            error: error || output 
          });
        }
      });
      
    } catch (error) {
      res.status(500).json({ message: "Failed to check camera capabilities", error });
    }
  });

  // Download high-resolution rectified image
  app.get("/api/calibrate/download-rectified/:cameraId", async (req, res) => {
    try {
      const { cameraId } = req.params;
      // Use the labeled version for download (clean version is only for ArUco marker validation)
      const rectifiedPath = path.join(process.cwd(), 'data', `latest_calibration_rectified_labeled_${cameraId}.png`);
      
      // Check if file exists
      try {
        await fs.access(rectifiedPath);
      } catch {
        return res.status(404).json({ message: "Rectified image not found. Run calibration first." });
      }
      
      // Send file for download
      res.download(rectifiedPath, `calibration_rectified_${cameraId}.png`, (err) => {
        if (err) {
          console.error('[Calibration] Error downloading rectified image:', err);
          if (!res.headersSent) {
            res.status(500).json({ message: "Failed to download rectified image" });
          }
        }
      });
    } catch (error) {
      console.error('[Calibration] Download error:', error);
      res.status(500).json({ message: "Failed to download rectified image", error });
    }
  });

  // Download validation debug image
  app.get("/api/calibrate/download-debug/:cameraId", async (req, res) => {
    try {
      const { cameraId } = req.params;
      const debugPath = path.join(process.cwd(), 'data', `validation_rectified_debug_${cameraId}.png`);
      
      // Check if file exists
      try {
        await fs.access(debugPath);
      } catch {
        return res.status(404).json({ message: "Debug image not found. Run ArUco marker validation first." });
      }
      
      // Send file for download
      res.download(debugPath, `validation_debug_${cameraId}.png`, (err) => {
        if (err) {
          console.error('[Validation] Error downloading debug image:', err);
          if (!res.headersSent) {
            res.status(500).json({ message: "Failed to download debug image" });
          }
        }
      });
    } catch (error) {
      console.error('[Validation] Download error:', error);
      res.status(500).json({ message: "Failed to download debug image", error });
    }
  });

  // Calibration routes
  app.post("/api/calibrate/:cameraId", async (req, res) => {
    const { cameraId } = req.params;
    let lockAcquired = false;
    
    try {
      const { paperSize, templateTimestamp } = req.body; // Expected: paperSize: "6-page-3x2", templateTimestamp: ISO string
      
      // Get camera info first
      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      
      // Check global calibration lock - ensures only ONE camera calibrates at a time (2GB RAM constraint)
      const globalLockStatus = cameraSessionManager.isAnyCalibrationInProgress();
      if (globalLockStatus.inProgress && globalLockStatus.cameraId !== cameraId) {
        console.log(`[Calibration] Another camera (${globalLockStatus.cameraId}) is already calibrating - rejecting request for camera ${cameraId}`);
        return res.status(409).json({ 
          message: `Another camera (${globalLockStatus.cameraId}) is currently calibrating. Please wait for it to complete.`,
          conflictingCamera: globalLockStatus.cameraId 
        });
      }
      
      // Acquire global calibration lock FIRST
      if (!cameraSessionManager.acquireGlobalCalibrationLock(cameraId)) {
        console.log(`[Calibration] Failed to acquire global calibration lock for camera ${cameraId}`);
        return res.status(409).json({ 
          message: "Another camera is calibrating. Please try again.",
          error: "Global calibration lock unavailable"
        });
      }
      
      // CRITICAL FIX: Acquire camera-specific lock AFTER global lock
      // This blocks frontend from spawning new preview processes during calibration
      console.log('[Calibration] Acquiring exclusive camera lock to prevent preview race condition...');
      await cameraSessionManager.acquireExclusiveLock(cameraId);
      lockAcquired = true;
      console.log('[Calibration] Both global and camera-specific locks acquired. No new operations can interfere.');
      
      // Now kill any existing Python processes that might be holding the camera
      // The lock prevents new ones from spawning during cleanup
      // INCREASED WAIT: Preview requests can take 20-30 seconds, so we wait longer
      console.log('[Calibration] Waiting 25 seconds for any in-flight preview requests to complete...');
      await new Promise(resolve => setTimeout(resolve, 25000));
      console.log('[Calibration] Wait complete. Now killing any stuck camera processes...');
      
      try {
        const killPromises = [
          new Promise((resolve) => {
            exec('pkill -9 -f "aruco_calibrator.py" || true', () => resolve(null));
          }),
          new Promise((resolve) => {
            exec('pkill -9 -f "camera_preview.py" || true', () => resolve(null));
          }),
          new Promise((resolve) => {
            exec('pkill -9 -f "validate_slot_qrs.py" || true', () => resolve(null));
          }),
          new Promise((resolve) => {
            exec('pkill -9 -f "rectified_preview.py" || true', () => resolve(null));
          }),
          new Promise((resolve) => {
            const devicePath = camera.devicePath || '/dev/video0';
            exec(`fuser -k ${devicePath} 2>/dev/null || true`, () => resolve(null));
          }),
          new Promise((resolve) => {
            exec('fuser -k /dev/video0 /dev/video1 /dev/video2 2>/dev/null || true', () => resolve(null));
          })
        ];
        await Promise.all(killPromises);
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('[Calibration] Killed existing camera processes, waited 3s for device release');
      } catch (e) {
        console.error('[Calibration] Error killing stuck processes:', e);
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

      // Turn on LED light for consistent illumination during calibration (unified controller)
      // Kill stuck LED processes first to ensure clean state (prevents issues when calibrating after alert)
      console.log('[Calibration] Turning on white LED light (killing stuck processes first)...');
      const ledResult = await setWhiteLight(true);
      console.log('[Calibration] LED white light result:', ledResult);
      
      // Small delay to ensure LED process completes and releases stdout
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get template rectangles with category dimensions for preview overlay
      // Templates are camera-independent and filtered by paper size only
      // User explicitly selects template in UI, no timestamp filtering needed
      const templateRectanglesForPreview = await storage.getTemplateRectanglesByPaperSize(paperSizeFormat);
      const templatesWithDimensions = [];
      
      console.log(`[Calibration] Found ${templateRectanglesForPreview.length} templates matching paper size: ${paperSizeFormat}`);
      
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
        } else {
          console.warn(`[Calibration] Template ${template.id} has missing category ${template.categoryId}`);
        }
      }
      
      console.log(`[Calibration] Built ${templatesWithDimensions.length} templates with dimensions for preview overlay`);

      // Call Python calibration script with paper size and preview generation
      // Calculate preview output size maintaining correct aspect ratio
      // INCREASED from 10 to 30 px/cm for much sharper rectified preview images
      // (Calibration captures at 4K, but rectified preview needs higher resolution for visual clarity)
      const previewScale = 30; // 30 px/cm for preview (vs native ~31.8 px/cm for validation)
      const previewWidth = Math.round(paperDims.widthCm * previewScale);
      const previewHeight = Math.round(paperDims.heightCm * previewScale);
      console.log(`[Calibration] Preview output size: ${previewWidth}x${previewHeight} px (maintains ${(paperDims.widthCm/paperDims.heightCm).toFixed(2)}:1 aspect ratio)`);
      
      const deviceSource = getCameraDeviceSource(camera);
      const calibrationArgs = [
        path.join(process.cwd(), 'python/aruco_calibrator.py'),
        '--camera-id', cameraId,
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--paper-size', `${paperDims.widthCm}x${paperDims.heightCm}`,
        '--generate-preview',
        '--preview-output-size', `${previewWidth}x${previewHeight}`,
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
      
      const pythonProcess = spawnTracked(
        'python3',
        calibrationArgs,
        'aruco_calibrator.py',
        'python',
        `Calibration: ${camera.name}`
      );

      let result = '';
      let error = '';
      let responseSent = false;

      pythonProcess.on('error', async (err) => {
        if (!responseSent) {
          responseSent = true;
          if (lockAcquired) cameraSessionManager.releaseLock(cameraId);
          cameraSessionManager.releaseGlobalCalibrationLock(cameraId); // Release global lock
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
        const errStr = data.toString();
        console.error(`[Validation] Python stderr: ${errStr}`);
        error += errStr;
        
        // Turn off LED immediately after frame capture completes (~30s)
        if (errStr.includes('[LED_OFF_SIGNAL]')) {
          console.log('[Validation] Frame capture complete - turning off LED');
          turnOffLED().catch(err => console.error('[Validation] LED turnoff error:', err));
        }
      });

      pythonProcess.on('close', async (code) => {
        if (responseSent) return;
        
        try {
          if (code === 0) {
            try {
              console.log(`[Calibration] Received ${result.length} bytes of JSON from Python`);
              console.log(`[Calibration] First 200 chars: ${result.substring(0, 200)}`);
              console.log(`[Calibration] Last 200 chars: ${result.substring(result.length - 200)}`);
              
              const calibrationData = JSON.parse(result);
              console.log(`[Calibration] JSON parsed successfully`);
              console.log(`[Calibration] Has rectified_preview field: ${!!calibrationData.rectified_preview}`);
              if (calibrationData.rectified_preview) {
                console.log(`[Calibration] Preview field length: ${calibrationData.rectified_preview.length} chars`);
              }
              
              const homographyMatrix = calibrationData.homography_matrix;
              const cameraMatrix = calibrationData.camera_matrix || null;
              const distCoeffs = calibrationData.dist_coeffs || null;
              
              // Update camera with calibration data AND paperSize
              // This ensures camera remembers its template choice across reboots
              await storage.updateCamera(cameraId, {
                homographyMatrix: homographyMatrix,
                cameraMatrix: cameraMatrix,
                distCoeffs: distCoeffs,
                calibrationTimestamp: new Date(),
                paperSize: paperSizeFormat, // Persist template choice to camera record
              });

              // Delete existing slots for this camera to avoid duplicates
              const existingSlots = await storage.getSlotsByCamera(cameraId);
              for (const slot of existingSlots) {
                // First delete all detection logs for this slot to avoid foreign key constraint
                await storage.deleteDetectionLogsBySlotId(slot.id);
                await storage.deleteSlot(slot.id);
              }
              console.log(`[Calibration] Deleted ${existingSlots.length} existing slots`);

              // Get CAMERA-SPECIFIC template rectangles (with fallback to shared templates)
              // This ensures each camera uses its own adjusted coordinates
              const templateRectangles = await storage.getTemplateRectanglesByPaperSizeAndCamera(paperSizeFormat, cameraId);
              const createdSlots: any[] = [];
              
              console.log(`[Calibration] Creating slots for ${templateRectangles.length} camera-specific templates (paper size: ${paperSizeFormat}, camera: ${cameraId})`);

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

                  // Create camera-specific slotId to prevent conflicts between cameras
                  // Format: "cam1_slot1", "cam2_slot1", etc.
                  const cameraShortId = camera.name.replace(/\s+/g, '').toLowerCase().slice(0, 4);
                  const cameraSpecificSlotId = `${cameraShortId}_${template.autoQrId || template.id.slice(0, 4)}`;
                  
                  const slot = await storage.createSlot({
                    slotId: cameraSpecificSlotId,
                    cameraId: cameraId,
                    toolName: category.name,
                    expectedQrId: template.autoQrId || `${category.name}_${template.id.slice(0, 4)}`,
                    priority: 'high',
                    regionCoords: pixelCoords,
                    xCm: template.xCm,
                    yCm: template.yCm,
                    widthCm: category.widthCm,
                    heightCm: category.heightCm,
                    rotationDeg: template.rotation,
                    allowCheckout: true,
                    graceWindow: '08:00-17:00',
                  });

                  // Update template rectangle with slot ID, QR code, and camera ID
                  // This makes the coordinates camera-specific from first calibration
                  await storage.updateTemplateRectangle(template.id, {
                    slotId: slot.id,
                    autoQrId: slot.slotNumber.toString(), // Use simplified slot number for QR codes
                    cameraId: cameraId, // Mark these coordinates as camera-specific
                  });

                  createdSlots.push(slot);
                } catch (slotError) {
                  console.warn(`Failed to create slot for template ${template.id}:`, slotError);
                }
              }

              // Save paper size format immediately after ArUco calibration succeeds
              // This ensures it's available for validation steps 2 and 3
              await storage.setConfig('last_calibration_paper_size_format', paperSizeFormat, 'Last calibration paper size format (e.g., 6-page-3x2)');
              console.log('[Calibration] Saved paper size format to config:', paperSizeFormat);

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
              
              // CRITICAL: Include slot validation results for smart calibration flow
              // This allows frontend to auto-advance to Step 2 when all slots detected
              if (calibrationData.slot_validation) {
                response.slot_validation = calibrationData.slot_validation;
                console.log(`[Calibration] Including slot validation in response: ${calibrationData.slot_validation.valid_count}/${calibrationData.slot_validation.total_count} markers detected`);
              }

              res.json(response);
            } catch (parseError) {
              res.status(500).json({ message: "Failed to parse calibration result", error: parseError });
            }
          } else {
            res.status(500).json({ message: "Calibration failed", error });
          }
        } finally {
          // Always release locks when calibration completes
          if (lockAcquired) {
            cameraSessionManager.releaseLock(cameraId);
            lockAcquired = false;
          }
          cameraSessionManager.releaseGlobalCalibrationLock(cameraId); // Release global lock
          
          // Turn off LED light after calibration
          turnOffLED().catch(err => console.error('[Calibration] LED turnoff error:', err));
        }
      });

    } catch (error) {
      // Release locks on error
      if (lockAcquired) {
        cameraSessionManager.releaseLock(cameraId);
      }
      cameraSessionManager.releaseGlobalCalibrationLock(cameraId); // Release global lock
      // Turn off LED on unexpected errors
      await turnOffLED();
      res.status(500).json({ message: "Calibration error", error });
    }
  });

  // Verify adjusted template positions by regenerating rectified preview
  app.post("/api/calibrate/:cameraId/verify-positions", async (req, res) => {
    const { cameraId } = req.params;
    let lockAcquired = false;
    
    try {
      const { adjustedTemplates, paperSize } = req.body;
      
      // Validate adjusted templates payload
      if (!adjustedTemplates || !Array.isArray(adjustedTemplates) || adjustedTemplates.length === 0) {
        return res.status(400).json({ message: "Invalid adjusted templates: must be a non-empty array" });
      }
      
      // Validate each template has required numeric fields
      for (const template of adjustedTemplates) {
        if (typeof template.xCm !== 'number' || typeof template.yCm !== 'number' || 
            typeof template.widthCm !== 'number' || typeof template.heightCm !== 'number') {
          return res.status(400).json({ 
            message: "Invalid template data: xCm, yCm, widthCm, and heightCm must be numbers" 
          });
        }
      }
      
      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      
      if (!camera.homographyMatrix || !Array.isArray(camera.homographyMatrix) || camera.homographyMatrix.length !== 9) {
        console.error('[VerifyPositions] Invalid homography matrix:', camera.homographyMatrix);
        return res.status(400).json({ message: "Camera not calibrated or homography matrix is invalid. Run ArUco calibration first." });
      }
      
      // Get paper dimensions from format
      const { getPaperDimensions } = await import('./utils/paper-size.js');
      const paperSizeFormat = paperSize || 'A4-landscape';
      const paperDims = getPaperDimensions(paperSizeFormat);
      
      // Convert adjusted templates to Python format
      const templatesForPython = adjustedTemplates.map((t: any) => ({
        x: t.xCm,
        y: t.yCm,
        width: t.widthCm,
        height: t.heightCm,
        rotation: t.rotation || 0,
        categoryName: t.categoryName || t.autoQrId || 'Tool'
      }));
      
      if (!camera.homographyMatrix || !Array.isArray(camera.homographyMatrix) || camera.homographyMatrix.length !== 9) {
        console.error('[VerifyPositions] Invalid homography matrix:', camera.homographyMatrix);
        return res.status(400).json({ 
          message: "Camera homography matrix is invalid or missing. The homography matrix should have exactly 9 elements.",
          details: { 
            hasMatrix: !!camera.homographyMatrix,
            isArray: Array.isArray(camera.homographyMatrix),
            length: camera.homographyMatrix?.length || 0
          }
        });
      }
      
      const homographyString = camera.homographyMatrix.join(',');
      console.log('[VerifyPositions] Camera info:', {
        deviceIndex: camera.deviceIndex,
        devicePath: camera.devicePath,
        resolution: camera.resolution,
        homographyLength: camera.homographyMatrix.length,
        homographyString: homographyString.substring(0, 50) + '...'
      });
      
      console.log('[VerifyPositions] Adjusted templates:', JSON.stringify(adjustedTemplates, null, 2));
      
      // CRITICAL: Acquire camera lock to prevent race condition with preview polling
      console.log('[VerifyPositions] Acquiring exclusive camera lock...');
      await cameraSessionManager.acquireExclusiveLock(cameraId);
      lockAcquired = true;
      
      // Wait for in-flight preview requests to complete (they can take 20-30 seconds)
      console.log('[VerifyPositions] Waiting 25 seconds for in-flight previews to complete...');
      await new Promise(resolve => setTimeout(resolve, 25000));
      console.log('[VerifyPositions] Wait complete. Lock acquired.');
      
      // Let Python calculate output size from measured pixel density (~100 px/cm for 4K)
      // Python aruco_calibrator measured the actual pixel density from marker spacing
      console.log(`[VerifyPositions] Using measured pixel density from ArUco calibration (no output-size override)`);
      
      // Generate clean preview WITHOUT templates - frontend RectifiedPreviewCanvas will draw adjustable overlays
      // This prevents dual overlays (Python-drawn + canvas-drawn) that make fine adjustments difficult
      console.log(`[VerifyPositions] Generating clean preview without template overlays for precise adjustments`);
      
      // IMPORTANT: Homography string may start with negative numbers (e.g., "-18.706...")
      // which argparse would interpret as a flag. Use --key=value syntax to avoid this.
      const previewArgs = [
        path.join(process.cwd(), 'python', 'rectified_preview.py'),
        `--resolution=${camera.resolution[0]}x${camera.resolution[1]}`,
        `--homography=${homographyString}`,  // Use --key=value syntax for negative numbers
        // NO --output-size parameter - let Python use measured pixel density
        // NO --templates parameter - frontend canvas will draw adjustable overlays
        `--paper-size=${paperDims.widthCm}x${paperDims.heightCm}`,
      ];
      
      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        previewArgs.push(`--device-path=${camera.devicePath}`);
        console.log(`[VerifyPositions] Using device path: ${camera.devicePath}`);
      } else {
        previewArgs.push(`--camera=${camera.deviceIndex?.toString() || '0'}`);
        console.log(`[VerifyPositions] Using camera index: ${camera.deviceIndex || 0}`);
      }
      
      if (camera.cameraMatrix) {
        previewArgs.push(`--camera-matrix=${camera.cameraMatrix.join(',')}`);
      }
      
      if (camera.distCoeffs) {
        previewArgs.push(`--dist-coeffs=${camera.distCoeffs.join(',')}`);
      }
      
      console.log('[VerifyPositions] Python args:', previewArgs.join(' '));
      
      console.log('[VerifyPositions] Generating rectified preview with adjusted templates...');
      const pythonProcess = spawnTracked(
        'python3',
        previewArgs,
        'rectified_preview.py',
        'python',
        `Verify positions preview: ${camera.name}`
      );
      
      let result = '';
      let error = '';
      
      pythonProcess.stdout.on('data', (data) => {
        result += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        console.error('[VerifyPositions] Python stderr:', stderrText);
        error += stderrText;
      });
      
      pythonProcess.on('close', (code) => {
        console.log(`[VerifyPositions] Python process exited with code ${code}`);
        
        // Release camera lock when Python process completes
        if (lockAcquired) {
          cameraSessionManager.releaseLock(cameraId);
          lockAcquired = false;
          console.log('[VerifyPositions] Released camera lock');
        }
        
        if (code === 0) {
          try {
            const previewData = JSON.parse(result);
            console.log('[VerifyPositions] Preview data parsed successfully:', { ok: previewData.ok });
            if (previewData.ok) {
              res.json({
                ok: true,
                rectifiedPreview: previewData.image
              });
            } else {
              console.error('[VerifyPositions] Preview generation failed:', previewData.error);
              res.status(500).json({ message: "Failed to generate preview", error: previewData.error });
            }
          } catch (parseError) {
            console.error('[VerifyPositions] Failed to parse result:', parseError);
            console.error('[VerifyPositions] Raw output:', result);
            res.status(500).json({ message: "Failed to parse preview result", error: String(parseError) });
          }
        } else {
          console.error('[VerifyPositions] Python failed with error:', error);
          res.status(500).json({ message: "Preview generation failed", error });
        }
      });
      
    } catch (error) {
      console.error('[VerifyPositions] Error:', error);
      // Release lock on error
      if (lockAcquired) {
        cameraSessionManager.releaseLock(cameraId);
        lockAcquired = false;
      }
      res.status(500).json({ message: "Verification error", error });
    }
  });

  // Sync adjusted template positions to slots (fixes cut-off markers issue)
  app.post("/api/slots/sync-positions/:cameraId", async (req, res) => {
    try {
      const { cameraId } = req.params;
      
      // Get current slots
      const slots = await storage.getSlotsByCamera(cameraId);
      
      // Get adjusted template rectangles  
      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      
      // Get paper size format from config
      const paperSizeConfig = await storage.getConfigByKey('last_calibration_paper_size_format');
      const paperSizeFormat = (paperSizeConfig?.value as string) || 'A4-landscape';
      
      const templates = await storage.getTemplateRectanglesByPaperSize(paperSizeFormat);
      console.log(`[SlotSync] Found ${templates.length} adjusted templates and ${slots.length} slots`);
      
      let updated = 0;
      for (const slot of slots) {
        // Find matching template by ArUco ID
        const template = templates.find(t => t.autoQrId === slot.expectedQrId);
        if (template) {
          // Update slot with adjusted template positions
          await storage.updateSlot(slot.id, {
            xCm: template.xCm,
            yCm: template.yCm
          });
          console.log(`[SlotSync] Updated slot ${slot.slotNumber} position to x=${template.xCm}, y=${template.yCm}`);
          updated++;
        }
      }
      
      res.json({ 
        message: `Synced positions for ${updated} slots`,
        updated,
        total: slots.length
      });
    } catch (error) {
      console.error('[SlotSync] Error:', error);
      res.status(500).json({ message: "Failed to sync slot positions", error });
    }
  });

  // Diagnostic endpoint to show current slot coordinates (for debugging)
  app.get("/api/slots/diagnostic/:cameraId", async (req, res) => {
    try {
      const { cameraId } = req.params;
      const slots = await storage.getSlotsByCamera(cameraId);
      
      const diagnosticData = {
        cameraId,
        slotCount: slots.length,
        slots: slots.map(slot => ({
          id: slot.expectedQrId,
          toolName: slot.toolName,
          xCm: slot.xCm,
          yCm: slot.yCm,
          widthCm: slot.widthCm,
          heightCm: slot.heightCm,
          rotation: slot.rotationDeg || 0
        }))
      };
      
      res.json(diagnosticData);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post("/api/calibrate/:cameraId/validate-markers-covered", async (req, res) => {
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
      
      // Prepare expected slots data with full geometry for spatial validation and overlay
      // IMPORTANT: These coordinates come from the DATABASE which contains ADJUSTED coordinates after save
      const expectedSlots = slots.map(slot => ({
        id: slot.slotNumber?.toString() || slot.expectedQrId, // Use slotNumber (ArUco marker ID) for validation
        slotId: slot.slotId,
        toolName: slot.toolName,
        x: slot.xCm, // Center position in cm (FROM DATABASE - ADJUSTED if saved)
        y: slot.yCm,
        width: slot.widthCm, // Dimensions in cm
        height: slot.heightCm,
        rotation: slot.rotationDeg || 0 // Rotation in degrees
      }));
      
      console.log(`[Validation] ====== SLOT COORDINATES BEING USED FOR VALIDATION ======`);
      expectedSlots.forEach((slot, idx) => {
        console.log(`[Validation] ${idx + 1}. ${slot.id} (${slot.toolName}): x=${slot.x.toFixed(2)}cm, y=${slot.y.toFixed(2)}cm, size=${slot.width}x${slot.height}cm, rot=${slot.rotation}°`);
      });
      console.log(`[Validation] ==================================================`);

      // Acquire exclusive camera lock AFTER validation succeeds
      // This includes a 10-second delay to ensure any preview process has fully released the camera
      await cameraSessionManager.acquireExclusiveLock(cameraId);
      lockAcquired = true;
      
      // Turn on LED light for consistent illumination during validation (unified controller)
      // Kill stuck LED processes first to ensure clean state
      await setWhiteLight(true);
      
      // Small delay to ensure LED process completes and releases stdout
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get paper dimensions from calibration config
      const paperSizeConfig = await storage.getConfigByKey('last_calibration_paper_size_format');
      let paperWidthCm, paperHeightCm;
      
      if (paperSizeConfig?.value) {
        const { getPaperDimensions } = await import('./utils/paper-size.js');
        const paperDimensions = getPaperDimensions(paperSizeConfig.value as string);
        paperWidthCm = paperDimensions.widthCm;
        paperHeightCm = paperDimensions.heightCm;
        console.log(`[Validation] Using paper dimensions: ${paperWidthCm}x${paperHeightCm} cm`);
      }
      
      // Call Python validation script with saved rectified image from calibration
      const validationArgs = [
        path.join(process.cwd(), 'python/validate_slot_qrs.py'),
        '--camera-id', cameraId,
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--homography', JSON.stringify(camera.homographyMatrix),
        '--slots', JSON.stringify(expectedSlots),
        '--should-detect', 'false', // Step 2: QRs should NOT be visible
        '--use-saved-rectified' // Use the high-res rectified image from calibration
      ];
      
      // Add paper dimensions if available
      if (paperWidthCm && paperHeightCm) {
        validationArgs.push('--paper-width-cm', paperWidthCm.toString());
        validationArgs.push('--paper-height-cm', paperHeightCm.toString());
      }
      
      // Add camera calibration parameters if available
      if (camera.cameraMatrix && camera.distCoeffs) {
        validationArgs.push('--camera-matrix', JSON.stringify(camera.cameraMatrix));
        validationArgs.push('--dist-coeffs', JSON.stringify(camera.distCoeffs));
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
      
      const pythonProcess = spawnTracked(
        'python3',
        validationArgs,
        'validate_slot_qrs.py',
        'python',
        `Validation: ${camera.name}`
      );
      
      let result = '';
      let error = '';
      let responseSent = false;
      
      // Set timeout for validation (10 minutes max for high-res processing)
      const validationTimeout = setTimeout(async () => {
        if (!responseSent) {
          responseSent = true;
          clearTimeout(validationTimeout);
          pythonProcess.kill('SIGTERM'); // Try graceful termination first
          setTimeout(() => pythonProcess.kill('SIGKILL'), 5000); // Force kill after 5s if still running
          if (lockAcquired) cameraSessionManager.releaseLock(cameraId);
          lockAcquired = false;
          await turnOffLED();
          console.error('[Validation] Process timed out after 10 minutes (covered step)');
          res.status(408).json({ 
            message: "Validation timed out. Process took longer than expected (>10 minutes).",
            error: "Timeout - validation process exceeded 600 seconds"
          });
        }
      }, 600000); // 10 minutes in milliseconds
      
      pythonProcess.on('error', async (err) => {
        clearTimeout(validationTimeout);
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
        const errStr = data.toString();
        console.error(`[Validation] Python stderr: ${errStr}`);
        error += errStr;
        
        // Turn off LED immediately after frame capture completes (~30s)
        if (errStr.includes('[LED_OFF_SIGNAL]')) {
          console.log('[Validation] Frame capture complete - turning off LED');
          turnOffLED().catch(err => console.error('[Validation] LED turnoff error:', err));
        }
      });
      
      pythonProcess.on('close', async (code) => {
        clearTimeout(validationTimeout);
        if (responseSent) return;
        
        try {
          if (code === 0) {
            try {
              const validationResult = JSON.parse(result);
              
              // If all 3 stages complete successfully, save calibration config
              if (validationResult.success) {
                const paperSize = paperSizeConfig?.value as string || 'A4-landscape';
                
                await storage.setConfig('last_calibration_camera_id', cameraId, 'Last successfully calibrated camera ID');
                await storage.setConfig('last_calibration_timestamp', new Date().toISOString(), 'Last successful calibration timestamp');
                await storage.setConfig('last_calibration_paper_size_format', paperSize, 'Last calibration paper size format (e.g., 6-page-3x2)');
                
                console.log('[Validation] Full calibration complete - config saved');
              }
              
              res.json(validationResult);
            } catch (parseError) {
              console.error('[Validation] Failed to parse validation result:', parseError);
              console.error('[Validation] Raw output:', result);
              res.status(500).json({ 
                success: false,
                error: "Failed to parse validation result",
                message: "Validation script returned invalid JSON - check server logs for details"
              });
            }
          } else {
            try {
              const validationResult = JSON.parse(result);
              res.json(validationResult); // Return 200 even on validation failure so frontend can show detailed message
            } catch (parseError) {
              console.error('[Validation] Failed to parse Python output. Exit code:', code);
              console.error('[Validation] Result:', result);
              console.error('[Validation] Error output:', error);
              res.status(500).json({ 
                success: false,
                error: error || "Validation script failed to return valid JSON",
                message: "Validation failed - check server logs for details"
              });
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
      // Use 1920x1080 for preview to avoid RAM overload on 2GB Raspberry Pi
      // Calibration uses full resolution (3840x2160) but same camera settings
      const previewWidth = 1920;
      const previewHeight = 1080;
      
      console.log(`[Preview] Using lower resolution for RAM efficiency: ${previewWidth}x${previewHeight}`);
      
      const previewArgs = [
        path.join(process.cwd(), 'python/camera_preview.py'),
        '--camera-id', cameraId,
        '--width', previewWidth.toString(),
        '--height', previewHeight.toString()
      ];
      
      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        previewArgs.push('--device-path', camera.devicePath);
      } else {
        previewArgs.push('--camera', camera.deviceIndex?.toString() || '0');
      }
      
      const pythonProcess = spawnTracked(
        'python3',
        previewArgs,
        'camera_preview.py',
        'python',
        `Camera preview: ${camera.name}`
      );

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
        const errStr = data.toString();
        console.error(`[Validation] Python stderr: ${errStr}`);
        error += errStr;
        
        // Turn off LED immediately after frame capture completes (~30s)
        if (errStr.includes('[LED_OFF_SIGNAL]')) {
          console.log('[Validation] Frame capture complete - turning off LED');
          turnOffLED().catch(err => console.error('[Validation] LED turnoff error:', err));
        }
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

  // Debug images endpoint - serves captured validation images for troubleshooting
  app.get("/api/debug-images/:filename", (req, res) => {
    try {
      const { filename } = req.params;
      // Use absolute path to home directory
      const debugDir = '/home/naniwa/ShelfEye/debug_images';
      const filePath = path.join(debugDir, filename);
      
      console.log(`[Debug Images] Request for: ${filename}`);
      console.log(`[Debug Images] CWD: ${process.cwd()}`);
      console.log(`[Debug Images] Debug dir: ${debugDir}`);
      console.log(`[Debug Images] Full path: ${filePath}`);
      console.log(`[Debug Images] File exists: ${fsSync.existsSync(filePath)}`);
      
      // Security: prevent directory traversal
      if (!filePath.startsWith(debugDir)) {
        console.log(`[Debug Images] Access denied - path traversal attempt`);
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Check if file exists
      if (!fsSync.existsSync(filePath)) {
        // List what files ARE in the directory
        try {
          const files = fsSync.readdirSync(debugDir);
          console.log(`[Debug Images] Files in debug dir: ${files.join(', ')}`);
        } catch (e) {
          console.log(`[Debug Images] Could not list debug dir: ${e}`);
        }
        return res.status(404).json({ message: "Debug image not found", path: filePath });
      }
      
      // Serve the image
      console.log(`[Debug Images] Serving file: ${filePath}`);
      res.sendFile(filePath);
    } catch (error) {
      console.error(`[Debug Images] Error:`, error);
      res.status(500).json({ message: "Failed to serve debug image", error });
    }
  });

  // Serve validation debug images from data directory
  app.get("/api/validation-images/:filename", (req, res) => {
    try {
      const { filename } = req.params;
      const dataDir = path.join(process.cwd(), 'data');
      const filePath = path.join(dataDir, filename);
      
      console.log(`[Validation Images] Request for: ${filename}`);
      console.log(`[Validation Images] Full path: ${filePath}`);
      
      // Security: prevent directory traversal
      if (!filePath.startsWith(dataDir)) {
        console.log(`[Validation Images] Access denied - path traversal attempt`);
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Check if file exists
      if (!fsSync.existsSync(filePath)) {
        return res.status(404).json({ message: "Validation image not found" });
      }
      
      // Serve the image
      res.sendFile(filePath);
    } catch (error) {
      console.error(`[Validation Images] Error:`, error);
      res.status(500).json({ message: "Failed to serve validation image", error });
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

      // Get CAMERA-SPECIFIC template rectangles (with fallback to shared templates)
      // This ensures preview shows camera-specific adjusted coordinates
      const templates = await storage.getTemplateRectanglesByPaperSizeAndCamera(paperSizeFormat, cameraId);
      
      console.log(`[Rectified Preview] Found ${templates.length} camera-specific templates (paper size: ${paperSizeFormat}, camera: ${cameraId})`);
      
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
      
      // Let Python calculate output size from measured pixel density (~100 px/cm for 4K)
      // Python aruco_calibrator measured the actual pixel density from marker spacing
      console.log(`[Rectified Preview] Paper: ${paperDimensions.widthCm}x${paperDimensions.heightCm} cm`);
      console.log(`[Rectified Preview] Using measured pixel density from ArUco calibration (no output-size override)`);
      
      const args = [
        path.join(process.cwd(), 'python/rectified_preview.py'),
        `--resolution=${camera.resolution[0]}x${camera.resolution[1]}`,
        `--homography=${homographyStr}`,  // Use --key=value syntax for negative numbers
        // NO --output-size parameter - let Python use measured pixel density
        `--paper-size=${paperDimensions.widthCm}x${paperDimensions.heightCm}`
      ];
      
      // Use device path if available (for Raspberry Pi), otherwise use index
      if (camera.devicePath) {
        args.push(`--device-path=${camera.devicePath}`);
        console.log(`[Rectified Preview] Using device path: ${camera.devicePath}`);
      } else {
        args.push(`--camera=${camera.deviceIndex?.toString() || '0'}`);
        console.log(`[Rectified Preview] Using camera index: ${camera.deviceIndex || 0}`);
      }
      
      // Add templates if available
      if (templateData.length > 0) {
        args.push(`--templates=${JSON.stringify(templateData)}`);
      }
      
      // Add camera calibration parameters for lens distortion correction
      if (camera.cameraMatrix && camera.distCoeffs) {
        args.push(`--camera-matrix=${camera.cameraMatrix.join(',')}`);
        args.push(`--dist-coeffs=${camera.distCoeffs.join(',')}`);
        console.log(`[Rectified Preview] Using camera calibration for undistortion`);
      } else {
        console.log(`[Rectified Preview] No camera calibration parameters - skipping undistortion`);
      }
      
      const pythonProcess = spawnTracked(
        'python3',
        args,
        'rectified_preview.py',
        'python',
        `Rectified preview: ${camera.name}`
      );

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
        const errStr = data.toString();
        console.error(`[Validation] Python stderr: ${errStr}`);
        error += errStr;
        
        // Turn off LED immediately after frame capture completes (~30s)
        if (errStr.includes('[LED_OFF_SIGNAL]')) {
          console.log('[Validation] Frame capture complete - turning off LED');
          turnOffLED().catch(err => console.error('[Validation] LED turnoff error:', err));
        }
      });

      pythonProcess.on('close', (code) => {
        if (responseSent) return;
        
        if (code === 0) {
          try {
            const previewData = JSON.parse(result);
            // Add no-cache headers to prevent browser from caching stale rectified preview
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
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
      const pythonProcess = spawnTracked(
        'python3',
        [
          path.join(process.cwd(), 'python/camera_manager.py'),
          '--camera', activeCamera.deviceIndex?.toString() || '0',
          '--slots', JSON.stringify(slots.map(s => ({
            id: s.slotId,
            coords: s.regionCoords,
            expectedQr: s.expectedQrId
          }))),
          '--homography', JSON.stringify(activeCamera.homographyMatrix || [])
        ],
        'camera_manager.py',
        'python',
        `Manual capture: ${activeCamera.name}`
      );

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
        const errStr = data.toString();
        console.error(`[Validation] Python stderr: ${errStr}`);
        error += errStr;
        
        // Turn off LED immediately after frame capture completes (~30s)
        if (errStr.includes('[LED_OFF_SIGNAL]')) {
          console.log('[Validation] Frame capture complete - turning off LED');
          turnOffLED().catch(err => console.error('[Validation] LED turnoff error:', err));
        }
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
      const { updateSlotSchema } = await import("@shared/schema");
      const updates = updateSlotSchema.parse(req.body);
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No update fields provided" });
      }
      
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

  // Slot validation and import/export routes
  app.post("/api/slots/validate", async (req, res) => {
    try {
      const { validateSlotCollection } = await import("./utils/slot-validator");
      const slots = req.body.slots;
      if (!Array.isArray(slots)) {
        return res.status(400).json({ message: "Expected 'slots' array in request body" });
      }

      const cameras = await storage.getCameras();
      const cameraMap = new Map(cameras.map(cam => [cam.id, cam]));
      
      const result = validateSlotCollection(slots, cameraMap);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Validation error", error });
    }
  });

  app.post("/api/slots/import", async (req, res) => {
    try {
      const { importSlotsFromJSON, validateSlotCollection, slotExportEnvelopeSchema, translateZodError } = await import("./utils/slot-validator");
      const { json, targetCameraId, validateOnly = false } = req.body;

      if (!json || !targetCameraId) {
        return res.status(400).json({ message: "Missing required fields: json, targetCameraId" });
      }

      try {
        slotExportEnvelopeSchema.parse(json);
      } catch (envelopeError) {
        if (envelopeError instanceof z.ZodError) {
          const errors = translateZodError(envelopeError, 'envelope');
          return res.status(400).json({ 
            message: "Invalid slot export format", 
            errors
          });
        }
        return res.status(400).json({ 
          message: "Invalid slot export format", 
          error: String(envelopeError)
        });
      }

      const slotsToImport = importSlotsFromJSON(json, targetCameraId);
      
      const cameras = await storage.getCameras();
      const cameraMap = new Map(cameras.map(cam => [cam.id, cam]));
      const validation = validateSlotCollection(slotsToImport, cameraMap);

      if (!validation.valid) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.errors,
          warnings: validation.warnings
        });
      }

      if (validateOnly) {
        return res.json({ 
          message: "Validation passed", 
          slotCount: slotsToImport.length,
          warnings: validation.warnings
        });
      }

      const validatedSlots = [];
      const allSchemaErrors = [];
      
      for (const slotData of slotsToImport) {
        try {
          const validatedData = insertSlotSchema.parse(slotData);
          validatedSlots.push(validatedData);
        } catch (parseError) {
          if (parseError instanceof z.ZodError) {
            const errors = translateZodError(parseError, slotData.slotId || 'unknown');
            allSchemaErrors.push(...errors);
          } else {
            allSchemaErrors.push({
              slotId: slotData.slotId || 'unknown',
              field: 'unknown',
              message: String(parseError),
              severity: 'error' as const
            });
          }
        }
      }
      
      if (allSchemaErrors.length > 0) {
        return res.status(400).json({ 
          message: "Schema validation failed for some slots", 
          errors: allSchemaErrors,
          count: allSchemaErrors.length
        });
      }
      
      const importedSlots = [];
      for (const validatedData of validatedSlots) {
        const slot = await storage.createSlot(validatedData);
        importedSlots.push(slot);
      }

      res.json({ 
        message: "Import successful", 
        imported: importedSlots.length,
        slots: importedSlots,
        warnings: validation.warnings
      });
    } catch (error) {
      res.status(500).json({ message: "Import error", error });
    }
  });

  app.get("/api/slots/export/:cameraId", async (req, res) => {
    try {
      const { exportSlotsToJSON } = await import("./utils/slot-validator");
      const { cameraId } = req.params;

      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      const slots = await storage.getSlotsByCamera(cameraId);
      const exportData = exportSlotsToJSON(slots, camera);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="slots-${camera.name}-${new Date().toISOString().split('T')[0]}.json"`);
      res.json(exportData);
    } catch (error) {
      res.status(500).json({ message: "Export error", error });
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

      // Use 'scale' parameter which directly sets pixels per module
      // For simple numeric data like "1"-"60", QR version 1 needs 21x21 modules
      // With scale=50, each module is 50px = total ~1050px image for easy scanning
      const qrOptions = {
        errorCorrectionLevel: errorCorrectionMap[errorCorrection] || 'L',
        type: 'image/png' as const,
        quality: 1,
        margin: 2, // 2 module quiet zone
        scale: moduleNum, // Direct pixels per module (e.g., 60 = 60px per square)
      };

      // Generate QR code as base64
      const qrCodeBase64 = await QRCode.toDataURL(qrData, qrOptions);
      
      // Extract base64 data without the data URL prefix
      const base64Data = qrCodeBase64.split(',')[1];

      // Calculate approximate dimensions (21-25 modules for numeric data + margin)
      const estimatedSize = moduleNum * 25; // 21 modules + 4 margin @ scale
      
      res.json({
        ok: true,
        payload,
        qrCode: base64Data,
        dimensions: { width: estimatedSize, height: estimatedSize }
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
        const process = spawnTracked(
          'python3',
          args,
          'aruco_generator.py',
          'python',
          `ArUco ${mode}: ${markerId}`
        );
        
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

  // Summary Report Google Sheets routes
  app.get("/api/summary-report/status", async (_req, res) => {
    try {
      const url = scheduler.getSummaryReportUrl();
      const spreadsheetIdConfig = await storage.getConfigByKey('SUMMARY_SPREADSHEET_ID');
      res.json({
        configured: !!spreadsheetIdConfig?.value,
        spreadsheetId: spreadsheetIdConfig?.value || null,
        url,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get summary report status", error });
    }
  });

  app.post("/api/summary-report/set-spreadsheet", async (req, res) => {
    try {
      const { spreadsheetId } = req.body;
      if (!spreadsheetId || typeof spreadsheetId !== 'string') {
        return res.status(400).json({ message: "spreadsheetId is required" });
      }

      await storage.setConfig('SUMMARY_SPREADSHEET_ID', spreadsheetId, 'Summary report spreadsheet ID');
      scheduler.setSummaryReportSpreadsheetId(spreadsheetId);

      res.json({
        ok: true,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to set spreadsheet ID", error });
    }
  });

  app.post("/api/summary-report/create-weekly", async (_req, res) => {
    try {
      const tabName = await scheduler.createWeeklySummaryTab();
      const url = scheduler.getSummaryReportUrl();
      res.json({
        ok: true,
        tabName,
        url,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to create weekly tab", error });
    }
  });

  app.post("/api/summary-report/sync", async (req, res) => {
    try {
      const { captureTime } = req.body;
      const validTimes = ['08:00', '11:00', '14:00', '17:00'];
      
      if (!captureTime || !validTimes.includes(captureTime)) {
        return res.status(400).json({ 
          message: "Valid captureTime required (08:00, 11:00, 14:00, or 17:00)" 
        });
      }

      await scheduler.triggerSummarySync(captureTime);
      res.json({ ok: true, message: `Synced for ${captureTime}` });
    } catch (error) {
      res.status(500).json({ message: "Failed to sync summary report", error });
    }
  });

  app.post("/api/summary-report/scan-template", async (_req, res) => {
    try {
      await scheduler.scanSummaryTemplateLayout();
      res.json({ ok: true, message: "Template layout scanned successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to scan template layout", error });
    }
  });

  app.get("/api/summary-report/tool-config", async (_req, res) => {
    try {
      const config = scheduler.getSummaryToolConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to get tool config", error });
    }
  });

  app.post("/api/summary-report/tool-config", async (req, res) => {
    try {
      const { tools } = req.body;
      if (!Array.isArray(tools)) {
        return res.status(400).json({ message: "tools must be an array" });
      }

      // Validate each tool entry
      for (const tool of tools) {
        if (!tool.name || typeof tool.name !== 'string') {
          return res.status(400).json({ message: "Each tool must have a name" });
        }
        if (typeof tool.totalCount !== 'number' || tool.totalCount < 0) {
          return res.status(400).json({ message: "Each tool must have a valid totalCount" });
        }
        if (typeof tool.isCheckType !== 'boolean') {
          return res.status(400).json({ message: "Each tool must have isCheckType (boolean)" });
        }
      }

      await scheduler.setSummaryToolConfig(tools);
      res.json({ ok: true, tools });
    } catch (error) {
      res.status(500).json({ message: "Failed to update tool config", error });
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

  // Template design routes (camera-independent saved templates)
  app.get("/api/template-designs", async (req, res) => {
    try {
      const designs = await storage.getTemplateDesigns();
      
      // Fetch all categories once (optimization)
      const allCategories = await storage.getToolCategories();
      
      // Include rectangles and categories for each design
      const designsWithData = await Promise.all(
        designs.map(async (design) => {
          const rectangles = await storage.getTemplateRectanglesByDesignId(design.id);
          
          // Get unique category IDs from rectangles
          const categoryIds = Array.from(new Set(rectangles.map(r => r.categoryId)));
          const relevantCategories = allCategories.filter(c => categoryIds.includes(c.id));
          
          return {
            ...design,
            templateRectangles: rectangles,
            categories: relevantCategories,
          };
        })
      );
      
      res.json(designsWithData);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch template designs", error });
    }
  });

  app.get("/api/template-designs/:id", async (req, res) => {
    try {
      const design = await storage.getTemplateDesign(req.params.id);
      if (!design) {
        return res.status(404).json({ message: "Template design not found" });
      }
      
      // Also fetch the rectangles for this design
      const rectangles = await storage.getTemplateRectanglesByDesignId(design.id);
      res.json({ ...design, rectangles });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch template design", error });
    }
  });

  app.post("/api/template-designs", async (req, res) => {
    try {
      const { name, paperSize, rectangles } = req.body;
      
      console.log(`[TemplateDesigns] Creating design: ${name}, paperSize: ${paperSize}, rectangles: ${rectangles?.length || 0}`);
      
      if (!name || !paperSize || !rectangles || !Array.isArray(rectangles)) {
        return res.status(400).json({ message: "Missing required fields: name, paperSize, rectangles" });
      }
      
      // Create the design
      const design = await storage.createTemplateDesign({ name, paperSize });
      console.log(`[TemplateDesigns] Created design with ID: ${design.id}`);
      
      // Create all rectangles linked to this design
      let successCount = 0;
      for (const rect of rectangles) {
        try {
          await storage.createTemplateRectangle({
            ...rect,
            designId: design.id,
            paperSize: paperSize,
          });
          successCount++;
        } catch (rectError) {
          console.error(`[TemplateDesigns] Failed to create rectangle:`, rectError, 'Data:', rect);
        }
      }
      
      console.log(`[TemplateDesigns] Created ${successCount}/${rectangles.length} rectangles for design ${design.id}`);
      
      res.json({ ...design, rectangleCount: successCount });
    } catch (error) {
      console.error('[TemplateDesigns] Error creating template design:', error);
      res.status(500).json({ message: "Failed to create template design", error });
    }
  });

  app.put("/api/template-designs/:id", async (req, res) => {
    try {
      const { name, paperSize, rectangles } = req.body;
      
      // Update the design
      const design = await storage.updateTemplateDesign(req.params.id, { name, paperSize });
      
      if (!design) {
        return res.status(404).json({ message: "Template design not found" });
      }
      
      // If rectangles are provided, update them too
      if (rectangles && Array.isArray(rectangles)) {
        // Delete old rectangles for this design
        await storage.deleteTemplateRectanglesByDesignId(design.id);
        
        // Create new ones
        for (const rect of rectangles) {
          await storage.createTemplateRectangle({
            ...rect,
            designId: design.id,
            paperSize: paperSize || design.paperSize,
          });
        }
      }
      
      res.json(design);
    } catch (error) {
      console.error('Error updating template design:', error);
      res.status(500).json({ message: "Failed to update template design", error });
    }
  });

  app.delete("/api/template-designs/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTemplateDesign(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Template design not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete template design", error });
    }
  });

  // Template rectangle routes
  app.get("/api/template-rectangles", async (req, res) => {
    try {
      const { paperSize, cameraId } = req.query;
      
      // If both paperSize and cameraId are provided, use camera-specific query with fallback
      if (paperSize && typeof paperSize === 'string' && cameraId && typeof cameraId === 'string') {
        const rectangles = await storage.getTemplateRectanglesByPaperSizeAndCamera(paperSize, cameraId);
        return res.json(rectangles);
      }
      
      // If only paperSize is provided, get all templates for that paper size
      if (paperSize && typeof paperSize === 'string') {
        const rectangles = await storage.getTemplateRectanglesByPaperSize(paperSize);
        return res.json(rectangles);
      }
      
      // Otherwise return all templates
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
      
      // Templates are now camera-independent - no camera validation needed
      
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
      console.log(`[API] PUT /api/template-rectangles/${req.params.id}`, req.body);
      const updates = insertTemplateRectangleSchema.partial().parse(req.body);
      const rectangle = await storage.updateTemplateRectangle(req.params.id, updates);
      
      if (!rectangle) {
        return res.status(404).json({ message: "Template rectangle not found" });
      }
      
      console.log(`[API] Updated template rectangle:`, { id: rectangle.id, autoQrId: rectangle.autoQrId, xCm: rectangle.xCm, yCm: rectangle.yCm });
      
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

  // Validate and auto-correct template rectangles for a paper size
  app.post("/api/template-rectangles/validate", async (req, res) => {
    try {
      const { paperSize } = req.body;
      if (!paperSize || typeof paperSize !== 'string') {
        return res.status(400).json({ message: "Paper size is required" });
      }

      const rectangles = await storage.getTemplateRectanglesByPaperSize(paperSize);
      const categories = await storage.getToolCategories();
      
      const fixed: any[] = [];
      const errors: any[] = [];

      for (const rect of rectangles) {
        const category = categories.find(c => c.id === rect.categoryId);
        if (!category) {
          errors.push({ id: rect.id, autoQrId: rect.autoQrId, error: "Category not found" });
          continue;
        }

        const violations = checkBoundaryViolationsServer(
          { xCm: rect.xCm, yCm: rect.yCm, widthCm: category.widthCm, heightCm: category.heightCm },
          paperSize
        );

        if (violations.length > 0) {
          const clamped = clampToBoundsServer(
            { xCm: rect.xCm, yCm: rect.yCm, widthCm: category.widthCm, heightCm: category.heightCm },
            paperSize
          );

          await storage.updateTemplateRectangle(rect.id, {
            xCm: clamped.xCm,
            yCm: clamped.yCm,
          });

          fixed.push({
            id: rect.id,
            autoQrId: rect.autoQrId,
            oldPosition: { xCm: rect.xCm, yCm: rect.yCm },
            newPosition: { xCm: clamped.xCm, yCm: clamped.yCm },
            violations: violations.map(v => v.edge),
          });
        }
      }

      res.json({
        success: true,
        fixed: fixed.length,
        errors: errors.length,
        details: { fixed, errors },
      });
    } catch (error) {
      console.error('Error validating template rectangles:', error);
      res.status(500).json({ message: "Failed to validate template rectangles", error });
    }
  });

  // Get calibration configuration for active camera card
  app.get("/api/config/calibration-info", async (_req, res) => {
    try {
      const cameraIdConfig = await storage.getConfigByKey("last_calibration_camera_id");
      const timestampConfig = await storage.getConfigByKey("last_calibration_timestamp");
      const paperSizeConfig = await storage.getConfigByKey("last_calibration_paper_size_format");

      // If no calibration exists, return null
      if (!cameraIdConfig?.value) {
        return res.json(null);
      }

      // Get camera details
      const camera = await storage.getCamera(cameraIdConfig.value as string);

      res.json({
        cameraId: cameraIdConfig.value,
        cameraName: camera?.name || 'Unknown Camera',
        timestamp: timestampConfig?.value || null,
        paperSize: paperSizeConfig?.value || 'Unknown',
      });
    } catch (error) {
      console.error('Error fetching calibration info:', error);
      res.status(500).json({ message: "Failed to get calibration info", error });
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

  // Alert retry queue stats
  app.get("/api/alert-queue/stats", async (_req, res) => {
    try {
      const stats = scheduler.getAlertQueueStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to get alert queue stats", error });
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
      
      // Auto-assign ArUco ID (51-95, reusing deleted numbers)
      const existingWorkers = await storage.getWorkers();
      const usedArucoIds = new Set(existingWorkers.map(w => w.arucoId));
      
      let nextArucoId = null;
      for (let id = 51; id <= 95; id++) {
        if (!usedArucoIds.has(id)) {
          nextArucoId = id;
          break;
        }
      }
      
      if (nextArucoId === null) {
        return res.status(400).json({ 
          message: "Worker limit reached. Maximum 45 workers allowed (ArUco IDs 51-95 are reserved for workers)." 
        });
      }
      
      // Create worker with auto-assigned ArUco ID
      const worker = await storage.createWorker({
        ...workerData,
        arucoId: nextArucoId,
        workerCode: `W${nextArucoId}`, // Auto-generate from ArUco ID
      });
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

  // GPIO Light Control route (for testing) - Uses unified LED controller
  app.post("/api/gpio/light", async (req, res) => {
    try {
      const { action } = req.body;
      
      console.log('[GPIO Light] Received action:', action);
      
      if (!action || !['on', 'off'].includes(action)) {
        return res.status(400).json({ message: "Invalid action. Use 'on' or 'off'" });
      }

      // Use unified LED controller
      let success = false;
      if (action === 'on') {
        success = await setWhiteLight();
      } else {
        await turnOffLED();
        success = true; // turnOffLED doesn't return a value
      }

      if (!success && action === 'on') {
        return res.status(409).json({
          ok: false,
          action,
          message: 'White light blocked - RED FLASH alert has priority. Stop the alert first.'
        });
      }

      const response = {
        ok: true,
        action,
        message: `Light ${action === 'on' ? 'turned on' : 'turned off'} successfully (unified controller)`
      };
      
      console.log('[GPIO Light] Sending response:', JSON.stringify(response));
      
      res.json(response);

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
        const childProcess = spawnTracked(
          'python3',
          args,
          'detect_cameras.py',
          'python',
          'Camera detection'
        );

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

  // Debug endpoint to view validation rectified image
  app.get("/api/debug/validation-image/:cameraId", (req, res) => {
    const { cameraId } = req.params;
    const debugImagePath = path.join(process.cwd(), 'data', `validation_rectified_debug_${cameraId}.png`);
    res.sendFile(debugImagePath, (err) => {
      if (err) {
        res.status(404).json({ error: 'Debug image not found. Run ArUco marker validation first.' });
      }
    });
  });

  // Debug endpoint to show detailed camera configuration
  app.get("/api/debug/camera-config/:cameraId", async (req, res) => {
    try {
      const { cameraId } = req.params;
      const camera = await storage.getCamera(cameraId);
      
      if (!camera) {
        return res.status(404).json({ error: 'Camera not found' });
      }
      
      // Get paper size configuration
      const paperSizeFromCamera = camera.paperSize;
      const globalPaperSize = await storage.getConfigByKey('last_calibration_paper_size_format');
      
      res.json({
        cameraId: camera.id,
        name: camera.name,
        devicePath: camera.devicePath,
        deviceIndex: camera.deviceIndex,
        resolution: {
          configured: camera.resolution,
          width: camera.resolution?.[0] || 'not set',
          height: camera.resolution?.[1] || 'not set',
        },
        paperSize: {
          cameraSpecific: paperSizeFromCamera || 'not set',
          globalFallback: globalPaperSize?.value || 'not set',
          activeValue: paperSizeFromCamera || globalPaperSize?.value || 'not set',
        },
        calibration: {
          lastCalibrated: camera.calibrationTimestamp,
          hasHomography: !!camera.homographyMatrix,
        },
        notes: [
          'The configured resolution should match your camera hardware capabilities',
          '4K cameras: 3840x2160, 2K cameras: typically 2560x1440 or 1920x1080',
          'If ArUco detection is poor, verify resolution matches camera specs',
        ]
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get camera config' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
