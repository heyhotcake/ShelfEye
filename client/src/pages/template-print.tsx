import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Printer, ArrowLeft, Download } from "lucide-react";
import type { TemplateRectangle, ToolCategory } from "@shared/schema";
import { jsPDF } from "jspdf";
import NotoSansJP from "@/assets/fonts/NotoSansJP-base64";

interface TemplateRectangleWithCategory extends TemplateRectangle {
  category: ToolCategory;
}

interface TemplateDesign {
  id: string; // Database UUID primary key
  name: string;
  timestamp: string; // For display only
  paperSize: string;
  cameraId?: string;
  templateRectangles: any[];
  categories: any[];
}

export default function TemplatePrint() {
  const [, setLocation] = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [savedTemplateDesigns, setSavedTemplateDesigns] = useState<TemplateDesign[]>([]);
  const [selectedDesignId, setSelectedDesignId] = useState<string>('');
  const [paperSize, setPaperSize] = useState('A4-landscape');

  // Fetch template designs from database
  const { data: templateDesignsData = [] } = useQuery<any[]>({
    queryKey: ['/api/template-designs'],
  });

  // Map database results to savedTemplateDesigns state and auto-select first design
  useEffect(() => {
    if (templateDesignsData.length > 0) {
      const mapped = templateDesignsData.map((design: any) => ({
        id: design.id,
        name: design.name,
        timestamp: design.createdAt,
        paperSize: design.paperSize,
        templateRectangles: design.templateRectangles || [], // Correct field name from API
        categories: design.categories || [],
      }));
      setSavedTemplateDesigns(mapped);
      
      // Auto-select first design if no selection OR if current selection was deleted
      setSelectedDesignId(prevId => {
        const selectedStillExists = mapped.some(d => d.id === prevId);
        if (!prevId || !selectedStillExists) {
          setPaperSize(mapped[0].paperSize);
          return mapped[0].id;
        }
        return prevId;
      });
    } else {
      // Clear state when no designs exist
      setSavedTemplateDesigns([]);
      setSelectedDesignId('');
      setPaperSize('A4-landscape'); // Reset to default when no designs
    }
  }, [templateDesignsData]);

  // Update paper size when design selection changes
  useEffect(() => {
    if (selectedDesignId) {
      const design = savedTemplateDesigns.find(d => d.id === selectedDesignId);
      if (design) {
        setPaperSize(design.paperSize);
      }
    }
  }, [selectedDesignId, savedTemplateDesigns]);

  // Canvas dimensions at 300 DPI for accurate printing (1mm = 11.811 pixels at 300 DPI)
  const paperDimensions: Record<string, { 
    width: number; 
    height: number;
    realWidthMm: number;
    realHeightMm: number;
  }> = {
    'A5-landscape': { width: 2480, height: 1748, realWidthMm: 210, realHeightMm: 148 },
    'A4-landscape': { width: 3508, height: 2480, realWidthMm: 297, realHeightMm: 210 },
    'A3-landscape': { width: 4961, height: 3508, realWidthMm: 420, realHeightMm: 297 },
    '2xA5-landscape': { width: 4961, height: 1748, realWidthMm: 420, realHeightMm: 148 },
    '3xA5-landscape': { width: 7441, height: 1748, realWidthMm: 630, realHeightMm: 148 },
    '6-page-3x2': { width: 10525, height: 4961, realWidthMm: 891, realHeightMm: 420 },
    '8-page-4x2': { width: 14032, height: 4961, realWidthMm: 1188, realHeightMm: 420 },
  };

  const canvasDimensions = paperDimensions[paperSize] || paperDimensions['A4-landscape'];

  // Load ALL template rectangles from database as fallback when no design is selected
  const { data: allTemplateRectangles = [] } = useQuery<TemplateRectangle[]>({
    queryKey: ['/api/template-rectangles'],
    queryFn: async () => {
      const response = await fetch(`/api/template-rectangles`);
      if (!response.ok) throw new Error('Failed to fetch template rectangles');
      return response.json();
    },
  });
  
  // Use database templates if no saved design is selected
  const templateRectangles = selectedDesignId && savedTemplateDesigns.length > 0
    ? (savedTemplateDesigns.find(d => d.id === selectedDesignId)?.templateRectangles || [])
    : allTemplateRectangles;

  const { data: categories = [] } = useQuery<ToolCategory[]>({
    queryKey: ['/api/tool-categories'],
  });

  // Generate ArUco markers for slot numbers (1-99)
  const { data: qrCodes = {} } = useQuery<Record<string, string>>({
    queryKey: ['/api/aruco-slot-markers', templateRectangles],
    queryFn: async () => {
      const codes: Record<string, string> = {};
      
      for (const rect of templateRectangles) {
        if (rect.autoQrId) {
          try {
            // Extract slot number from autoQrId (format: "slot-1", "slot-2", etc.)
            const slotNumber = parseInt(rect.autoQrId.replace('slot-', ''));
            
            const response = await fetch('/api/aruco-generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: 'single',
                markerId: slotNumber,
                markerLengthCm: 3.0, // 3cm ArUco markers for slots
              }),
            });
            
            if (response.ok) {
              const result = await response.json();
              codes[rect.autoQrId] = `data:image/png;base64,${result.image}`;
            }
          } catch (error) {
            console.error(`Failed to generate ArUco marker for ${rect.autoQrId}:`, error);
          }
        }
      }
      
      return codes;
    },
    enabled: templateRectangles.length > 0,
  });

  const { data: arucoMarkers } = useQuery<any>({
    queryKey: ['/api/aruco-corner-markers', paperSize],
    queryFn: async () => {
      // Corner markers: 96 (top-left), 97 (top-right), 98 (bottom-right), 99 (bottom-left)
      const markerIds = [96, 97, 98, 99];
      const markerPromises = markerIds.map(id =>
        fetch('/api/aruco-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'single',
            markerId: id,
            markerLengthCm: 5.0,
          }),
        }).then(res => res.json())
      );
      
      const results = await Promise.all(markerPromises);
      
      return {
        ok: true,
        markers: results.map((result, index) => ({
          id: markerIds[index],
          image: result.image,
          sizeCm: 5.0,
        }))
      };
    },
  });

  const templatesWithCategories: TemplateRectangleWithCategory[] = templateRectangles
    .map(rect => {
      const category = categories.find(c => c.id === rect.categoryId);
      if (!category) return null;
      return {
        ...rect,
        category,
      };
    })
    .filter((t): t is TemplateRectangleWithCategory => t !== null);

  const cmToPixels = (cm: number, isWidth: boolean = true) => {
    const realSize = isWidth ? canvasDimensions.realWidthMm : canvasDimensions.realHeightMm;
    const canvasSize = isWidth ? canvasDimensions.width : canvasDimensions.height;
    return (cm * 10 / realSize) * canvasSize;
  };
  
  // Circled numbers for tool numbering (1-50)
  const CIRCLED_NUMBERS = [
    '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
    '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳',
    '㉑', '㉒', '㉓', '㉔', '㉕', '㉖', '㉗', '㉘', '㉙', '㉚',
    '㉛', '㉜', '㉝', '㉞', '㉟', '㊱', '㊲', '㊳', '㊴', '㊵',
    '㊶', '㊷', '㊸', '㊹', '㊺', '㊻', '㊼', '㊽', '㊾', '㊿'
  ];
  
  // Build a map of rect.id -> numbered label (e.g., "OPPテープ①")
  // Group by category label, sort by global Y (with tolerance) then X, assign numbers
  const buildNumberedLabelMap = (): Map<string, string> => {
    const labelMap = new Map<string, string>();
    
    // Group rectangles by category label (excluding scanner_grid and worker_tag_grid)
    const toolRects = templatesWithCategories.filter(
      r => r.category.categoryType !== 'scanner_grid' && r.category.categoryType !== 'worker_tag_grid'
    );
    
    // Define category groups that share numbering (e.g., both calculator types share same sequence)
    const getCategoryGroup = (label: string): string => {
      // Treat 電卓 and 電卓（小）as same group for numbering
      if (label === '電卓' || label === '電卓（小）') {
        return '電卓_group';
      }
      return label;
    };
    
    // Group by category group (not individual label)
    const byCategory = new Map<string, typeof toolRects>();
    for (const rect of toolRects) {
      const label = rect.category.label || '';
      const group = getCategoryGroup(label);
      if (!byCategory.has(group)) {
        byCategory.set(group, []);
      }
      byCategory.get(group)!.push(rect);
    }
    
    // For each category, sort by global position and assign numbers
    // Global position uses xCm and yCm directly (already in global coordinates)
    // Sort by Y first (with 5mm = 0.5cm tolerance for "same row"), then X
    const ROW_TOLERANCE_CM = 0.5;
    
    Array.from(byCategory.entries()).forEach(([categoryLabel, rects]) => {
      // Compute visual bounding box edges for each rect (accounting for rotation)
      const rectsWithEdges = rects.map(rect => {
        const rotation = rect.rotation || 0;
        const angleRad = (rotation * Math.PI) / 180;
        const w = rect.category.widthCm || 0;
        const h = rect.category.heightCm || 0;
        
        // For rotated rectangles, compute the actual leftmost and topmost points
        const halfW = w / 2;
        const halfH = h / 2;
        const corners = [
          { x: -halfW, y: -halfH },
          { x: halfW, y: -halfH },
          { x: halfW, y: halfH },
          { x: -halfW, y: halfH },
        ];
        const rotatedCorners = corners.map(c => ({
          x: rect.xCm + c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad),
          y: rect.yCm + c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad),
        }));
        
        const left = Math.min(...rotatedCorners.map(c => c.x));
        const top = Math.min(...rotatedCorners.map(c => c.y));
        
        return { ...rect, visualLeft: left, visualTop: top };
      });
      
      // Sort: group by row (Y with tolerance), then by X within row
      const sorted = rectsWithEdges.sort((a, b) => {
        // If Y values are within tolerance, consider them same row
        if (Math.abs(a.visualTop - b.visualTop) <= ROW_TOLERANCE_CM) {
          return a.visualLeft - b.visualLeft; // Same row: sort by X (left to right)
        }
        return a.visualTop - b.visualTop; // Different rows: sort by Y (top to bottom)
      });
      
      // Assign numbered labels (use each rect's actual label, not the group name)
      sorted.forEach((rect, index) => {
        const number = CIRCLED_NUMBERS[index] || `(${index + 1})`;
        const actualLabel = rect.category.label || '';
        labelMap.set(rect.id, `${actualLabel}${number}`);
      });
    });
    
    return labelMap;
  };
  
  const numberedLabelMap = buildNumberedLabelMap();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderCanvas = async () => {
      const qrImageCache: { [key: string]: HTMLImageElement } = {};
      const arucoImageCache: { [key: number]: HTMLImageElement } = {};

      const loadImage = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      };

      // Load QR codes
      for (const rect of templatesWithCategories) {
        if (rect.autoQrId && qrCodes[rect.autoQrId]) {
          try {
            qrImageCache[rect.autoQrId] = await loadImage(qrCodes[rect.autoQrId]);
          } catch (error) {
            console.error(`Failed to load QR code for ${rect.autoQrId}:`, error);
          }
        }
      }

      // Load ArUco corner markers
      if (arucoMarkers?.ok && arucoMarkers.markers) {
        for (const marker of arucoMarkers.markers) {
          try {
            arucoImageCache[marker.id] = await loadImage(`data:image/png;base64,${marker.image}`);
          } catch (error) {
            console.error(`Failed to load ArUco marker ${marker.id}:`, error);
          }
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render 4 corner ArUco markers at the exact corners (5cm size)
      if (arucoMarkers?.ok && arucoMarkers.markers) {
        const markerSizeCm = 5;
        const paperWidthCm = canvasDimensions.realWidthMm / 10;
        const paperHeightCm = canvasDimensions.realHeightMm / 10;
        
        const cornerPositions = [
          { id: 96, xCm: 0, yCm: 0 }, // Top-left (A)
          { id: 97, xCm: paperWidthCm - markerSizeCm, yCm: 0 }, // Top-right (B)
          { id: 98, xCm: paperWidthCm - markerSizeCm, yCm: paperHeightCm - markerSizeCm }, // Bottom-right (C)
          { id: 99, xCm: 0, yCm: paperHeightCm - markerSizeCm }, // Bottom-left (D)
        ];

        cornerPositions.forEach((pos) => {
          const marker = arucoMarkers.markers.find((m: any) => m.id === pos.id);
          if (marker && arucoImageCache[marker.id]) {
            const xPx = cmToPixels(pos.xCm, true);
            const yPx = cmToPixels(pos.yCm, false);
            const sizePx = cmToPixels(markerSizeCm, true);
            
            ctx.drawImage(arucoImageCache[marker.id], xPx, yPx, sizePx, sizePx);
          }
        });
      }

      // Render template rectangles
      templatesWithCategories.forEach((rect) => {
        const widthPx = cmToPixels(rect.category.widthCm, true);
        const heightPx = cmToPixels(rect.category.heightCm, false);
        const xPx = cmToPixels(rect.xCm, true);
        const yPx = cmToPixels(rect.yCm, false);

        const centerX = xPx;
        const centerY = yPx;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate((rect.rotation * Math.PI) / 180);

        const isScannerGrid = rect.category.categoryType === 'scanner_grid';
        const isWorkerTagGrid = rect.category.categoryType === 'worker_tag_grid';
        
        if (isWorkerTagGrid) {
          // Worker tag grid: header + solid cell borders + alignment lines
          // Cell = 4cm × 6.75cm usable area + 1cm border on each side = 6cm × 8.75cm
          const gridRows = rect.category.gridRows || 2;
          const gridCols = rect.category.gridCols || 4;
          const cellWidthCm = 5; // 4cm usable + 0.5cm borders each side
          const cellHeightCm = 7.75; // 6.75cm usable + 0.5cm borders each side
          const headerHeightCm = 2; // 2cm header, no margins
          
          const cellWidthPx = cmToPixels(cellWidthCm, true);
          const cellHeightPx = cmToPixels(cellHeightCm, false);
          const headerHeightPx = cmToPixels(headerHeightCm, false);
          const gridWidthPx = cellWidthPx * gridCols;
          const gridHeightPx = cellHeightPx * gridRows;
          const totalHeightPx = headerHeightPx + gridHeightPx;
          
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2;
          
          // Draw header rectangle
          ctx.strokeRect(-gridWidthPx / 2, -totalHeightPx / 2, gridWidthPx, headerHeightPx);
          
          // Draw header text: "[label] タグ枠"
          const baseLabel = rect.category.label?.replace(' (作業者タグ)', '').replace(' (Worker Tags)', '') || '';
          const headerText = `${baseLabel} タグ枠`;
          let headerFontPx = 48;
          ctx.font = `bold ${headerFontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          let textWidth = ctx.measureText(headerText).width;
          while (textWidth > gridWidthPx - 20 && headerFontPx > 18) {
            headerFontPx -= 2;
            ctx.font = `bold ${headerFontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
            textWidth = ctx.measureText(headerText).width;
          }
          
          ctx.fillStyle = '#000000';
          ctx.fillText(headerText, 0, -totalHeightPx / 2 + headerHeightPx / 2);
          
          // Draw grid cells with alignment lines
          const gridTopY = -totalHeightPx / 2 + headerHeightPx;
          
          for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
              const cellX = -gridWidthPx / 2 + col * cellWidthPx;
              const cellY = gridTopY + row * cellHeightPx;
              
              // Draw cell border
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 2;
              ctx.strokeRect(cellX, cellY, cellWidthPx, cellHeightPx);
              
              // Draw alignment guides inside each cell (4cm wide, 0.5cm from top and bottom edges)
              const cellCenterX = cellX + cellWidthPx / 2;
              const borderPx = cmToPixels(0.5, false); // 0.5cm border
              const guideWidthPx = cmToPixels(4, true);
              
              ctx.strokeStyle = '#CCCCCC';
              ctx.lineWidth = 1;
              
              // Top guide line (1cm from top of cell)
              ctx.beginPath();
              ctx.moveTo(cellCenterX - guideWidthPx / 2, cellY + borderPx);
              ctx.lineTo(cellCenterX + guideWidthPx / 2, cellY + borderPx);
              ctx.stroke();
              
              // Bottom guide line (1cm from bottom of cell)
              ctx.beginPath();
              ctx.moveTo(cellCenterX - guideWidthPx / 2, cellY + cellHeightPx - borderPx);
              ctx.lineTo(cellCenterX + guideWidthPx / 2, cellY + cellHeightPx - borderPx);
              ctx.stroke();
              
              // Draw slot number (1-indexed, top-left to bottom-right)
              const slotNumber = row * gridCols + col + 1;
              ctx.fillStyle = '#000000';
              ctx.font = `bold ${headerFontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(slotNumber.toString(), cellCenterX, cellY + cellHeightPx / 2);
            }
          }
        } else if (isScannerGrid) {
          // Scanner grid: corner markers only + centered label
          const cornerLength = cmToPixels(1.5, true);
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 3;
          
          const halfW = widthPx / 2;
          const halfH = heightPx / 2;
          
          // Top-left corner
          ctx.beginPath();
          ctx.moveTo(-halfW + cornerLength, -halfH);
          ctx.lineTo(-halfW, -halfH);
          ctx.lineTo(-halfW, -halfH + cornerLength);
          ctx.stroke();
          
          // Top-right corner
          ctx.beginPath();
          ctx.moveTo(halfW - cornerLength, -halfH);
          ctx.lineTo(halfW, -halfH);
          ctx.lineTo(halfW, -halfH + cornerLength);
          ctx.stroke();
          
          // Bottom-right corner
          ctx.beginPath();
          ctx.moveTo(halfW - cornerLength, halfH);
          ctx.lineTo(halfW, halfH);
          ctx.lineTo(halfW, halfH - cornerLength);
          ctx.stroke();
          
          // Bottom-left corner
          ctx.beginPath();
          ctx.moveTo(-halfW + cornerLength, halfH);
          ctx.lineTo(-halfW, halfH);
          ctx.lineTo(-halfW, halfH - cornerLength);
          ctx.stroke();
          
          // Draw label in center
          if (rect.category.label) {
            const padding = cmToPixels(0.3, true);
            const maxFontPx = 96;
            const minFontPx = 18;
            let fontPx = Math.min(maxFontPx, Math.max(minFontPx, widthPx * 0.25));
            
            ctx.font = `bold ${fontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const maxTextWidth = widthPx - 2 * padding;
            let textWidth = ctx.measureText(rect.category.label).width;
            while (textWidth > maxTextWidth && fontPx > minFontPx) {
              fontPx -= 2;
              ctx.font = `bold ${fontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
              textWidth = ctx.measureText(rect.category.label).width;
            }
            
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.strokeText(rect.category.label, 0, 0);
            
            ctx.fillStyle = '#000000';
            ctx.fillText(rect.category.label, 0, 0);
          }
        } else {
          // Standard tool slot rendering
          
          // Fill entire slot with category color, leaving 2cm safezone around QR code
          const fillColor = rect.category.labelColor || "#FFFFFF";
          const qrSizeCm = 3;
          const safezoneMarginCm = 2; // 2cm safezone around QR code
          const clearAreaSizeCm = qrSizeCm + safezoneMarginCm * 2; // 7cm total clear area
          const clearAreaSizePx = cmToPixels(clearAreaSizeCm, true);
          
          if (fillColor && fillColor !== "#FFFFFF") {
            // Fill entire slot with color
            ctx.fillStyle = fillColor;
            ctx.fillRect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);
            
            // Draw white rectangle in center for QR code safezone
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(-clearAreaSizePx / 2, -clearAreaSizePx / 2, clearAreaSizePx, clearAreaSizePx);
          }
          
          // Draw black outline on top
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2;
          ctx.strokeRect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);

          // Draw QR code centered within the rectangle (3x3 cm)
          const qrSizePx = cmToPixels(qrSizeCm, true);
          if (rect.autoQrId && qrImageCache[rect.autoQrId]) {
            ctx.drawImage(qrImageCache[rect.autoQrId], -qrSizePx / 2, -qrSizePx / 2, qrSizePx, qrSizePx);
          }

          // Draw alignment guides (light grey horizontal lines for worker card placement)
          const guideWidthCm = 4;
          const guideSpacingCm = 6.75;
          const guideWidthPx = cmToPixels(guideWidthCm, true);
          const guideSpacingPx = cmToPixels(guideSpacingCm, false);
          
          ctx.strokeStyle = '#CCCCCC';
          ctx.lineWidth = 1;
          
          ctx.beginPath();
          ctx.moveTo(-guideWidthPx / 2, -guideSpacingPx / 2);
          ctx.lineTo(guideWidthPx / 2, -guideSpacingPx / 2);
          ctx.stroke();
          
          ctx.beginPath();
          ctx.moveTo(-guideWidthPx / 2, guideSpacingPx / 2);
          ctx.lineTo(guideWidthPx / 2, guideSpacingPx / 2);
          ctx.stroke();

          // Draw label above QR code (use numbered label for consistency with PDF)
          const displayLabel = numberedLabelMap.get(rect.id) || rect.category.label;
          if (displayLabel) {
            const padding = cmToPixels(0.3, true);
            const maxFontPx = 96;
            const minFontPx = 18;
            const minTextWidthPx = cmToPixels(4, true);
            let fontPx = Math.min(maxFontPx, Math.max(minFontPx, widthPx * 0.35));
            
            ctx.font = `bold ${fontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            let textWidth = ctx.measureText(displayLabel).width;
            while (textWidth < minTextWidthPx && fontPx < maxFontPx) {
              fontPx += 2;
              ctx.font = `bold ${fontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
              textWidth = ctx.measureText(displayLabel).width;
            }
            
            const maxTextWidth = widthPx - 2 * padding;
            while (textWidth > maxTextWidth && fontPx > minFontPx) {
              fontPx -= 2;
              ctx.font = `bold ${fontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
              textWidth = ctx.measureText(displayLabel).width;
            }
            
            const slotTop = -heightPx / 2;
            const qrTop = -qrSizePx / 2;
            const labelY = (slotTop + qrTop) / 2;
            
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.strokeText(displayLabel, 0, labelY);
            
            ctx.fillStyle = '#000000';
            ctx.fillText(displayLabel, 0, labelY);
          }
        }

        ctx.restore();
      });
    };

    renderCanvas();
  }, [templatesWithCategories, qrCodes, arucoMarkers, canvasDimensions, paperSize, numberedLabelMap]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!arucoMarkers || !qrCodes) return;

    // Helper to convert cm to mm
    const cmToMm = (cm: number) => cm * 10;
    
    // Helper to setup Japanese font in PDF  
    const setupJapaneseFont = (pdf: jsPDF) => {
      // Use variable font for all weights (it contains normal and bold)
      pdf.addFileToVFS("NotoSansJP.ttf", NotoSansJP);
      pdf.addFont("NotoSansJP.ttf", "NotoSansJP", "normal");
      pdf.addFont("NotoSansJP.ttf", "NotoSansJP", "bold");
    };
    
    // numberedLabelMap is already computed at component level

    const isMultiPage = paperSize === '6-page-3x2' || paperSize === '8-page-4x2';
    const is6Page = paperSize === '6-page-3x2';
    const is8Page = paperSize === '8-page-4x2';

    if (isMultiPage) {
      // Multi-page format: Create PDF with multiple A4 landscape pages
      const a4WidthMm = 297;  // A4 landscape
      const a4HeightMm = 210;
      const gutterMm = 0;  // No gutters - sheets touch edge-to-edge
      const markerSizeMm = 50;
      const safeMarginMm = 10; // 1cm safe zone from sheet edge
      // Markers should be at the INNER corners of the safe zone
      const markerInsetMm = safeMarginMm; // Start at safe zone boundary

      const gridCols = is8Page ? 4 : 3;
      const gridRows = 2;
      const totalSheets = gridCols * gridRows;

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });
      
      setupJapaneseFont(pdf);

      // Helper to determine which sheet a rectangle belongs to
      const getSheetForRect = (xMm: number, yMm: number): number => {
        const col = Math.floor(xMm / (a4WidthMm + gutterMm));
        const row = Math.floor(yMm / (a4HeightMm + gutterMm));
        return row * gridCols + col + 1; // Sheet number 1-N
      };

      // Process each sheet
      for (let sheetNum = 1; sheetNum <= totalSheets; sheetNum++) {
        if (sheetNum > 1) pdf.addPage();

        const row = Math.floor((sheetNum - 1) / gridCols);
        const col = (sheetNum - 1) % gridCols;
        const sheetOffsetX = col * (a4WidthMm + gutterMm);
        const sheetOffsetY = row * (a4HeightMm + gutterMm);

        // Draw safe zone (grey margin 1cm inset)
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.3);
        pdf.rect(safeMarginMm, safeMarginMm, a4WidthMm - 2 * safeMarginMm, a4HeightMm - 2 * safeMarginMm);

        // Draw sheet number
        pdf.setFontSize(10);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Sheet ${sheetNum}`, a4WidthMm / 2, 5, { align: 'center' });

        // Add ArUco markers for corner sheets
        // For 6-page (3x2): corners are sheets 1, 3, 4, 6
        // For 8-page (4x2): corners are sheets 1, 4, 5, 8
        const topLeft = 1;
        const topRight = gridCols;
        const bottomLeft = gridCols + 1;
        const bottomRight = gridCols * 2;
        
        if ([topLeft, topRight, bottomLeft, bottomRight].includes(sheetNum)) {
          const cornerMarkers = {
            [topLeft]: 0,      // Top-left
            [topRight]: 1,     // Top-right
            [bottomLeft]: 3,   // Bottom-left
            [bottomRight]: 2,  // Bottom-right
          };
          const markerIndex = cornerMarkers[sheetNum] as number;
          const marker = arucoMarkers.markers[markerIndex];
          
          let markerX = 0;
          let markerY = 0;

          if (sheetNum === topLeft) { // Top-left
            markerX = markerInsetMm;
            markerY = markerInsetMm;
          } else if (sheetNum === topRight) { // Top-right
            markerX = a4WidthMm - markerSizeMm - markerInsetMm;
            markerY = markerInsetMm;
          } else if (sheetNum === bottomLeft) { // Bottom-left
            markerX = markerInsetMm;
            markerY = a4HeightMm - markerSizeMm - markerInsetMm;
          } else if (sheetNum === bottomRight) { // Bottom-right
            markerX = a4WidthMm - markerSizeMm - markerInsetMm;
            markerY = a4HeightMm - markerSizeMm - markerInsetMm;
          }

          if (marker && marker.image) {
            pdf.addImage(marker.image, 'PNG', markerX, markerY, markerSizeMm, markerSizeMm);
          }
        }

        // Draw template rectangles that belong to this sheet
        templatesWithCategories.forEach((rect, rectIndex) => {
          const xMm = cmToMm(rect.xCm);
          const yMm = cmToMm(rect.yCm);
          const widthMm = cmToMm(rect.category.widthCm);
          const heightMm = cmToMm(rect.category.heightCm);
          
          const sheetLeftMm = sheetOffsetX;
          const sheetRightMm = sheetOffsetX + a4WidthMm;
          const sheetTopMm = sheetOffsetY;
          const sheetBottomMm = sheetOffsetY + a4HeightMm;
          
          const isScannerGrid = rect.category.categoryType === 'scanner_grid';
          const isWorkerTagGrid = rect.category.categoryType === 'worker_tag_grid';
          
          // For scanner grids: check if ANY corner falls on this sheet (they can span pages)
          // For other slots: check if center is on this sheet
          const halfW = widthMm / 2;
          const halfH = heightMm / 2;
          
          const cornerPositions = [
            { x: xMm - halfW, y: yMm - halfH, name: 'topLeft' },
            { x: xMm + halfW, y: yMm - halfH, name: 'topRight' },
            { x: xMm + halfW, y: yMm + halfH, name: 'bottomRight' },
            { x: xMm - halfW, y: yMm + halfH, name: 'bottomLeft' },
          ];
          
          const isPointInSheet = (px: number, py: number) => 
            px >= sheetLeftMm && px < sheetRightMm && py >= sheetTopMm && py < sheetBottomMm;
          
          const cornersInSheet = cornerPositions.filter(c => isPointInSheet(c.x, c.y));
          const centerInSheet = isPointInSheet(xMm, yMm);
          
          // Scanner grids: render if ANY corner is on this sheet
          // Other slots: render only if center is on this sheet
          if (isScannerGrid) {
            if (cornersInSheet.length === 0) return; // No corners on this sheet
          } else {
            if (!centerInSheet) return; // Skip if center not in this sheet
          }

          // CLAMP rectangle center to stay within sheet's safe zone
          // Safe zone is 10mm from all edges of the sheet
          const halfWidthMm = widthMm / 2;
          const halfHeightMm = heightMm / 2;
          
          // Calculate rotation-aware bounding box dimensions
          // When rotated, the axis-aligned bounding box is larger
          const angleRad = (rect.rotation * Math.PI) / 180;
          const cosA = Math.abs(Math.cos(angleRad));
          const sinA = Math.abs(Math.sin(angleRad));
          const rotatedHalfWidth = halfWidthMm * cosA + halfHeightMm * sinA;
          const rotatedHalfHeight = halfWidthMm * sinA + halfHeightMm * cosA;
          
          // Calculate safe zone bounds for this sheet (in global coordinates)
          // Use rotation-aware bounding box for proper clamping
          const sheetSafeLeft = sheetOffsetX + safeMarginMm + rotatedHalfWidth;
          const sheetSafeRight = sheetOffsetX + a4WidthMm - safeMarginMm - rotatedHalfWidth;
          const sheetSafeTop = sheetOffsetY + safeMarginMm + rotatedHalfHeight;
          const sheetSafeBottom = sheetOffsetY + a4HeightMm - safeMarginMm - rotatedHalfHeight;
          
          // Clamp center position to safe zone
          const clampedXMm = Math.max(sheetSafeLeft, Math.min(sheetSafeRight, xMm));
          const clampedYMm = Math.max(sheetSafeTop, Math.min(sheetSafeBottom, yMm));

          // Adjust coordinates relative to sheet (using clamped positions)
          const localX = clampedXMm - sheetOffsetX;
          const localY = clampedYMm - sheetOffsetY;

          pdf.saveGraphicsState();
          pdf.setDrawColor(0, 0, 0);
          pdf.setLineWidth(0.5);
          
          if (isWorkerTagGrid) {
            // Worker tag grid: header + solid cell borders + alignment lines
            // Cell = 4cm × 6.75cm usable area + 1cm border on each side = 6cm × 8.75cm
            const gridRows = rect.category.gridRows || 2;
            const gridCols = rect.category.gridCols || 4;
            const cellWidthMm = 50; // 4cm usable + 0.5cm borders each side
            const cellHeightMm = 77.5; // 6.75cm usable + 0.5cm borders each side
            const headerHeightMm = 20; // 2cm header, no margins
            
            const gridWidthMm = cellWidthMm * gridCols;
            const gridHeightMm = cellHeightMm * gridRows;
            const totalHeightMm = headerHeightMm + gridHeightMm;
            
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.5);
            
            // Draw header rectangle
            pdf.rect(localX - gridWidthMm / 2, localY - totalHeightMm / 2, gridWidthMm, headerHeightMm);
            
            // Draw header text: "[label] タグ枠"
            const baseLabel = rect.category.label?.replace(' (作業者タグ)', '').replace(' (Worker Tags)', '') || '';
            const headerText = `${baseLabel} タグ枠`;
            let headerFontPt = 40; // ~2cm height (20mm * 2pt/mm = 40pt)
            pdf.setFont('NotoSansJP', 'bold');
            pdf.setTextColor(0, 0, 0);
            pdf.setFontSize(headerFontPt);
            
            let textWidth = pdf.getTextWidth(headerText);
            while (textWidth > gridWidthMm - 10 && headerFontPt > 12) {
              headerFontPt -= 2;
              pdf.setFontSize(headerFontPt);
              textWidth = pdf.getTextWidth(headerText);
            }
            
            pdf.text(headerText, localX, localY - totalHeightMm / 2 + headerHeightMm / 2, { align: 'center', baseline: 'middle' });
            
            // Draw grid cells with alignment lines
            const gridTopY = localY - totalHeightMm / 2 + headerHeightMm;
            
            for (let row = 0; row < gridRows; row++) {
              for (let col = 0; col < gridCols; col++) {
                const cellX = localX - gridWidthMm / 2 + col * cellWidthMm;
                const cellY = gridTopY + row * cellHeightMm;
                
                // Draw cell border
                pdf.setDrawColor(0, 0, 0);
                pdf.setLineWidth(0.5);
                pdf.rect(cellX, cellY, cellWidthMm, cellHeightMm);
                
                // Draw alignment guides inside each cell (4cm wide, 0.5cm from top and bottom edges)
                const cellCenterX = cellX + cellWidthMm / 2;
                const borderMm = 5; // 0.5cm border
                const guideWidthMm = 40; // 4cm
                
                pdf.setDrawColor(204, 204, 204); // Light grey
                pdf.setLineWidth(0.3);
                
                // Top guide line (1cm from top of cell)
                pdf.line(cellCenterX - guideWidthMm / 2, cellY + borderMm, 
                         cellCenterX + guideWidthMm / 2, cellY + borderMm);
                
                // Bottom guide line (1cm from bottom of cell)
                pdf.line(cellCenterX - guideWidthMm / 2, cellY + cellHeightMm - borderMm, 
                         cellCenterX + guideWidthMm / 2, cellY + cellHeightMm - borderMm);
                
                // Draw slot number (1-indexed, top-left to bottom-right)
                const slotNumber = row * gridCols + col + 1;
                pdf.setFont('NotoSansJP', 'bold');
                pdf.setFontSize(headerFontPt);
                pdf.setTextColor(0, 0, 0);
                pdf.text(slotNumber.toString(), cellCenterX, cellY + cellHeightMm / 2, { align: 'center', baseline: 'middle' });
              }
            }
            pdf.setDrawColor(0, 0, 0); // Reset to black
          } else if (isScannerGrid) {
            // Scanner grid: corner markers only + centered label
            // Only draw corners that fall on this sheet
            const cornerLengthMm = 15; // 1.5cm corner length
            pdf.setLineWidth(1);
            
            // For each corner, check if it's on this sheet and draw it
            cornersInSheet.forEach(corner => {
              // Convert global corner position to local sheet coordinates
              const cornerLocalX = corner.x - sheetOffsetX;
              const cornerLocalY = corner.y - sheetOffsetY;
              
              if (corner.name === 'topLeft') {
                pdf.line(cornerLocalX, cornerLocalY, cornerLocalX + cornerLengthMm, cornerLocalY);
                pdf.line(cornerLocalX, cornerLocalY, cornerLocalX, cornerLocalY + cornerLengthMm);
              } else if (corner.name === 'topRight') {
                pdf.line(cornerLocalX - cornerLengthMm, cornerLocalY, cornerLocalX, cornerLocalY);
                pdf.line(cornerLocalX, cornerLocalY, cornerLocalX, cornerLocalY + cornerLengthMm);
              } else if (corner.name === 'bottomRight') {
                pdf.line(cornerLocalX - cornerLengthMm, cornerLocalY, cornerLocalX, cornerLocalY);
                pdf.line(cornerLocalX, cornerLocalY - cornerLengthMm, cornerLocalX, cornerLocalY);
              } else if (corner.name === 'bottomLeft') {
                pdf.line(cornerLocalX, cornerLocalY, cornerLocalX + cornerLengthMm, cornerLocalY);
                pdf.line(cornerLocalX, cornerLocalY - cornerLengthMm, cornerLocalX, cornerLocalY);
              }
            });
            
            // Draw label in center only if center is on this sheet
            if (centerInSheet && rect.category.label) {
              const paddingMm = 3;
              const maxFontPt = 28;
              const minFontPt = 10;
              let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 0.8));
              
              pdf.setFont('NotoSansJP', 'bold');
              pdf.setTextColor(0, 0, 0);
              pdf.setFontSize(fontPt);
              
              const maxTextWidth = widthMm - 2 * paddingMm;
              let textWidth = pdf.getTextWidth(rect.category.label);
              while (textWidth > maxTextWidth && fontPt > minFontPt) {
                fontPt -= 1;
                pdf.setFontSize(fontPt);
                textWidth = pdf.getTextWidth(rect.category.label);
              }
              
              pdf.text(rect.category.label, localX, localY, { align: 'center', baseline: 'middle' });
            }
          } else if (rect.rotation !== 0) {
            // angleRad already calculated above for rotation-aware bounding box
            const halfW = widthMm / 2;
            const halfH = heightMm / 2;
            const corners = [
              { x: -halfW, y: -halfH },
              { x: halfW, y: -halfH },
              { x: halfW, y: halfH },
              { x: -halfW, y: halfH },
            ];

            const rotatedCorners = corners.map(c => ({
              x: localX + c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad),
              y: localY + c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad),
            }));

            // Fill entire slot with category color, leaving 2cm safezone around QR code
            const fillColor = rect.category.labelColor || "#FFFFFF";
            const qrSizeMm = 30;
            const safezoneMarginMm = 20; // 2cm safezone around QR code
            const clearAreaSizeMm = qrSizeMm + safezoneMarginMm * 2; // 70mm total clear area
            
            if (fillColor && fillColor !== "#FFFFFF") {
              const r = parseInt(fillColor.slice(1, 3), 16);
              const g = parseInt(fillColor.slice(3, 5), 16);
              const b = parseInt(fillColor.slice(5, 7), 16);
              
              // Fill entire slot with color (rotated polygon)
              pdf.setFillColor(r, g, b);
              pdf.lines(
                rotatedCorners.map((c, i) => [
                  rotatedCorners[(i + 1) % 4].x - c.x,
                  rotatedCorners[(i + 1) % 4].y - c.y,
                ]),
                rotatedCorners[0].x,
                rotatedCorners[0].y,
                [1, 1],
                'F'
              );
              
              // Draw white rectangle in center for QR code safezone (rotated)
              const clearHalf = clearAreaSizeMm / 2;
              const clearCorners = [
                { x: -clearHalf, y: -clearHalf },
                { x: clearHalf, y: -clearHalf },
                { x: clearHalf, y: clearHalf },
                { x: -clearHalf, y: clearHalf },
              ];
              const rotatedClearCorners = clearCorners.map(c => ({
                x: localX + c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad),
                y: localY + c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad),
              }));
              
              pdf.setFillColor(255, 255, 255);
              pdf.lines(
                rotatedClearCorners.map((c, i) => [
                  rotatedClearCorners[(i + 1) % 4].x - c.x,
                  rotatedClearCorners[(i + 1) % 4].y - c.y,
                ]),
                rotatedClearCorners[0].x,
                rotatedClearCorners[0].y,
                [1, 1],
                'F'
              );
            }

            // Draw black outline on top (at original slot boundary)
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.5);
            pdf.lines(
              rotatedCorners.map((c, i) => [
                rotatedCorners[(i + 1) % 4].x - c.x,
                rotatedCorners[(i + 1) % 4].y - c.y,
              ]),
              rotatedCorners[0].x,
              rotatedCorners[0].y,
              [1, 1],
              'S'
            );
            if (rect.autoQrId && qrCodes[rect.autoQrId]) {
              pdf.addImage(qrCodes[rect.autoQrId], 'PNG', localX - qrSizeMm / 2, localY - qrSizeMm / 2, qrSizeMm, qrSizeMm);
            }
            
            // Helper function to rotate a point around center
            const rotatePoint = (px: number, py: number, cx: number, cy: number, angle: number) => {
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              return {
                x: cx + (px - cx) * cos - (py - cy) * sin,
                y: cy + (px - cx) * sin + (py - cy) * cos
              };
            };
            
            // Draw alignment guides (rotated with shape)
            const guideWidthMm = 40; // 4cm
            const guideSpacingMm = 67.5; // 6.75cm
            pdf.setDrawColor(204, 204, 204); // Light grey
            pdf.setLineWidth(0.3);
            
            // Top guide line (rotated)
            const topGuideLeft = rotatePoint(localX - guideWidthMm / 2, localY - guideSpacingMm / 2, localX, localY, angleRad);
            const topGuideRight = rotatePoint(localX + guideWidthMm / 2, localY - guideSpacingMm / 2, localX, localY, angleRad);
            pdf.line(topGuideLeft.x, topGuideLeft.y, topGuideRight.x, topGuideRight.y);
            
            // Bottom guide line (rotated)
            const bottomGuideLeft = rotatePoint(localX - guideWidthMm / 2, localY + guideSpacingMm / 2, localX, localY, angleRad);
            const bottomGuideRight = rotatePoint(localX + guideWidthMm / 2, localY + guideSpacingMm / 2, localX, localY, angleRad);
            pdf.line(bottomGuideLeft.x, bottomGuideLeft.y, bottomGuideRight.x, bottomGuideRight.y);
            pdf.setDrawColor(0, 0, 0); // Reset to black
            
            // Add label above QR code (rotated)
            // Use coordinate transform to avoid jsPDF's align/baseline drift with rotation
            const displayLabel = numberedLabelMap.get(rect.id) || rect.category.label;
            if (displayLabel) {
              const paddingMm = 3;
              const maxFontPt = 28;
              const minFontPt = 10;
              const minTextWidthMm = 40; // Minimum 4cm text width
              let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 1.2));
              
              pdf.setFont('NotoSansJP', 'bold');
              pdf.setTextColor(0, 0, 0); // Black text
              pdf.setFontSize(fontPt);
              
              // Increase font size if text is narrower than 3cm
              let textWidth = pdf.getTextWidth(displayLabel);
              while (textWidth < minTextWidthMm && fontPt < maxFontPt) {
                fontPt += 1;
                pdf.setFontSize(fontPt);
                textWidth = pdf.getTextWidth(displayLabel);
              }
              
              // Reduce font size if text is too wide for the slot
              const maxTextWidth = widthMm - 2 * paddingMm;
              while (textWidth > maxTextWidth && fontPt > minFontPt) {
                fontPt -= 1;
                pdf.setFontSize(fontPt);
                textWidth = pdf.getTextWidth(displayLabel);
              }
              
              // Position label between slot top and top guide line (above the guide line)
              // But ensure it stays within slot bounds
              const slotTopOffset = heightMm / 2;
              const guideLineOffset = guideSpacingMm / 2;
              // Clamp label to stay inside slot: at most (slotTopOffset - padding) from center
              const maxLabelOffset = slotTopOffset - 5; // 5mm padding from edge
              const idealLabelOffset = (slotTopOffset + guideLineOffset) / 2;
              const labelOffset = Math.min(idealLabelOffset, maxLabelOffset);
              
              // For rotated text, we need to manually position since jsPDF's align is applied before rotation
              const angleRad = (rect.rotation * Math.PI) / 180;
              
              // Position label offset along the slot's "up" direction
              // jsPDF uses clockwise rotation, so "up" in slot space becomes: (sin(θ), -cos(θ)) in page space
              const labelX = localX + labelOffset * Math.sin(angleRad);
              const labelY = localY - labelOffset * Math.cos(angleRad);
              
              // Now center the text at this point
              const textWidthMm = pdf.getTextWidth(displayLabel);
              
              // Text starts at (labelX, labelY) and extends in the rotated direction
              // To center: offset by -textWidth/2 along the rotated X axis
              const startX = labelX - (textWidthMm / 2) * Math.cos(angleRad);
              const startY = labelY + (textWidthMm / 2) * Math.sin(angleRad);
              
              pdf.text(displayLabel, startX, startY, { angle: rect.rotation });
            }
          } else {
            // Fill entire slot with category color, leaving 2cm safezone around QR code
            const fillColor = rect.category.labelColor || "#FFFFFF";
            const qrSizeMm = 30;
            const safezoneMarginMm = 20; // 2cm safezone around QR code
            const clearAreaSizeMm = qrSizeMm + safezoneMarginMm * 2; // 70mm total clear area
            
            if (fillColor && fillColor !== "#FFFFFF") {
              const r = parseInt(fillColor.slice(1, 3), 16);
              const g = parseInt(fillColor.slice(3, 5), 16);
              const b = parseInt(fillColor.slice(5, 7), 16);
              
              // Fill entire slot with color
              pdf.setFillColor(r, g, b);
              pdf.rect(localX - widthMm / 2, localY - heightMm / 2, widthMm, heightMm, 'F');
              
              // Draw white rectangle in center for QR code safezone
              pdf.setFillColor(255, 255, 255);
              pdf.rect(localX - clearAreaSizeMm / 2, localY - clearAreaSizeMm / 2, clearAreaSizeMm, clearAreaSizeMm, 'F');
            }
            
            // Draw black outline on top (at original slot boundary)
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.5);
            pdf.rect(localX - widthMm / 2, localY - heightMm / 2, widthMm, heightMm);
            if (rect.autoQrId && qrCodes[rect.autoQrId]) {
              pdf.addImage(qrCodes[rect.autoQrId], 'PNG', localX - qrSizeMm / 2, localY - qrSizeMm / 2, qrSizeMm, qrSizeMm);
            }
            
            // Draw alignment guides (light grey horizontal lines for worker card placement)
            const guideWidthMm = 40; // 4cm
            const guideSpacingMm = 67.5; // 6.75cm
            pdf.setDrawColor(204, 204, 204); // Light grey
            pdf.setLineWidth(0.3);
            // Top guide line
            pdf.line(localX - guideWidthMm / 2, localY - guideSpacingMm / 2, localX + guideWidthMm / 2, localY - guideSpacingMm / 2);
            // Bottom guide line
            pdf.line(localX - guideWidthMm / 2, localY + guideSpacingMm / 2, localX + guideWidthMm / 2, localY + guideSpacingMm / 2);
            pdf.setDrawColor(0, 0, 0); // Reset to black
            
            // Add label above the top guide line (not cutting through it)
            const displayLabel2 = numberedLabelMap.get(rect.id) || rect.category.label;
            if (displayLabel2) {
              const paddingMm = 3;
              const maxFontPt = 28;
              const minFontPt = 10;
              const minTextWidthMm = 40; // Minimum 4cm text width
              let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 1.2));
              
              pdf.setFont('NotoSansJP', 'bold');
              pdf.setTextColor(0, 0, 0); // Black text
              pdf.setFontSize(fontPt);
              
              // Increase font size if text is narrower than 3cm
              let textWidth = pdf.getTextWidth(displayLabel2);
              while (textWidth < minTextWidthMm && fontPt < maxFontPt) {
                fontPt += 1;
                pdf.setFontSize(fontPt);
                textWidth = pdf.getTextWidth(displayLabel2);
              }
              
              // Reduce font size if text is too wide for the slot
              const maxTextWidth = widthMm - 2 * paddingMm;
              while (textWidth > maxTextWidth && fontPt > minFontPt) {
                fontPt -= 1;
                pdf.setFontSize(fontPt);
                textWidth = pdf.getTextWidth(displayLabel2);
              }
              
              // Position label between slot top and top guide line (above the guide line)
              // Guide line is at guideSpacingMm/2 = 33.75mm from center
              // Slot top is at heightMm/2 from center
              const slotTop = localY - heightMm / 2;
              const guideLineY = localY - guideSpacingMm / 2;
              // Label goes halfway between slot top and guide line
              const labelY = (slotTop + guideLineY) / 2;
              
              pdf.text(displayLabel2, localX, labelY, { align: 'center', baseline: 'middle' });
            }
          }

          pdf.restoreGraphicsState();
        });

      }

      const filename = is8Page ? '8page-4x2' : '6page-3x2';
      pdf.save(`template-${filename}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } else {
      // Single-page format (original logic)
      const { realWidthMm, realHeightMm } = canvasDimensions;
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: [realWidthMm, realHeightMm],
      });
      
      setupJapaneseFont(pdf);

      const markerSizeMm = 50;
      const cornerPositions = [
        { x: 0, y: 0 },
        { x: realWidthMm - markerSizeMm, y: 0 },
        { x: realWidthMm - markerSizeMm, y: realHeightMm - markerSizeMm },
        { x: 0, y: realHeightMm - markerSizeMm },
      ];

      arucoMarkers.markers.forEach((marker: any, index: number) => {
        const pos = cornerPositions[index];
        if (marker.image) {
          pdf.addImage(marker.image, 'PNG', pos.x, pos.y, markerSizeMm, markerSizeMm);
        }
      });

      templatesWithCategories.forEach((rect) => {
        const xMm = cmToMm(rect.xCm);
        const yMm = cmToMm(rect.yCm);
        const widthMm = cmToMm(rect.category.widthCm);
        const heightMm = cmToMm(rect.category.heightCm);

        pdf.saveGraphicsState();
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.5);

        const isScannerGrid = rect.category.categoryType === 'scanner_grid';
        const isWorkerTagGrid = rect.category.categoryType === 'worker_tag_grid';
        
        if (isWorkerTagGrid) {
          // Worker tag grid: header + solid cell borders + alignment lines
          // Cell = 4cm × 6.75cm usable area + 1cm border on each side = 6cm × 8.75cm
          const gridRows = rect.category.gridRows || 2;
          const gridCols = rect.category.gridCols || 4;
          const cellWidthMm = 50; // 4cm usable + 0.5cm borders each side
          const cellHeightMm = 77.5; // 6.75cm usable + 0.5cm borders each side
          const headerHeightMm = 20; // 2cm header, no margins
          
          const gridWidthMm = cellWidthMm * gridCols;
          const gridHeightMm = cellHeightMm * gridRows;
          const totalHeightMm = headerHeightMm + gridHeightMm;
          
          pdf.setDrawColor(0, 0, 0);
          pdf.setLineWidth(0.5);
          
          // Draw header rectangle
          pdf.rect(xMm - gridWidthMm / 2, yMm - totalHeightMm / 2, gridWidthMm, headerHeightMm);
          
          // Draw header text: "[label] タグ枠"
          const baseLabel = rect.category.label?.replace(' (作業者タグ)', '').replace(' (Worker Tags)', '') || '';
          const headerText = `${baseLabel} タグ枠`;
          let headerFontPt = 40; // ~2cm height (20mm * 2pt/mm = 40pt)
          pdf.setFont('NotoSansJP', 'bold');
          pdf.setTextColor(0, 0, 0);
          pdf.setFontSize(headerFontPt);
          
          let textWidth = pdf.getTextWidth(headerText);
          while (textWidth > gridWidthMm - 10 && headerFontPt > 12) {
            headerFontPt -= 2;
            pdf.setFontSize(headerFontPt);
            textWidth = pdf.getTextWidth(headerText);
          }
          
          pdf.text(headerText, xMm, yMm - totalHeightMm / 2 + headerHeightMm / 2, { align: 'center', baseline: 'middle' });
          
          // Draw grid cells with alignment lines
          const gridTopY = yMm - totalHeightMm / 2 + headerHeightMm;
          
          for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
              const cellX = xMm - gridWidthMm / 2 + col * cellWidthMm;
              const cellY = gridTopY + row * cellHeightMm;
              
              // Draw cell border
              pdf.setDrawColor(0, 0, 0);
              pdf.setLineWidth(0.5);
              pdf.rect(cellX, cellY, cellWidthMm, cellHeightMm);
              
              // Draw alignment guides inside each cell (4cm wide, 0.5cm from top and bottom edges)
              const cellCenterX = cellX + cellWidthMm / 2;
              const borderMm = 5; // 0.5cm border
              const guideWidthMm = 40; // 4cm
              
              pdf.setDrawColor(204, 204, 204); // Light grey
              pdf.setLineWidth(0.3);
              
              // Top guide line (1cm from top of cell)
              pdf.line(cellCenterX - guideWidthMm / 2, cellY + borderMm, 
                       cellCenterX + guideWidthMm / 2, cellY + borderMm);
              
              // Bottom guide line (1cm from bottom of cell)
              pdf.line(cellCenterX - guideWidthMm / 2, cellY + cellHeightMm - borderMm, 
                       cellCenterX + guideWidthMm / 2, cellY + cellHeightMm - borderMm);
              
              // Draw slot number (1-indexed, top-left to bottom-right)
              const slotNumber = row * gridCols + col + 1;
              pdf.setFont('NotoSansJP', 'bold');
              pdf.setFontSize(headerFontPt);
              pdf.setTextColor(0, 0, 0);
              pdf.text(slotNumber.toString(), cellCenterX, cellY + cellHeightMm / 2, { align: 'center', baseline: 'middle' });
            }
          }
          pdf.setDrawColor(0, 0, 0); // Reset to black
        } else if (isScannerGrid) {
          // Scanner grid: corner markers only + centered label
          const cornerLengthMm = 15; // 1.5cm corner length
          const halfW = widthMm / 2;
          const halfH = heightMm / 2;
          pdf.setLineWidth(1);
          
          // Top-left corner
          pdf.line(xMm - halfW, yMm - halfH, xMm - halfW + cornerLengthMm, yMm - halfH);
          pdf.line(xMm - halfW, yMm - halfH, xMm - halfW, yMm - halfH + cornerLengthMm);
          
          // Top-right corner
          pdf.line(xMm + halfW - cornerLengthMm, yMm - halfH, xMm + halfW, yMm - halfH);
          pdf.line(xMm + halfW, yMm - halfH, xMm + halfW, yMm - halfH + cornerLengthMm);
          
          // Bottom-right corner
          pdf.line(xMm + halfW - cornerLengthMm, yMm + halfH, xMm + halfW, yMm + halfH);
          pdf.line(xMm + halfW, yMm + halfH - cornerLengthMm, xMm + halfW, yMm + halfH);
          
          // Bottom-left corner
          pdf.line(xMm - halfW, yMm + halfH, xMm - halfW + cornerLengthMm, yMm + halfH);
          pdf.line(xMm - halfW, yMm + halfH - cornerLengthMm, xMm - halfW, yMm + halfH);
          
          // Draw label in center
          if (rect.category.label) {
            const paddingMm = 3;
            const maxFontPt = 16;
            const minFontPt = 6;
            let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 0.5));
            
            pdf.setFont('NotoSansJP', 'bold');
            pdf.setTextColor(0, 0, 0);
            pdf.setFontSize(fontPt);
            
            const maxTextWidth = widthMm - 2 * paddingMm;
            let textWidth = pdf.getTextWidth(rect.category.label);
            while (textWidth > maxTextWidth && fontPt > minFontPt) {
              fontPt -= 0.5;
              pdf.setFontSize(fontPt);
              textWidth = pdf.getTextWidth(rect.category.label);
            }
            
            pdf.text(rect.category.label, xMm, yMm, { align: 'center', baseline: 'middle' });
          }
        } else if (rect.rotation !== 0) {
          const angleRad = (rect.rotation * Math.PI) / 180;
          const halfW = widthMm / 2;
          const halfH = heightMm / 2;
          const corners = [
            { x: -halfW, y: -halfH },
            { x: halfW, y: -halfH },
            { x: halfW, y: halfH },
            { x: -halfW, y: halfH },
          ];

          const rotatedCorners = corners.map(c => ({
            x: xMm + c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad),
            y: yMm + c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad),
          }));

          // Fill entire slot with category color, leaving 2cm safezone around QR code
          const fillColor = rect.category.labelColor || "#FFFFFF";
          const qrSizeMm = 30;
          const safezoneMarginMm = 20; // 2cm safezone around QR code
          const clearAreaSizeMm = qrSizeMm + safezoneMarginMm * 2; // 70mm total clear area
          
          if (fillColor && fillColor !== "#FFFFFF") {
            const r = parseInt(fillColor.slice(1, 3), 16);
            const g = parseInt(fillColor.slice(3, 5), 16);
            const b = parseInt(fillColor.slice(5, 7), 16);
            
            // Fill entire slot with color (rotated polygon)
            pdf.setFillColor(r, g, b);
            pdf.lines(
              rotatedCorners.map((c, i) => [
                rotatedCorners[(i + 1) % 4].x - c.x,
                rotatedCorners[(i + 1) % 4].y - c.y,
              ]),
              rotatedCorners[0].x,
              rotatedCorners[0].y,
              [1, 1],
              'F'
            );
            
            // Draw white rectangle in center for QR code safezone (rotated)
            const clearHalf = clearAreaSizeMm / 2;
            const clearCorners = [
              { x: -clearHalf, y: -clearHalf },
              { x: clearHalf, y: -clearHalf },
              { x: clearHalf, y: clearHalf },
              { x: -clearHalf, y: clearHalf },
            ];
            const rotatedClearCorners = clearCorners.map(c => ({
              x: xMm + c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad),
              y: yMm + c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad),
            }));
            
            pdf.setFillColor(255, 255, 255);
            pdf.lines(
              rotatedClearCorners.map((c, i) => [
                rotatedClearCorners[(i + 1) % 4].x - c.x,
                rotatedClearCorners[(i + 1) % 4].y - c.y,
              ]),
              rotatedClearCorners[0].x,
              rotatedClearCorners[0].y,
              [1, 1],
              'F'
            );
          }

          // Draw black outline on top (at original slot boundary)
          pdf.setDrawColor(0, 0, 0);
          pdf.setLineWidth(0.5);
          pdf.lines(
            rotatedCorners.map((c, i) => [
              rotatedCorners[(i + 1) % 4].x - c.x,
              rotatedCorners[(i + 1) % 4].y - c.y,
            ]),
            rotatedCorners[0].x,
            rotatedCorners[0].y,
            [1, 1],
            'S'
          );
          if (rect.autoQrId && qrCodes[rect.autoQrId]) {
            pdf.addImage(qrCodes[rect.autoQrId], 'PNG', xMm - qrSizeMm / 2, yMm - qrSizeMm / 2, qrSizeMm, qrSizeMm);
          }
          
          // Helper function to rotate a point around center
          const rotatePoint = (px: number, py: number, cx: number, cy: number, angle: number) => {
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            return {
              x: cx + (px - cx) * cos - (py - cy) * sin,
              y: cy + (px - cx) * sin + (py - cy) * cos
            };
          };
          
          // Draw alignment guides (rotated with shape)
          const guideWidthMm = 40; // 4cm
          const guideSpacingMm = 67.5; // 6.75cm
          pdf.setDrawColor(204, 204, 204); // Light grey
          pdf.setLineWidth(0.3);
          
          // Top guide line (rotated)
          const topGuideLeft = rotatePoint(xMm - guideWidthMm / 2, yMm - guideSpacingMm / 2, xMm, yMm, angleRad);
          const topGuideRight = rotatePoint(xMm + guideWidthMm / 2, yMm - guideSpacingMm / 2, xMm, yMm, angleRad);
          pdf.line(topGuideLeft.x, topGuideLeft.y, topGuideRight.x, topGuideRight.y);
          
          // Bottom guide line (rotated)
          const bottomGuideLeft = rotatePoint(xMm - guideWidthMm / 2, yMm + guideSpacingMm / 2, xMm, yMm, angleRad);
          const bottomGuideRight = rotatePoint(xMm + guideWidthMm / 2, yMm + guideSpacingMm / 2, xMm, yMm, angleRad);
          pdf.line(bottomGuideLeft.x, bottomGuideLeft.y, bottomGuideRight.x, bottomGuideRight.y);
          pdf.setDrawColor(0, 0, 0); // Reset to black
          
          // Add label above the top guide line (rotated)
          // Use coordinate transform to avoid jsPDF's align/baseline drift with rotation
          const displayLabelRotated = numberedLabelMap.get(rect.id) || rect.category.label;
          if (displayLabelRotated) {
            const paddingMm = 3;
            const maxFontPt = 16;
            const minFontPt = 6;
            let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 0.6));
            
            pdf.setFont('NotoSansJP', 'bold');
            pdf.setTextColor(0, 0, 0); // Black text
            pdf.setFontSize(fontPt);
            let textWidth = pdf.getTextWidth(displayLabelRotated);
            const maxTextWidth = widthMm - 2 * paddingMm;
            while (textWidth > maxTextWidth && fontPt > minFontPt) {
              fontPt -= 0.5;
              pdf.setFontSize(fontPt);
              textWidth = pdf.getTextWidth(displayLabelRotated);
            }
            
            // Position label between slot top and top guide line (above the guide line)
            // But ensure it stays within slot bounds
            const slotTopOffset = heightMm / 2;
            const guideLineOffset = guideSpacingMm / 2;
            // Clamp label to stay inside slot: at most (slotTopOffset - padding) from center
            const maxLabelOffset = slotTopOffset - 5; // 5mm padding from edge
            const idealLabelOffset = (slotTopOffset + guideLineOffset) / 2;
            const labelOffset = Math.min(idealLabelOffset, maxLabelOffset);
            
            // For rotated text, manually position since jsPDF's align is applied before rotation
            const labelAngleRad = (rect.rotation * Math.PI) / 180;
            
            // Position label offset along the slot's "up" direction
            // jsPDF uses clockwise rotation, so "up" in slot space becomes: (sin(θ), -cos(θ)) in page space
            const labelX = xMm + labelOffset * Math.sin(labelAngleRad);
            const labelYPos = yMm - labelOffset * Math.cos(labelAngleRad);
            
            // Center the text at this point
            const textWidthMm = pdf.getTextWidth(displayLabelRotated);
            
            const startX = labelX - (textWidthMm / 2) * Math.cos(labelAngleRad);
            const startY = labelYPos + (textWidthMm / 2) * Math.sin(labelAngleRad);
            
            pdf.text(displayLabelRotated, startX, startY, { angle: rect.rotation });
          }
        } else {
          // Fill entire slot with category color, leaving 2cm safezone around QR code
          const fillColor = rect.category.labelColor || "#FFFFFF";
          const qrSizeMm = 30;
          const safezoneMarginMm = 20; // 2cm safezone around QR code
          const clearAreaSizeMm = qrSizeMm + safezoneMarginMm * 2; // 70mm total clear area
          
          if (fillColor && fillColor !== "#FFFFFF") {
            const r = parseInt(fillColor.slice(1, 3), 16);
            const g = parseInt(fillColor.slice(3, 5), 16);
            const b = parseInt(fillColor.slice(5, 7), 16);
            
            // Fill entire slot with color
            pdf.setFillColor(r, g, b);
            pdf.rect(xMm - widthMm / 2, yMm - heightMm / 2, widthMm, heightMm, 'F');
            
            // Draw white rectangle in center for QR code safezone
            pdf.setFillColor(255, 255, 255);
            pdf.rect(xMm - clearAreaSizeMm / 2, yMm - clearAreaSizeMm / 2, clearAreaSizeMm, clearAreaSizeMm, 'F');
          }
          
          // Draw black outline on top (at original slot boundary)
          pdf.setDrawColor(0, 0, 0);
          pdf.setLineWidth(0.5);
          pdf.rect(xMm - widthMm / 2, yMm - heightMm / 2, widthMm, heightMm);
          if (rect.autoQrId && qrCodes[rect.autoQrId]) {
            pdf.addImage(qrCodes[rect.autoQrId], 'PNG', xMm - qrSizeMm / 2, yMm - qrSizeMm / 2, qrSizeMm, qrSizeMm);
          }
          
          // Draw alignment guides (light grey horizontal lines for worker card placement)
          const guideWidthMm = 40; // 4cm
          const guideSpacingMm = 67.5; // 6.75cm
          pdf.setDrawColor(204, 204, 204); // Light grey
          pdf.setLineWidth(0.3);
          // Top guide line
          pdf.line(xMm - guideWidthMm / 2, yMm - guideSpacingMm / 2, xMm + guideWidthMm / 2, yMm - guideSpacingMm / 2);
          // Bottom guide line
          pdf.line(xMm - guideWidthMm / 2, yMm + guideSpacingMm / 2, xMm + guideWidthMm / 2, yMm + guideSpacingMm / 2);
          pdf.setDrawColor(0, 0, 0); // Reset to black
          
          // Add label above the top guide line (not cutting through it)
          const displayLabelNonRotated = numberedLabelMap.get(rect.id) || rect.category.label;
          if (displayLabelNonRotated) {
            const paddingMm = 3;
            const maxFontPt = 16;
            const minFontPt = 6;
            let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 0.6));
            
            pdf.setFont('NotoSansJP', 'bold');
            pdf.setTextColor(0, 0, 0); // Black text
            pdf.setFontSize(fontPt);
            let textWidth = pdf.getTextWidth(displayLabelNonRotated);
            const maxTextWidth = widthMm - 2 * paddingMm;
            while (textWidth > maxTextWidth && fontPt > minFontPt) {
              fontPt -= 0.5;
              pdf.setFontSize(fontPt);
              textWidth = pdf.getTextWidth(displayLabelNonRotated);
            }
            
            // Position label between slot top and top guide line (above the guide line)
            const slotTop = yMm - heightMm / 2;
            const guideLineY = yMm - guideSpacingMm / 2;
            const labelY = (slotTop + guideLineY) / 2;
            
            pdf.text(displayLabelNonRotated, xMm, labelY, { align: 'center', baseline: 'middle' });
          }
        }

        pdf.restoreGraphicsState();
      });

      pdf.save(`template-${paperSize}-${new Date().toISOString().slice(0, 10)}.pdf`);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden print:block">
      <div className="print:hidden">
        <Sidebar />
      </div>
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card px-6 py-4 print:hidden">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="template-print-title">
                Print Template Preview
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Preview and print template rectangles with QR codes
              </p>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setLocation('/slot-drawing')}
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button variant="outline" onClick={handleDownload} data-testid="button-download">
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
              <Button onClick={handlePrint} data-testid="button-print">
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6 print:p-0">
          <div className="max-w-7xl mx-auto space-y-6 print:space-y-0">
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>Print Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {savedTemplateDesigns.length > 0 ? (
                    <div className="flex items-center gap-3">
                      <Label htmlFor="template-design" className="text-sm font-medium">Template Design:</Label>
                      <Select value={selectedDesignId} onValueChange={setSelectedDesignId}>
                        <SelectTrigger className="w-64" id="template-design" data-testid="select-template-design">
                          <SelectValue placeholder="Select a template design" />
                        </SelectTrigger>
                        <SelectContent>
                          {savedTemplateDesigns.map((design) => (
                            <SelectItem key={design.id} value={design.id}>
                              {design.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-foreground mb-1">Loading templates from database...</p>
                      <p>Showing {allTemplateRectangles.length} template{allTemplateRectangles.length !== 1 ? 's' : ''} with fresh QR codes (numbers 1-7)</p>
                    </div>
                  )}
                  {selectedDesignId && (
                    <div className="text-sm text-muted-foreground pl-32">
                      <p>Paper Size: <span className="font-medium text-foreground">{paperSize}</span></p>
                      <p>{templatesWithCategories.length} template{templatesWithCategories.length !== 1 ? 's' : ''}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-center">
              <canvas 
                ref={canvasRef}
                width={canvasDimensions.width}
                height={canvasDimensions.height}
                className="bg-white rounded shadow-lg print:shadow-none print:rounded-none"
                style={{ 
                  maxWidth: '100%',
                  height: 'auto'
                }}
                data-testid="print-canvas"
              />
            </div>
            
            <style>{`
              @media print {
                @page {
                  size: ${paperSize.includes('A3') ? 'A3' : paperSize.includes('A5') ? 'A5' : 'A4'} landscape;
                  margin: 0;
                }
                body, html {
                  margin: 0;
                  padding: 0;
                  overflow: hidden;
                }
                canvas {
                  width: 100vw !important;
                  height: 100vh !important;
                  max-width: 100vw !important;
                  max-height: 100vh !important;
                  object-fit: contain;
                  page-break-inside: avoid;
                }
              }
            `}</style>
          </div>
        </div>
      </main>
    </div>
  );
}
