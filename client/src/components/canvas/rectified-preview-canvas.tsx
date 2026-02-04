import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Point {
  x: number;
  y: number;
}

interface TemplateRect {
  id: string;
  categoryId: string;
  categoryName: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  heightCm: number;
  rotation: number;
  autoQrId?: string;
  categoryType?: 'tool' | 'scanner_grid' | 'worker_tag_grid';
  gridRows?: number;
  gridCols?: number;
}

interface RectifiedPreviewCanvasProps {
  baseImage: string;
  templates: TemplateRect[];
  paperWidthCm: number;
  paperHeightCm: number;
  paperSize?: string; // Paper size string like '8-page-4x2' to determine multi-sheet layout
  measuredPxPerCm?: number;  // actual pixel density from ArUco marker detection
  onTemplatesAdjusted: (adjustedTemplates: TemplateRect[]) => void;
  className?: string;
}

export function RectifiedPreviewCanvas({
  baseImage,
  templates,
  paperWidthCm,
  paperHeightCm,
  paperSize,
  measuredPxPerCm,
  onTemplatesAdjusted,
  className
}: RectifiedPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [draggedTemplate, setDraggedTemplate] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);
  const [adjustedTemplates, setAdjustedTemplates] = useState<TemplateRect[]>(templates);
  const [hasTemplateAdjustments, setHasTemplateAdjustments] = useState(false);

  useEffect(() => {
    setAdjustedTemplates(templates);
    setHasTemplateAdjustments(false);
  }, [templates]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      const aspectRatio = img.width / img.height;
      
      const container = canvasRef.current?.parentElement;
      if (container) {
        const containerWidth = container.clientWidth;
        const width = containerWidth;
        const height = width / aspectRatio;
        setCanvasSize({ width, height });
        
        // Diagnostic logging for scale mismatch debugging
        const expectedAspectRatio = paperWidthCm / paperHeightCm;
        const imagePxPerCmX = img.width / paperWidthCm;
        const imagePxPerCmY = img.height / paperHeightCm;
        const assumedPxPerCm = 30; // Server generates preview at 30 px/cm
        
        console.log('[RectifiedPreviewCanvas] Image loaded:', {
          imageDimensions: `${img.width}×${img.height}px`,
          paperDimensions: `${paperWidthCm}×${paperHeightCm}cm`,
          imageAspectRatio: aspectRatio.toFixed(4),
          expectedAspectRatio: expectedAspectRatio.toFixed(4),
          aspectRatioMatch: Math.abs(aspectRatio - expectedAspectRatio) < 0.01,
          imagePxPerCm: `${imagePxPerCmX.toFixed(2)} (X), ${imagePxPerCmY.toFixed(2)} (Y)`,
          measuredPxPerCm: measuredPxPerCm?.toFixed(2) ?? 'N/A',
          assumedPxPerCm,
          canvasSize: `${width.toFixed(0)}×${height.toFixed(0)}px`,
          scaleFactor: `${(width / img.width).toFixed(4)} (canvas/image)`,
        });
        
        // Check for pixel density mismatch
        if (measuredPxPerCm && Math.abs(imagePxPerCmX - measuredPxPerCm) > 0.5) {
          const scaleDiff = ((imagePxPerCmX - measuredPxPerCm) / measuredPxPerCm * 100).toFixed(2);
          console.warn(`[RectifiedPreviewCanvas] PIXEL DENSITY MISMATCH: Image uses ${imagePxPerCmX.toFixed(2)} px/cm but measured is ${measuredPxPerCm.toFixed(2)} px/cm (${scaleDiff}% difference)`);
        }
        
        if (Math.abs(aspectRatio - expectedAspectRatio) > 0.01) {
          console.warn('[RectifiedPreviewCanvas] ASPECT RATIO MISMATCH! Image may not match paper dimensions.');
        }
      }
    };
    img.src = baseImage;
  }, [baseImage, paperWidthCm, paperHeightCm, measuredPxPerCm]);

  // The rectified image is cropped to the marker-bounded area (1cm inset from each edge)
  // So the image shows from (markerInset, markerInset) to (paperWidth-markerInset, paperHeight-markerInset)
  const markerInsetCm = 1.0;
  const croppedWidthCm = paperWidthCm - 2 * markerInsetCm;
  const croppedHeightCm = paperHeightCm - 2 * markerInsetCm;

  const cmToPixels = (cm: number, axis: 'x' | 'y'): number => {
    // Convert from full paper cm to cropped cm (subtract offset), then to pixels
    if (axis === 'x') {
      const croppedCm = cm - markerInsetCm;
      return (croppedCm / croppedWidthCm) * canvasSize.width;
    } else {
      const croppedCm = cm - markerInsetCm;
      return (croppedCm / croppedHeightCm) * canvasSize.height;
    }
  };

  const pixelsToCm = (pixels: number, axis: 'x' | 'y'): number => {
    // Convert from pixels to cropped cm, then add offset for full paper cm
    if (axis === 'x') {
      const croppedCm = (pixels / canvasSize.width) * croppedWidthCm;
      return croppedCm + markerInsetCm;
    } else {
      const croppedCm = (pixels / canvasSize.height) * croppedHeightCm;
      return croppedCm + markerInsetCm;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

    // DIAGNOSTIC: Log coordinate conversion details for debugging overlay alignment (once per render)
    if (adjustedTemplates.length > 0 && !draggedTemplate) {
      const sampleTemplate = adjustedTemplates[0];
      const sampleCenterX = cmToPixels(sampleTemplate.xCm, 'x');
      const sampleCenterY = cmToPixels(sampleTemplate.yCm, 'y');
      console.log('[OverlayDebug] Coordinate conversion check:', {
        paperDimensions: `${paperWidthCm}×${paperHeightCm} cm`,
        canvasDimensions: `${canvasSize.width}×${canvasSize.height} px`,
        pxPerCmX: (canvasSize.width / paperWidthCm).toFixed(2),
        pxPerCmY: (canvasSize.height / paperHeightCm).toFixed(2),
        sampleTemplate: {
          name: sampleTemplate.categoryName,
          xCm: sampleTemplate.xCm.toFixed(2),
          yCm: sampleTemplate.yCm.toFixed(2),
          widthCm: sampleTemplate.widthCm,
          heightCm: sampleTemplate.heightCm,
          xPx: sampleCenterX.toFixed(1),
          yPx: sampleCenterY.toFixed(1),
        },
        // Expected positions for comparison with debug markers
        expectedCornerPx: {
          topLeft: `(${cmToPixels(0, 'x').toFixed(1)}, ${cmToPixels(0, 'y').toFixed(1)})`,
          topRight: `(${cmToPixels(paperWidthCm, 'x').toFixed(1)}, ${cmToPixels(0, 'y').toFixed(1)})`,
          bottomLeft: `(${cmToPixels(0, 'x').toFixed(1)}, ${cmToPixels(paperHeightCm, 'y').toFixed(1)})`,
          bottomRight: `(${cmToPixels(paperWidthCm, 'x').toFixed(1)}, ${cmToPixels(paperHeightCm, 'y').toFixed(1)})`,
        },
        // ArUco expected positions (calculated based on paper layout)
        paperSize: paperSize || 'single-sheet',
        expectedArUcoPx: (() => {
          const markerSizeCm = 5;
          const markerInsetCm = 1;
          const halfMarker = markerSizeCm / 2;
          const a4WidthCm = 29.7;
          const is8Page = paperSize === '8-page-4x2';
          const is6Page = paperSize === '6-page-3x2';
          const isMultiSheet = is8Page || is6Page;
          const gridCols = is8Page ? 4 : is6Page ? 3 : 1;
          
          if (isMultiSheet) {
            return {
              topLeft: `(${cmToPixels(markerInsetCm + halfMarker, 'x').toFixed(1)}, ${cmToPixels(markerInsetCm + halfMarker, 'y').toFixed(1)})`,
              topRight: `(${cmToPixels((gridCols - 1) * a4WidthCm + (a4WidthCm - markerSizeCm - markerInsetCm) + halfMarker, 'x').toFixed(1)}, ${cmToPixels(markerInsetCm + halfMarker, 'y').toFixed(1)})`,
            };
          } else {
            return {
              topLeft: `(${cmToPixels(markerInsetCm + halfMarker, 'x').toFixed(1)}, ${cmToPixels(markerInsetCm + halfMarker, 'y').toFixed(1)})`,
              topRight: `(${cmToPixels(paperWidthCm - markerSizeCm - markerInsetCm + halfMarker, 'x').toFixed(1)}, ${cmToPixels(markerInsetCm + halfMarker, 'y').toFixed(1)})`,
            };
          }
        })(),
        templateCount: adjustedTemplates.length,
        allTemplatePositions: adjustedTemplates.slice(0, 5).map(t => ({
          name: t.categoryName,
          cm: `(${t.xCm.toFixed(1)}, ${t.yCm.toFixed(1)})`,
          px: `(${cmToPixels(t.xCm, 'x').toFixed(0)}, ${cmToPixels(t.yCm, 'y').toFixed(0)})`,
        })),
      });
    }

    adjustedTemplates.forEach((template) => {
      const centerX = cmToPixels(template.xCm, 'x');
      const centerY = cmToPixels(template.yCm, 'y');
      const width = cmToPixels(template.widthCm, 'x');
      const height = cmToPixels(template.heightCm, 'y');

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate((template.rotation * Math.PI) / 180);

      const isHovered = hoveredTemplate === template.id;
      const isDragged = draggedTemplate === template.id;
      const isGridType = template.categoryType === 'scanner_grid' || template.categoryType === 'worker_tag_grid';
      
      // Choose colors based on category type
      let strokeColor = isDragged ? 'rgb(147, 51, 234)' : isHovered ? 'rgb(236, 72, 153)' : 'rgb(217, 70, 239)';
      let fillColor = 'rgba(217, 70, 239, 0.1)';
      
      if (isGridType) {
        if (template.categoryType === 'scanner_grid') {
          strokeColor = isDragged ? 'rgb(234, 179, 8)' : isHovered ? 'rgb(250, 204, 21)' : 'rgb(234, 179, 8)';
          fillColor = 'rgba(234, 179, 8, 0.15)';
        } else if (template.categoryType === 'worker_tag_grid') {
          strokeColor = isDragged ? 'rgb(59, 130, 246)' : isHovered ? 'rgb(96, 165, 250)' : 'rgb(59, 130, 246)';
          fillColor = 'rgba(59, 130, 246, 0.15)';
        }
      }
      
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isDragged ? 2 : isHovered ? 1.5 : 1;
      ctx.strokeRect(-width / 2, -height / 2, width, height);

      if (isHovered || isDragged) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(-width / 2, -height / 2, width, height);
      }
      
      // Draw grid cells for scanner/worker grids
      if (isGridType) {
        const rows = template.gridRows || 2;
        const cols = template.gridCols || 4;
        const cellWidth = width / cols;
        const cellHeight = height / rows;
        
        ctx.fillStyle = fillColor;
        ctx.fillRect(-width / 2, -height / 2, width, height);
        
        // Draw grid lines
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        
        // Vertical lines
        for (let c = 1; c < cols; c++) {
          const x = -width / 2 + c * cellWidth;
          ctx.beginPath();
          ctx.moveTo(x, -height / 2);
          ctx.lineTo(x, height / 2);
          ctx.stroke();
        }
        
        // Horizontal lines
        for (let r = 1; r < rows; r++) {
          const y = -height / 2 + r * cellHeight;
          ctx.beginPath();
          ctx.moveTo(-width / 2, y);
          ctx.lineTo(width / 2, y);
          ctx.stroke();
        }
        
        ctx.setLineDash([]);
        
        // Draw cell numbers
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cellNum = r * cols + c + 1;
            const cellCenterX = -width / 2 + (c + 0.5) * cellWidth;
            const cellCenterY = -height / 2 + (r + 0.5) * cellHeight;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.beginPath();
            ctx.arc(cellCenterX, cellCenterY, 8, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = 'white';
            ctx.fillText(cellNum.toString(), cellCenterX, cellCenterY);
          }
        }
      }

      ctx.fillStyle = 'white';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const labelText = template.categoryName;
      const metrics = ctx.measureText(labelText);
      const labelWidth = metrics.width + 8;
      const labelHeight = 20;
      
      // Position label at top of rectangle for grids
      const labelY = isGridType ? -height / 2 - 12 : 0;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(-labelWidth / 2, labelY - labelHeight / 2, labelWidth, labelHeight);
      
      ctx.fillStyle = 'white';
      ctx.fillText(labelText, 0, labelY);

      ctx.restore();
    });

    // DEBUG: Draw ArUco marker outer corners and centers to verify coordinate system alignment
    const debugBoundary = true; // Enable visual debugging
    if (debugBoundary) {
      ctx.save();
      
      // ArUco marker parameters
      const markerSizeCm = 5;
      const markerInsetCm = 1; // 10mm safe zone inset from sheet edge
      const a4WidthCm = 29.7;
      const a4HeightCm = 21.0;
      
      // Determine grid layout based on paper size
      const is8Page = paperSize === '8-page-4x2';
      const is6Page = paperSize === '6-page-3x2';
      const isMultiSheet = is8Page || is6Page;
      const gridCols = is8Page ? 4 : is6Page ? 3 : 1;
      const gridRows = isMultiSheet ? 2 : 1;
      
      console.log('[RectifiedPreviewCanvas] ArUco position calculation:', {
        paperSize,
        is8Page,
        is6Page,
        isMultiSheet,
        gridCols,
        gridRows,
      });
      
      // Calculate OUTER CORNER positions (used for homography crop boundary)
      let outerCornerPositions;
      let markerCenterPositions;
      
      if (isMultiSheet) {
        // OUTER CORNERS - the actual boundary points for homography
        // These are at the inset distance from sheet edges
        const tlOuterX = markerInsetCm;
        const tlOuterY = markerInsetCm;
        
        const trOuterX = (gridCols - 1) * a4WidthCm + (a4WidthCm - markerInsetCm);
        const trOuterY = markerInsetCm;
        
        const brOuterX = (gridCols - 1) * a4WidthCm + (a4WidthCm - markerInsetCm);
        const brOuterY = (gridRows - 1) * a4HeightCm + (a4HeightCm - markerInsetCm);
        
        const blOuterX = markerInsetCm;
        const blOuterY = (gridRows - 1) * a4HeightCm + (a4HeightCm - markerInsetCm);
        
        outerCornerPositions = [
          { x: tlOuterX, y: tlOuterY, id: 'c(96)' },
          { x: trOuterX, y: trOuterY, id: 'c(97)' },
          { x: brOuterX, y: brOuterY, id: 'c(98)' },
          { x: blOuterX, y: blOuterY, id: 'c(99)' },
        ];
        
        // MARKER CENTERS - for reference
        const halfMarker = markerSizeCm / 2;
        markerCenterPositions = [
          { x: markerInsetCm + halfMarker, y: markerInsetCm + halfMarker, id: 'A(96)' },
          { x: (gridCols - 1) * a4WidthCm + (a4WidthCm - markerSizeCm - markerInsetCm) + halfMarker, y: markerInsetCm + halfMarker, id: 'B(97)' },
          { x: (gridCols - 1) * a4WidthCm + (a4WidthCm - markerSizeCm - markerInsetCm) + halfMarker, y: (gridRows - 1) * a4HeightCm + (a4HeightCm - markerSizeCm - markerInsetCm) + halfMarker, id: 'C(98)' },
          { x: markerInsetCm + halfMarker, y: (gridRows - 1) * a4HeightCm + (a4HeightCm - markerSizeCm - markerInsetCm) + halfMarker, id: 'D(99)' },
        ];
      } else {
        // Single-sheet layouts
        outerCornerPositions = [
          { x: markerInsetCm, y: markerInsetCm, id: 'c(96)' },
          { x: paperWidthCm - markerInsetCm, y: markerInsetCm, id: 'c(97)' },
          { x: paperWidthCm - markerInsetCm, y: paperHeightCm - markerInsetCm, id: 'c(98)' },
          { x: markerInsetCm, y: paperHeightCm - markerInsetCm, id: 'c(99)' },
        ];
        
        const halfMarker = markerSizeCm / 2;
        markerCenterPositions = [
          { x: markerInsetCm + halfMarker, y: markerInsetCm + halfMarker, id: 'A(96)' },
          { x: paperWidthCm - markerSizeCm - markerInsetCm + halfMarker, y: markerInsetCm + halfMarker, id: 'B(97)' },
          { x: paperWidthCm - markerSizeCm - markerInsetCm + halfMarker, y: paperHeightCm - markerSizeCm - markerInsetCm + halfMarker, id: 'C(98)' },
          { x: markerInsetCm + halfMarker, y: paperHeightCm - markerSizeCm - markerInsetCm + halfMarker, id: 'D(99)' },
        ];
      }
      
      // Draw GREEN markers at OUTER CORNERS (the homography boundary points)
      // These should overlap with the detected ArUco marker outer corners
      ctx.fillStyle = 'lime';
      ctx.strokeStyle = 'lime';
      ctx.lineWidth = 2;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      outerCornerPositions.forEach(corner => {
        const px = cmToPixels(corner.x, 'x');
        const py = cmToPixels(corner.y, 'y');
        
        // Draw cross marker at outer corner
        const size = 15;
        ctx.beginPath();
        ctx.moveTo(px - size, py);
        ctx.lineTo(px + size, py);
        ctx.moveTo(px, py - size);
        ctx.lineTo(px, py + size);
        ctx.stroke();
        
        // Draw circle at corner
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw label with cm coordinates
        const labelOffsetX = corner.x < paperWidthCm / 2 ? 45 : -45;
        const labelOffsetY = corner.y < paperHeightCm / 2 ? 15 : -15;
        ctx.fillText(`(${corner.x.toFixed(1)},${corner.y.toFixed(1)})`, px + labelOffsetX, py + labelOffsetY);
      });
      
      // Draw ORANGE markers at marker CENTERS with 5cm square outline
      ctx.fillStyle = 'orange';
      ctx.strokeStyle = 'orange';
      ctx.lineWidth = 2;
      ctx.font = 'bold 11px monospace';
      
      markerCenterPositions.forEach(pos => {
        const px = cmToPixels(pos.x, 'x');
        const py = cmToPixels(pos.y, 'y');
        
        // Draw 5cm square representing the ArUco marker (2.5cm from center each way)
        const markerHalfSize = cmToPixels(2.5, 'x');
        ctx.strokeRect(px - markerHalfSize, py - markerHalfSize, markerHalfSize * 2, markerHalfSize * 2);
        
        // Draw crosshair at center
        const crossSize = 8;
        ctx.beginPath();
        ctx.moveTo(px - crossSize, py);
        ctx.lineTo(px + crossSize, py);
        ctx.moveTo(px, py - crossSize);
        ctx.lineTo(px, py + crossSize);
        ctx.stroke();
        
        // Label
        ctx.fillText(pos.id, px, py - markerHalfSize - 8);
      });
      
      // Draw intermediate markers at 10cm intervals along edges
      ctx.fillStyle = 'cyan';
      ctx.strokeStyle = 'cyan';
      ctx.lineWidth = 1;
      ctx.font = '10px monospace';
      
      // Top edge markers
      for (let x = 10; x < paperWidthCm; x += 10) {
        const px = cmToPixels(x, 'x');
        const py = cmToPixels(0, 'y');
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + 10);
        ctx.stroke();
        ctx.fillText(`${x}`, px, py + 18);
      }
      
      // Left edge markers
      for (let y = 10; y < paperHeightCm; y += 10) {
        const px = cmToPixels(0, 'x');
        const py = cmToPixels(y, 'y');
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + 10, py);
        ctx.stroke();
        ctx.fillText(`${y}`, px + 18, py);
      }
      
      // Draw paper boundary rectangle
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(0, 0, canvasSize.width, canvasSize.height);
      ctx.setLineDash([]);
      
      ctx.restore();
    }

    if (hoveredTemplate || draggedTemplate) {
      canvas.style.cursor = 'move';
    } else {
      canvas.style.cursor = 'default';
    }
  }, [adjustedTemplates, canvasSize, hoveredTemplate, draggedTemplate, paperWidthCm, paperHeightCm, paperSize]);

  const isPointInRect = (px: number, py: number, template: TemplateRect): boolean => {
    const centerX = cmToPixels(template.xCm, 'x');
    const centerY = cmToPixels(template.yCm, 'y');
    const width = cmToPixels(template.widthCm, 'x');
    const height = cmToPixels(template.heightCm, 'y');

    const dx = px - centerX;
    const dy = py - centerY;

    const angle = (-template.rotation * Math.PI) / 180;
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle);

    return (
      localX >= -width / 2 &&
      localX <= width / 2 &&
      localY >= -height / 2 &&
      localY <= height / 2
    );
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const clickedTemplate = [...adjustedTemplates].reverse().find(t => isPointInRect(x, y, t));
    if (clickedTemplate) {
      setDraggedTemplate(clickedTemplate.id);
      const centerX = cmToPixels(clickedTemplate.xCm, 'x');
      const centerY = cmToPixels(clickedTemplate.yCm, 'y');
      setDragOffset({ x: x - centerX, y: y - centerY });
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (draggedTemplate) {
      const newX = x - dragOffset.x;
      const newY = y - dragOffset.y;
      const newXCm = pixelsToCm(newX, 'x');
      const newYCm = pixelsToCm(newY, 'y');

      setAdjustedTemplates(prev =>
        prev.map(t =>
          t.id === draggedTemplate
            ? { ...t, xCm: newXCm, yCm: newYCm }
            : t
        )
      );
      setHasTemplateAdjustments(true);
    } else {
      const foundTemplate = [...adjustedTemplates].reverse().find(t => isPointInRect(x, y, t));
      setHoveredTemplate(foundTemplate?.id || null);
    }
  };

  const handleMouseUp = () => {
    if (draggedTemplate) {
      setDraggedTemplate(null);
      onTemplatesAdjusted(adjustedTemplates);
    }
  };

  const handleMouseLeave = () => {
    if (draggedTemplate) {
      setDraggedTemplate(null);
      onTemplatesAdjusted(adjustedTemplates);
    }
    setHoveredTemplate(null);
  };

  const resetPositions = () => {
    setAdjustedTemplates(templates);
    setHasTemplateAdjustments(false);
    onTemplatesAdjusted(templates);
  };

  return (
    <div className={cn("relative", className)}>
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full rounded"
        data-testid="canvas-rectified-preview"
      />
      {hasTemplateAdjustments && (
        <div className="absolute top-2 right-2 flex gap-2">
          <button
            onClick={resetPositions}
            className="px-3 py-1 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded shadow-lg transition-colors"
            data-testid="button-reset-positions"
          >
            Reset Positions
          </button>
        </div>
      )}
      <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded">
        <p className="text-xs text-muted-foreground">
          💡 <strong>Drag the purple rectangles</strong> to adjust template positions if needed. Changes will be saved when you proceed to QR validation.
        </p>
      </div>
    </div>
  );
}
