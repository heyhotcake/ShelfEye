CREATE TABLE "alert_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" varchar,
	"rule_id" varchar NOT NULL,
	"alert_type" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rule_type" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"verification_window" integer DEFAULT 5 NOT NULL,
	"business_hours_only" boolean DEFAULT true NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"conditions" json NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cameras" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"device_index" integer,
	"device_path" text,
	"resolution" json DEFAULT '[3840,2160]'::json NOT NULL,
	"paper_size" text,
	"homography_matrix" json,
	"camera_matrix" json,
	"dist_coeffs" json,
	"calibration_timestamp" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "capture_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"trigger_type" text NOT NULL,
	"cameras_captured" integer DEFAULT 0 NOT NULL,
	"slots_processed" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error_messages" json,
	"execution_time_ms" integer
);
--> statement-breakpoint
CREATE TABLE "detection_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" varchar NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"qr_id" text,
	"worker_id" varchar,
	"worker_name" text,
	"ssim_score" real,
	"pose_quality" real,
	"image_path" text,
	"alert_triggered" boolean DEFAULT false NOT NULL,
	"raw_detection_data" json
);
--> statement-breakpoint
CREATE TABLE "google_oauth_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" timestamp,
	"is_configured" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "google_oauth_credentials_service_unique" UNIQUE("service")
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" text NOT NULL,
	"slot_number" integer NOT NULL,
	"camera_id" varchar NOT NULL,
	"tool_name" text NOT NULL,
	"expected_qr_id" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"region_coords" json NOT NULL,
	"x_cm" real NOT NULL,
	"y_cm" real NOT NULL,
	"width_cm" real NOT NULL,
	"height_cm" real NOT NULL,
	"rotation_deg" integer DEFAULT 0 NOT NULL,
	"allow_checkout" boolean DEFAULT true NOT NULL,
	"grace_window" text DEFAULT '08:30-16:30',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "slots_slot_id_unique" UNIQUE("slot_id"),
	CONSTRAINT "slots_camera_id_slot_number_unique" UNIQUE("camera_id","slot_number")
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" json NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "system_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "template_designs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"paper_size" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "template_rectangles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_id" varchar,
	"camera_id" varchar,
	"category_id" varchar NOT NULL,
	"paper_size" text NOT NULL,
	"x_cm" real NOT NULL,
	"y_cm" real NOT NULL,
	"rotation" integer DEFAULT 0 NOT NULL,
	"auto_qr_id" text,
	"slot_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tool_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tool_type" text NOT NULL,
	"width_cm" real NOT NULL,
	"height_cm" real NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_code" text NOT NULL,
	"aruco_id" integer NOT NULL,
	"name" text NOT NULL,
	"team" text,
	"department" text,
	"qr_payload" json,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "workers_worker_code_unique" UNIQUE("worker_code"),
	CONSTRAINT "workers_aruco_id_unique" UNIQUE("aruco_id")
);
--> statement-breakpoint
ALTER TABLE "alert_queue" ADD CONSTRAINT "alert_queue_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_queue" ADD CONSTRAINT "alert_queue_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detection_logs" ADD CONSTRAINT "detection_logs_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detection_logs" ADD CONSTRAINT "detection_logs_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_camera_id_cameras_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."cameras"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_rectangles" ADD CONSTRAINT "template_rectangles_design_id_template_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."template_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_rectangles" ADD CONSTRAINT "template_rectangles_camera_id_cameras_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."cameras"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_rectangles" ADD CONSTRAINT "template_rectangles_category_id_tool_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."tool_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_rectangles" ADD CONSTRAINT "template_rectangles_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE set null ON UPDATE no action;