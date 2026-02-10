import { type Camera, type Slot, type DetectionLog, type AlertRule, type AlertQueue, type SystemConfig, type ToolCategory, type TemplateRectangle, type TemplateDesign, type Worker, type CaptureRun, type GoogleOAuthCredential, type InsertCamera, type InsertSlot, type InsertDetectionLog, type InsertAlertRule, type InsertAlertQueue, type InsertSystemConfig, type InsertToolCategory, type InsertTemplateRectangle, type InsertTemplateDesign, type InsertWorker, type InsertCaptureRun, type InsertGoogleOAuthCredential } from "@shared/schema";

export interface IStorage {
  // Camera methods
  getCameras(): Promise<Camera[]>;
  getCamera(id: string): Promise<Camera | undefined>;
  createCamera(camera: InsertCamera): Promise<Camera>;
  updateCamera(id: string, updates: Partial<InsertCamera>): Promise<Camera | undefined>;
  deleteCamera(id: string): Promise<boolean>;

  // Slot methods
  getSlots(): Promise<Slot[]>;
  getSlotsByCamera(cameraId: string): Promise<Slot[]>;
  getSlot(id: string): Promise<Slot | undefined>;
  getSlotBySlotId(slotId: string): Promise<Slot | undefined>;
  createSlot(slot: InsertSlot): Promise<Slot>;
  updateSlot(id: string, updates: Partial<InsertSlot>): Promise<Slot | undefined>;
  deleteSlot(id: string): Promise<boolean>;

  // Detection log methods
  getDetectionLogs(limit?: number, offset?: number): Promise<DetectionLog[]>;
  getDetectionLogsBySlot(slotId: string, limit?: number): Promise<DetectionLog[]>;
  getDetectionLogsByDateRange(startDate: Date, endDate: Date): Promise<DetectionLog[]>;
  getLatestDetectionLogBySlotBeforeTime(slotId: string, timestamp: Date): Promise<DetectionLog | undefined>;
  createDetectionLog(log: InsertDetectionLog): Promise<DetectionLog>;
  deleteDetectionLogsBySlotId(slotId: string): Promise<number>;

  // Alert rule methods
  getAlertRules(): Promise<AlertRule[]>;
  getActiveAlertRules(): Promise<AlertRule[]>;
  getAlertRule(id: string): Promise<AlertRule | undefined>;
  createAlertRule(rule: InsertAlertRule): Promise<AlertRule>;
  updateAlertRule(id: string, updates: Partial<InsertAlertRule>): Promise<AlertRule | undefined>;
  deleteAlertRule(id: string): Promise<boolean>;

  // Alert queue methods
  getAlertQueue(): Promise<AlertQueue[]>;
  getPendingAlerts(): Promise<AlertQueue[]>;
  getFailedAlerts(): Promise<AlertQueue[]>;
  createAlert(alert: InsertAlertQueue): Promise<AlertQueue>;
  updateAlertStatus(id: string, status: string, sentAt?: Date): Promise<AlertQueue | undefined>;

  // System config methods
  getSystemConfig(): Promise<SystemConfig[]>;
  getConfigByKey(key: string): Promise<SystemConfig | undefined>;
  setConfig(key: string, value: any, description?: string): Promise<SystemConfig>;
  updateConfig(key: string, value: any): Promise<SystemConfig | undefined>;

  // Tool category methods
  getToolCategories(): Promise<ToolCategory[]>;
  getToolCategory(id: string): Promise<ToolCategory | undefined>;
  createToolCategory(category: InsertToolCategory): Promise<ToolCategory>;
  updateToolCategory(id: string, updates: Partial<InsertToolCategory>): Promise<ToolCategory | undefined>;
  deleteToolCategory(id: string): Promise<boolean>;

  // Template rectangle methods
  getTemplateRectangles(): Promise<TemplateRectangle[]>;
  getTemplateRectanglesByPaperSize(paperSize: string): Promise<TemplateRectangle[]>;
  getTemplateRectanglesByPaperSizeAndCamera(paperSize: string, cameraId: string): Promise<TemplateRectangle[]>;
  getTemplateRectangle(id: string): Promise<TemplateRectangle | undefined>;
  createTemplateRectangle(rectangle: InsertTemplateRectangle): Promise<TemplateRectangle>;
  updateTemplateRectangle(id: string, updates: Partial<InsertTemplateRectangle>): Promise<TemplateRectangle | undefined>;
  deleteTemplateRectangle(id: string): Promise<boolean>;
  getTemplateRectanglesByDesignId(designId: string, masterOnly?: boolean): Promise<TemplateRectangle[]>;
  getTemplateRectanglesByDesignIdAndCamera(designId: string, cameraId: string): Promise<TemplateRectangle[]>;
  deleteTemplateRectanglesByDesignId(designId: string): Promise<number>;

