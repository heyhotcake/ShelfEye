# Slot Setup Guide

## Overview

Slots are the core tracking units in ShelfEye. Each slot represents a physical location where a tool should be stored, identified by an ArUco marker and defined by pixel coordinates and physical dimensions.

## Camera Metadata Schema

Before defining slots, ensure cameras have the following metadata:

```typescript
{
  id: string;              // UUID
  name: string;            // Camera display name
  deviceIndex?: number;    // Device index (optional)
  devicePath?: string;     // Device path (e.g., /dev/video0)
  resolution: [number, number];  // [width, height] in pixels
  paperSize?: string;      // Calibration template size (A4, A3, etc.)
  homographyMatrix?: number[];   // 3x3 transformation matrix (9 values)
  cameraMatrix?: number[];       // 3x3 intrinsic matrix (9 values)
  distCoeffs?: number[];         // Lens distortion coefficients
  calibrationTimestamp?: Date;   // When camera was last calibrated
  isActive: boolean;       // Whether camera is enabled
}
```

**Required for Slot Import:**
- `id`: Used as targetCameraId during import
- `resolution`: Used to validate region coordinates are within bounds
- `homographyMatrix`: Required for coordinate transformations

## Slot Definition Data Structure

Each slot requires the following fields:

### Required Fields

- **slotId**: Unique identifier (e.g., "A1", "B2", "TOOL-001")
- **cameraId**: UUID of the camera monitoring this slot
- **toolName**: Name of the tool stored in this slot
- **expectedQrId**: ArUco marker ID as string (1-50 for tool markers, 96-99 for corner calibration markers)
- **regionCoords**: Polygon coordinates in pixels `[[x1,y1], [x2,y2], ...]` (minimum 3 points)
- **xCm, yCm**: Center position in centimeters on the physical template
- **widthCm, heightCm**: Physical dimensions in centimeters
- **rotationDeg**: Rotation angle in degrees (0-359)

### Optional Fields

- **priority**: "low", "medium", or "high" (default: "medium")
- **allowCheckout**: Boolean (default: true)
- **graceWindow**: Time range for alerts (default: "08:30-16:30")
- **isActive**: Boolean (default: true)

## Validation Rules

The slot validator checks for:

### Individual Slot Validation

1. **Tool Name**: Must not be empty
2. **Camera ID**: Must be provided and reference a valid camera
3. **Region Coordinates**:
   - Minimum 3 coordinate pairs
   - All coordinates must be `[x, y]` number pairs
   - Coordinates must be within camera resolution bounds
4. **Physical Dimensions**:
   - xCm, yCm must be positive numbers
   - widthCm, heightCm must be positive numbers
   - rotationDeg must be 0-359
5. **Priority**: Must be "low", "medium", or "high"
6. **Grace Window**: Must match format "HH:MM-HH:MM"

### Collection-Level Validation

1. **Unique Slot IDs**: No duplicate slotId values per camera (exact string match)
2. **Unique ArUco Marker IDs**: No duplicate expectedQrId values per camera
3. **Region Overlap Detection**: Warns if slot regions overlap (using polygon intersection)
4. **Camera Existence**: All cameraId references must map to existing cameras

## Validation Error and Warning Taxonomy

### Errors (Block Import)

