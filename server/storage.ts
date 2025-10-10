import { type Camera, type Slot, type DetectionLog, type AlertRule, type AlertQueue, type SystemConfig, type User, type InsertCamera, type InsertSlot, type InsertDetectionLog, type InsertAlertRule, type InsertAlertQueue, type InsertSystemConfig, type InsertUser } from "@shared/schema";
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
}

export class MemStorage implements IStorage {
  private cameras: Map<string, Camera> = new Map();
  private slots: Map<string, Slot> = new Map();
  private detectionLogs: DetectionLog[] = [];
  private alertRules: Map<string, AlertRule> = new Map();
  private alertQueue: Map<string, AlertQueue> = new Map();
  private systemConfig: Map<string, SystemConfig> = new Map();
  private users: Map<string, User> = new Map();

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
}

export const storage = new MemStorage();
