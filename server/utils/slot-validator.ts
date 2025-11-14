import { Slot, InsertSlot, Camera } from "@shared/schema";
import { z, ZodError } from "zod";

export const slotExportEnvelopeSchema = z.object({
  version: z.string(),
  exportDate: z.string().datetime(),
  cameraId: z.string().uuid(),
  cameraName: z.string(),
  slots: z.array(z.object({
    slotId: z.string().min(1),
    toolName: z.string().min(1),
    expectedQrId: z.string().regex(/^\d+$/).refine(val => {
      const num = parseInt(val);
      const isToolMarker = num >= 1 && num <= 50;
      const isCornerMarker = num >= 96 && num <= 99;
      return isToolMarker || isCornerMarker;
    }, { message: "ArUco marker ID must be 1-50 (tools) or 96-99 (corners)" }),
    priority: z.enum(["low", "medium", "high"]),
    regionCoords: z.array(z.tuple([z.number(), z.number()])).min(3),
    xCm: z.number().positive(),
    yCm: z.number().positive(),
    widthCm: z.number().positive(),
    heightCm: z.number().positive(),
    rotationDeg: z.number().min(0).max(359),
    allowCheckout: z.boolean(),
    graceWindow: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/),
  }))
});

export type SlotExportEnvelope = z.infer<typeof slotExportEnvelopeSchema>;

