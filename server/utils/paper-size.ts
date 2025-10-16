/**
 * Paper size utilities for calibration
 * Converts paper size formats to physical dimensions in cm
 */

export interface PaperDimensions {
  widthCm: number;
  heightCm: number;
}

export function getPaperDimensions(paperSize: string): PaperDimensions {
  switch (paperSize) {
    case 'A5-landscape':
      return { widthCm: 21.0, heightCm: 14.8 };
    
    case 'A4-landscape':
      return { widthCm: 29.7, heightCm: 21.0 };
    
    case 'A3-landscape':
      return { widthCm: 42.0, heightCm: 29.7 };
    
    case '2xA5-landscape':
      // 2 A5 sheets side by side = 42.0cm × 14.8cm
      return { widthCm: 42.0, heightCm: 14.8 };
    
    case '3xA5-landscape':
      // 3 A5 sheets side by side = 63.0cm × 14.8cm
      return { widthCm: 63.0, heightCm: 14.8 };
    
    case '6-page-3x2':
      // 3×2 A4 landscape sheets = 89.1cm × 42.0cm
      return { widthCm: 89.1, heightCm: 42.0 };
    
    default:
      // Default to A4 landscape
      console.warn(`Unknown paper size: ${paperSize}, defaulting to A4 landscape`);
      return { widthCm: 29.7, heightCm: 21.0 };
  }
}
