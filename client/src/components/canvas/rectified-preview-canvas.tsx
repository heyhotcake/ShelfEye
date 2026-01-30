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
  onTemplatesAdjusted: (adjustedTemplates: TemplateRect[]) => void;
  className?: string;
}

export function RectifiedPreviewCanvas({
  baseImage,
  templates,
  paperWidthCm,
  paperHeightCm,
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
        const actualPxPerCmX = img.width / paperWidthCm;
        const actualPxPerCmY = img.height / paperHeightCm;
        console.log('[RectifiedPreviewCanvas] Image loaded:', {
          imageDimensions: `${img.width}×${img.height}px`,
          paperDimensions: `${paperWidthCm}×${paperHeightCm}cm`,
          imageAspectRatio: aspectRatio.toFixed(4),
          expectedAspectRatio: expectedAspectRatio.toFixed(4),
          aspectRatioMatch: Math.abs(aspectRatio - expectedAspectRatio) < 0.01,
          calculatedPxPerCm: `${actualPxPerCmX.toFixed(1)} (X), ${actualPxPerCmY.toFixed(1)} (Y)`,
          canvasSize: `${width.toFixed(0)}×${height.toFixed(0)}px`,
        });
        
        if (Math.abs(aspectRatio - expectedAspectRatio) > 0.01) {
          console.warn('[RectifiedPreviewCanvas] ASPECT RATIO MISMATCH! Image may not match paper dimensions.');
        }
      }
    };
    img.src = baseImage;
  }, [baseImage, paperWidthCm, paperHeightCm]);

  const cmToPixels = (cm: number, axis: 'x' | 'y'): number => {
    if (axis === 'x') {
      return (cm / paperWidthCm) * canvasSize.width;
    } else {
      return (cm / paperHeightCm) * canvasSize.height;
    }
  };

  const pixelsToCm = (pixels: number, axis: 'x' | 'y'): number => {
    if (axis === 'x') {
      return (pixels / canvasSize.width) * paperWidthCm;
    } else {
      return (pixels / canvasSize.height) * paperHeightCm;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

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

    if (hoveredTemplate || draggedTemplate) {
      canvas.style.cursor = 'move';
    } else {
      canvas.style.cursor = 'default';
    }
  }, [adjustedTemplates, canvasSize, hoveredTemplate, draggedTemplate, paperWidthCm, paperHeightCm]);

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