export interface SlotValidationError {
  slotId: string;
  code: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface SlotValidationResult {
  valid: boolean;
  errors: SlotValidationError[];
  warnings: SlotValidationError[];
}

export function translateZodError(zodError: ZodError, slotId: string): SlotValidationError[] {
  return zodError.errors.map(err => {
    const field = err.path.join('.');
    let code = 'VALIDATION_ERROR';
    let message = err.message;
    
    if (field === 'slotId' && err.code === 'too_small') {
      code = 'MISSING_SLOT_ID';
      message = 'Slot ID is required';
    } else if (field === 'toolName' && err.code === 'too_small') {
      code = 'MISSING_TOOL_NAME';
      message = 'Tool name is required';
    } else if (field === 'expectedQrId' && err.code === 'too_small') {
      code = 'MISSING_EXPECTED_QR_ID';
      message = 'ArUco marker ID (expectedQrId) is required';
    } else if (field === 'expectedQrId' && (err.code === 'invalid_string' || err.code === 'custom')) {
      code = 'INVALID_EXPECTED_QR_ID';
      message = 'ArUco marker ID must be 1-50 (tool markers) or 96-99 (corner markers)';
    } else if (field === 'cameraId' && err.code === 'too_small') {
      code = 'MISSING_CAMERA_ID';
      message = 'Camera ID is required';
    } else if (field === 'cameraId' && err.code === 'invalid_string') {
      code = 'INVALID_CAMERA_ID';
      message = 'Camera ID must be a valid UUID';
    } else if (field === 'regionCoords' && err.code === 'too_small') {
      code = 'INVALID_REGION_COORDS';
      message = 'Region must have at least 3 coordinate pairs';
    } else if (field === 'regionCoords' && (err.code === 'invalid_type' || err.code === 'invalid_union')) {
      code = 'MALFORMED_COORDS';
      message = 'Region coordinates must be [x, y] number pairs';
    } else if (field === 'xCm' && err.code === 'too_small') {
      code = 'INVALID_X_POSITION';
      message = 'X position must be a positive number';
    } else if (field === 'yCm' && err.code === 'too_small') {
      code = 'INVALID_Y_POSITION';
      message = 'Y position must be a positive number';
    } else if (field === 'widthCm' && err.code === 'too_small') {
      code = 'INVALID_WIDTH';
      message = 'Width must be a positive number';
    } else if (field === 'heightCm' && err.code === 'too_small') {
      code = 'INVALID_HEIGHT';
      message = 'Height must be a positive number';
    } else if (field === 'rotationDeg' && (err.code === 'too_small' || err.code === 'too_big')) {
      code = 'INVALID_ROTATION';
      message = 'Rotation must be between 0 and 359 degrees';
    } else if (field === 'priority' && err.code === 'invalid_enum_value') {
      code = 'INVALID_PRIORITY';
      message = 'Priority must be low, medium, or high';
    } else if (field === 'graceWindow' && err.code === 'invalid_string') {
      code = 'INVALID_GRACE_WINDOW';
      message = 'Grace window must be in format HH:MM-HH:MM';
    }
    
    return {
      slotId,
      code,
      field,
      message,
      severity: 'error' as const
    };
  });
}

interface RegionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function validateSlot(
  slot: Partial<InsertSlot>,
  camera?: Camera
): SlotValidationResult {
  const errors: SlotValidationError[] = [];
  const warnings: SlotValidationError[] = [];
  
  const slotId = slot.slotId || 'unknown';
  
  if (!slot.slotId || slot.slotId.trim() === '') {
    errors.push({
      slotId: 'unknown',
      field: 'slotId',
      message: 'Slot ID is required',
      severity: 'error'
    });
  }
  
  if (!slot.toolName || slot.toolName.trim() === '') {
    errors.push({
      slotId,
      field: 'toolName',
      message: 'Tool name is required',
      severity: 'error'
    });
  }
  
  if (!slot.expectedQrId || slot.expectedQrId.trim() === '') {
    errors.push({
      slotId,
      field: 'expectedQrId',
      message: 'ArUco marker ID (expectedQrId) is required',
      severity: 'error'
    });
  } else {
    const markerId = parseInt(slot.expectedQrId);
    const isToolMarker = markerId >= 1 && markerId <= 50;
    const isCornerMarker = markerId >= 96 && markerId <= 99;
    
    if (isNaN(markerId) || (!isToolMarker && !isCornerMarker)) {
      errors.push({
        slotId,
        field: 'expectedQrId',
        message: 'ArUco marker ID must be 1-50 (tool markers) or 96-99 (corner markers)',
        severity: 'error'
      });
    }
  }
  
  if (!slot.cameraId) {
    errors.push({
      slotId,
      field: 'cameraId',
      message: 'Camera ID is required',
      severity: 'error'
    });
  } else if (camera === undefined) {
    errors.push({
      slotId,
      field: 'cameraId',
      message: `Camera ID ${slot.cameraId} does not exist`,
      severity: 'error'
    });
  }
  
  if (!slot.regionCoords || !Array.isArray(slot.regionCoords) || slot.regionCoords.length < 3) {
    errors.push({
      slotId,
      field: 'regionCoords',
      message: 'Region must have at least 3 coordinate pairs',
      severity: 'error'
    });
  } else {
    const validCoords = slot.regionCoords.every(
      coord => Array.isArray(coord) && coord.length === 2 && 
      typeof coord[0] === 'number' && typeof coord[1] === 'number'
    );
    
    if (!validCoords) {
      errors.push({
        slotId,
        field: 'regionCoords',
        message: 'Region coordinates must be [x, y] number pairs',
        severity: 'error'
      });
    }
    
    if (camera && validCoords) {
      const [width, height] = camera.resolution;
      const outOfBounds = slot.regionCoords.some(coord => {
        if (!Array.isArray(coord) || coord.length !== 2) return false;
        const [x, y] = coord;
        return x < 0 || x > width || y < 0 || y > height;
      });
      
      if (outOfBounds) {
        errors.push({
          slotId,
          field: 'regionCoords',
          message: `Region coordinates exceed camera resolution (${width}x${height})`,
          severity: 'error'
        });
      }
    }
  }
  
  if (typeof slot.xCm !== 'number' || slot.xCm < 0) {
    errors.push({
      slotId,
      field: 'xCm',
      message: 'X position must be a positive number',
      severity: 'error'
    });
  }
  
  if (typeof slot.yCm !== 'number' || slot.yCm < 0) {
    errors.push({
      slotId,
      field: 'yCm',
      message: 'Y position must be a positive number',
      severity: 'error'
    });
  }
  
  if (typeof slot.widthCm !== 'number' || slot.widthCm <= 0) {
    errors.push({
      slotId,
      field: 'widthCm',
      message: 'Width must be a positive number',
      severity: 'error'
    });
  }
  
  if (typeof slot.heightCm !== 'number' || slot.heightCm <= 0) {
    errors.push({
      slotId,
      field: 'heightCm',
      message: 'Height must be a positive number',
      severity: 'error'
    });
  }
  
  if (slot.rotationDeg !== undefined) {
    if (typeof slot.rotationDeg !== 'number' || slot.rotationDeg < 0 || slot.rotationDeg >= 360) {
      errors.push({
        slotId,
        field: 'rotationDeg',
        message: 'Rotation must be between 0 and 359 degrees',
        severity: 'error'
      });
    }
  }
  
  if (slot.priority && !['low', 'medium', 'high'].includes(slot.priority)) {
    errors.push({
      slotId,
      field: 'priority',
      message: 'Priority must be low, medium, or high',
      severity: 'error'
    });
  }
  
  if (slot.graceWindow) {
    const timeRangeRegex = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
    if (!timeRangeRegex.test(slot.graceWindow)) {
      errors.push({
        slotId,
        field: 'graceWindow',
        message: 'Grace window must be in format HH:MM-HH:MM',
        severity: 'error'
      });
    }
  }
  
  if (slot.xCm && slot.widthCm && slot.xCm < slot.widthCm / 2) {
    warnings.push({
      slotId,
      field: 'xCm',
      message: 'Slot may extend beyond left edge of template',
      severity: 'warning'
    });
  }
  
  if (slot.yCm && slot.heightCm && slot.yCm < slot.heightCm / 2) {
    warnings.push({
      slotId,
      field: 'yCm',
      message: 'Slot may extend beyond top edge of template',
      severity: 'warning'
    });
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function validateSlotCollection(
  slots: Partial<InsertSlot>[],
  cameras: Map<string, Camera>
): SlotValidationResult {
  const allErrors: SlotValidationError[] = [];
  const allWarnings: SlotValidationError[] = [];
  
  slots.forEach(slot => {
    const camera = slot.cameraId ? cameras.get(slot.cameraId) : undefined;
    const result = validateSlot(slot, camera);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  });
  
  const slotIdsByCamera = new Map<string, Set<string>>();
  const expectedQrIdsByCamera = new Map<string, Set<string>>();
  
  slots.forEach(slot => {
    if (!slot.cameraId || !slot.slotId) return;
    
    if (!slotIdsByCamera.has(slot.cameraId)) {
      slotIdsByCamera.set(slot.cameraId, new Set());
      expectedQrIdsByCamera.set(slot.cameraId, new Set());
    }
    
    if (slotIdsByCamera.get(slot.cameraId)!.has(slot.slotId)) {
      allErrors.push({
        slotId: slot.slotId,
        field: 'slotId',
        message: `Duplicate slot ID "${slot.slotId}" for camera ${slot.cameraId}`,
        severity: 'error'
      });
    }
    slotIdsByCamera.get(slot.cameraId)!.add(slot.slotId);
    
    if (slot.expectedQrId) {
      if (expectedQrIdsByCamera.get(slot.cameraId)!.has(slot.expectedQrId)) {
        allErrors.push({
          slotId: slot.slotId,
          field: 'expectedQrId',
          message: `Duplicate ArUco marker ID "${slot.expectedQrId}" for camera ${slot.cameraId}`,
          severity: 'error'
        });
      }
      expectedQrIdsByCamera.get(slot.cameraId)!.add(slot.expectedQrId);
    }
  });
  
  const slotsByCamera = new Map<string, Partial<InsertSlot>[]>();
  slots.forEach(slot => {
    if (!slot.cameraId) return;
    if (!slotsByCamera.has(slot.cameraId)) {
      slotsByCamera.set(slot.cameraId, []);
    }
    slotsByCamera.get(slot.cameraId)!.push(slot);
  });
  
  slotsByCamera.forEach((cameraSlots, cameraId) => {
    const overlaps = detectRegionOverlaps(cameraSlots);
    overlaps.forEach(overlap => {
      allWarnings.push({
        slotId: overlap.slot1Id,
        field: 'regionCoords',
        message: `Region overlaps with slot ${overlap.slot2Id}`,
        severity: 'warning'
      });
    });
  });
  
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings
  };
}

function detectRegionOverlaps(slots: Partial<InsertSlot>[]): Array<{slot1Id: string, slot2Id: string}> {
  const overlaps: Array<{slot1Id: string, slot2Id: string}> = [];
  
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const slot1 = slots[i];
      const slot2 = slots[j];
      
      if (!slot1.regionCoords || !slot2.regionCoords || !slot1.slotId || !slot2.slotId) {
        continue;
      }
      
      if (regionsOverlap(slot1.regionCoords as number[][], slot2.regionCoords as number[][])) {
        overlaps.push({
          slot1Id: slot1.slotId,
          slot2Id: slot2.slotId
        });
      }
    }
  }
  
