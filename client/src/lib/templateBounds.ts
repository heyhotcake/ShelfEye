/**
 * Template boundary validation and clamping utilities
 * Ensures rectangles stay within printable area for all paper sizes
 */

export interface PaperBounds {
  widthCm: number;
  heightCm: number;
  safeMarginCm: number;
}

export const PAPER_BOUNDS: Record<string, PaperBounds> = {
  'A5-landscape': { widthCm: 21.0, heightCm: 14.8, safeMarginCm: 1.0 },
  'A4-landscape': { widthCm: 29.7, heightCm: 21.0, safeMarginCm: 1.0 },
  'A3-landscape': { widthCm: 42.0, heightCm: 29.7, safeMarginCm: 1.0 },
  '2xA5-landscape': { widthCm: 42.0, heightCm: 14.8, safeMarginCm: 1.0 },
  '3xA5-landscape': { widthCm: 63.0, heightCm: 14.8, safeMarginCm: 1.0 },
  '6-page-3x2': { widthCm: 89.1, heightCm: 42.0, safeMarginCm: 1.0 },
  '8-page-4x2': { widthCm: 118.8, heightCm: 42.0, safeMarginCm: 1.0 },
};

export interface Rectangle {
  xCm: number;
  yCm: number;
  widthCm: number;
  heightCm: number;
}

export interface BoundaryViolation {
  edge: 'left' | 'right' | 'top' | 'bottom';
  amount: number; // How far outside (in cm)
}

/**
 * Get safe zone bounds for multi-page formats, accounting for per-sheet margins
 * For 6-page: 3 columns x 2 rows of A4 sheets, each with 1cm safe margin
 * For 8-page: 4 columns x 2 rows of A4 sheets, each with 1cm safe margin
 */
function getMultiPageSafeBounds(cols: number, rows: number): { minX: number; maxX: number; minY: number; maxY: number }[] {
  const a4WidthCm = 29.7;
  const a4HeightCm = 21.0;
  const safeMarginCm = 1.0;
  
  const sheetBounds = [];
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sheetOffsetX = col * a4WidthCm;
      const sheetOffsetY = row * a4HeightCm;
      
      sheetBounds.push({
        minX: sheetOffsetX + safeMarginCm,
        maxX: sheetOffsetX + a4WidthCm - safeMarginCm,
        minY: sheetOffsetY + safeMarginCm,
        maxY: sheetOffsetY + a4HeightCm - safeMarginCm,
      });
    }
  }
  
  return sheetBounds;
}

/**
 * Legacy wrapper for 6-page format
 */
function get6PageSafeBounds(): { minX: number; maxX: number; minY: number; maxY: number }[] {
  return getMultiPageSafeBounds(3, 2);
}

/**
 * Check if a rectangle extends outside the safe zones
 * For 6-page format, checks against individual sheet safe zones
 */
export function checkBoundaryViolations(
  rect: Rectangle,
  paperSize: string
): BoundaryViolation[] {
  const bounds = PAPER_BOUNDS[paperSize];
  if (!bounds) return [];

  const violations: BoundaryViolation[] = [];
  
  const halfWidth = rect.widthCm / 2;
  const halfHeight = rect.heightCm / 2;
  
  const leftEdge = rect.xCm - halfWidth;
  const rightEdge = rect.xCm + halfWidth;
  const topEdge = rect.yCm - halfHeight;
  const bottomEdge = rect.yCm + halfHeight;
  
  if (paperSize === '6-page-3x2' || paperSize === '8-page-4x2') {
    // For multi-page format, check against all sheet safe zones
    // Rectangle must fit entirely within at least one sheet's safe zone
    const sheetSafeBounds = paperSize === '8-page-4x2' 
      ? getMultiPageSafeBounds(4, 2)
      : get6PageSafeBounds();
    
    let fitsInAnySheet = false;
    for (const sheet of sheetSafeBounds) {
      if (leftEdge >= sheet.minX && rightEdge <= sheet.maxX &&
          topEdge >= sheet.minY && bottomEdge <= sheet.maxY) {
        fitsInAnySheet = true;
        break;
      }
    }
    
    if (!fitsInAnySheet) {
      // Find which edges violate the closest sheet
      const centerX = rect.xCm;
      const centerY = rect.yCm;
      
      // Determine which sheet the center is in
      const col = Math.floor(centerX / 29.7);
      const row = Math.floor(centerY / 21.0);
      const totalCols = paperSize === '8-page-4x2' ? 4 : 3;
      const maxIndex = paperSize === '8-page-4x2' ? 7 : 5;
      const sheetIndex = Math.min(Math.max(row * totalCols + col, 0), maxIndex);
      const sheet = sheetSafeBounds[sheetIndex];
      
      if (leftEdge < sheet.minX) violations.push({ edge: 'left', amount: sheet.minX - leftEdge });
      if (rightEdge > sheet.maxX) violations.push({ edge: 'right', amount: rightEdge - sheet.maxX });
      if (topEdge < sheet.minY) violations.push({ edge: 'top', amount: sheet.minY - topEdge });
      if (bottomEdge > sheet.maxY) violations.push({ edge: 'bottom', amount: bottomEdge - sheet.maxY });
    }
  } else {
    // For single-page formats, use simple bounds
    const minX = bounds.safeMarginCm;
    const maxX = bounds.widthCm - bounds.safeMarginCm;
    const minY = bounds.safeMarginCm;
    const maxY = bounds.heightCm - bounds.safeMarginCm;
    
    if (leftEdge < minX) violations.push({ edge: 'left', amount: minX - leftEdge });
    if (rightEdge > maxX) violations.push({ edge: 'right', amount: rightEdge - maxX });
    if (topEdge < minY) violations.push({ edge: 'top', amount: minY - topEdge });
    if (bottomEdge > maxY) violations.push({ edge: 'bottom', amount: bottomEdge - maxY });
  }
  
  return violations;
}

