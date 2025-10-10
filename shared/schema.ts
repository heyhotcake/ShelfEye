import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  deviceIndex: integer("device_index").notNull().default(0),
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

// Insert schemas
export const insertCameraSchema = createInsertSchema(cameras).omit({ id: true, createdAt: true });
export const insertSlotSchema = createInsertSchema(slots).omit({ id: true, createdAt: true });
export const insertDetectionLogSchema = createInsertSchema(detectionLogs).omit({ id: true });
export const insertAlertRuleSchema = createInsertSchema(alertRules).omit({ id: true, createdAt: true });
export const insertAlertQueueSchema = createInsertSchema(alertQueue).omit({ id: true, createdAt: true });
export const insertSystemConfigSchema = createInsertSchema(systemConfig).omit({ id: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true, email: true, role: true });

// Types
export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type InsertSlot = z.infer<typeof insertSlotSchema>;
export type InsertDetectionLog = z.infer<typeof insertDetectionLogSchema>;
export type InsertAlertRule = z.infer<typeof insertAlertRuleSchema>;
export type InsertAlertQueue = z.infer<typeof insertAlertQueueSchema>;
export type InsertSystemConfig = z.infer<typeof insertSystemConfigSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Camera = typeof cameras.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type DetectionLog = typeof detectionLogs.$inferSelect;
export type AlertRule = typeof alertRules.$inferSelect;
export type AlertQueue = typeof alertQueue.$inferSelect;
export type SystemConfig = typeof systemConfig.$inferSelect;
export type User = typeof users.$inferSelect;