| Error Code | Field | Message | Solution |
|------------|-------|---------|----------|
| `MISSING_TOOL_NAME` | toolName | Tool name is required | Provide non-empty tool name |
| `MISSING_EXPECTED_QR_ID` | expectedQrId | ArUco marker ID is required | Provide ArUco marker ID (1-50 or 96-99) |
| `INVALID_EXPECTED_QR_ID` | expectedQrId | ArUco marker ID must be 1-50 or 96-99 | Use valid marker ID range (tools: 1-50, corners: 96-99) |
| `MISSING_CAMERA_ID` | cameraId | Camera ID is required | Provide valid camera UUID |
| `INVALID_CAMERA_ID` | cameraId | Camera ID does not exist | Use existing camera UUID from system |
| `INVALID_REGION_COORDS` | regionCoords | Region must have at least 3 coordinate pairs | Add more polygon vertices (minimum 3) |
| `MALFORMED_COORDS` | regionCoords | Region coordinates must be [x, y] number pairs | Fix coordinate format to [[x1,y1], [x2,y2], ...] |
| `COORDS_OUT_OF_BOUNDS` | regionCoords | Region coordinates exceed camera resolution | Adjust coordinates to fit within camera bounds |
| `INVALID_X_POSITION` | xCm | X position must be a positive number | Provide positive number for xCm |
| `INVALID_Y_POSITION` | yCm | Y position must be a positive number | Provide positive number for yCm |
| `INVALID_WIDTH` | widthCm | Width must be a positive number | Provide positive number for widthCm |
| `INVALID_HEIGHT` | heightCm | Height must be a positive number | Provide positive number for heightCm |
| `INVALID_ROTATION` | rotationDeg | Rotation must be between 0 and 359 degrees | Adjust rotation to valid range |
| `INVALID_PRIORITY` | priority | Priority must be low, medium, or high | Use valid priority value |
| `INVALID_GRACE_WINDOW` | graceWindow | Grace window must be in format HH:MM-HH:MM | Fix time format (e.g., "08:30-16:30") |
| `DUPLICATE_SLOT_ID` | slotId | Duplicate slot ID for camera | Use unique slotId values |
| `DUPLICATE_ARUCO_ID` | expectedQrId | Duplicate ArUco marker ID for camera | Assign unique ArUco marker IDs (1-50) |

### Warnings (Import Allowed)

| Warning Code | Field | Message | Impact |
|------------|-------|---------|--------|
| `REGION_OVERLAP` | regionCoords | Region overlaps with another slot | May cause detection ambiguity |
| `EDGE_PROXIMITY_LEFT` | xCm | Slot may extend beyond left edge of template | Tool may be partially outside calibrated area |
| `EDGE_PROXIMITY_TOP` | yCm | Slot may extend beyond top edge of template | Tool may be partially outside calibrated area |

**Important:** Warnings do not block import but should be reviewed before production deployment.

## Import/Export Format

Slots are exported/imported using JSON format:

```json
{
  "version": "1.0",
  "exportDate": "2025-11-14T10:30:00.000Z",
  "cameraId": "camera-uuid-here",
  "cameraName": "Front Camera",
  "slots": [
    {
      "slotId": "A1",
      "toolName": "Screwdriver #10",
      "expectedQrId": "1",
      "priority": "high",
      "regionCoords": [[100, 100], [200, 100], [200, 200], [100, 200]],
      "xCm": 5.0,
      "yCm": 10.0,
      "widthCm": 3.5,
      "heightCm": 15.0,
      "rotationDeg": 0,
      "allowCheckout": true,
      "graceWindow": "08:30-16:30"
    }
  ]
}
```

## API Endpoints

### Validate Slots

```bash
POST /api/slots/validate
Content-Type: application/json

{
  "slots": [...]
}
```

**Response:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "slotId": "A1",
      "field": "regionCoords",
      "message": "Region overlaps with slot A2",
      "severity": "warning"
    }
  ]
}
```

### Import Slots

```bash
POST /api/slots/import
Content-Type: application/json