  return overlaps;
}

function regionsOverlap(region1: number[][], region2: number[][]): boolean {
  const bounds1 = getRegionBounds(region1);
  const bounds2 = getRegionBounds(region2);
  
  if (!boundsOverlap(bounds1, bounds2)) {
    return false;
  }
  
  for (const point of region1) {
    if (isPointInPolygon(point, region2)) {
      return true;
    }
  }
  
  for (const point of region2) {
    if (isPointInPolygon(point, region1)) {
      return true;
    }
  }
  
  return false;
}

function getRegionBounds(region: number[][]): RegionBounds {
  const xs = region.map(p => p[0]);
  const ys = region.map(p => p[1]);
  
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

function boundsOverlap(b1: RegionBounds, b2: RegionBounds): boolean {
  return !(b1.maxX < b2.minX || b2.maxX < b1.minX || 
           b1.maxY < b2.minY || b2.maxY < b1.minY);
}

function isPointInPolygon(point: number[], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    
    if (intersect) {
      inside = !inside;
    }
  }
  
  return inside;
}

export interface SlotExportFormat {
  version: string;
  exportDate: string;
  cameraId: string;
  cameraName: string;
  slots: Array<{
    slotId: string;
    toolName: string;
    expectedQrId: string;
    priority: string;
    regionCoords: number[][];
    xCm: number;
    yCm: number;
    widthCm: number;
    heightCm: number;
    rotationDeg: number;
    allowCheckout: boolean;
    graceWindow: string;
  }>;
}

