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

// Global scheduler instance
let scheduler: CaptureScheduler;

export async function registerRoutes(app: Express): Promise<Server> {
  scheduler = new CaptureScheduler(storage);
  await scheduler.initialize();
  
  // Run startup calibration
  await startupCalibrationService.initialize();
  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      version: "2.1.0"
    });
  });

  // Camera management routes
  app.get("/api/cameras", async (_req, res) => {
    const cameras = await storage.getCameras();
    res.json(cameras);
  });

  app.get("/api/cameras/:id", async (req, res) => {
    const camera = await storage.getCamera(req.params.id);
    if (!camera) {
      return res.status(404).json({ message: "Camera not found" });
    }
    res.json(camera);
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
    const deleted = await storage.deleteCamera(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Camera not found" });
    }
    res.json({ ok: true });
  });

  // Calibration routes
  app.post("/api/calibrate/:cameraId", async (req, res) => {
    try {
      const { cameraId } = req.params;
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

      // Call Python calibration script with paper size
      const pythonProcess = spawn('python3', [
        path.join(process.cwd(), 'python/aruco_calibrator.py'),
        '--camera', camera.deviceIndex.toString(),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--paper-size', `${paperDims.widthCm}x${paperDims.heightCm}`
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
            const calibrationData = JSON.parse(result);
            const homographyMatrix = calibrationData.homography_matrix;
            
            await storage.updateCamera(cameraId, {
              homographyMatrix: homographyMatrix,
              calibrationTimestamp: new Date(),
            });

            const templateRectangles = await storage.getTemplateRectanglesByCamera(cameraId);
            const createdSlots: any[] = [];

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

            res.json({
              ok: true,
              homographyMatrix: homographyMatrix,
              reprojectionError: calibrationData.reprojection_error,
              markersDetected: calibrationData.markers_detected,
              slotsCreated: createdSlots.length,
            });
          } catch (parseError) {
            res.status(500).json({ message: "Failed to parse calibration result", error: parseError });
          }
        } else {
          res.status(500).json({ message: "Calibration failed", error });
        }
      });

    } catch (error) {
      res.status(500).json({ message: "Calibration error", error });
    }
  });

  // Two-step calibration validation routes
  app.post("/api/calibrate/:cameraId/validate-qrs-visible", async (req, res) => {
    try {
      const { cameraId } = req.params;
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
      
      // Call Python validation script
      const pythonProcess = spawn('python3', [
        path.join(process.cwd(), 'python/validate_slot_qrs.py'),
        '--camera', camera.deviceIndex.toString(),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--homography', JSON.stringify(camera.homographyMatrix),
        '--slots', JSON.stringify(expectedSlots),
        '--secret', secret,
        '--should-detect', 'true' // Step 1: QRs should be visible
      ]);
      
      let result = '';
      let error = '';
      let responseSent = false;
      
      pythonProcess.on('error', (err) => {
        if (!responseSent) {
          responseSent = true;
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
      });
      
    } catch (error) {
      res.status(500).json({ message: "Validation error", error });
    }
  });
  
  app.post("/api/calibrate/:cameraId/validate-qrs-covered", async (req, res) => {
    try {
      const { cameraId } = req.params;
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
      
      // Call Python validation script
      const pythonProcess = spawn('python3', [
        path.join(process.cwd(), 'python/validate_slot_qrs.py'),
        '--camera', camera.deviceIndex.toString(),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--homography', JSON.stringify(camera.homographyMatrix),
        '--slots', JSON.stringify(expectedSlots),
        '--secret', secret,
        '--should-detect', 'false' // Step 2: QRs should NOT be visible
      ]);
      
      let result = '';
      let error = '';
      let responseSent = false;
      
      pythonProcess.on('error', (err) => {
        if (!responseSent) {
          responseSent = true;
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
      });
      
    } catch (error) {
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
      const pythonProcess = spawn('python3', [
        path.join(process.cwd(), 'python/camera_preview.py'),
        camera.deviceIndex.toString(),
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
      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      if (!camera.homographyMatrix || camera.homographyMatrix.length !== 9) {
        return res.status(400).json({ 
          message: "Camera not calibrated. Please calibrate the camera first." 
        });
      }

      // Call Python rectified preview script
      const homographyStr = camera.homographyMatrix.join(',');
      const pythonProcess = spawn('python3', [
        path.join(process.cwd(), 'python/rectified_preview.py'),
        '--camera', camera.deviceIndex.toString(),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`,
        '--homography', homographyStr,
        '--output-size', '800x600'
      ]);

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
            res.status(500).json({ message: "Failed to parse rectified preview result", error: parseError });
          }
        } else {
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
        '--camera', activeCamera.deviceIndex.toString(),
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
    const { cameraId } = req.query;
    const slots = cameraId 
      ? await storage.getSlotsByCamera(cameraId as string)
      : await storage.getSlots();
    res.json(slots);
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
    const deleted = await storage.deleteSlot(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Slot not found" });
    }
    res.json({ ok: true });
  });

  // Detection logs routes
  app.get("/api/detection-logs", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const { slotId, startDate, endDate } = req.query;

    let logs;
    if (slotId) {
      logs = await storage.getDetectionLogsBySlot(slotId as string, limit);
    } else if (startDate && endDate) {
      logs = await storage.getDetectionLogsByDateRange(
        new Date(startDate as string),
        new Date(endDate as string)
      );
    } else {
      logs = await storage.getDetectionLogs(limit, offset);
    }

    res.json(logs);
  });

  // Alert management routes
  app.get("/api/alert-rules", async (_req, res) => {
    const rules = await storage.getAlertRules();
    res.json(rules);
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
    const queue = await storage.getAlertQueue();
    res.json(queue);
  });

  app.get("/api/alert-queue/pending", async (_req, res) => {
    const pending = await storage.getPendingAlerts();
    res.json(pending);
  });

  app.get("/api/alert-queue/failed", async (_req, res) => {
    const failed = await storage.getFailedAlerts();
    res.json(failed);
  });

  // QR code generation route
  app.post("/api/qr-generate", async (req, res) => {
    try {
      const { type, id, slotName, workerName, errorCorrection = 'L', moduleSize = 25, includeHmac = true } = req.body;

      const payload: any = {
        type,
        id,
        slot_name: slotName || undefined,
        worker_name: workerName || undefined,
        version: "1.0",
        ts: Math.floor(Date.now() / 1000),
        nonce: Math.random().toString(36).substring(2, 8),
      };

      if (includeHmac) {
        // In a real implementation, you'd use a proper HMAC with a secret key
        payload.hmac = Buffer.from(JSON.stringify(payload)).toString('base64').substring(0, 8);
      }

      // Generate QR code using Node.js library
      const qrData = JSON.stringify(payload);
      
      // Map error correction levels
      const errorCorrectionMap: Record<string, QRCode.QRCodeErrorCorrectionLevel> = {
        'L': 'L',
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
        const process = spawn('python', args);
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
    const config = await storage.getSystemConfig();
    res.json(config);
  });

  app.get("/api/config/:key", async (req, res) => {
    const config = await storage.getConfigByKey(req.params.key);
    if (!config) {
      return res.status(404).json({ message: "Configuration key not found" });
    }
    res.json(config);
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
    const categories = await storage.getToolCategories();
    res.json(categories);
  });

  app.get("/api/tool-categories/:id", async (req, res) => {
    const category = await storage.getToolCategory(req.params.id);
    if (!category) {
      return res.status(404).json({ message: "Tool category not found" });
    }
    res.json(category);
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
    const deleted = await storage.deleteToolCategory(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Tool category not found" });
    }
    res.json({ success: true });
  });

  // Template rectangle routes
  app.get("/api/template-rectangles", async (req, res) => {
    const { paperSize } = req.query;
    if (paperSize && typeof paperSize === 'string') {
      const rectangles = await storage.getTemplateRectanglesByPaperSize(paperSize);
      return res.json(rectangles);
    }
    const rectangles = await storage.getTemplateRectangles();
    res.json(rectangles);
  });

  app.get("/api/template-rectangles/:id", async (req, res) => {
    const rectangle = await storage.getTemplateRectangle(req.params.id);
    if (!rectangle) {
      return res.status(404).json({ message: "Template rectangle not found" });
    }
    res.json(rectangle);
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
    const deleted = await storage.deleteTemplateRectangle(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Template rectangle not found" });
    }
    res.json({ success: true });
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

      // Get HMAC secret key from config
      const secretConfig = await storage.getConfigByKey('QR_SECRET_KEY');
      const secretKey = secretConfig?.value as string || 'default-secret-key';

      // Generate QR payload (unique per worker with workerCode as ID)
      const payload: any = {
        type: "worker",
        id: worker.workerCode, // Unique worker identifier for checkout tracking
        worker_name: worker.name,
        version: "1.0",
        ts: Math.floor(Date.now() / 1000),
        nonce: Math.random().toString(36).substring(2, 8),
      };

      if (worker.department) {
        payload.department = worker.department;
      }

      // Generate proper HMAC-SHA256 signature (matching Python implementation)
      const message = JSON.stringify(payload, Object.keys(payload).sort());
      const hmac = crypto.createHmac('sha256', secretKey);
      hmac.update(message);
      payload.hmac = hmac.digest('hex');

      // Generate QR code as PNG with RGBA
      const qrData = JSON.stringify(payload);
      const qrCodeBuffer = await QRCode.toBuffer(qrData, {
        errorCorrectionLevel: 'H',
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

      // Save QR payload to worker
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
      const limit = parseInt(req.query.limit as string) || 50;
      const runs = await storage.getCaptureRuns(limit);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get capture runs", error });
    }
  });

  // Worker checkout report route - shows which worker has which tool at a specific time
  app.get("/api/reports/checkouts", async (req, res) => {
    try {
      const timestamp = req.query.timestamp ? new Date(req.query.timestamp as string) : new Date();
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
  });

  const httpServer = createServer(app);
  return httpServer;
}
