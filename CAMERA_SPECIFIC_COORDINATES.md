# Camera-Specific Template Coordinates

## Overview
Template designs (layouts) are **shared** across all cameras, but the actual **coordinates** are **camera-specific**. This allows multiple cameras to use the same template design while each having different physical perspectives.

## How It Works

### 1. Template Design Creation (Shared)
**Location**: Slot Drawing page  
**Storage**: localStorage (`templateConfigVersions`)  
**Scope**: Shared across ALL cameras

When you create a template design like "6-page-3x2":
- You define the layout, paper size, and tool categories
- This design is saved to localStorage
- **No camera selection needed** - designs are universal

### 2. Initial Calibration (Camera-Specific)
**Location**: Calibration page  
**Storage**: PostgreSQL database (`template_rectangles` table)  
**Scope**: Camera-specific

When Camera 1 calibrates with "6-page-3x2":
1. Select camera in "Active Camera" dropdown
2. Select template design in "Template Design" dropdown
3. Click "Run ArUco Calibration"
4. System creates slots and **automatically saves coordinates with `cameraId`**
5. Database now has: `template_rectangles` with `cameraId = Camera1_ID`

### 3. Coordinate Adjustments (Camera-Specific)
**Location**: Calibration page → Rectified Preview  
**Storage**: PostgreSQL database (`template_rectangles` table)  
**Scope**: Camera-specific

If slot markers don't align perfectly:
1. Drag rectangles in the rectified preview to adjust positions
2. Click "Save Adjustments & Recalibrate"
3. System updates **only that camera's coordinates** in database
4. Other cameras using same template design are **not affected**

### 4. Loading Coordinates (Smart Fallback)
**Backend**: `GET /api/template-rectangles?paperSize=X&cameraId=Y`  
**Storage Method**: `getTemplateRectanglesByPaperSizeAndCamera()`

When loading templates for calibration overlay:
1. **First**: Try to load camera-specific coordinates (`cameraId = Camera1_ID`)
2. **Fallback**: If none exist, load shared templates (`cameraId = null`)
3. **Result**: Camera always gets the most appropriate coordinates

## Database Schema

```typescript
template_rectangles {
  id: string (primary key)
  categoryId: string
  paperSize: string        // e.g., "6-page-3x2"
  xCm: number              // Camera-specific X coordinate
  yCm: number              // Camera-specific Y coordinate
  rotation: number
  cameraId: string | null  // null = shared, non-null = camera-specific
  autoQrId: string
  slotId: string
  createdAt: Date
}
```

## Example Scenario

**Setup**: 2 cameras monitoring the same workshop

### Step 1: Create Template Design
- User creates "6-page-3x2" template on Slot Drawing page
- Design saved to localStorage (shared)
- Both cameras can see this design

### Step 2: Camera 1 Calibrates
- User selects Camera 1 (Wide Shelf)
- User selects "6-page-3x2" template
- Calibration runs → coordinates saved with `cameraId = camera1_id`

### Step 3: Camera 2 Calibrates
- User selects Camera 2 (Shelf 2)
- User selects "6-page-3x2" template
- Calibration runs → NEW coordinates saved with `cameraId = camera2_id`

### Step 4: Adjustments (Camera 1)
- User selects Camera 1
- User adjusts some slot positions in rectified preview
- Clicks "Save Adjustments & Recalibrate"
- **Only Camera 1's coordinates updated**
- Camera 2's coordinates remain unchanged

### Result
- Camera 1 has coordinates: `(10, 20), (15, 25), ...` with `cameraId = camera1_id`
- Camera 2 has coordinates: `(12, 18), (17, 23), ...` with `cameraId = camera2_id`
- Both use the same template design "6-page-3x2"

## Key Benefits

1. **Design Reusability**: Create one template, use on multiple cameras
2. **Perspective Independence**: Each camera has its own physical viewpoint
3. **Independent Adjustments**: Fix one camera without affecting others
4. **Smart Fallback**: New cameras can start with shared templates
5. **Data Integrity**: Camera-specific data isolated in database

## Code References

- **Backend API**: `server/routes.ts` line 2109-2131
- **Storage Logic**: `server/storage.ts` line 896-921
- **Frontend Loading**: `client/src/pages/calibration.tsx` line 108-123
- **Frontend Saving**: `client/src/pages/calibration.tsx` line 719-731
- **Initial Save**: `server/routes.ts` line 609-615
