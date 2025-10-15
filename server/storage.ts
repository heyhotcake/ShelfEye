import { type Camera, type Slot, type DetectionLog, type AlertRule, type AlertQueue, type SystemConfig, type User, type ToolCategory, type TemplateRectangle, type Worker, type CaptureRun, type InsertCamera, type InsertSlot, type InsertDetectionLog, type InsertAlertRule, type InsertAlertQueue, type InsertSystemConfig, type InsertUser, type InsertToolCategory, type InsertTemplateRectangle, type InsertWorker, type InsertCaptureRun } from "@shared/schema";
import { randomUUID } from "crypto";

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

  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Tool category methods
  getToolCategories(): Promise<ToolCategory[]>;
  getToolCategory(id: string): Promise<ToolCategory | undefined>;
  createToolCategory(category: InsertToolCategory): Promise<ToolCategory>;
  updateToolCategory(id: string, updates: Partial<InsertToolCategory>): Promise<ToolCategory | undefined>;
  deleteToolCategory(id: string): Promise<boolean>;

  // Template rectangle methods
  getTemplateRectangles(): Promise<TemplateRectangle[]>;
  getTemplateRectanglesByPaperSize(paperSize: string): Promise<TemplateRectangle[]>;
  getTemplateRectanglesByCamera(cameraId: string): Promise<TemplateRectangle[]>;
  getTemplateRectangle(id: string): Promise<TemplateRectangle | undefined>;
  createTemplateRectangle(rectangle: InsertTemplateRectangle): Promise<TemplateRectangle>;
  updateTemplateRectangle(id: string, updates: Partial<InsertTemplateRectangle>): Promise<TemplateRectangle | undefined>;
  deleteTemplateRectangle(id: string): Promise<boolean>;

  // Worker methods
  getWorkers(): Promise<Worker[]>;
  getActiveWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  getWorkerByCode(workerCode: string): Promise<Worker | undefined>;
  createWorker(worker: InsertWorker): Promise<Worker>;
  updateWorker(id: string, updates: Partial<Worker>): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;

  // Capture run methods
  getCaptureRuns(limit?: number): Promise<CaptureRun[]>;
  getCaptureRun(id: string): Promise<CaptureRun | undefined>;
  createCaptureRun(run: InsertCaptureRun): Promise<CaptureRun>;
}

export class MemStorage implements IStorage {
  private cameras: Map<string, Camera> = new Map();
  private slots: Map<string, Slot> = new Map();
  private detectionLogs: DetectionLog[] = [];
  private alertRules: Map<string, AlertRule> = new Map();
  private alertQueue: Map<string, AlertQueue> = new Map();
  private systemConfig: Map<string, SystemConfig> = new Map();
  private users: Map<string, User> = new Map();
  private toolCategories: Map<string, ToolCategory> = new Map();
  private templateRectangles: Map<string, TemplateRectangle> = new Map();
  private workers: Map<string, Worker> = new Map();
  private captureRuns: Map<string, CaptureRun> = new Map();

  constructor() {
    // Initialize with default camera and slots
    this.initializeDefaults();
  }

  private async initializeDefaults() {
    // Create default camera
    const defaultCamera = await this.createCamera({
      name: "Camera Station A",
      deviceIndex: 0,
      resolution: [1920, 1080],
      isActive: true,
    });

    // No default slots - user will create their own via the slot drawing UI

    // Create default alert rules
    await this.createAlertRule({
      name: "Tool Missing Alert",
      ruleType: "TOOL_MISSING",
      isEnabled: true,
      verificationWindow: 5,
      businessHoursOnly: true,
      priority: "high",
      conditions: { emptyDurationMinutes: 5 },
    });

    await this.createAlertRule({
      name: "QR Detection Failure",
      ruleType: "QR_FAILURE",
      isEnabled: true,
      verificationWindow: 3,
      businessHoursOnly: false,
      priority: "medium",
      conditions: { consecutiveFailures: 3 },
    });

    await this.createAlertRule({
      name: "Camera Health Alert",
      ruleType: "CAMERA_HEALTH",
      isEnabled: true,
      verificationWindow: 1,
      businessHoursOnly: false,
      priority: "high",
      conditions: { maxReprojectionError: 2.5 },
    });

    // Initialize system config
    await this.setConfig("BUSINESS_HOURS", "08:00-20:00", "Operating hours for alerts");
    await this.setConfig("EMAIL_RECIPIENTS", ["manager@factory.com", "supervisor@factory.com"], "Alert email recipients");
    await this.setConfig("GOOGLE_SHEETS_ID", "", "Google Sheets ID for logging");
    await this.setConfig("SMTP_CONFIG", {
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: "", pass: "" }
    }, "SMTP configuration for email alerts");
    await this.setConfig("CAPTURE_SCHEDULE", ["08:00", "11:00", "14:00", "17:00"], "Scheduled capture times");

