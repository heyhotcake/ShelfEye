interface Point {
  x: number;
  y: number;
}

interface TemplateRect {
  xCm: number;
  yCm: number;
  widthCm: number;
  heightCm: number;
  rotation: number;
}

export function transformTemplateToPixels(
  template: TemplateRect,
  homographyMatrix: number[]
): number[][] {
  if (!homographyMatrix || homographyMatrix.length !== 9) {
    throw new Error('Invalid homography matrix');
  }

  const corners = getRectangleCorners(template);
  
  const transformedCorners = corners.map(corner => {
    return applyHomography(corner, homographyMatrix);
  });

  return transformedCorners.map(p => [p.x, p.y]);
}

function getRectangleCorners(rect: TemplateRect): Point[] {
  const { xCm, yCm, widthCm, heightCm, rotation } = rect;
  
  const centerX = xCm + widthCm / 2;
  const centerY = yCm + heightCm / 2;
  
  const halfW = widthCm / 2;
  const halfH = heightCm / 2;
  
  const angleRad = (rotation * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  
  const corners: Point[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  
  return corners.map(corner => ({
    x: centerX + corner.x * cos - corner.y * sin,
    y: centerY + corner.x * sin + corner.y * cos,
  }));
}

function applyHomography(point: Point, H: number[]): Point {
  const x = point.x;
  const y = point.y;
  
  const xPrime = H[0] * x + H[1] * y + H[2];
  const yPrime = H[3] * x + H[4] * y + H[5];
  const w = H[6] * x + H[7] * y + H[8];
  
  return {
    x: xPrime / w,
    y: yPrime / w,
  };
}