  // Template design methods (saved templates)
  getTemplateDesigns(): Promise<TemplateDesign[]>;
  getTemplateDesign(id: string): Promise<TemplateDesign | undefined>;
  getTemplateDesignByTimestamp(timestamp: string): Promise<TemplateDesign | undefined>;
  createTemplateDesign(design: InsertTemplateDesign): Promise<TemplateDesign>;
  updateTemplateDesign(id: string, updates: Partial<InsertTemplateDesign>): Promise<TemplateDesign | undefined>;
  deleteTemplateDesign(id: string): Promise<boolean>;
  saveTemplateDesignWithRectangles(design: InsertTemplateDesign, rectangles: InsertTemplateRectangle[], existingId?: string): Promise<TemplateDesign>;

  // Worker methods
  getWorkers(): Promise<Worker[]>;
  getActiveWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  getWorkerByCode(workerCode: string): Promise<Worker | undefined>;
  createWorker(worker: InsertWorker & { arucoId: number; workerCode: string }): Promise<Worker>;
  updateWorker(id: string, updates: Partial<Worker>): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;

  // Capture run methods
  getCaptureRuns(limit?: number): Promise<CaptureRun[]>;
  getCaptureRun(id: string): Promise<CaptureRun | undefined>;
  createCaptureRun(run: InsertCaptureRun): Promise<CaptureRun>;
}

import { db } from './db';
import * as schema from '@shared/schema';
import { eq, desc, and, gte, lte, isNull } from 'drizzle-orm';
import { withRetry } from './db-retry';

export class DbStorage implements IStorage {
  private initPromise: Promise<void> | null = null;
  
  constructor() {
    // Lazy initialization - will be triggered on first method call
  }
  