    // Create admin user
    await this.createUser({
      username: "admin",
      email: "admin@factory.com",
      role: "admin",
      password: "admin123", // In real app, this would be hashed
    });
  }

  // Camera methods
  async getCameras(): Promise<Camera[]> {
    return Array.from(this.cameras.values());
  }

  async getCamera(id: string): Promise<Camera | undefined> {
    return this.cameras.get(id);
  }

  async createCamera(camera: InsertCamera): Promise<Camera> {
    const id = randomUUID();
    const newCamera: Camera = {
      ...camera,
      id,
      createdAt: new Date(),
      calibrationTimestamp: null,
      homographyMatrix: null,
    };
    this.cameras.set(id, newCamera);
    return newCamera;
  }

  async updateCamera(id: string, updates: Partial<InsertCamera>): Promise<Camera | undefined> {
    const camera = this.cameras.get(id);
    if (!camera) return undefined;

    const updated = { ...camera, ...updates };
    this.cameras.set(id, updated);
    return updated;
  }

  async deleteCamera(id: string): Promise<boolean> {
    return this.cameras.delete(id);
  }

  // Slot methods
  async getSlots(): Promise<Slot[]> {
    return Array.from(this.slots.values());
  }

  async getSlotsByCamera(cameraId: string): Promise<Slot[]> {
    return Array.from(this.slots.values()).filter(slot => slot.cameraId === cameraId);
  }

  async getSlot(id: string): Promise<Slot | undefined> {
    return this.slots.get(id);
  }

  async getSlotBySlotId(slotId: string): Promise<Slot | undefined> {
    return Array.from(this.slots.values()).find(slot => slot.slotId === slotId);
  }

  async createSlot(slot: InsertSlot): Promise<Slot> {
    const id = randomUUID();
    const newSlot: Slot = {
      ...slot,
      id,
      createdAt: new Date(),
    };
    this.slots.set(id, newSlot);
    return newSlot;
  }

  async updateSlot(id: string, updates: Partial<InsertSlot>): Promise<Slot | undefined> {
    const slot = this.slots.get(id);
    if (!slot) return undefined;

    const updated = { ...slot, ...updates };
    this.slots.set(id, updated);
    return updated;
  }

  async deleteSlot(id: string): Promise<boolean> {
    return this.slots.delete(id);
  }

  // Detection log methods
  async getDetectionLogs(limit = 100, offset = 0): Promise<DetectionLog[]> {
    return this.detectionLogs
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(offset, offset + limit);
  }

  async getDetectionLogsBySlot(slotId: string, limit = 50): Promise<DetectionLog[]> {
    return this.detectionLogs
      .filter(log => log.slotId === slotId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getDetectionLogsByDateRange(startDate: Date, endDate: Date): Promise<DetectionLog[]> {
    return this.detectionLogs.filter(log => 
      log.timestamp >= startDate && log.timestamp <= endDate
    ).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async getLatestDetectionLogBySlotBeforeTime(slotId: string, timestamp: Date): Promise<DetectionLog | undefined> {
    const slotLogs = this.detectionLogs
      .filter(log => log.slotId === slotId && log.timestamp <= timestamp)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return slotLogs[0];
  }

  async createDetectionLog(log: InsertDetectionLog): Promise<DetectionLog> {
    const id = randomUUID();
    const newLog: DetectionLog = {
      ...log,
      id,
      timestamp: log.timestamp || new Date(),
    };
    this.detectionLogs.push(newLog);
    return newLog;
  }

  // Alert rule methods
  async getAlertRules(): Promise<AlertRule[]> {
    return Array.from(this.alertRules.values());
  }

  async getActiveAlertRules(): Promise<AlertRule[]> {
    return Array.from(this.alertRules.values()).filter(rule => rule.isEnabled);
  }

  async getAlertRule(id: string): Promise<AlertRule | undefined> {
    return this.alertRules.get(id);
  }

  async createAlertRule(rule: InsertAlertRule): Promise<AlertRule> {
    const id = randomUUID();
    const newRule: AlertRule = {
      ...rule,
      id,
      createdAt: new Date(),
    };
    this.alertRules.set(id, newRule);
    return newRule;
  }

  async updateAlertRule(id: string, updates: Partial<InsertAlertRule>): Promise<AlertRule | undefined> {
    const rule = this.alertRules.get(id);
    if (!rule) return undefined;

    const updated = { ...rule, ...updates };
    this.alertRules.set(id, updated);
    return updated;
  }

  async deleteAlertRule(id: string): Promise<boolean> {
    return this.alertRules.delete(id);
  }

  // Alert queue methods
  async getAlertQueue(): Promise<AlertQueue[]> {
    return Array.from(this.alertQueue.values())
      .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());
  }

  async getPendingAlerts(): Promise<AlertQueue[]> {
    return Array.from(this.alertQueue.values())
      .filter(alert => alert.status === "pending");
  }

  async getFailedAlerts(): Promise<AlertQueue[]> {
    return Array.from(this.alertQueue.values())
      .filter(alert => alert.status === "failed");
  }

  async createAlert(alert: InsertAlertQueue): Promise<AlertQueue> {
    const id = randomUUID();
    const newAlert: AlertQueue = {
      ...alert,
      id,
      createdAt: new Date(),
      sentAt: null,
    };
    this.alertQueue.set(id, newAlert);
    return newAlert;
  }

  async updateAlertStatus(id: string, status: string, sentAt?: Date): Promise<AlertQueue | undefined> {
    const alert = this.alertQueue.get(id);
    if (!alert) return undefined;

    const updated = { ...alert, status, sentAt: sentAt || null };
    this.alertQueue.set(id, updated);
    return updated;
  }

  // System config methods
  async getSystemConfig(): Promise<SystemConfig[]> {
    return Array.from(this.systemConfig.values());
  }

  async getConfigByKey(key: string): Promise<SystemConfig | undefined> {
    return this.systemConfig.get(key);
  }

  async setConfig(key: string, value: any, description?: string): Promise<SystemConfig> {
    const config: SystemConfig = {
      id: randomUUID(),
      key,
      value,
      description: description || null,
      updatedAt: new Date(),
    };
    this.systemConfig.set(key, config);
    return config;
  }

  async updateConfig(key: string, value: any): Promise<SystemConfig | undefined> {
    const config = this.systemConfig.get(key);
    if (!config) return undefined;

    const updated = { ...config, value, updatedAt: new Date() };
    this.systemConfig.set(key, updated);
    return updated;
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.email === email);
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = randomUUID();
    const newUser: User = { ...user, id };
    this.users.set(id, newUser);
    return newUser;
  }

  // Tool category methods
  async getToolCategories(): Promise<ToolCategory[]> {
    return Array.from(this.toolCategories.values());
  }

  async getToolCategory(id: string): Promise<ToolCategory | undefined> {
    return this.toolCategories.get(id);
  }

  async createToolCategory(category: InsertToolCategory): Promise<ToolCategory> {
    const id = randomUUID();
    const newCategory: ToolCategory = {
      ...category,
      id,
      createdAt: new Date(),
    };
    this.toolCategories.set(id, newCategory);
    return newCategory;
  }

  async updateToolCategory(id: string, updates: Partial<InsertToolCategory>): Promise<ToolCategory | undefined> {
    const category = this.toolCategories.get(id);
    if (!category) return undefined;

    const updated = { ...category, ...updates };
    this.toolCategories.set(id, updated);
    return updated;
  }

  async deleteToolCategory(id: string): Promise<boolean> {
    return this.toolCategories.delete(id);
  }

  // Template rectangle methods
  async getTemplateRectangles(): Promise<TemplateRectangle[]> {
    return Array.from(this.templateRectangles.values());
  }

  async getTemplateRectanglesByPaperSize(paperSize: string): Promise<TemplateRectangle[]> {
    return Array.from(this.templateRectangles.values())
      .filter(rect => rect.paperSize === paperSize);
  }

  async getTemplateRectanglesByCamera(cameraId: string): Promise<TemplateRectangle[]> {
    return Array.from(this.templateRectangles.values())
      .filter(rect => rect.cameraId === cameraId);
  }

  async getTemplateRectangle(id: string): Promise<TemplateRectangle | undefined> {
    return this.templateRectangles.get(id);
  }

  async createTemplateRectangle(rectangle: InsertTemplateRectangle): Promise<TemplateRectangle> {
    const id = randomUUID();
    const newRectangle: TemplateRectangle = {
      ...rectangle,
      id,
      createdAt: new Date(),
    };
    this.templateRectangles.set(id, newRectangle);
    return newRectangle;
  }

  async updateTemplateRectangle(id: string, updates: Partial<InsertTemplateRectangle>): Promise<TemplateRectangle | undefined> {
    const rectangle = this.templateRectangles.get(id);
    if (!rectangle) return undefined;

    const updated = { ...rectangle, ...updates };
    this.templateRectangles.set(id, updated);
    return updated;
  }

  async deleteTemplateRectangle(id: string): Promise<boolean> {
    return this.templateRectangles.delete(id);
  }

  // Worker methods
  async getWorkers(): Promise<Worker[]> {
    return Array.from(this.workers.values());
  }

  async getActiveWorkers(): Promise<Worker[]> {
    return Array.from(this.workers.values()).filter(w => w.isActive);
  }

  async getWorker(id: string): Promise<Worker | undefined> {
    return this.workers.get(id);
  }

  async getWorkerByCode(workerCode: string): Promise<Worker | undefined> {
    return Array.from(this.workers.values()).find(w => w.workerCode === workerCode);
  }

  async createWorker(worker: InsertWorker): Promise<Worker> {
    const existing = Array.from(this.workers.values()).find(w => w.workerCode === worker.workerCode);
    if (existing) {
      throw new Error(`Worker with code ${worker.workerCode} already exists`);
    }

    const id = randomUUID();
    const newWorker: Worker = {
      id,
      workerCode: worker.workerCode,
      name: worker.name,
      department: worker.department ?? null,
      qrPayload: null,
      isActive: worker.isActive ?? true,
      createdAt: new Date(),
    };
    this.workers.set(id, newWorker);
    return newWorker;
  }

  async updateWorker(id: string, updates: Partial<Worker>): Promise<Worker | undefined> {
    const worker = this.workers.get(id);
    if (!worker) return undefined;

    if (updates.workerCode && updates.workerCode !== worker.workerCode) {
      const existing = Array.from(this.workers.values()).find(
        w => w.id !== id && w.workerCode === updates.workerCode
      );
      if (existing) {
        throw new Error(`Worker with code ${updates.workerCode} already exists`);
      }
    }

    const updated = { ...worker, ...updates, id: worker.id };
    this.workers.set(id, updated);
    return updated;
  }

  async deleteWorker(id: string): Promise<boolean> {
    return this.workers.delete(id);
  }

  // Capture run methods
  async getCaptureRuns(limit = 50): Promise<CaptureRun[]> {
    return Array.from(this.captureRuns.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getCaptureRun(id: string): Promise<CaptureRun | undefined> {
    return this.captureRuns.get(id);
  }

  async createCaptureRun(run: InsertCaptureRun): Promise<CaptureRun> {
    const id = randomUUID();
    const newRun: CaptureRun = {
      ...run,
      id,
      timestamp: new Date(),
    };
    this.captureRuns.set(id, newRun);
    return newRun;
  }
}

import { db } from './db';
import * as schema from '@shared/schema';
import { eq, desc, and, gte, lte } from 'drizzle-orm';

export class DbStorage implements IStorage {
  constructor() {
    this.initializeDefaults();
  }

  private async initializeDefaults() {
    const existingCameras = await this.getCameras();
    
    if (existingCameras.length === 0) {
      await this.createCamera({
        name: "Camera Station A",
        deviceIndex: 0,
        resolution: [1920, 1080],
        isActive: true,
      });

      await this.createAlertRule({
        name: "Tool Missing Alert",
        ruleType: "TOOL_MISSING",
        isEnabled: true,
        verificationWindow: 5,
        businessHoursOnly: true,
        priority: "high",
        conditions: { emptyDurationMinutes: 5 },
      });

      await this.createAlertRule({
        name: "QR Detection Failure",
        ruleType: "QR_FAILURE",
        isEnabled: true,
        verificationWindow: 3,
        businessHoursOnly: false,
        priority: "medium",
        conditions: { consecutiveFailures: 3 },
      });

      await this.createAlertRule({
        name: "Camera Health Alert",
        ruleType: "CAMERA_HEALTH",
        isEnabled: true,
        verificationWindow: 1,
        businessHoursOnly: false,
        priority: "high",
        conditions: { maxReprojectionError: 2.5 },
      });

      await this.setConfig("smtp_host", "smtp.gmail.com", "SMTP server host");
      await this.setConfig("smtp_port", 587, "SMTP server port");
      await this.setConfig("smtp_user", "", "SMTP username");
      await this.setConfig("smtp_pass", "", "SMTP password");
      await this.setConfig("smtp_from", "alerts@example.com", "Alert email sender");
      await this.setConfig("alert_email", "", "Alert recipient email");
      await this.setConfig("google_sheets_url", "", "Google Sheets logging URL");
      await this.setConfig("buzzer_gpio_pin", 17, "Buzzer GPIO pin");
      await this.setConfig("led_gpio_pin", 27, "LED GPIO pin");
    }
  }

  async getCameras(): Promise<Camera[]> {
    return await db.select().from(schema.cameras);
  }

  async getCamera(id: string): Promise<Camera | undefined> {
    const result = await db.select().from(schema.cameras).where(eq(schema.cameras.id, id));
    return result[0];
  }

  async createCamera(camera: InsertCamera): Promise<Camera> {
    const result = await db.insert(schema.cameras).values(camera).returning();
    return result[0];
  }

  async updateCamera(id: string, updates: Partial<InsertCamera>): Promise<Camera | undefined> {
    const result = await db.update(schema.cameras).set(updates).where(eq(schema.cameras.id, id)).returning();
    return result[0];
  }

  async deleteCamera(id: string): Promise<boolean> {
    const result = await db.delete(schema.cameras).where(eq(schema.cameras.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getSlots(): Promise<Slot[]> {
    return await db.select().from(schema.slots);
  }

  async getSlotsByCamera(cameraId: string): Promise<Slot[]> {
    return await db.select().from(schema.slots).where(eq(schema.slots.cameraId, cameraId));
  }

  async getSlot(id: string): Promise<Slot | undefined> {
    const result = await db.select().from(schema.slots).where(eq(schema.slots.id, id));
    return result[0];
  }

  async getSlotBySlotId(slotId: string): Promise<Slot | undefined> {
    const result = await db.select().from(schema.slots).where(eq(schema.slots.slotId, slotId));
    return result[0];
  }

  async createSlot(slot: InsertSlot): Promise<Slot> {
    const result = await db.insert(schema.slots).values(slot).returning();
    return result[0];
  }

  async updateSlot(id: string, updates: Partial<InsertSlot>): Promise<Slot | undefined> {
    const result = await db.update(schema.slots).set(updates).where(eq(schema.slots.id, id)).returning();
    return result[0];
  }

  async deleteSlot(id: string): Promise<boolean> {
    const result = await db.delete(schema.slots).where(eq(schema.slots.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getDetectionLogs(limit: number = 100, offset: number = 0): Promise<DetectionLog[]> {
    return await db.select().from(schema.detectionLogs).orderBy(desc(schema.detectionLogs.timestamp)).limit(limit).offset(offset);
  }

  async getDetectionLogsBySlot(slotId: string, limit: number = 100): Promise<DetectionLog[]> {
    return await db.select().from(schema.detectionLogs).where(eq(schema.detectionLogs.slotId, slotId)).orderBy(desc(schema.detectionLogs.timestamp)).limit(limit);
  }

  async getDetectionLogsByDateRange(startDate: Date, endDate: Date): Promise<DetectionLog[]> {
    return await db.select().from(schema.detectionLogs).where(and(gte(schema.detectionLogs.timestamp, startDate), lte(schema.detectionLogs.timestamp, endDate))).orderBy(desc(schema.detectionLogs.timestamp));
  }

  async getLatestDetectionLogBySlotBeforeTime(slotId: string, timestamp: Date): Promise<DetectionLog | undefined> {
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
    const result = await db.insert(schema.detectionLogs).values(log).returning();
    return result[0];
  }

  async getAlertRules(): Promise<AlertRule[]> {
    return await db.select().from(schema.alertRules);
  }

  async getActiveAlertRules(): Promise<AlertRule[]> {
    return await db.select().from(schema.alertRules).where(eq(schema.alertRules.isEnabled, true));
  }

  async getAlertRule(id: string): Promise<AlertRule | undefined> {
    const result = await db.select().from(schema.alertRules).where(eq(schema.alertRules.id, id));
    return result[0];
  }

  async createAlertRule(rule: InsertAlertRule): Promise<AlertRule> {
    const result = await db.insert(schema.alertRules).values(rule).returning();
    return result[0];
  }

  async updateAlertRule(id: string, updates: Partial<InsertAlertRule>): Promise<AlertRule | undefined> {
    const result = await db.update(schema.alertRules).set(updates).where(eq(schema.alertRules.id, id)).returning();
    return result[0];
  }

  async deleteAlertRule(id: string): Promise<boolean> {
    const result = await db.delete(schema.alertRules).where(eq(schema.alertRules.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getAlertQueue(): Promise<AlertQueue[]> {
    return await db.select().from(schema.alertQueue).orderBy(desc(schema.alertQueue.scheduledAt));
  }

  async getPendingAlerts(): Promise<AlertQueue[]> {
    return await db.select().from(schema.alertQueue).where(eq(schema.alertQueue.status, 'pending')).orderBy(desc(schema.alertQueue.scheduledAt));
  }

  async getFailedAlerts(): Promise<AlertQueue[]> {
    return await db.select().from(schema.alertQueue).where(eq(schema.alertQueue.status, 'failed')).orderBy(desc(schema.alertQueue.scheduledAt));
  }

  async createAlert(alert: InsertAlertQueue): Promise<AlertQueue> {
    const result = await db.insert(schema.alertQueue).values(alert).returning();
    return result[0];
  }

  async updateAlertStatus(id: string, status: string, sentAt?: Date): Promise<AlertQueue | undefined> {
    const result = await db.update(schema.alertQueue).set({ status, sentAt }).where(eq(schema.alertQueue.id, id)).returning();
    return result[0];
  }

  async getSystemConfig(): Promise<SystemConfig[]> {
    return await db.select().from(schema.systemConfig);
  }

  async getConfigByKey(key: string): Promise<SystemConfig | undefined> {
    const result = await db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, key));
    return result[0];
  }

  async setConfig(key: string, value: any, description?: string): Promise<SystemConfig> {
    const existing = await this.getConfigByKey(key);
    if (existing) {
      const result = await db.update(schema.systemConfig).set({ value, description, updatedAt: new Date() }).where(eq(schema.systemConfig.key, key)).returning();
      return result[0];
    } else {
      const result = await db.insert(schema.systemConfig).values({ key, value, description }).returning();
      return result[0];
    }
  }

  async updateConfig(key: string, value: any): Promise<SystemConfig | undefined> {
    const result = await db.update(schema.systemConfig).set({ value, updatedAt: new Date() }).where(eq(schema.systemConfig.key, key)).returning();
    return result[0];
  }

  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(schema.users).where(eq(schema.users.username, username));
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return result[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    const result = await db.insert(schema.users).values(user).returning();
    return result[0];
  }

  async getToolCategories(): Promise<ToolCategory[]> {
    return await db.select().from(schema.toolCategories);
  }

  async getToolCategory(id: string): Promise<ToolCategory | undefined> {
    const result = await db.select().from(schema.toolCategories).where(eq(schema.toolCategories.id, id));
    return result[0];
  }

  async createToolCategory(category: InsertToolCategory): Promise<ToolCategory> {
    const result = await db.insert(schema.toolCategories).values(category).returning();
    return result[0];
  }

  async updateToolCategory(id: string, updates: Partial<InsertToolCategory>): Promise<ToolCategory | undefined> {
    const result = await db.update(schema.toolCategories).set(updates).where(eq(schema.toolCategories.id, id)).returning();
    return result[0];
  }

  async deleteToolCategory(id: string): Promise<boolean> {
    const result = await db.delete(schema.toolCategories).where(eq(schema.toolCategories.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getTemplateRectangles(): Promise<TemplateRectangle[]> {
    return await db.select().from(schema.templateRectangles);
  }

  async getTemplateRectanglesByPaperSize(paperSize: string): Promise<TemplateRectangle[]> {
    return await db.select().from(schema.templateRectangles).where(eq(schema.templateRectangles.paperSize, paperSize));
  }

  async getTemplateRectanglesByCamera(cameraId: string): Promise<TemplateRectangle[]> {
    return await db.select().from(schema.templateRectangles).where(eq(schema.templateRectangles.cameraId, cameraId));
  }

  async getTemplateRectangle(id: string): Promise<TemplateRectangle | undefined> {
    const result = await db.select().from(schema.templateRectangles).where(eq(schema.templateRectangles.id, id));
    return result[0];
  }

  async createTemplateRectangle(rectangle: InsertTemplateRectangle): Promise<TemplateRectangle> {
    const result = await db.insert(schema.templateRectangles).values(rectangle).returning();
    return result[0];
  }

  async updateTemplateRectangle(id: string, updates: Partial<InsertTemplateRectangle>): Promise<TemplateRectangle | undefined> {
    const result = await db.update(schema.templateRectangles).set(updates).where(eq(schema.templateRectangles.id, id)).returning();
    return result[0];
  }

  async deleteTemplateRectangle(id: string): Promise<boolean> {
    const result = await db.delete(schema.templateRectangles).where(eq(schema.templateRectangles.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Worker methods
  async getWorkers(): Promise<Worker[]> {
    return await db.select().from(schema.workers);
  }

  async getActiveWorkers(): Promise<Worker[]> {
    return await db.select().from(schema.workers).where(eq(schema.workers.isActive, true));
  }

  async getWorker(id: string): Promise<Worker | undefined> {
    const result = await db.select().from(schema.workers).where(eq(schema.workers.id, id));
    return result[0];
  }

  async getWorkerByCode(workerCode: string): Promise<Worker | undefined> {
    const result = await db.select().from(schema.workers).where(eq(schema.workers.workerCode, workerCode));
    return result[0];
  }

  async createWorker(worker: InsertWorker): Promise<Worker> {
    const result = await db.insert(schema.workers).values(worker).returning();
    return result[0];
  }

  async updateWorker(id: string, updates: Partial<Worker>): Promise<Worker | undefined> {
    const result = await db.update(schema.workers).set(updates).where(eq(schema.workers.id, id)).returning();
    return result[0];
  }

  async deleteWorker(id: string): Promise<boolean> {
    const result = await db.delete(schema.workers).where(eq(schema.workers.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getCaptureRuns(limit: number = 50): Promise<CaptureRun[]> {
    return await db.select().from(schema.captureRuns).orderBy(desc(schema.captureRuns.timestamp)).limit(limit);
  }

  async getCaptureRun(id: string): Promise<CaptureRun | undefined> {
    const result = await db.select().from(schema.captureRuns).where(eq(schema.captureRuns.id, id));
    return result[0];
  }

  async createCaptureRun(run: InsertCaptureRun): Promise<CaptureRun> {
    const result = await db.insert(schema.captureRuns).values(run).returning();
    return result[0];
  }
}

export const storage = new DbStorage();