{
  "json": {...},  // Exported slot JSON
  "targetCameraId": "camera-uuid",
  "validateOnly": false  // Set to true for dry-run validation
}
```

**Response:**
```json
{
  "message": "Import successful",
  "imported": 25,
  "slots": [...],
  "warnings": [...]
}
```

### Export Slots

```bash
GET /api/slots/export/:cameraId
```

**Response:** Downloads JSON file with all slots for the specified camera

## UI-Based Import/Export Workflow

### Using the Slot Management Modal

The ShelfEye UI provides a slot import/export modal for managing slot configurations visually. This is the recommended method for production deployments.

**Accessing the Modal:**
1. Navigate to the Slot Drawing page
2. Select a camera from the dropdown in the left sidebar
3. Click the "Import/Export Slots" button in the toolbar (right side)
4. The "Slot Import/Export" modal opens with Export and Import sections

**Export Workflow:**
1. Select the camera you want to export slots from
2. Click "Export to JSON"
3. Browser downloads a JSON file with all slots for that camera
4. File format: `slots-{cameraName}-{timestamp}.json`

**Import Workflow:**
1. Select the target camera where you want to import slots
2. Click "Select JSON File" to upload a slot definition file
3. **Automatic Validation**: System validates the file immediately
   - Checks camera membership (warns if file is for different camera)
   - Validates against comprehensive error taxonomy (21 error codes)
   - Surfaces errors and warnings in tables
4. **Review Validation Results**:
   - **Errors (Red)**: Must be fixed before import (blocks import)
   - **Warnings (Yellow)**: Can proceed but review recommended
5. **Confirm Import**: Click "Import N Slots" if validation passes
6. **Protection Features**:
   - Modal cannot be accidentally dismissed during confirm step
   - Must explicitly click "Cancel" or "Confirm Import"
   - Warnings remain visible until user makes choice

**Validation Display:**
- Errors table shows: Slot ID, Field, Error Code, Message
- Warnings table shows: Slot ID, Field, Warning Code, Impact
- All codes documented in error taxonomy (see below)

**Safety Features:**
- Camera-scoped validation (prevents importing wrong camera's slots)
- Duplicate detection (slotId and ArUco IDs per camera)
- Overlap warnings (polygons intersecting)
- Edge proximity warnings (slots extending beyond calibration area)
- Atomic import (all-or-nothing operation)
- Accidental dismissal prevention (must explicitly confirm/cancel)

## Production Deployment Process

### Step 1: Camera Calibration

Before defining slots, ensure cameras are properly calibrated:

1. Print calibration template with 4 corner ArUco markers (IDs 96-99)
2. Run camera calibration through the UI
3. Verify homography matrix is computed successfully

### Step 2: Define Slot Physical Layout

1. Create template rectangles for each tool position
2. Assign ArUco marker IDs (1-50 for tools)
3. Record physical measurements (xCm, yCm, widthCm, heightCm)
4. Note rotation angles if tools are not horizontally aligned

### Step 3: Capture Region Coordinates

For each slot:

1. Run a test capture to get camera image
2. Use the slot drawing tool or computer vision to determine polygon vertices
3. Record pixel coordinates for region boundaries
4. Verify coordinates are within camera resolution

### Step 4: Create Slot Definition JSON

Compile all slot data into the JSON export format:

```bash
# Example slot definition template
{
  "version": "1.0",
  "exportDate": "2025-11-14T00:00:00.000Z",
  "cameraId": "PLACEHOLDER",
  "cameraName": "Production Camera 1",
  "slots": [
    // Add each slot definition here
  ]
}
```

### Step 5: Import via UI (Recommended)

**Using the Slot Import/Export Modal:**

1. Open ShelfEye UI and navigate to Slot Drawing page
2. Select target camera from dropdown (left sidebar)
3. Click "Import/Export Slots" button in toolbar to open modal
4. Click "Select JSON File" in Import section
5. **Review Validation Results**:
   - System automatically validates uploaded file
   - Check Errors table (must fix all errors)
   - Review Warnings table (decide if acceptable)
6. If validation passes:
   - Click "Import N Slots" button
   - Modal shows confirmation and imports slots
   - Cache automatically invalidated
7. Close modal and verify slots appear in UI

**Alternative: Import via API**

For scripting or automation, use the API endpoints:

```bash
# Dry-run validation first
curl -X POST http://localhost:5000/api/slots/import \
  -H "Content-Type: application/json" \
  -d '{
    "json": <paste-slot-json-here>,
    "targetCameraId": "<actual-camera-uuid>",
    "validateOnly": true
  }'

# If validation passes, import
curl -X POST http://localhost:5000/api/slots/import \
  -H "Content-Type: application/json" \
  -d '{
    "json": <paste-slot-json-here>,
    "targetCameraId": "<actual-camera-uuid>",
    "validateOnly": false
  }'
