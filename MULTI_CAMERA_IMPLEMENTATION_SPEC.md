# Multi-Camera Implementation - Complete Technical Specification

**Document Version:** 1.0  
**Date:** November 6, 2025  
**Status:** Ready for Implementation

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Architectural Decisions](#2-architectural-decisions)
3. [Database Schema](#3-database-schema)
4. [Phased Implementation Plan](#4-phased-implementation-plan)
5. [Critical Files to Modify](#5-critical-files-to-modify)
6. [Testing Checkpoints](#6-testing-checkpoints)
7. [Backward Compatibility](#7-backward-compatibility)
8. [Rollback Strategy](#8-rollback-strategy)
9. [Success Metrics](#9-success-metrics)
10. [Known Limitations](#10-known-limitations)

---

## 1. EXECUTIVE SUMMARY

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
data/roi_archives/slot_1_20250106_120000.jpg
```

**New (Multi-Camera):**
```
data/latest_calibration_rectified_{cameraId}.png
data/latest_preview_{cameraId}.jpg
data/roi_archives/{cameraId}/slot_1_20250106_120000.jpg
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
  id: serial("id").primaryKey(),
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

Detection loop already iterates through all cameras in `server/services/process_cameras.py`.

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
**File:** `shared/schema.ts`

**Change:**
```typescript
export const cameras = pgTable("cameras", {
  // ... existing fields ...
  paperSize: text("paper_size"), // Stores template like "6-page-3x2", "A4-landscape"
  // ... rest of fields ...
});
```

**Command:**
```bash
npm run db:push --force
```

#### Task 0.2: Validate Schema Change (CHECKPOINT)
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

**Files to Modify:**

**`python/aruco_calibrator.py`:**
```python
# Add camera_id parameter
parser.add_argument('--camera-id', required=True, help='Camera UUID')
args = parser.parse_args()

# Update output paths
rectified_path = f"data/latest_calibration_rectified_{args.camera_id}.png"
labeled_path = f"data/latest_calibration_labeled_{args.camera_id}.png"
preview_path = f"data/latest_calibration_preview_{args.camera_id}.png"

# Save with namespaced paths
cv2.imwrite(rectified_path, rectified_image)
```

**`python/camera_preview.py`:**
```python
# Add camera_id parameter
parser.add_argument('--camera-id', required=True)
args = parser.parse_args()

# Update output path
output_path = f"data/latest_preview_{args.camera_id}.jpg"
cv2.imwrite(output_path, processed_frame)
```

**`python/validate_slot_qrs.py`:**
```python
# Add camera_id to ROI archive paths
roi_dir = f"data/roi_archives/{camera_id}"
os.makedirs(roi_dir, exist_ok=True)
roi_path = f"{roi_dir}/slot_{slot_number}_{timestamp}.jpg"
```

**`python/rectified_preview.py`:**
```python
# Accept camera_id parameter
parser.add_argument('--camera-id', required=True)
args = parser.parse_args()

# Output with camera_id namespace
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

**File:** Search for cleanup script (look for "90 days" or "3 months")

**Change:**
```typescript
// OLD: 90 days
const retentionDays = 90;

// NEW: 60 days (2 months)
const retentionDays = 60;
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

**File:** `server/routes.ts` or `server/services/camera_session_manager.ts`

**Implementation:**
```typescript
class CameraSessionManager {
  private static exclusiveLocks: Map<string, boolean> = new Map();
  private static calibrationInProgress: string | null = null;
  
  // NEW: Global calibration lock
  static async acquireCalibrationLock(cameraId: string): Promise<boolean> {
    if (this.calibrationInProgress && this.calibrationInProgress !== cameraId) {
      console.log(`[CameraSessionManager] Calibration blocked - ${this.calibrationInProgress} is calibrating`);
      return false;
    }
    this.calibrationInProgress = cameraId;
    console.log(`[CameraSessionManager] Calibration lock acquired for ${cameraId}`);
    return true;
  }
  
  static releaseCalibrationLock(cameraId: string): void {
    if (this.calibrationInProgress === cameraId) {
      this.calibrationInProgress = null;
      console.log(`[CameraSessionManager] Calibration lock released for ${cameraId}`);
    }
  }
}
```

#### Task 2.2: Update Calibration Endpoint

**File:** `server/routes.ts`

```typescript
app.post('/api/calibrate/:cameraId', async (req, res) => {
  const { cameraId } = req.params;
  const { paperSize } = req.body;
  
  try {
    // Check global calibration lock
    const lockAcquired = await CameraSessionManager.acquireCalibrationLock(cameraId);
    if (!lockAcquired) {
      return res.status(409).json({ 
        message: `Another camera is currently calibrating. Please wait.`
      });
    }
    
    // Get camera details
    const camera = await db.query.cameras.findFirst({
      where: eq(cameras.id, cameraId)
    });
    
    // Use camera's configured resolution
    const [width, height] = camera.resolution;
    
    // Execute calibration...
    
    // Save paperSize to database
    await db.update(cameras)
      .set({
        paperSize: paperSize,
        // ... other calibration data
      })
      .where(eq(cameras.id, cameraId));
    
    // Release lock
    CameraSessionManager.releaseCalibrationLock(cameraId);
    
    return res.json({ ok: true, ... });
    
  } catch (error) {
    CameraSessionManager.releaseCalibrationLock(cameraId);
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

Update all template localStorage keys:
```typescript
localStorage.setItem(`templateTimestamp_${cameraId}`, timestamp);
localStorage.setItem(`templateDesign_${cameraId}`, design);
localStorage.setItem(`savedTemplates_${cameraId}`, templates);
```

#### Task 3.5: Add Cameras Navigation Link

**File:** `client/src/App.tsx`

Add route and navigation link for `/cameras`

#### Task 3.6: Test Frontend UI (CHECKPOINT)

Test all UI elements, tab switching, localStorage scoping

---

### PHASE 4: Alerts & System Test (HIGH RISK)

**Goal:** Include camera names in alerts and validate entire system

#### Task 4.1: Update Alert System

**File:** `server/services/alert_service.ts`

Update alert messages:
```typescript
const subject = `Tool Alert - ${camera.name} - ${slot.toolName}`;
const body = `Missing tool: ${slot.toolName} on ${camera.name}, Slot ${slot.slotNumber}`;
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

### Phase 0 Checkpoint
- [ ] Existing camera visible in database
- [ ] Preview loads correctly
- [ ] Calibration works
- [ ] No runtime errors

### Phase 1 Checkpoint
- [ ] Files include cameraId in filename
- [ ] Routes read namespaced files
- [ ] No file conflicts

### Phase 2 Checkpoint
- [ ] Calibration lock prevents concurrent calibrations
- [ ] paperSize saves to database
- [ ] Detection runs sequentially
- [ ] RAM under 1.5GB

### Phase 3 Checkpoint
- [ ] Camera management page works
- [ ] Tabs switch smoothly
- [ ] localStorage namespaced

### Phase 4 Final Checkpoint
- [ ] Both cameras calibrate independently
- [ ] Templates persist across reboots
- [ ] Detection runs sequentially
- [ ] Alerts include camera name
- [ ] System stable 24+ hours

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

## 10. KNOWN LIMITATIONS

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
