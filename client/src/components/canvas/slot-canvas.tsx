import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Point {
  x: number;
  y: number;
}

interface SlotRegion {
  id: string;
  slotId: string;
  points: Point[];
  toolName: string;
  expectedQrId: string;
  priority: 'high' | 'medium' | 'low';
  allowCheckout: boolean;
  graceWindow: string;
}

interface SlotCanvasProps {
  width: number;
  height: number;
  isDrawing: boolean;
  onDrawingComplete: (region: SlotRegion) => void;
  onRegionSelect: (region: SlotRegion | null) => void;
  regions: SlotRegion[];
  selectedRegion: SlotRegion | null;
  className?: string;
}

export function SlotCanvas({
  width,
  height,
  isDrawing,
  onDrawingComplete,
  onRegionSelect,
  regions,
  selectedRegion,
  className
}: SlotCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background grid pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw existing regions
    regions.forEach((region) => {
      if (region.points.length > 2) {
        ctx.beginPath();
        ctx.moveTo(region.points[0].x, region.points[0].y);
        region.points.forEach(point => ctx.lineTo(point.x, point.y));
        ctx.closePath();
        
        // Fill and stroke
        const isSelected = selectedRegion?.id === region.id;
        ctx.fillStyle = isSelected 
          ? 'rgba(59, 130, 246, 0.2)' 
          : 'rgba(34, 197, 94, 0.2)';
        ctx.fill();
        ctx.strokeStyle = isSelected 
          ? 'rgb(59, 130, 246)' 
          : 'rgb(34, 197, 94)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw label
        const centerX = region.points.reduce((sum, p) => sum + p.x, 0) / region.points.length;
        const centerY = region.points.reduce((sum, p) => sum + p.y, 0) / region.points.length;
        
        ctx.fillStyle = 'white';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(region.slotId, centerX, centerY);
      }
    });

    // Draw current drawing points
    if (currentPoints.length > 0) {
      ctx.strokeStyle = 'rgb(239, 68, 68)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
      currentPoints.forEach(point => ctx.lineTo(point.x, point.y));
      if (currentPoints.length > 2) {
        ctx.closePath();
      }
      ctx.stroke();

      // Draw points
      currentPoints.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgb(239, 68, 68)';
        ctx.fill();
      });
    }
  }, [regions, currentPoints, selectedRegion]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (isDrawing) {
      const newPoints = [...currentPoints, { x, y }];
      setCurrentPoints(newPoints);

      // If we have enough points and the user clicks near the first point, complete the region
      if (newPoints.length >= 3) {
        const firstPoint = newPoints[0];
        const distance = Math.sqrt(Math.pow(x - firstPoint.x, 2) + Math.pow(y - firstPoint.y, 2));
        
        if (distance < 20) { // Close enough to first point
          const newRegion: SlotRegion = {
            id: Date.now().toString(),
            slotId: `${String.fromCharCode(65 + regions.length)}${(regions.length % 6) + 1}`,
            points: newPoints.slice(0, -1), // Remove the last point (duplicate of first)
            toolName: '',
            expectedQrId: '',
            priority: 'medium',
            allowCheckout: true,
            graceWindow: '08:30-16:30',
          };
          
          onDrawingComplete(newRegion);
          setCurrentPoints([]);
        }
      }
    } else {
      // Check if click is inside any region
      for (const region of regions) {
        if (isPointInPolygon({ x, y }, region.points)) {
          onRegionSelect(region);
          return;
        }
      }
      
      onRegionSelect(null);
    }
  };

  const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (
        polygon[i].y > point.y !== polygon[j].y > point.y &&
        point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x
      ) {
        inside = !inside;
      }
    }
    return inside;
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={cn(
        "w-full border-2 border-border rounded bg-muted",
        isDrawing ? "cursor-crosshair" : "cursor-pointer",
        className
      )}
      onClick={handleCanvasClick}
      data-testid="slot-canvas"
    />
  );
}
