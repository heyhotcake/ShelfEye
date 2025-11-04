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
  'A5-landscape': { widthCm: 21.0, heightCm: 14.8, safeMarginCm: 0.5 },
  'A4-landscape': { widthCm: 29.7, heightCm: 21.0, safeMarginCm: 0.5 },
  'A3-landscape': { widthCm: 42.0, heightCm: 29.7, safeMarginCm: 0.5 },
  '2xA5-landscape': { widthCm: 42.0, heightCm: 14.8, safeMarginCm: 0.5 },
  '3xA5-landscape': { widthCm: 63.0, heightCm: 14.8, safeMarginCm: 0.5 },
  '6-page-3x2': { widthCm: 89.1, heightCm: 42.0, safeMarginCm: 0.5 },
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
 * Check if a rectangle extends outside the printable area
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
  
  const minX = bounds.safeMarginCm;
  const maxX = bounds.widthCm - bounds.safeMarginCm;
  const minY = bounds.safeMarginCm;
  const maxY = bounds.heightCm - bounds.safeMarginCm;
  
  if (leftEdge < minX) {
    violations.push({ edge: 'left', amount: minX - leftEdge });
  }
  if (rightEdge > maxX) {
    violations.push({ edge: 'right', amount: rightEdge - maxX });
  }
  if (topEdge < minY) {
    violations.push({ edge: 'top', amount: minY - topEdge });
  }
  if (bottomEdge > maxY) {
    violations.push({ edge: 'bottom', amount: bottomEdge - maxY });
  }
  
  return violations;
}

/**
 * Clamp a rectangle position to stay within printable bounds
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
  
  const minX = bounds.safeMarginCm + halfWidth;
  const maxX = bounds.widthCm - bounds.safeMarginCm - halfWidth;
  const minY = bounds.safeMarginCm + halfHeight;
  const maxY = bounds.heightCm - bounds.safeMarginCm - halfHeight;
  
  const clampedX = Math.max(minX, Math.min(maxX, rect.xCm));
  const clampedY = Math.max(minY, Math.min(maxY, rect.yCm));
  
  const clamped = clampedX !== rect.xCm || clampedY !== rect.yCm;
  
  return { xCm: clampedX, yCm: clampedY, clamped };
}

/**
 * Format boundary violations into a user-friendly message
 */
export function formatViolationMessage(violations: BoundaryViolation[]): string {
  if (violations.length === 0) return '';
  
  const edges = violations.map(v => `${v.edge} (${v.amount.toFixed(1)}cm outside)`);
  return `Rectangle extends beyond printable area: ${edges.join(', ')}`;
}