```

### Step 6: Verify Import

1. **UI Verification**:
   - Navigate to Slot Drawing page
   - Select the camera you imported to
   - Verify all slots appear in the slot list
   - Check that slot count matches import count

2. **Database Verification** (optional):
   ```bash
   psql -d shelfeye -c "SELECT slot_id, tool_name, camera_id FROM slots WHERE camera_id = '<camera-uuid>' ORDER BY slot_id;"
   ```

3. **Test Detection**:
   - Run a test capture to verify slot detection works
   - Review detection logs to confirm ArUco markers are being detected
   - Verify SSIM scores are calculated correctly

## Troubleshooting

### Validation Errors

**"Region coordinates exceed camera resolution"**
- Solution: Verify camera resolution is correct and adjust coordinates

**"Duplicate slot number for camera"**
- Solution: Ensure each slot has a unique slotId per camera

**"Region must have at least 3 coordinate pairs"**
- Solution: Polygons need minimum 3 vertices to define a region

### Import Failures

**"Camera not found"**
- Solution: Verify targetCameraId matches an existing camera UUID

**"Failed to parse slot data"**
- Solution: Check JSON syntax, ensure all required fields are present

### Runtime Issues

**Slots not detecting tools**
- Verify homography matrix is calibrated
- Check ArUco marker IDs match slot definitions
- Ensure lighting is consistent during captures

**Excessive overlap warnings**
- Review physical slot layout
- Adjust region coordinates to minimize overlap
- Consider if overlaps are intentional (nested regions)

## Best Practices

1. **Start Small**: Import 5-10 slots first, verify they work, then import the rest

2. **Use Consistent Naming**: Use logical slotId patterns (A1-A10, B1-B10, etc.)

3. **Document Physical Layout**: Keep a diagram of slot positions and ArUco IDs

4. **Test After Import**: Run manual captures to verify slot detection before enabling scheduler

5. **Backup Definitions**: Keep slot definition JSON files under version control

6. **Monitor Overlap Warnings**: While some overlap may be acceptable, excessive overlap can cause detection issues

7. **Validate Before Production**: Always use `validateOnly: true` first to catch issues

## Migration Checklist

### Pre-Import Validation
- [ ] All cameras exist in database with valid UUIDs
- [ ] Cameras calibrated with corner markers (IDs 96-99)
- [ ] Homography matrices computed and stored
- [ ] Camera resolutions verified (e.g., 3840x2160)
- [ ] Physical slot layout documented with measurements
- [ ] ArUco marker IDs assigned (1-50 for tools, no duplicates)
- [ ] Slot definition JSON created following schema
- [ ] JSON syntax validated (use JSONLint or similar)
- [ ] All required fields present for each slot
- [ ] Validation endpoint returns `valid: true`
- [ ] All errors resolved (zero error count)
- [ ] Warnings reviewed and documented

### Staging/Testing
- [ ] Test import on staging/dev environment
- [ ] Dry-run validation (`validateOnly: true`) passes
- [ ] Database backup created before import
- [ ] Test import of 5-10 slots first
- [ ] Manual capture test successful for test slots
- [ ] Detection logs show correct ArUco marker detection
- [ ] SSIM comparison working for test slots
- [ ] Alert rules trigger correctly for missing tools
- [ ] No false positives in detection

### Production Import
- [ ] Production database backup created
- [ ] Maintenance window scheduled
- [ ] Scheduler paused during import
- [ ] Full slot dataset imported successfully
- [ ] Import response shows correct count
- [ ] Database query confirms slot count matches
- [ ] All slot-to-camera relationships verified
- [ ] No duplicate slotId or expectedQrId values
- [ ] Region coordinates within camera resolution bounds

### Post-Import Verification
- [ ] Manual capture executed for each camera
- [ ] All slots visible in detection logs
- [ ] ArUco markers detected correctly
- [ ] SSIM scores calculated for each slot
- [ ] Tool presence/absence detected accurately
- [ ] Alert rules evaluated correctly
- [ ] No unexpected errors in application logs
- [ ] Scheduler re-enabled and running
- [ ] First scheduled capture successful
- [ ] Monitoring dashboard shows all slots

### Rollback Plan
- [ ] Database backup location documented
- [ ] Rollback SQL script prepared:
  ```sql
  -- Delete all imported slots for specific camera
  DELETE FROM slots WHERE camera_id = '<camera-uuid>';
  
  -- Or restore from backup
  pg_restore -d shelfeye /path/to/backup.dump
  ```
- [ ] Rollback tested in staging environment
- [ ] Escalation contact identified if issues occur