  /**
   * Ensure initialization has completed before executing any storage operation
   * Lazy initialization pattern - runs once on first method call
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeDefaults();
    }
    await this.initPromise;
  }
  
  /**
   * Wrap database operations with automatic retry logic for transient errors
   * Handles network drops, connection resets, timeouts - critical for Pi WiFi + Neon
   */
  private async withDbRetry<T>(operation: () => Promise<T>, context?: string): Promise<T> {
    return withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 2000,
      backoffMultiplier: 2
    });
  }

  private async initializeDefaults() {
    // Use direct DB access to avoid re-entering ensureInitialized() (deadlock prevention)
    const existingCameras = await db.select().from(schema.cameras);
    
    if (existingCameras.length === 0) {
      // Direct DB insert - do NOT call public methods to avoid re-entrancy deadlock
      await db.insert(schema.cameras).values({
        name: "Camera Station A",
        deviceIndex: 0,
        resolution: [3840, 2160],
        isActive: true,
      });

      await db.insert(schema.alertRules).values({
        name: "Tool Missing Alert",
        ruleType: "TOOL_MISSING",
        isEnabled: true,
        verificationWindow: 5,
        businessHoursOnly: true,
        priority: "high",
        conditions: { emptyDurationMinutes: 5 } as Record<string, any>,
      });

      await db.insert(schema.alertRules).values({
        name: "QR Detection Failure",
        ruleType: "QR_FAILURE",
        isEnabled: true,
        verificationWindow: 3,
        businessHoursOnly: false,
        priority: "medium",
        conditions: { consecutiveFailures: 3 } as Record<string, any>,
      });

      await db.insert(schema.alertRules).values({
        name: "Camera Health Alert",
        ruleType: "CAMERA_HEALTH",
        isEnabled: true,
        verificationWindow: 1,
        businessHoursOnly: false,
        priority: "high",
        conditions: { maxReprojectionError: 2.5 } as Record<string, any>,
      });
    }
    
    // Always ensure config values exist (even on existing installations)
    // This allows adding new config keys without breaking existing deployments
    const configDefaults = [
      { key: "smtp_host", value: "smtp.gmail.com", desc: "SMTP server host" },
      { key: "smtp_port", value: "587", desc: "SMTP server port" },
      { key: "smtp_user", value: "", desc: "SMTP username" },
      { key: "smtp_pass", value: "", desc: "SMTP password" },
      { key: "smtp_from", value: "alerts@example.com", desc: "Alert email sender" },
      { key: "alert_email", value: "", desc: "Alert recipient email" },
      { key: "EMAIL_RECIPIENTS", value: JSON.stringify(["manager@factory.com", "supervisor@factory.com"]), desc: "Alert email recipients (array)" },
      { key: "google_sheets_url", value: "", desc: "Google Sheets logging URL" },
      { key: "buzzer_gpio_pin", value: "", desc: "Buzzer GPIO pin (not connected)" },
      { key: "led_gpio_pin", value: "", desc: "LED GPIO pin (not connected)" },
      { key: "light_strip_gpio_pin", value: "18", desc: "LED strip data - BCM GPIO 18 (Physical Pin 12)" },
      { key: "led_strip_num_leds", value: "99", desc: "Number of LEDs in the WS2812B light strip" },
      { key: "led_strip_brightness", value: "100", desc: "LED strip brightness level (0-255)" },
      { key: "alert_led_gpio_pin", value: "", desc: "Alert LED GPIO pin (not connected - alerts use LED strip)" },
      { key: "calibration-info", value: JSON.stringify({
        version: "1.0",
        lastUpdated: new Date().toISOString(),
        notes: "Initial setup - calibration pending"
      }), desc: "Camera calibration metadata" },
      { key: "capture_times", value: JSON.stringify(["08:00", "11:00", "14:00", "17:00"]), desc: "Scheduled capture times (JSON array)" },
      { key: "timezone", value: "Asia/Tokyo", desc: "System timezone (JST)" },
      { key: "scheduler_paused", value: "false", desc: "Scheduler pause state (true/false)" },
      { key: "ALERT_TEMPLATES", value: JSON.stringify({
        missing_tool: {
          subject: "🔴 Tool Missing Alert - {{toolName}}",
          body: "Tool {{toolName}} has been missing from slot {{slotNumber}} for {{duration}} minutes."
        },
        camera_offline: {
          subject: "📷 Camera Offline - {{cameraName}}",
          body: "Camera {{cameraName}} is offline or not responding."
        }
      }), desc: "Email alert templates" },
      { key: "SHEETS_SPREADSHEET_ID", value: "", desc: "Google Sheets spreadsheet ID" },
      { key: "SHEETS_FORMATTING", value: JSON.stringify({
        tabFormat: "monthly",
        headerRow: true,
        autoWidth: true,
        dateFormat: "YYYY-MM-DD HH:mm:ss"
      }), desc: "Google Sheets formatting options" },
      { key: "last_calibration_camera_id", value: "", desc: "ID of last calibrated camera" },
      { key: "last_calibration_timestamp", value: "", desc: "Timestamp of last calibration" },
      { key: "last_calibration_paper_size_format", value: "6-page-3x2", desc: "Last used paper size format" },
    ];
    
    // Direct DB access for config defaults to avoid re-entrancy deadlock
    for (const config of configDefaults) {
      const existing = await db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, config.key));
      if (!existing || existing.length === 0) {
        await db.insert(schema.systemConfig).values({
          key: config.key,
          value: config.value,
          description: config.desc
        });
      }
    }
  }

  async getCameras(): Promise<Camera[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.cameras);
  }

  async getCamera(id: string): Promise<Camera | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.cameras).where(eq(schema.cameras.id, id));
    return result[0];
  }

  async createCamera(camera: InsertCamera): Promise<Camera> {
    await this.ensureInitialized();
    
    // Auto-assign deviceIndex if not provided
    if (camera.deviceIndex === undefined || camera.deviceIndex === null) {
      const allCameras = await db.select().from(schema.cameras);
      const maxIndex = allCameras.reduce((max, cam) => {
        const idx = cam.deviceIndex ?? -1;
        return idx > max ? idx : max;
      }, -1);
      camera.deviceIndex = maxIndex + 1;
    }
    
    const result = await db.insert(schema.cameras).values(camera as any).returning();
    return result[0];
  }

  async updateCamera(id: string, updates: Partial<InsertCamera>): Promise<Camera | undefined> {
    await this.ensureInitialized();
    const result = await db.update(schema.cameras).set(updates as any).where(eq(schema.cameras.id, id)).returning();
    return result[0];
  }

  async deleteCamera(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await db.delete(schema.cameras).where(eq(schema.cameras.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getSlots(): Promise<Slot[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.slots);
  }

  async getSlotsByCamera(cameraId: string): Promise<Slot[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.slots).where(eq(schema.slots.cameraId, cameraId));
  }

  async getSlot(id: string): Promise<Slot | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.slots).where(eq(schema.slots.id, id));
    return result[0];
  }

  async getSlotBySlotId(slotId: string): Promise<Slot | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.slots).where(eq(schema.slots.slotId, slotId));
    return result[0];
  }

  async createSlot(slot: InsertSlot, explicitSlotNumber?: number): Promise<Slot> {
    await this.ensureInitialized();
    
    let slotNumber: number;
    if (explicitSlotNumber !== undefined) {
      slotNumber = explicitSlotNumber;
    } else {
      const cameraSlots = await this.getSlotsByCamera(slot.cameraId);
      const maxNumber = cameraSlots.reduce((max, s) => {
        return s.slotNumber > max ? s.slotNumber : max;
      }, 0);
      slotNumber = maxNumber + 1;
    }
    
    const slotToInsert = {
      ...slot,
      slotNumber,
    };
    
    const result = await db.insert(schema.slots).values(slotToInsert as any).returning();
    return result[0];
  }

  async updateSlot(id: string, updates: Partial<InsertSlot>): Promise<Slot | undefined> {
    await this.ensureInitialized();
    const definedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    ) as Partial<InsertSlot>;
    const result = await db.update(schema.slots).set(definedUpdates as any).where(eq(schema.slots.id, id)).returning();
    return result[0];
  }

  async deleteSlot(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await db.delete(schema.slots).where(eq(schema.slots.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getDetectionLogs(limit: number = 100, offset: number = 0): Promise<DetectionLog[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.detectionLogs).orderBy(desc(schema.detectionLogs.timestamp)).limit(limit).offset(offset);
  }

  async getDetectionLogsBySlot(slotId: string, limit: number = 100): Promise<DetectionLog[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.detectionLogs).where(eq(schema.detectionLogs.slotId, slotId)).orderBy(desc(schema.detectionLogs.timestamp)).limit(limit);
  }

  async getDetectionLogsByDateRange(startDate: Date, endDate: Date): Promise<DetectionLog[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.detectionLogs).where(and(gte(schema.detectionLogs.timestamp, startDate), lte(schema.detectionLogs.timestamp, endDate))).orderBy(desc(schema.detectionLogs.timestamp)).limit(10000);
  }

  async getLatestDetectionLogBySlotBeforeTime(slotId: string, timestamp: Date): Promise<DetectionLog | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.detectionLogs)
      .where(and(
        eq(schema.detectionLogs.slotId, slotId),
        lte(schema.detectionLogs.timestamp, timestamp)
      ))
      .orderBy(desc(schema.detectionLogs.timestamp))
      .limit(1);
    return result[0];
  }

  async createDetectionLog(log: InsertDetectionLog): Promise<DetectionLog> {
    await this.ensureInitialized();
    return this.withDbRetry(async () => {
      const result = await db.insert(schema.detectionLogs).values(log).returning();
      return result[0];
    }, 'createDetectionLog');
  }

  async deleteDetectionLogsBySlotId(slotId: string): Promise<number> {
    await this.ensureInitialized();
    const result = await db.delete(schema.detectionLogs)
      .where(eq(schema.detectionLogs.slotId, slotId));
    return result.rowCount || 0;
  }

  async getAlertRules(): Promise<AlertRule[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.alertRules);
  }

  async getActiveAlertRules(): Promise<AlertRule[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.alertRules).where(eq(schema.alertRules.isEnabled, true));
  }

  async getAlertRule(id: string): Promise<AlertRule | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.alertRules).where(eq(schema.alertRules.id, id));
    return result[0];
  }

  async createAlertRule(rule: InsertAlertRule): Promise<AlertRule> {
    await this.ensureInitialized();
    const result = await db.insert(schema.alertRules).values(rule).returning();
    return result[0];
  }

  async updateAlertRule(id: string, updates: Partial<InsertAlertRule>): Promise<AlertRule | undefined> {
    await this.ensureInitialized();
    const result = await db.update(schema.alertRules).set(updates).where(eq(schema.alertRules.id, id)).returning();
    return result[0];
  }

  async deleteAlertRule(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await db.delete(schema.alertRules).where(eq(schema.alertRules.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getAlertQueue(): Promise<AlertQueue[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.alertQueue).orderBy(desc(schema.alertQueue.scheduledAt));
  }

  async getPendingAlerts(): Promise<AlertQueue[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.alertQueue).where(eq(schema.alertQueue.status, 'pending')).orderBy(desc(schema.alertQueue.scheduledAt));
  }

  async getFailedAlerts(): Promise<AlertQueue[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.alertQueue).where(eq(schema.alertQueue.status, 'failed')).orderBy(desc(schema.alertQueue.scheduledAt));
  }

  async createAlert(alert: InsertAlertQueue): Promise<AlertQueue> {
    await this.ensureInitialized();
    const result = await db.insert(schema.alertQueue).values(alert).returning();
    return result[0];
  }

  async updateAlertStatus(id: string, status: string, sentAt?: Date): Promise<AlertQueue | undefined> {
    await this.ensureInitialized();
    const result = await db.update(schema.alertQueue).set({ status, sentAt }).where(eq(schema.alertQueue.id, id)).returning();
    return result[0];
  }

  async getSystemConfig(): Promise<SystemConfig[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.systemConfig);
  }

  async getConfigByKey(key: string): Promise<SystemConfig | undefined> {
    await this.ensureInitialized();
    return this.withDbRetry(async () => {
      const result = await db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, key));
      return result[0];
    }, `getConfigByKey:${key}`);
  }

  async setConfig(key: string, value: any, description?: string): Promise<SystemConfig> {
    await this.ensureInitialized();
    return this.withDbRetry(async () => {
      const existing = await this.getConfigByKey(key);
      if (existing) {
        const result = await db.update(schema.systemConfig).set({ value, description, updatedAt: new Date() }).where(eq(schema.systemConfig.key, key)).returning();
        return result[0];
      } else {
        const result = await db.insert(schema.systemConfig).values({ key, value, description }).returning();
        return result[0];
      }
    }, `setConfig:${key}`);
  }

  async updateConfig(key: string, value: any): Promise<SystemConfig | undefined> {
    await this.ensureInitialized();
    const result = await db.update(schema.systemConfig).set({ value, updatedAt: new Date() }).where(eq(schema.systemConfig.key, key)).returning();
    return result[0];
  }

  async getToolCategories(): Promise<ToolCategory[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.toolCategories);
  }

  async getToolCategory(id: string): Promise<ToolCategory | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.toolCategories).where(eq(schema.toolCategories.id, id));
    return result[0];
  }

  async createToolCategory(category: InsertToolCategory): Promise<ToolCategory> {
    await this.ensureInitialized();
    const result = await db.insert(schema.toolCategories).values(category).returning();
    return result[0];
  }

  async updateToolCategory(id: string, updates: Partial<InsertToolCategory>): Promise<ToolCategory | undefined> {
    await this.ensureInitialized();
    const result = await db.update(schema.toolCategories).set(updates).where(eq(schema.toolCategories.id, id)).returning();
    return result[0];
  }

  async deleteToolCategory(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await db.delete(schema.toolCategories).where(eq(schema.toolCategories.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getTemplateRectangles(): Promise<TemplateRectangle[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.templateRectangles);
  }

  async getTemplateRectanglesByPaperSize(paperSize: string): Promise<TemplateRectangle[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.templateRectangles)
      .where(eq(schema.templateRectangles.paperSize, paperSize))
      .orderBy(schema.templateRectangles.createdAt); // Order by creation time for consistency
  }

  async getTemplateRectanglesByPaperSizeAndCamera(paperSize: string, cameraId: string): Promise<TemplateRectangle[]> {
    await this.ensureInitialized();
    // First try to get camera-specific templates
    const cameraSpecific = await db.select().from(schema.templateRectangles)
      .where(
        and(
          eq(schema.templateRectangles.paperSize, paperSize),
          eq(schema.templateRectangles.cameraId, cameraId)
        )
      )
      .orderBy(schema.templateRectangles.createdAt);
    
    // If camera-specific templates exist, return them
    if (cameraSpecific.length > 0) {
      return cameraSpecific;
    }
    
    // Otherwise, fall back to shared templates (cameraId is null)
    return await db.select().from(schema.templateRectangles)
      .where(
        and(
          eq(schema.templateRectangles.paperSize, paperSize),
          isNull(schema.templateRectangles.cameraId)
        )
      )
      .orderBy(schema.templateRectangles.createdAt);
  }

  async getTemplateRectangle(id: string): Promise<TemplateRectangle | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.templateRectangles).where(eq(schema.templateRectangles.id, id));
    return result[0];
  }

  async createTemplateRectangle(rectangle: InsertTemplateRectangle): Promise<TemplateRectangle> {
    await this.ensureInitialized();
    const result = await db.insert(schema.templateRectangles).values(rectangle).returning();
    return result[0];
  }

  async updateTemplateRectangle(id: string, updates: Partial<InsertTemplateRectangle>): Promise<TemplateRectangle | undefined> {
    await this.ensureInitialized();
    const result = await db.update(schema.templateRectangles).set(updates).where(eq(schema.templateRectangles.id, id)).returning();
    return result[0];
  }

  async deleteTemplateRectangle(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await db.delete(schema.templateRectangles).where(eq(schema.templateRectangles.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getTemplateRectanglesByDesignId(designId: string, masterOnly: boolean = false): Promise<TemplateRectangle[]> {
    await this.ensureInitialized();
    
    if (masterOnly) {
      // Return only master templates (camera_id is NULL) - used for printing
      return await db.select().from(schema.templateRectangles)
        .where(and(
          eq(schema.templateRectangles.designId, designId),
          isNull(schema.templateRectangles.cameraId)
        ))
        .orderBy(schema.templateRectangles.createdAt);
    }
    
    // Return all templates for this design (both master and camera-specific)
    return await db.select().from(schema.templateRectangles)
      .where(eq(schema.templateRectangles.designId, designId))
      .orderBy(schema.templateRectangles.createdAt);
  }

  async getTemplateRectanglesByDesignIdAndCamera(designId: string, cameraId: string): Promise<TemplateRectangle[]> {
    await this.ensureInitialized();
    // Get templates that belong to both the specific design AND the camera
    // These are templates that were calibrated for this camera with this design
    return await db.select().from(schema.templateRectangles)
      .where(and(
        eq(schema.templateRectangles.designId, designId),
        eq(schema.templateRectangles.cameraId, cameraId)
      ))
      .orderBy(schema.templateRectangles.createdAt);
  }

  async deleteTemplateRectanglesByDesignId(designId: string): Promise<number> {
    await this.ensureInitialized();
    const result = await db.delete(schema.templateRectangles)
      .where(eq(schema.templateRectangles.designId, designId));
    return result.rowCount || 0;
  }

  // Template design methods
  async getTemplateDesigns(): Promise<TemplateDesign[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.templateDesigns)
      .orderBy(desc(schema.templateDesigns.createdAt));
  }

  async getTemplateDesign(id: string): Promise<TemplateDesign | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.templateDesigns)
      .where(eq(schema.templateDesigns.id, id));
    return result[0];
  }

  async getTemplateDesignByTimestamp(timestamp: string): Promise<TemplateDesign | undefined> {
    await this.ensureInitialized();
    // Parse the timestamp and find the design with matching createdAt
    const targetDate = new Date(timestamp);
    const result = await db.select().from(schema.templateDesigns)
      .where(eq(schema.templateDesigns.createdAt, targetDate));
    return result[0];
  }

  async createTemplateDesign(design: InsertTemplateDesign): Promise<TemplateDesign> {
    await this.ensureInitialized();
    const result = await db.insert(schema.templateDesigns)
      .values(design)
      .returning();
    return result[0];
  }

  async updateTemplateDesign(id: string, updates: Partial<InsertTemplateDesign>): Promise<TemplateDesign | undefined> {
    await this.ensureInitialized();
    const result = await db.update(schema.templateDesigns)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.templateDesigns.id, id))
      .returning();
    return result[0];
  }

  async deleteTemplateDesign(id: string): Promise<boolean> {
    await this.ensureInitialized();
    // Delete associated rectangles first (cascade)
    await this.deleteTemplateRectanglesByDesignId(id);
    
    const result = await db.delete(schema.templateDesigns)
      .where(eq(schema.templateDesigns.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async saveTemplateDesignWithRectangles(design: InsertTemplateDesign, rectangles: InsertTemplateRectangle[], existingId?: string): Promise<TemplateDesign> {
    await this.ensureInitialized();
    // Atomic transaction - all or nothing
    return await db.transaction(async (tx) => {
      let savedDesign: TemplateDesign;
      
      if (existingId) {
        // Update existing design
        const updated = await tx.update(schema.templateDesigns)
          .set({ ...design, updatedAt: new Date() })
          .where(eq(schema.templateDesigns.id, existingId))
          .returning();
        
        if (!updated || updated.length === 0) {
          throw new Error(`Template design ${existingId} not found`);
        }
        savedDesign = updated[0];
        
        // Delete old rectangles
        await tx.delete(schema.templateRectangles)
          .where(eq(schema.templateRectangles.designId, existingId));
      } else {
        // Create new design
        const created = await tx.insert(schema.templateDesigns)
          .values(design)
          .returning();
        savedDesign = created[0];
      }
      
      // Bulk insert all rectangles linked to this design
      if (rectangles.length > 0) {
        const rectanglesToInsert = rectangles.map(rect => ({
          ...rect,
          designId: savedDesign.id,
          paperSize: savedDesign.paperSize,
        }));
        
        await tx.insert(schema.templateRectangles).values(rectanglesToInsert);
      }
      
      return savedDesign;
    });
  }

  // Worker methods
  async getWorkers(): Promise<Worker[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.workers);
  }

  async getActiveWorkers(): Promise<Worker[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.workers).where(eq(schema.workers.isActive, true));
  }

  async getWorker(id: string): Promise<Worker | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.workers).where(eq(schema.workers.id, id));
    return result[0];
  }

  async getWorkerByCode(workerCode: string): Promise<Worker | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.workers).where(eq(schema.workers.workerCode, workerCode));
    return result[0];
  }

  async createWorker(worker: InsertWorker & { arucoId: number; workerCode: string }): Promise<Worker> {
    await this.ensureInitialized();
    const result = await db.insert(schema.workers).values(worker).returning();
    return result[0];
  }

  async updateWorker(id: string, updates: Partial<Worker>): Promise<Worker | undefined> {
    await this.ensureInitialized();
    const result = await db.update(schema.workers).set(updates).where(eq(schema.workers.id, id)).returning();
    return result[0];
  }

  async deleteWorker(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await db.delete(schema.workers).where(eq(schema.workers.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getCaptureRuns(limit: number = 50): Promise<CaptureRun[]> {
    await this.ensureInitialized();
    return await db.select().from(schema.captureRuns).orderBy(desc(schema.captureRuns.timestamp)).limit(limit);
  }

  async getCaptureRun(id: string): Promise<CaptureRun | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.captureRuns).where(eq(schema.captureRuns.id, id));
    return result[0];
  }

  async createCaptureRun(run: InsertCaptureRun): Promise<CaptureRun> {
    await this.ensureInitialized();
    return this.withDbRetry(async () => {
      const result = await db.insert(schema.captureRuns).values(run as any).returning();
      return result[0];
    }, 'createCaptureRun');
  }

  // Google OAuth credential methods
  async getGoogleOAuthCredential(service: 'gmail' | 'sheets'): Promise<GoogleOAuthCredential | undefined> {
    await this.ensureInitialized();
    const result = await db.select().from(schema.googleOAuthCredentials).where(eq(schema.googleOAuthCredentials.service, service));
    return result[0];
  }

  async setGoogleOAuthCredential(service: 'gmail' | 'sheets', credential: Partial<InsertGoogleOAuthCredential>): Promise<GoogleOAuthCredential> {
    await this.ensureInitialized();
    const existing = await this.getGoogleOAuthCredential(service);
    
    if (existing) {
      const result = await db.update(schema.googleOAuthCredentials)
        .set({ ...credential, updatedAt: new Date() })
        .where(eq(schema.googleOAuthCredentials.service, service))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(schema.googleOAuthCredentials)
        .values({ service, ...credential } as any)
        .returning();
      return result[0];
    }
  }

  async deleteGoogleOAuthCredential(service: 'gmail' | 'sheets'): Promise<boolean> {
    await this.ensureInitialized();
    const result = await db.delete(schema.googleOAuthCredentials).where(eq(schema.googleOAuthCredentials.service, service));
    return result.rowCount !== null && result.rowCount > 0;
  }
}

export const storage = new DbStorage();
