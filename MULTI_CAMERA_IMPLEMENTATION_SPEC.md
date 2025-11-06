# Multi-Camera Implementation - Complete Technical Specification

**Document Version:** 2.0  
**Date:** November 6, 2025  
**Status:** Pre-Implementation Analysis Complete - Critical Issues Found

---

## ⚠️ IMPLEMENTATION STATUS

**Current State:** System gaps identified that MUST be addressed before implementation.

**Risk Level:** HIGH - Proceeding without addressing prerequisites will break the working single-camera system.

---

## TABLE OF CONTENTS

1. [Prerequisites & Current State Analysis](#1-prerequisites--current-state-analysis)
2. [Critical Implementation Warnings](#2-critical-implementation-warnings) 
3. [Pre-Implementation Checklist](#3-pre-implementation-checklist)
4. [Executive Summary](#4-executive-summary)
5. [Architectural Decisions](#5-architectural-decisions)
6. [Database Schema](#6-database-schema)
7. [Phased Implementation Plan](#7-phased-implementation-plan)
8. [Critical Files to Modify](#8-critical-files-to-modify)
9. [Testing Checkpoints](#9-testing-checkpoints)
10. [Backward Compatibility](#10-backward-compatibility)
11. [Rollback Strategy](#11-rollback-strategy)
12. [Success Metrics](#12-success-metrics)
13. [What's Already Working](#13-whats-already-working)
14. [Known Limitations](#14-known-limitations)

---

## 1. PREREQUISITES & CURRENT STATE ANALYSIS

### 🔴 Critical Gaps Identified

After thorough codebase analysis, the following MUST be fixed before implementation:

#### 1.1 Missing Database Field (CONFIRMED - Direct File Read)
**Issue:** `paperSize` field doesn't exist in `cameras` table  
**Verification:** Direct read of shared/schema.ts lines 6-18 shows NO paperSize field
**Current fields:** id, name, deviceIndex, devicePath, resolution, homographyMatrix, cameraMatrix, distCoeffs, calibrationTimestamp, isActive, createdAt
**Missing field:** paperSize or paper_size - NOT PRESENT IN SCHEMA
**Impact:** Cameras cannot remember template choice after reboot  
**Location:** `shared/schema.ts` (Lines 6-18 - verified by direct file read)
**Fix Required:** Add `paperSize: text("paper_size")` to schema before multi-camera work  

#### 1.2 File Path Collisions (VERIFIED)
**Issue:** Python scripts use generic file paths without camera ID namespacing
**Verification:** Confirmed via codebase search - no --camera-id parameter in Python scripts
**Current State:**
```python
# All cameras write to same file - DATA CORRUPTION!
"data/latest_calibration_rectified.png"
"data/latest_preview.jpg"
"data/validation_rectified_debug.jpg"
```
**Impact:** Camera 2 will overwrite Camera 1's files
**Files Affected (CONFIRMED):**
- `python/aruco_calibrator.py` - doesn't accept `--camera-id` (has --camera only)
- `python/camera_preview.py` - doesn't accept `--camera-id` (has --camera only)
- `python/validate_slot_qrs.py` - uses positional arg but doesn't namespace outputs
- `python/rectified_preview.py` - doesn't accept `--camera-id`

#### 1.3 localStorage Template Collisions
**Issue:** Template data stored without camera scoping
**Current Code:**
```javascript
// Camera 2 will overwrite Camera 1's templates!
localStorage.setItem('templateTimestamp', timestamp);
localStorage.setItem('templateDesign', design);
localStorage.setItem('savedTemplates', templates);
```
**Location:** `client/src/pages/calibration.tsx`
**Impact:** Camera template selections will overwrite each other

#### 1.4 Global Calibration Lock Enhancement Needed
**Issue:** While CameraSessionManager has per-camera exclusive locks, no global mutex prevents simultaneous calibrations of different cameras
**Current State:** `acquireExclusiveLock()` prevents concurrent operations on same camera but not across cameras
**Location:** `server/camera-session-manager.ts`
**Impact:** Both cameras could calibrate simultaneously, causing resource exhaustion on 2GB Raspberry Pi
**Note:** Existing exclusive lock is good, just needs global coordination for multi-camera

#### 1.5 ROI Archive Path Note
**Note:** Code correctly uses `data/rois` for ROI storage (not roi_archives)
**Location:** `server/services/maintenance-service.ts` Line 81
**Status:** No issue - path is consistent, just needs camera ID subdirectories
**Required Change:** Update to `data/rois/{cameraId}/` for multi-camera support

#### 1.6 Alert System Partially Missing Camera Names (VERIFIED)
**Issue:** Plain text alerts don't consistently use camera names (HTML emails do)
**Verification:** HTML email builder uses cameraName (lines 135, 152) but plain text doesn't
**Location:** `server/services/email-alerts.ts` (buildEmailBody function)
**Impact:** Plain text email recipients won't know which shelf needs attention
**Note:** HTML emails already show camera name for diagnostic_failure and camera_offline

#### 1.7 No Camera Management UI
**Issue:** `client/src/pages/cameras.tsx` doesn't exist
**Impact:** No way to add/configure Camera 2 through UI

---

## 2. CRITICAL IMPLEMENTATION WARNINGS

### ⚠️ RESOURCE CONSTRAINTS (2GB Raspberry Pi)

**NEVER run both cameras simultaneously!**

```
❌ WRONG - System will crash:
Camera 1: capturing...
Camera 2: capturing... ← RAM EXHAUSTED, USB OVERLOAD, SYSTEM HANG!

✅ CORRECT - Sequential operation only:
Camera 1: capture → process → release → wait 30s
Camera 2: capture → process → release → wait 30s
```

### ⚠️ FILE COLLISION RISK

**Without namespacing, Camera 2 WILL corrupt Camera 1's data:**

```
Camera 1 calibrates → saves to data/latest_calibration_rectified.png
Camera 2 calibrates → OVERWRITES same file!
Camera 1 detection → reads WRONG calibration data → FALSE ALERTS!
```

### ⚠️ USB BANDWIDTH LIMITATION

The Raspberry Pi's shared USB controller cannot handle:
- Two 4K MJPEG streams
- Two 2K MJPEG streams
- Any concurrent camera operations

**Result of violation:** Kernel USB errors, camera disconnections, system instability

---

## 3. PRE-IMPLEMENTATION CHECKLIST

### ✅ Verify Before Starting

**Database Ready:**
- [ ] Backup current database
- [ ] Test rollback procedure
- [ ] Confirm existing camera UUID

**File System Ready:**
- [ ] Create `data/` subdirectories if missing
- [ ] Check disk space (need 2GB free minimum)
- [ ] Verify write permissions on `data/` directory

**Python Environment:**
- [ ] All Python scripts executable
- [ ] OpenCV version compatible
- [ ] ArUco library installed

**Current System Stable:**
- [ ] Single camera detecting 7/7 slots
- [ ] Alerts working properly
- [ ] No existing errors in logs

**Hardware Verification:**
- [ ] Second camera connected to `/dev/video1`
- [ ] Camera recognized by `v4l2-ctl --list-devices`
- [ ] Power supply adequate (3A minimum)

### 🛑 STOP if any check fails!

---

## 4. EXECUTIVE SUMMARY

### Current System State
- Single 4K camera (devicePath: `/dev/video0`) fully operational
- ArUco marker-based tool tracking system working perfectly
- Smart calibration flow with auto-advance to Step 2 when 7/7 slots detected
- Worker tracking with ArUco markers (IDs 51-95) 
- Camera race conditions FIXED with 25-second wait + exclusive locking via CameraSessionManager
- Raw-frame ArUco detection achieving 100% success rate (7/7 slots)
- Detection uses inverse homography mapping to avoid warpPerspective interpolation artifacts

### Project Goal
Add second camera (2K resolution, devicePath: `/dev/video1`) for second shelf while maintaining complete stability of existing single-camera system.

### Critical Success Criteria
1. ✅ Both cameras work independently without breaking each other
2. ✅ Each camera remembers its template choice (`paperSize`) across reboots
3. ✅ No memory/USB/CPU overload on 2GB Raspberry Pi
4. ✅ Alerts clearly distinguish which camera/shelf has issues
5. ✅ Existing single-camera functionality remains 100% intact throughout implementation

---

## 2. ARCHITECTURAL DECISIONS

### 2.1 Sequential Operation Strategy (CRITICAL)

**Core Principle:** NEVER power both cameras simultaneously

**Rationale:**
- Raspberry Pi has only 2GB RAM - dual camera operation would exceed capacity
- Shared USB controller cannot handle two MJPEG streams at full resolution
- CPU is limited - concurrent processing would cause throttling
- Prevents race conditions and resource conflicts

**Implementation Details:**

#### Detection Loop Sequencing
```
Camera 1: Power up → Capture → Process slots → Release resources → Power down
    ↓
Wait 30 seconds (ensures complete resource cleanup)
    ↓
Camera 2: Power up → Capture → Process slots → Release resources → Power down
    ↓
Cycle complete, wait for next scheduled run
```

#### Calibration Sequencing
- System-wide mutex lock (only ONE camera can calibrate at any time)
- Calibration endpoint returns HTTP 409 Conflict if another camera is calibrating
- UI disables all camera tabs except active one during calibration
- 25-second wait after acquiring lock (ensures preview polling completes)

#### Preview Polling
- Only the ACTIVE tab polls for camera preview
- Inactive tabs pause their polling (no background requests)
- Prevents dual camera preview generation

### 2.2 Data Persistence Architecture

#### Camera-Template Association
Each camera stores its chosen template in the `paperSize` field:
- Camera 1 can use "6-page-3x2" template
- Camera 2 can use "6-page-3x2" template (same as Camera 1)
- OR Camera 2 can use "A4-landscape" template (different from Camera 1)
- System is agnostic - each camera remembers its own choice independently

#### Persistence Across Reboots
```javascript
Database record for each camera stores:
{
  id: "uuid",
  name: "Camera 1",
  devicePath: "/dev/video0",
  resolution: [3840, 2160],
  paperSize: "6-page-3x2",  // ← Persisted template choice
  homographyMatrix: [...],
  cameraMatrix: [...],
  calibrationTimestamp: "2025-11-06T..."
}
```

On reboot:
1. Backend queries all active cameras from database
2. Each camera's `paperSize` is read from database
3. Calibration UI pre-selects the saved template for each camera
4. Detection loop uses saved calibration data for each camera

### 2.3 File Path Namespacing (CRITICAL)

**Problem:** Current system uses generic file paths that will collide with second camera

**Current (Single Camera):**
```
data/latest_calibration_rectified.png
data/latest_preview.jpg
data/rois/slot_1_20250106_120000.jpg
```

**New (Multi-Camera):**
```
data/latest_calibration_rectified_{cameraId}.png
data/latest_preview_{cameraId}.jpg
data/rois/{cameraId}/slot_1_20250106_120000.jpg
```

**Files Requiring Namespacing:**
- Calibration rectified previews (high-res and UI preview)
- Calibration labeled images (for download)
- Camera preview images
- ROI archive directories
- Homography matrices (if saved to filesystem)

**Implementation:**
All Python scripts must accept `--camera-id` parameter and include it in output paths.

### 2.4 Template localStorage Scoping (CRITICAL)

**Problem:** Templates are stored in browser localStorage WITHOUT cameraId scoping. Camera 2 will overwrite Camera 1's data.

**Current (Broken for Multi-Camera):**
```javascript
localStorage.setItem('templateTimestamp', '1730901234567');
localStorage.setItem('templateDesign', JSON.stringify(design));
localStorage.setItem('savedTemplates', JSON.stringify(templates));
```

**New (Camera-Scoped):**
```javascript
localStorage.setItem(`templateTimestamp_${cameraId}`, '1730901234567');
localStorage.setItem(`templateDesign_${cameraId}`, JSON.stringify(design));
localStorage.setItem(`savedTemplates_${cameraId}`, JSON.stringify(templates));
```

**All Template Keys to Namespace:**
- `templateTimestamp_${cameraId}`
- `templateDesign_${cameraId}` 
- `savedTemplates_${cameraId}`
- `activeTemplateVersion_${cameraId}`
- Any other template-related localStorage keys

### 2.5 Alert System Enhancement

**Requirement:** All alerts must clearly indicate which camera/shelf has the issue

**Alert Message Format:**
```
Email Subject: Tool Alert - [Camera Name] - [Tool Name]
Email Body: Missing tool: [Tool Name] on [Camera Name], Slot [Number]

Google Sheets Row: [Timestamp, Camera Name, Slot Number, Tool Name, Status]

LED: Combined state (RED FLASH if ANY camera has missing tool)
```

**Implementation:**
- Alerts query camera name from database using slot's `cameraId` foreign key
- All alert templates updated to include camera name
- LED continues using unified_led_controller.py with existing priority logic

### 2.6 Data Retention Update

**Change:** ROI archive retention: 90 days → 60 days (2 months)

**Rationale:** With two cameras, storage usage doubles. Reducing retention maintains disk space.

**Files to Update:**
- Scheduled cleanup job (runs daily at 3:00 AM JST)
- Emergency cleanup (triggered by disk usage threshold)

---

## 3. DATABASE SCHEMA

### 3.1 Existing Schema (DO NOT BREAK)

Current `cameras` table already supports multi-camera:
```typescript
export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  deviceIndex: integer("device_index"), // Optional
  devicePath: text("device_path"), // /dev/video0, /dev/video1, etc.
  resolution: json("resolution").$type<[number, number]>().notNull().default([3840, 2160]),
  homographyMatrix: json("homography_matrix").$type<number[]>(),
  cameraMatrix: json("camera_matrix").$type<number[]>(),
  distCoeffs: json("dist_coeffs").$type<number[]>(),
  calibrationTimestamp: timestamp("calibration_timestamp"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});
```

Current `slots` table already linked to cameras:
```typescript
export const slots = pgTable("slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slotId: text("slot_id").notNull().unique(),
  slotNumber: integer("slot_number").notNull(), // ArUco marker ID (1-50)
  cameraId: varchar("camera_id").references(() => cameras.id, { onDelete: "cascade" }).notNull(),
  toolName: text("tool_name").notNull(),
  expectedQrId: text("expected_qr_id"), // Legacy - stores ArUco marker ID
  priority: text("priority").notNull().default("medium"),
  regionCoords: json("region_coords").$type<number[][]>().notNull(),
  xCm: real("x_cm").notNull(),
  yCm: real("y_cm").notNull(),
  widthCm: real("width_cm").notNull(),
  heightCm: real("height_cm").notNull(),
  rotationDeg: integer("rotation_deg").notNull().default(0),
  allowCheckout: boolean("allow_checkout").notNull().default(true),
  graceWindow: text("grace_window").default("08:30-16:30"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
}, (table) => ({
  uniqueSlotNumberPerCamera: unique().on(table.cameraId, table.slotNumber),
}));
```

Detection loop already iterates through all cameras in `python/process_cameras.py`.

### 3.2 Required Schema Addition

Add `paperSize` column to persist template choice:

```typescript
export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  deviceIndex: integer("device_index"),
  devicePath: text("device_path"),
  resolution: json("resolution").$type<[number, number]>().notNull().default([3840, 2160]),
  paperSize: text("paper_size"), // ← ADD THIS FIELD
  homographyMatrix: json("homography_matrix").$type<number[]>(),
  cameraMatrix: json("camera_matrix").$type<number[]>(),
  distCoeffs: json("dist_coeffs").$type<number[]>(),
  calibrationTimestamp: timestamp("calibration_timestamp"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});
```

**Migration Command:**
```bash
npm run db:push --force
```

**Validation:**
After migration, verify:
```sql
SELECT id, name, device_path, paper_size FROM cameras;
```

---

## 4. PHASED IMPLEMENTATION PLAN

### Overview of Phases

| Phase | Description | Risk Level | Tasks |
|-------|-------------|------------|-------|
| 0 | Database Schema | LOW | 2 |
| 1 | File Isolation & Retention | MEDIUM | 4 |
| 2 | Backend Sequencing | HIGH | 4 |
| 3 | Frontend UI | MEDIUM | 6 |
| 4 | Alerts & System Test | HIGH | 6 |

**Total Tasks:** 22

---

### PHASE 0: Database Schema (LOW RISK)

**Goal:** Add paperSize field to cameras table without affecting runtime operations

#### Task 0.1: Add paperSize to Schema
**File:** `shared/schema.ts` (Line 6-18)

**Current Schema (MISSING paperSize):**
```typescript
export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  deviceIndex: integer("device_index"),
  devicePath: text("device_path"),
  resolution: json("resolution").$type<[number, number]>().notNull().default([3840, 2160]),
  // paperSize field MISSING - ADD HERE
  homographyMatrix: json("homography_matrix").$type<number[]>(),
  cameraMatrix: json("camera_matrix").$type<number[]>(),
  distCoeffs: json("dist_coeffs").$type<number[]>(),
  calibrationTimestamp: timestamp("calibration_timestamp"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});
```

**Updated Schema (WITH paperSize):**
```typescript
export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  deviceIndex: integer("device_index"),
  devicePath: text("device_path"),
  resolution: json("resolution").$type<[number, number]>().notNull().default([3840, 2160]),
  paperSize: text("paper_size"), // ← ADD THIS LINE - Stores "6-page-3x2", "A4-landscape", etc.
  homographyMatrix: json("homography_matrix").$type<number[]>(),
  cameraMatrix: json("camera_matrix").$type<number[]>(),
  distCoeffs: json("dist_coeffs").$type<number[]>(),
  calibrationTimestamp: timestamp("calibration_timestamp"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});
```

**Migration Commands:**
```bash
# Push schema change to database
npm run db:push --force

# Verify field was added
npm run db:studio
# Check cameras table has paperSize column
```

#### Task 0.2: Verify Camera Types (Already Complete)
**File:** `shared/schema.ts` (Lines 173, 186)

Camera types already exist - NO CHANGES NEEDED:
```typescript
// Line 173: export type InsertCamera = z.infer<typeof insertCameraSchema>;
// Line 186: export type Camera = typeof cameras.$inferSelect;
```
Note: Use `InsertCamera` instead of `NewCamera` in code

#### Task 0.3: Validate Schema Change (CHECKPOINT)
**Tests:**
1. Query cameras: `GET /api/cameras` - should return existing camera with `paperSize: null`
2. Preview still loads: `GET /api/camera-preview/{cameraId}`
3. Calibration still works: `POST /api/calibrate/{cameraId}`

**Success Criteria:**
- No runtime errors
- Existing camera visible in database
- All API endpoints respond normally

**Rollback Plan:**
If tests fail, revert schema change:
```bash
git checkout shared/schema.ts
npm run db:push --force
```

---

### PHASE 1: File Isolation & Retention (MEDIUM RISK)

**Goal:** Namespace all file paths with cameraId to prevent Camera 2 from overwriting Camera 1's files

#### Task 1.1: Update Python Scripts for File Namespacing

**⚠️ CRITICAL:** All Python scripts currently write to generic paths - MUST add camera ID namespacing!

**`python/aruco_calibrator.py`** (Currently NO --camera-id parameter):
```python
# Line ~400: Add camera_id parameter to argparse
parser.add_argument('--camera-id', required=True, help='Camera UUID for file namespacing')

# Line ~450-460: Update ALL output paths
rectified_path = f"data/latest_calibration_rectified_{args.camera_id}.png"
labeled_path = f"data/latest_calibration_labeled_{args.camera_id}.png"  
preview_path = f"data/latest_calibration_preview_{args.camera_id}.png"
validation_debug_path = f"data/validation_rectified_debug_{args.camera_id}.jpg"

# Update all cv2.imwrite calls to use namespaced paths
cv2.imwrite(rectified_path, rectified_image)
```

**`python/camera_preview.py`** (Currently NO --camera-id parameter):
```python
# Line ~360: Add camera_id parameter
parser.add_argument('--camera-id', required=True, help='Camera UUID for file namespacing')

# Line ~380: Update output path
output_path = f"data/latest_preview_{args.camera_id}.jpg"

# Line ~420: Update write call
cv2.imwrite(output_path, processed_frame)
```

**`python/validate_slot_qrs.py`** (Has camera_id but doesn't namespace all outputs):
```python
# Line ~230: Already accepts camera_id as first positional arg
# Line ~267: Update rectified path reading
saved_rectified_path = f"data/latest_calibration_rectified_{camera_id}.png"

# Line ~300: Update debug output path  
debug_path = f"data/validation_rectified_debug_{camera_id}.jpg"

# ROI paths in process_cameras.py need update:
# Line ~220: Update ROI save path
roi_dir = f"data/rois/{camera_id}"  # Note: Using data/rois not roi_archives!
os.makedirs(roi_dir, exist_ok=True)
roi_path = f"{roi_dir}/slot_{slot_number}_{timestamp}.jpg"
```

**`python/rectified_preview.py`** (Currently NO --camera-id parameter):
```python
# Line ~248: Add camera_id parameter
parser.add_argument('--camera-id', required=True, help='Camera UUID for file namespacing')

# Line ~280: Update output path
output_path = f"data/rectified_preview_{args.camera_id}.png"
```

#### Task 1.2: Update Server Routes to Pass cameraId

**File:** `server/routes.ts`

**Calibration Route:**
```typescript
app.post('/api/calibrate/:cameraId', async (req, res) => {
  const { cameraId } = req.params;
  
  // Pass cameraId to Python
  const pythonArgs = [
    'python/aruco_calibrator.py',
    '--camera-id', cameraId,
    '--camera', devicePath,
    '--paper-size', paperSize,
    // ... other args
  ];
  
  // Read from namespaced paths
  const rectifiedPath = `data/latest_calibration_rectified_${cameraId}.png`;
  const rectifiedBuffer = await fs.readFile(rectifiedPath);
  
  // ... rest of logic
});
```

**Preview Route:**
```typescript
app.get('/api/camera-preview/:cameraId', async (req, res) => {
  const { cameraId } = req.params;
  
  // Pass cameraId to Python
  const pythonArgs = [
    'python/camera_preview.py',
    '--camera-id', cameraId,
    '--camera', devicePath,
  ];
  
  // Read from namespaced path
  const previewPath = `data/latest_preview_${cameraId}.jpg`;
  const imageBuffer = await fs.readFile(previewPath);
  
  // ... rest of logic
});
```

#### Task 1.3: Update ROI Retention Policy

**File:** `server/services/maintenance-service.ts` (Line 77-107)

**⚠️ NOTE:** ROI path is `data/rois` NOT `data/roi_archives` in actual code!

**Current Implementation (90 days):**
```typescript
// Line 77: cleanupOldImages function
async cleanupOldImages(retentionDays: number): Promise<{ deletedFiles: number; freedMB: number }> {
  const roisDir = path.join(process.cwd(), 'data', 'rois'); // ← Actual path used
  // ... cleanup logic
}

// Line ~180 in scheduled job:
const retentionDays = 90; // ← Change to 60
```

**Updated Implementation (60 days for dual cameras):**
```typescript
// Update retention period
const retentionDays = 60; // Reduced from 90 to accommodate 2x storage usage

// Also update camera-namespaced cleanup:
async cleanupCameraROIs(cameraId: string, retentionDays: number) {
  const cameraRoisDir = path.join(process.cwd(), 'data', 'rois', cameraId);
  // ... cleanup logic per camera
}
```

#### Task 1.4: Test File Namespacing (CHECKPOINT)

**Tests:**
1. Run calibration - verify files created with cameraId
2. Check preview generation
3. Verify routes read namespaced files correctly

**Success Criteria:**
- All files include cameraId in filename
- Routes successfully read namespaced paths
- No file conflicts

---

### PHASE 2: Backend Sequencing (HIGH RISK)

**Goal:** Serialize camera operations to prevent concurrent power-up

#### Task 2.1: Add Global Calibration Lock

**File:** `server/camera-session-manager.ts` (Line 9-105)

**Current Implementation (Missing global calibration lock):**
```typescript
class CameraSessionManager {
  private locks: Map<string, CameraLock> = new Map();
  // Has exclusive locks but NO global calibration mutex!
}
```

**Updated Implementation (WITH global calibration lock):**
```typescript
class CameraSessionManager {
  private locks: Map<string, CameraLock> = new Map();
  private calibrationInProgress: string | null = null; // ← ADD THIS
  
  // ADD: Global calibration lock to prevent concurrent calibrations
  acquireCalibrationLock(cameraId: string): boolean {
    if (this.calibrationInProgress && this.calibrationInProgress !== cameraId) {
      console.log(`[CameraSessionManager] Calibration blocked - ${this.calibrationInProgress} is calibrating`);
      return false; // Another camera is calibrating
    }
    this.calibrationInProgress = cameraId;
    console.log(`[CameraSessionManager] Global calibration lock acquired for ${cameraId}`);
    return true;
  }
  
  // ADD: Release global calibration lock
  releaseCalibrationLock(cameraId: string): void {
    if (this.calibrationInProgress === cameraId) {
      this.calibrationInProgress = null;
      console.log(`[CameraSessionManager] Global calibration lock released for ${cameraId}`);
    }
  }
  
  // MODIFY: acquireExclusiveLock to also check global calibration
  async acquireExclusiveLock(cameraId: string): Promise<void> {
    // First acquire global calibration lock
    if (!this.acquireCalibrationLock(cameraId)) {
      throw new Error('Another camera is currently calibrating');
    }
    
    // Then proceed with existing exclusive lock logic
    this.locks.set(cameraId, {
      cameraId,
      type: 'exclusive',
      timestamp: Date.now()
    });
    // ... rest of existing logic
  }
  
  // MODIFY: releaseLock to also release calibration lock
  releaseLock(cameraId: string): void {
    const lock = this.locks.get(cameraId);
    if (lock) {
      console.log(`[CameraSessionManager] Released ${lock.type} lock for camera ${cameraId}`);
      this.locks.delete(cameraId);
      this.releaseCalibrationLock(cameraId); // ← ADD THIS
    }
  }
}
```

#### Task 2.2: Update Calibration Endpoint to Save paperSize

**File:** `server/routes.ts` (Line 340-500)

**Current Implementation (NOT saving paperSize):**
```typescript
// Line 345: Gets paperSize from body but doesn't save to database!
const { paperSize, templateTimestamp } = req.body;

// Line 420-430: Updates camera but MISSING paperSize field
await storage.updateCamera(cameraId, {
  homographyMatrix: homography,
  cameraMatrix: cameraMatrix,
  distCoeffs: distCoeffs,
  calibrationTimestamp: new Date(),
  // paperSize NOT SAVED!
});
```

**Updated Implementation (SAVE paperSize to database):**
```typescript
app.post('/api/calibrate/:cameraId', async (req, res) => {
  const { cameraId } = req.params;
  const { paperSize, templateTimestamp } = req.body; // paperSize like "6-page-3x2"
  let lockAcquired = false;
  
  try {
    // EXISTING: Acquire exclusive lock (Line 356)
    await cameraSessionManager.acquireExclusiveLock(cameraId);
    lockAcquired = true;
    
    // Pass camera ID to Python script
    const calibrationArgs = [
      'python/aruco_calibrator.py',
      '--camera-id', cameraId, // ← ADD THIS
      '--paper-size', paperSize,
      // ... rest of args
    ];
    
    // After successful calibration, save paperSize
    await storage.updateCamera(cameraId, {
      homographyMatrix: homography,
      cameraMatrix: cameraMatrix,
      distCoeffs: distCoeffs,
      calibrationTimestamp: new Date(),
      paperSize: paperSize, // ← ADD THIS - Persist template choice!
    });
    
    // Read from namespaced file
    const rectifiedPath = `data/latest_calibration_rectified_${cameraId}.png`; // ← NAMESPACED
    
    return res.json({ ok: true, ... });
    
  } catch (error) {
    if (lockAcquired) cameraSessionManager.releaseLock(cameraId);
    return res.status(500).json({ message: error.message });
  }
});
```

#### Task 2.3: Refactor Detection Loop for Sequential Processing

**File:** `server/services/process_cameras.py`

```python
def process_all():
    """Process all active cameras sequentially with 30-second delays"""
    
    cameras = get_all_active_cameras()
    
    for i, camera in enumerate(cameras):
        logger.info(f"Processing camera: {camera['name']}")
        
        try:
            process_camera(camera)
        except Exception as e:
            logger.error(f"Error: {e}")
        finally:
            cleanup_camera_resources(camera['id'])
            
            # Wait 30 seconds before next camera
            if i < len(cameras) - 1:
                logger.info("Waiting 30 seconds...")
                time.sleep(30)
```

#### Task 2.4: Test Backend Sequencing (CHECKPOINT)

**Tests:**
1. Calibration lock test - try calibrating two cameras simultaneously
2. paperSize persistence - verify it saves to database
3. Sequential detection - check logs for 30s delays
4. RAM monitoring - ensure usage stays under 1.5GB

---

### PHASE 3: Frontend UI (MEDIUM RISK)

**Goal:** Add camera management, tabbed UI, and localStorage scoping

#### Task 3.1: Create Camera Management Page

**New File:** `client/src/pages/cameras.tsx`

Create page with:
- Table showing all cameras (name, devicePath, resolution, paperSize, calibration status)
- Add camera form (name, devicePath, resolution dropdown)
- Delete camera functionality
- Display calibration badge

#### Task 3.2: Add Camera Tabs to Calibration Page

**File:** `client/src/pages/calibration.tsx`

Add:
- Tabs component for camera selection
- Load camera's saved paperSize on tab switch
- Disable tabs during calibration
- Handle 409 Conflict response

#### Task 3.3: Add Camera Tabs to Dashboard

**File:** `client/src/pages/dashboard.tsx`

Add:
- Camera tabs
- Only poll preview for active tab
- Show slots with camera name prefix ("Camera 1 • Slot 3")

#### Task 3.4: Add Camera Scoping to Template localStorage

**File:** `client/src/pages/calibration.tsx` (Multiple locations)

**⚠️ CRITICAL:** Templates currently use global keys - Camera 2 will overwrite Camera 1's data!

**Current Implementation (BROKEN for multi-camera):**
```typescript
// Line ~150-170: Global keys that collide between cameras
const templateTimestamp = localStorage.getItem('templateTimestamp');
const templateDesign = localStorage.getItem('templateDesign');
const savedTemplates = localStorage.getItem('savedTemplates');

// Line ~200-220: Saving without camera scope
localStorage.setItem('templateTimestamp', timestamp);
localStorage.setItem('templateDesign', JSON.stringify(design));
localStorage.setItem('savedTemplates', JSON.stringify(templates));
```

**Updated Implementation (Camera-scoped keys):**
```typescript
// ADD: Helper functions for camera-scoped localStorage
const getStorageKey = (key: string, cameraId: string) => `${key}_${cameraId}`;

const getCameraTemplateData = (cameraId: string) => {
  return {
    timestamp: localStorage.getItem(getStorageKey('templateTimestamp', cameraId)),
    design: localStorage.getItem(getStorageKey('templateDesign', cameraId)),
    savedTemplates: localStorage.getItem(getStorageKey('savedTemplates', cameraId)),
    activeVersion: localStorage.getItem(getStorageKey('activeTemplateVersion', cameraId))
  };
};

const saveCameraTemplateData = (cameraId: string, data: any) => {
  if (data.timestamp) {
    localStorage.setItem(getStorageKey('templateTimestamp', cameraId), data.timestamp);
  }
  if (data.design) {
    localStorage.setItem(getStorageKey('templateDesign', cameraId), JSON.stringify(data.design));
  }
  if (data.savedTemplates) {
    localStorage.setItem(getStorageKey('savedTemplates', cameraId), JSON.stringify(data.savedTemplates));
  }
  if (data.activeVersion) {
    localStorage.setItem(getStorageKey('activeTemplateVersion', cameraId), data.activeVersion);
  }
};

// UPDATE: All localStorage calls to use camera-scoped functions
// When loading templates for a camera:
const templateData = getCameraTemplateData(selectedCameraId);

// When saving templates for a camera:
saveCameraTemplateData(selectedCameraId, {
  timestamp: new Date().toISOString(),
  design: currentDesign,
  savedTemplates: templates
});
```

**Keys to Update:**
- `templateTimestamp` → `templateTimestamp_${cameraId}`
- `templateDesign` → `templateDesign_${cameraId}`
- `savedTemplates` → `savedTemplates_${cameraId}`
- `activeTemplateVersion` → `activeTemplateVersion_${cameraId}`

#### Task 3.5: Add Cameras Navigation Link

**File:** `client/src/App.tsx`

Add route and navigation link for `/cameras`

#### Task 3.6: Test Frontend UI (CHECKPOINT)

Test all UI elements, tab switching, localStorage scoping

---

### PHASE 4: Alerts & System Test (HIGH RISK)

**Goal:** Include camera names in alerts and validate entire system

#### Task 4.1: Update Alert System

**File:** `server/services/email-alerts.ts` (Line 1-100)

**Current Implementation (Missing camera identification):**
```typescript
// Line 78-90: buildEmailBody function
function buildEmailBody(alertData: AlertEmailData): string {
  let body = `Tool Tracking System Alert\n\n`;
  body += `Alert Type: ${type.replace(/_/g, ' ').toUpperCase()}\n`;
  body += `Timestamp: ${details.timestamp}\n\n`;
  // Camera name NOT included in alerts!
}
```

**Updated Implementation (Include camera name):**
```typescript
// UPDATE: AlertEmailData interface to include camera info
interface AlertEmailData {
  type: 'diagnostic_failure' | 'capture_failure' | 'camera_offline' | 'test_alert' | 'missing_tool';
  subject: string;
  details: {
    timestamp: string;
    cameraName?: string; // ← Already exists but not used!
    cameraId?: string;   // ← Already exists but not used!
    slotNumber?: number;
    toolName?: string;
    // ... rest
  };
}

// UPDATE: Email subject and body builders
function buildAlertSubject(alertData: AlertEmailData): string {
  const { type, details } = alertData;
  
  if (type === 'missing_tool' && details.cameraName && details.toolName) {
    return `Tool Alert - ${details.cameraName} - ${details.toolName}`;
  }
  
  if (details.cameraName) {
    return `System Alert - ${details.cameraName} - ${type.replace(/_/g, ' ')}`;
  }
  
  return `Tool Tracking System - ${type.replace(/_/g, ' ')}`;
}

function buildEmailBody(alertData: AlertEmailData): string {
  const { type, details } = alertData;
  
  let body = `Tool Tracking System Alert\n\n`;
  
  // Include camera identification
  if (details.cameraName) {
    body += `Camera: ${details.cameraName}\n`;
  }
  if (details.cameraId) {
    body += `Camera ID: ${details.cameraId}\n`;
  }
  
  body += `Alert Type: ${type.replace(/_/g, ' ').toUpperCase()}\n`;
  body += `Timestamp: ${details.timestamp}\n`;
  
  // Include slot/tool details for missing tool alerts
  if (type === 'missing_tool') {
    if (details.slotNumber) body += `Slot Number: ${details.slotNumber}\n`;
    if (details.toolName) body += `Missing Tool: ${details.toolName}\n`;
  }
  
  return body;
}
```

**Also Update:** Google Sheets integration to include camera name column
```typescript
// In sheets logging function
const rowData = [
  details.timestamp,
  details.cameraName || 'Unknown Camera', // ← Add camera column
  details.slotNumber,
  details.toolName,
  'MISSING'
];
```

#### Task 4.2: Add Second Camera on Raspberry Pi

Via UI:
- Name: "Camera 2"
- Device Path: "/dev/video1"
- Resolution: "2K (2560×1440)"

#### Task 4.3: Calibrate Both Cameras Sequentially

Calibrate Camera 1, then Camera 2. Verify paperSize saved for both.

#### Task 4.4: Monitor Sequential Detection Loop

Watch logs for sequential processing with 30s delays. Monitor RAM usage.

#### Task 4.5: Test Alerts Include Camera Name

Verify email, Sheets, and LED alerts show correct camera name.

#### Task 4.6: Full End-to-End System Test (FINAL CHECKPOINT)

Complete validation:
- Both cameras calibrated
- Templates persist across reboot
- Detection runs sequentially
- Alerts distinguish cameras
- RAM stays under 1.5GB
- No USB conflicts

---

## 5. CRITICAL FILES TO MODIFY

### Backend Files
- `shared/schema.ts` - Add paperSize column
- `server/routes.ts` - Add calibration lock, pass cameraId, save paperSize
- `server/services/process_cameras.py` - Sequential processing
- `server/services/alert_service.ts` - Include camera name

### Python Files
- `python/aruco_calibrator.py` - Accept cameraId, namespace files
- `python/camera_preview.py` - Accept cameraId, namespace preview
- `python/validate_slot_qrs.py` - Namespace ROI archives
- `python/rectified_preview.py` - Accept cameraId parameter

### Frontend Files
- `client/src/pages/cameras.tsx` - NEW camera management page
- `client/src/pages/calibration.tsx` - Add camera tabs
- `client/src/pages/dashboard.tsx` - Add camera tabs
- `client/src/App.tsx` - Add /cameras route

---

## 6. TESTING CHECKPOINTS

### Phase 0 Checkpoint - Database Schema
- [ ] `paperSize` field visible in database schema: `SELECT column_name FROM information_schema.columns WHERE table_name='cameras' AND column_name='paper_size';`
- [ ] Existing camera record has `paperSize: null`: `SELECT id, name, paper_size FROM cameras;`
- [ ] Preview API works: `curl http://localhost:5000/api/camera-preview/{cameraId}`
- [ ] Calibration API responds: `curl -X POST http://localhost:5000/api/calibrate/{cameraId}`
- [ ] No TypeScript errors after schema update

### Phase 1 Checkpoint - File Isolation
- [ ] Python scripts accept `--camera-id` parameter without error
- [ ] Calibration creates file: `data/latest_calibration_rectified_{cameraId}.png`
- [ ] Preview creates file: `data/latest_preview_{cameraId}.jpg`
- [ ] ROI archives saved to: `data/rois/{cameraId}/slot_*.jpg`
- [ ] Routes successfully read namespaced files
- [ ] Cleanup script updated to 60 days retention

### Phase 2 Checkpoint - Backend Sequencing
- [ ] Attempting concurrent calibrations returns HTTP 409 Conflict
- [ ] `paperSize` persists in database after calibration: `SELECT paper_size FROM cameras WHERE id='{cameraId}';`
- [ ] Process logs show "Waiting 30 seconds..." between cameras
- [ ] RAM usage stays under 1.5GB: `free -m` shows < 1500MB used
- [ ] No USB errors in `dmesg | grep -i usb`

### Phase 3 Checkpoint - Frontend UI
- [ ] Camera management page loads at `/cameras`
- [ ] Can add new camera with form
- [ ] Camera tabs visible in calibration page
- [ ] Camera tabs visible in dashboard
- [ ] localStorage inspection shows `templateTimestamp_{cameraId}` keys
- [ ] Tab switching pauses/resumes preview polling

### Phase 4 Final Checkpoint - Full System Test
- [ ] Camera 1 calibrates with "6-page-3x2" template
- [ ] Camera 2 calibrates with different or same template
- [ ] After reboot, both cameras show correct `paperSize` in database
- [ ] Detection logs show sequential processing with timestamps
- [ ] Alert emails show "Camera 1" or "Camera 2" in subject
- [ ] Google Sheets has camera name column
- [ ] System runs 24 hours without crash
- [ ] `htop` shows stable memory usage
- [ ] No file overwrites in `data/` directory

---

## 7. BACKWARD COMPATIBILITY

System must work with single camera throughout implementation:
- Auto-select single camera in UI
- Existing calibration data preserved
- File paths backward compatible

---

## 8. ROLLBACK STRATEGY

### Per-Phase Rollback

**Phase 0:** `git checkout shared/schema.ts && npm run db:push --force`

**Phase 1:** `git checkout python/ server/routes.ts`

**Phase 2:** `git checkout server/ python/`

**Phase 3:** `git checkout client/`

**Phase 4:** Disable Camera 2: `UPDATE cameras SET is_active = false WHERE name = 'Camera 2';`

---

## 9. SUCCESS METRICS

### Functional Requirements
- ✅ Both cameras operate independently
- ✅ Template choice persists across reboots
- ✅ Alerts distinguish cameras
- ✅ No concurrent camera power-up

### Performance Requirements
- ✅ RAM < 1.5GB during operation
- ✅ No USB bandwidth throttling
- ✅ CPU load acceptable

### Reliability Requirements
- ✅ System stable 24+ hours
- ✅ No race conditions
- ✅ No file overwrites
- ✅ Persistence after reboot

---

## 10. WHAT'S ALREADY WORKING

### ✅ Existing Infrastructure That Supports Multi-Camera

#### Sequential Processing Already Implemented
- `process_cameras.py` already iterates through all cameras
- 30-second delays between cameras already in place
- Resource cleanup after each camera already coded
- **Status:** Ready for multi-camera, just needs testing

#### Database Schema Ready
- `cameras` table supports multiple camera records
- `slots` table has `cameraId` foreign key
- Unique constraints prevent slot number conflicts per camera
- **Status:** Database structure fully supports multi-camera

#### Session Management Infrastructure
- `CameraSessionManager` provides exclusive locking
- Preview/calibration mutex prevents conflicts
- 10-second wait ensures camera release at OS level
- **Status:** Good foundation, just needs global calibration lock

#### Detection Logic Camera-Aware
- Detection loop queries all active cameras from database
- Each slot knows which camera it belongs to
- Homography matrices stored per camera
- **Status:** Logic ready, file paths need namespacing

#### Hardware Detection Working
- System can detect multiple `/dev/video*` devices
- Camera resolution configuration per device
- Device path mapping functional
- **Status:** Hardware layer ready for Camera 2

### ⚠️ What's Missing (See Prerequisites Section)
- `paperSize` field in database
- File path namespacing with camera ID
- localStorage scoping for templates
- Global calibration lock
- Camera management UI
- Alert system camera identification

---

## 11. KNOWN LIMITATIONS

### Hardware Constraints
- Maximum 2 cameras (USB bandwidth limit)
- Cameras cannot operate simultaneously (RAM constraint)
- Detection cycle time increases 30s per camera

### Software Constraints
- Preview polling only for active tab
- Calibration mutex prevents concurrent calibrations
- LED shows combined alert state

---

## END OF SPECIFICATION

**Ready to implement:** Yes  
**Estimated completion:** 6-8 hours  
**Risk level:** Medium (with phased approach)

**To begin implementation, start with Phase 0, Task 0.1**
