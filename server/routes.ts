import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import QRCode from "qrcode";
import { insertCameraSchema, insertSlotSchema, insertDetectionLogSchema, insertAlertRuleSchema, insertToolCategorySchema, insertTemplateRectangleSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
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
      const camera = await storage.getCamera(cameraId);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      // Call Python calibration script
      const pythonProcess = spawn('python3', [
        path.join(process.cwd(), 'python/aruco_calibrator.py'),
        '--camera', camera.deviceIndex.toString(),
        '--resolution', `${camera.resolution[0]}x${camera.resolution[1]}`
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
            await storage.updateCamera(cameraId, {
              homographyMatrix: calibrationData.homography_matrix,
              calibrationTimestamp: new Date(),
            });
            res.json({
              ok: true,
              homographyMatrix: calibrationData.homography_matrix,
              reprojectionError: calibrationData.reprojection_error,
              markersDetected: calibrationData.markers_detected,
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

              // Create detection log
              await storage.createDetectionLog({
                slotId: slot.id,
                status: slotResult.status,
                qrId: slotResult.qr_id || null,
                workerName: slotResult.worker_name || null,
                ssimScore: slotResult.ssim_score || null,
                poseQuality: slotResult.pose_quality || null,
                imagePath: slotResult.image_path || null,
                alertTriggered: slotResult.alert_triggered || false,
                rawDetectionData: slotResult,
              });

              statuses[slotResult.slot_id] = {
                state: slotResult.status,
                present: slotResult.present || false,
                correct_item: slotResult.correct_item || false,
                scores: {
                  s_empty: slotResult.s_empty || 0,
                  s_full: slotResult.s_full || 0
                },
                pose_quality: slotResult.pose_quality || 0,
                qr_id: slotResult.qr_id || null,
                worker_name: slotResult.worker_name || null,
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
      const { type, id, toolType, workerName, errorCorrection = 'L', moduleSize = 25, includeHmac = true } = req.body;

      const payload: any = {
        type,
        id,
        tool_type: toolType || undefined,
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
      const rectangle = await storage.createTemplateRectangle(rectangleData);
      res.json(rectangle);
    } catch (error) {
      res.status(400).json({ message: "Invalid template rectangle data", error });
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
      res.status(400).json({ message: "Invalid update data", error });
    }
  });

  app.delete("/api/template-rectangles/:id", async (req, res) => {
    const deleted = await storage.deleteTemplateRectangle(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Template rectangle not found" });
    }
    res.json({ success: true });
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

    for (const status of slotStatuses.values()) {
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
