import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  deviceIndex: integer("device_index").notNull().default(0),
  devicePath: text("device_path"), // For Raspberry Pi: /dev/video0, /dev/video1, etc.
  resolution: json("resolution").$type<[number, number]>().notNull().default([1920, 1080]),
  homographyMatrix: json("homography_matrix").$type<number[]>(),
  calibrationTimestamp: timestamp("calibration_timestamp"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const slots = pgTable("slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slotId: text("slot_id").notNull().unique(),
  cameraId: varchar("camera_id").references(() => cameras.id).notNull(),
  toolName: text("tool_name").notNull(),
  expectedQrId: text("expected_qr_id"),
  priority: text("priority").notNull().default("medium"), // high, medium, low
  regionCoords: json("region_coords").$type<number[][]>().notNull(), // polygon coordinates
  allowCheckout: boolean("allow_checkout").notNull().default(true),
  graceWindow: text("grace_window").default("08:30-16:30"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const detectionLogs = pgTable("detection_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slotId: varchar("slot_id").references(() => slots.id).notNull(),
  timestamp: timestamp("timestamp").notNull().default(sql`now()`),
  status: text("status").notNull(), // EMPTY, ITEM_PRESENT, CHECKED_OUT, TRAINING_ERROR
  qrId: text("qr_id"),
  workerId: varchar("worker_id").references(() => workers.id),
  workerName: text("worker_name"),
  ssimScore: real("ssim_score"),
  poseQuality: real("pose_quality"),
  imagePath: text("image_path"),
  alertTriggered: boolean("alert_triggered").notNull().default(false),
  rawDetectionData: json("raw_detection_data"),
});

export const alertRules = pgTable("alert_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ruleType: text("rule_type").notNull(), // TOOL_MISSING, QR_FAILURE, CAMERA_HEALTH
  isEnabled: boolean("is_enabled").notNull().default(true),
  verificationWindow: integer("verification_window").notNull().default(5), // minutes
  businessHoursOnly: boolean("business_hours_only").notNull().default(true),
  priority: text("priority").notNull().default("medium"),
  conditions: json("conditions").$type<Record<string, any>>().notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const alertQueue = pgTable("alert_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slotId: varchar("slot_id").references(() => slots.id),
  ruleId: varchar("rule_id").references(() => alertRules.id).notNull(),
  alertType: text("alert_type").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("pending"), // pending, sent, failed
  retryCount: integer("retry_count").notNull().default(0),
  scheduledAt: timestamp("scheduled_at").notNull().default(sql`now()`),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const systemConfig = pgTable("system_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: json("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("admin"),
  password: text("password").notNull(),
});

export const toolCategories = pgTable("tool_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  toolType: text("tool_type").notNull(),
  widthCm: real("width_cm").notNull(),
  heightCm: real("height_cm").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const templateRectangles = pgTable("template_rectangles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").references(() => toolCategories.id).notNull(),
  cameraId: varchar("camera_id").references(() => cameras.id).notNull(),
  paperSize: text("paper_size").notNull(), // A3, A4, A5, etc.
  xCm: real("x_cm").notNull(),
  yCm: real("y_cm").notNull(),
  rotation: integer("rotation").notNull().default(0), // 0, 45, 90, 135, 180, 225, 270, 315
  autoQrId: text("auto_qr_id"),
  slotId: varchar("slot_id").references(() => slots.id), // Auto-generated slot
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const workers = pgTable("workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerCode: text("worker_code").notNull().unique(),
  name: text("name").notNull(),
  department: text("department"),
  qrPayload: json("qr_payload"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const captureRuns = pgTable("capture_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").notNull().default(sql`now()`),
  triggerType: text("trigger_type").notNull(), // scheduled, manual, diagnostic
  camerasCaptured: integer("cameras_captured").notNull().default(0),
  slotsProcessed: integer("slots_processed").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  status: text("status").notNull(), // success, partial_failure, failure
  errorMessages: json("error_messages").$type<string[]>(),
  executionTimeMs: integer("execution_time_ms"),
});

export const googleOAuthCredentials = pgTable("google_oauth_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  service: text("service").notNull().unique(), // 'gmail' or 'sheets'
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  refreshToken: text("refresh_token"),
  accessToken: text("access_token"),
  expiresAt: timestamp("expires_at"),
  isConfigured: boolean("is_configured").notNull().default(false),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// Insert schemas
export const insertCameraSchema = createInsertSchema(cameras).omit({ id: true, createdAt: true });
export const insertSlotSchema = createInsertSchema(slots).omit({ id: true, createdAt: true });
export const insertDetectionLogSchema = createInsertSchema(detectionLogs).omit({ id: true });
export const insertAlertRuleSchema = createInsertSchema(alertRules).omit({ id: true, createdAt: true });
export const insertAlertQueueSchema = createInsertSchema(alertQueue).omit({ id: true, createdAt: true });
export const insertSystemConfigSchema = createInsertSchema(systemConfig).omit({ id: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true, email: true, role: true });
export const insertToolCategorySchema = createInsertSchema(toolCategories).omit({ id: true, createdAt: true });
export const insertTemplateRectangleSchema = createInsertSchema(templateRectangles).omit({ id: true, createdAt: true });
export const insertWorkerSchema = createInsertSchema(workers).omit({ id: true, createdAt: true, qrPayload: true });
export const insertCaptureRunSchema = createInsertSchema(captureRuns).omit({ id: true, timestamp: true });
export const insertGoogleOAuthCredentialSchema = createInsertSchema(googleOAuthCredentials).omit({ id: true, updatedAt: true });

// Types
export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type InsertSlot = z.infer<typeof insertSlotSchema>;
export type InsertDetectionLog = z.infer<typeof insertDetectionLogSchema>;
export type InsertAlertRule = z.infer<typeof insertAlertRuleSchema>;
export type InsertAlertQueue = z.infer<typeof insertAlertQueueSchema>;
export type InsertSystemConfig = z.infer<typeof insertSystemConfigSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertToolCategory = z.infer<typeof insertToolCategorySchema>;
export type InsertTemplateRectangle = z.infer<typeof insertTemplateRectangleSchema>;
export type InsertWorker = z.infer<typeof insertWorkerSchema>;
export type InsertCaptureRun = z.infer<typeof insertCaptureRunSchema>;
export type InsertGoogleOAuthCredential = z.infer<typeof insertGoogleOAuthCredentialSchema>;

export type Camera = typeof cameras.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type DetectionLog = typeof detectionLogs.$inferSelect;
export type AlertRule = typeof alertRules.$inferSelect;
export type AlertQueue = typeof alertQueue.$inferSelect;
export type SystemConfig = typeof systemConfig.$inferSelect;
export type User = typeof users.$inferSelect;
export type ToolCategory = typeof toolCategories.$inferSelect;
export type TemplateRectangle = typeof templateRectangles.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type CaptureRun = typeof captureRuns.$inferSelect;
export type GoogleOAuthCredential = typeof googleOAuthCredentials.$inferSelect;