export function exportSlotsToJSON(
  slots: Slot[],
  camera: Camera
): SlotExportFormat {
  return {
    version: "1.0",
    exportDate: new Date().toISOString(),
    cameraId: camera.id,
    cameraName: camera.name,
    slots: slots.map(slot => ({
      slotId: slot.slotId,
      toolName: slot.toolName,
      expectedQrId: slot.expectedQrId || slot.slotNumber.toString(),
      priority: slot.priority,
      regionCoords: slot.regionCoords,
      xCm: slot.xCm,
      yCm: slot.yCm,
      widthCm: slot.widthCm,
      heightCm: slot.heightCm,
      rotationDeg: slot.rotationDeg,
      allowCheckout: slot.allowCheckout,
      graceWindow: slot.graceWindow || '08:30-16:30',
    }))
  };
}

export function importSlotsFromJSON(
  json: SlotExportFormat,
  targetCameraId: string
): Partial<InsertSlot>[] {
  return json.slots.map(slot => ({
    slotId: slot.slotId,
    cameraId: targetCameraId,
    toolName: slot.toolName,
    expectedQrId: slot.expectedQrId,
    priority: slot.priority,
    regionCoords: slot.regionCoords,
    xCm: slot.xCm,
    yCm: slot.yCm,
    widthCm: slot.widthCm,
    heightCm: slot.heightCm,
    rotationDeg: slot.rotationDeg,
    allowCheckout: slot.allowCheckout,
    graceWindow: slot.graceWindow,
    isActive: true
  }));
}
