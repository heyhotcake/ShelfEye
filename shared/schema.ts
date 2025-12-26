import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, json, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  deviceIndex: integer("device_index"), // Optional - used when devicePath not provided
  devicePath: text("device_path"), // For Raspberry Pi: /dev/video0, /dev/video1, etc.
  resolution: json("resolution").$type<[number, number]>().notNull().default([3840, 2160]),
  paperSize: text("paper_size"), // Template paper size (A4/Letter) - persists calibration template choice
  homographyMatrix: json("homography_matrix").$type<number[]>(),
  cameraMatrix: json("camera_matrix").$type<number[]>(), // 3x3 intrinsic matrix for lens distortion correction
  distCoeffs: json("dist_coeffs").$type<number[]>(), // Distortion coefficients (k1, k2, p1, p2, k3)
  calibrationTimestamp: timestamp("calibration_timestamp"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Grid cell metadata type for scanner/worker tag grids
export type GridCellMetadata = {
  row: number;
  col: number;
  xOffsetCm: number; // Offset from grid center
  yOffsetCm: number;
  widthCm: number;
  heightCm: number;
  label?: string;
};

export const slots = pgTable("slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slotId: text("slot_id").notNull().unique(),
  slotNumber: integer("slot_number").notNull(), // ArUco marker ID (1-50) for slot identification (auto-assigned per camera)
  cameraId: varchar("camera_id").references(() => cameras.id, { onDelete: "cascade" }).notNull(),
  toolName: text("tool_name").notNull(),
  expectedQrId: text("expected_qr_id"), // Legacy column name - stores ArUco marker ID (same as slotNumber)
  priority: text("priority").notNull().default("medium"), // high, medium, low
  regionCoords: json("region_coords").$type<number[][]>().notNull(), // polygon coordinates in pixels
  xCm: real("x_cm").notNull(), // center X position in cm
  yCm: real("y_cm").notNull(), // center Y position in cm
  widthCm: real("width_cm").notNull(), // slot width in cm
  heightCm: real("height_cm").notNull(), // slot height in cm
  rotationDeg: integer("rotation_deg").notNull().default(0), // rotation in degrees
  allowCheckout: boolean("allow_checkout").notNull().default(true),
  graceWindow: text("grace_window").default("08:30-16:30"),
  isActive: boolean("is_active").notNull().default(true),
  slotType: text("slot_type").notNull().default("tool"), // 'tool', 'scanner_grid', 'worker_tag_grid'
  gridMetadata: json("grid_metadata").$type<GridCellMetadata[]>(), // For scanner/worker grids: array of cell definitions
  linkedSlotId: varchar("linked_slot_id"), // Links scanner grid slot ↔ worker tag grid slot (reciprocal)
  createdAt: timestamp("created_at").default(sql`now()`),
}, (table) => ({
  // Ensure each camera has unique slot numbers (1, 2, 3, etc.)
  uniqueSlotNumberPerCamera: unique().on(table.cameraId, table.slotNumber),
}));