/**
 * Clamp a rectangle position to stay within safe zones
 * For 6-page format, clamps to the nearest sheet's safe zone
 * Returns the corrected center position (xCm, yCm)
 */
export function clampToBounds(
  rect: Rectangle,
  paperSize: string
): { xCm: number; yCm: number; clamped: boolean } {
  const bounds = PAPER_BOUNDS[paperSize];
  if (!bounds) return { xCm: rect.xCm, yCm: rect.yCm, clamped: false };

  const halfWidth = rect.widthCm / 2;
  const halfHeight = rect.heightCm / 2;
  
  if (paperSize === '6-page-3x2' || paperSize === '8-page-4x2') {
    // For multi-page format, clamp to the appropriate sheet's safe zone
    const sheetSafeBounds = paperSize === '8-page-4x2'
      ? getMultiPageSafeBounds(4, 2)
      : get6PageSafeBounds();
    
    // Determine which sheet the rectangle center is in
    const col = Math.floor(rect.xCm / 29.7);
    const row = Math.floor(rect.yCm / 21.0);
    const totalCols = paperSize === '8-page-4x2' ? 4 : 3;
    const maxIndex = paperSize === '8-page-4x2' ? 7 : 5;
    const sheetIndex = Math.min(Math.max(row * totalCols + col, 0), maxIndex);
    const sheet = sheetSafeBounds[sheetIndex];
    
    // Clamp center to keep rectangle fully within this sheet's safe zone
    const minX = sheet.minX + halfWidth;
    const maxX = sheet.maxX - halfWidth;
    const minY = sheet.minY + halfHeight;
    const maxY = sheet.maxY - halfHeight;
    
    const clampedX = Math.max(minX, Math.min(maxX, rect.xCm));
    const clampedY = Math.max(minY, Math.min(maxY, rect.yCm));
    
    const clamped = clampedX !== rect.xCm || clampedY !== rect.yCm;
    
    return { xCm: clampedX, yCm: clampedY, clamped };
  } else {
    // For single-page formats, use simple bounds
    const minX = bounds.safeMarginCm + halfWidth;
    const maxX = bounds.widthCm - bounds.safeMarginCm - halfWidth;
    const minY = bounds.safeMarginCm + halfHeight;
    const maxY = bounds.heightCm - bounds.safeMarginCm - halfHeight;
    
    const clampedX = Math.max(minX, Math.min(maxX, rect.xCm));
    const clampedY = Math.max(minY, Math.min(maxY, rect.yCm));
    
    const clamped = clampedX !== rect.xCm || clampedY !== rect.yCm;
    
    return { xCm: clampedX, yCm: clampedY, clamped };
  }
}

/**
 * Format boundary violations into a user-friendly message
 */
export function formatViolationMessage(violations: BoundaryViolation[]): string {
  if (violations.length === 0) return '';
  
  const edges = violations.map(v => `${v.edge} (${v.amount.toFixed(1)}cm outside)`);
  return `Rectangle extends beyond printable area: ${edges.join(', ')}`;
}