export const detectionLogs = pgTable("detection_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slotId: varchar("slot_id").references(() => slots.id, { onDelete: "cascade" }).notNull(),
  timestamp: timestamp("timestamp").notNull().default(sql`now()`),
  status: text("status").notNull(), // EMPTY, ITEM_PRESENT, CHECKED_OUT, TRAINING_ERROR
  qrId: text("qr_id"), // Legacy column name - stores detected ArUco marker ID or worker QR code
  workerId: varchar("worker_id").references(() => workers.id, { onDelete: "set null" }),
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
  ruleType: text("rule_type").notNull(), // TOOL_MISSING, MARKER_DETECTION_FAILURE, CAMERA_HEALTH
  isEnabled: boolean("is_enabled").notNull().default(true),
  verificationWindow: integer("verification_window").notNull().default(5), // minutes
  businessHoursOnly: boolean("business_hours_only").notNull().default(true),
  priority: text("priority").notNull().default("medium"),
  conditions: json("conditions").$type<Record<string, any>>().notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const alertQueue = pgTable("alert_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slotId: varchar("slot_id").references(() => slots.id, { onDelete: "set null" }),
  ruleId: varchar("rule_id").references(() => alertRules.id, { onDelete: "cascade" }).notNull(),
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

export const toolCategories = pgTable("tool_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  label: text("label").notNull(), // Display label for printing (supports Japanese)
  widthCm: real("width_cm").notNull(),
  heightCm: real("height_cm").notNull(),
  categoryType: text("category_type").notNull().default("tool"), // 'tool', 'scanner_grid', 'worker_tag_grid'
  gridRows: integer("grid_rows"), // For grid types: number of rows (e.g., 2)
  gridCols: integer("grid_cols"), // For grid types: number of columns (e.g., 4)
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const templateDesigns = pgTable("template_designs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  paperSize: text("paper_size").notNull(), // A3, A4, A5, 6-page-3x2, 8-page-4x2, etc.
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const templateRectangles = pgTable("template_rectangles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  designId: varchar("design_id").references(() => templateDesigns.id, { onDelete: "cascade" }), // Links rectangle to a saved template design
  cameraId: varchar("camera_id").references(() => cameras.id, { onDelete: "cascade" }), // Camera-specific templates for adjusted coordinates
  categoryId: varchar("category_id").references(() => toolCategories.id, { onDelete: "cascade" }).notNull(),
  paperSize: text("paper_size").notNull(), // A3, A4, A5, etc.
  xCm: real("x_cm").notNull(),
  yCm: real("y_cm").notNull(),
  rotation: integer("rotation").notNull().default(0), // 0, 45, 90, 135, 180, 225, 270, 315
  autoQrId: text("auto_qr_id"), // Legacy column name - stores ArUco marker ID (1-50)
  slotId: varchar("slot_id").references(() => slots.id, { onDelete: "set null" }), // Auto-generated slot
  createdAt: timestamp("created_at").default(sql`now()`),
  // Templates can be: 
  // 1. Part of a saved design (designId set)
  // 2. Camera-specific adjusted (cameraId set) - created during calibration
  // 3. Shared/standalone (both null) - for testing or single-use
});

export const workers = pgTable("workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerCode: text("worker_code").notNull().unique(), // Legacy - auto-generated from arucoId
  arucoId: integer("aruco_id").notNull().unique(), // ArUco marker ID (50-95, auto-assigned, reusable)
  name: text("name").notNull(), // Japanese name
  team: text("team"), // Optional team assignment
  department: text("department"), // Legacy field - kept for backward compatibility
  qrPayload: json("qr_payload"), // Legacy field - kept for backward compatibility
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
export const insertSlotSchema = createInsertSchema(slots).omit({ id: true, slotNumber: true, createdAt: true })
  .refine(data => {
    if (!data.expectedQrId) return false;
    const markerId = parseInt(data.expectedQrId);
    const isToolMarker = markerId >= 1 && markerId <= 50;
    const isCornerMarker = markerId >= 96 && markerId <= 99;
    return !isNaN(markerId) && (isToolMarker || isCornerMarker);
  }, {
    message: "expectedQrId must be a valid ArUco marker ID (1-50 for tools, 96-99 for corners)",
    path: ["expectedQrId"]
  }); // slotNumber is auto-assigned

export const updateSlotSchema = createInsertSchema(slots).omit({ id: true, slotNumber: true, createdAt: true }).partial()
  .superRefine((data, ctx) => {
    if (data.expectedQrId !== undefined) {
      if (data.expectedQrId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "expectedQrId must be a valid ArUco marker ID (1-50 for tools, 96-99 for corners)",
          path: ["expectedQrId"]
        });
        return;
      }
      const markerId = parseInt(data.expectedQrId);
      const isToolMarker = markerId >= 1 && markerId <= 50;
      const isCornerMarker = markerId >= 96 && markerId <= 99;
      if (isNaN(markerId) || (!isToolMarker && !isCornerMarker)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "expectedQrId must be a valid ArUco marker ID (1-50 for tools, 96-99 for corners)",
          path: ["expectedQrId"]
        });
      }
    }
  });

export const insertDetectionLogSchema = createInsertSchema(detectionLogs).omit({ id: true });
export const insertAlertRuleSchema = createInsertSchema(alertRules).omit({ id: true, createdAt: true });
export const insertAlertQueueSchema = createInsertSchema(alertQueue).omit({ id: true, createdAt: true });
export const insertSystemConfigSchema = createInsertSchema(systemConfig).omit({ id: true, updatedAt: true });
export const insertToolCategorySchema = createInsertSchema(toolCategories).omit({ id: true, createdAt: true });
export const insertTemplateDesignSchema = createInsertSchema(templateDesigns).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTemplateRectangleSchema = createInsertSchema(templateRectangles).omit({ id: true, createdAt: true });
export const insertWorkerSchema = createInsertSchema(workers).omit({ id: true, createdAt: true, qrPayload: true, workerCode: true, arucoId: true, department: true });
export const insertCaptureRunSchema = createInsertSchema(captureRuns).omit({ id: true, timestamp: true });
export const insertGoogleOAuthCredentialSchema = createInsertSchema(googleOAuthCredentials).omit({ id: true, updatedAt: true });

// Types
export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type InsertSlot = z.infer<typeof insertSlotSchema>;
export type UpdateSlot = z.infer<typeof updateSlotSchema>;
export type InsertDetectionLog = z.infer<typeof insertDetectionLogSchema>;
export type InsertAlertRule = z.infer<typeof insertAlertRuleSchema>;
export type InsertAlertQueue = z.infer<typeof insertAlertQueueSchema>;
export type InsertSystemConfig = z.infer<typeof insertSystemConfigSchema>;
export type InsertToolCategory = z.infer<typeof insertToolCategorySchema>;
export type InsertTemplateDesign = z.infer<typeof insertTemplateDesignSchema>;
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
export type ToolCategory = typeof toolCategories.$inferSelect;
export type TemplateDesign = typeof templateDesigns.$inferSelect;
export type TemplateRectangle = typeof templateRectangles.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type CaptureRun = typeof captureRuns.$inferSelect;
export type GoogleOAuthCredential = typeof googleOAuthCredentials.$inferSelect;
