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
      const selectedStillExists = mapped.some(d => d.id === selectedDesignId);
      if (!selectedDesignId || !selectedStillExists) {
        setSelectedDesignId(mapped[0].id);
        setPaperSize(mapped[0].paperSize);
      }
    } else {
      // Clear state when no designs exist
      setSavedTemplateDesigns([]);
      setSelectedDesignId('');
      setPaperSize('A4-landscape'); // Reset to default when no designs
    }
  }, [templateDesignsData, selectedDesignId]);

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

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);

        // Draw QR code centered within the rectangle (3x3 cm)
        const qrSizeCm = 3;
        const qrSizePx = cmToPixels(qrSizeCm, true);
        if (rect.autoQrId && qrImageCache[rect.autoQrId]) {
          ctx.drawImage(qrImageCache[rect.autoQrId], -qrSizePx / 2, -qrSizePx / 2, qrSizePx, qrSizePx);
        }

        // Draw label above QR code (supports Japanese text)
        if (rect.category.label) {
          const padding = cmToPixels(0.3, true); // 0.3cm padding
          const maxFontPx = 96;
          const minFontPx = 18;
          let fontPx = Math.min(maxFontPx, Math.max(minFontPx, widthPx * 0.35));
          
          // Set font with Japanese support (bold)
          ctx.font = `bold ${fontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          
          // Reduce font size if text is too wide
          let textWidth = ctx.measureText(rect.category.label).width;
          const maxTextWidth = widthPx - 2 * padding;
          while (textWidth > maxTextWidth && fontPx > minFontPx) {
            fontPx -= 2;
            ctx.font = `bold ${fontPx}px "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif`;
            textWidth = ctx.measureText(rect.category.label).width;
          }
          
          // Position label above QR code
          const labelY = -qrSizePx / 2 - padding;
          
          // Draw white stroke for contrast
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.strokeText(rect.category.label, 0, labelY);
          
          // Draw black text
          ctx.fillStyle = '#000000';
          ctx.fillText(rect.category.label, 0, labelY);
        }

        ctx.restore();
      });
    };

    renderCanvas();
  }, [templatesWithCategories, qrCodes, arucoMarkers, canvasDimensions, paperSize]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!arucoMarkers || !qrCodes) return;

    // Helper to convert cm to mm
    const cmToMm = (cm: number) => cm * 10;

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
          
          // For non-rotated rectangles, check if the rectangle BOUNDS overlap with this sheet
          // (not just the center point)
          const rectLeftMm = xMm - widthMm / 2;
          const rectRightMm = xMm + widthMm / 2;
          const rectTopMm = yMm - heightMm / 2;
          const rectBottomMm = yMm + heightMm / 2;
          
          const sheetLeftMm = sheetOffsetX;
          const sheetRightMm = sheetOffsetX + a4WidthMm;
          const sheetTopMm = sheetOffsetY;
          const sheetBottomMm = sheetOffsetY + a4HeightMm;
          
          // Check if rectangle overlaps with this sheet (even partially)
          const overlapsSheet = !(rectRightMm <= sheetLeftMm || rectLeftMm >= sheetRightMm ||
                                  rectBottomMm <= sheetTopMm || rectTopMm >= sheetBottomMm);
          
          if (!overlapsSheet) return; // Skip if doesn't overlap this sheet

          // CLAMP rectangle center to stay within sheet's safe zone
          // Safe zone is 10mm from all edges of the sheet
          const halfWidthMm = widthMm / 2;
          const halfHeightMm = heightMm / 2;
          
          // Calculate safe zone bounds for this sheet (in global coordinates)
          const sheetSafeLeft = sheetOffsetX + safeMarginMm + halfWidthMm;
          const sheetSafeRight = sheetOffsetX + a4WidthMm - safeMarginMm - halfWidthMm;
          const sheetSafeTop = sheetOffsetY + safeMarginMm + halfHeightMm;
          const sheetSafeBottom = sheetOffsetY + a4HeightMm - safeMarginMm - halfHeightMm;
          
          // Clamp center position to safe zone
          const clampedXMm = Math.max(sheetSafeLeft, Math.min(sheetSafeRight, xMm));
          const clampedYMm = Math.max(sheetSafeTop, Math.min(sheetSafeBottom, yMm));

          // Adjust coordinates relative to sheet (using clamped positions)
          const localX = clampedXMm - sheetOffsetX;
          const localY = clampedYMm - sheetOffsetY;

          pdf.saveGraphicsState();
          pdf.setDrawColor(0, 0, 0);
          pdf.setLineWidth(0.5);

          if (rect.rotation !== 0) {
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
              x: localX + c.x * Math.cos(angleRad) - c.y * Math.sin(angleRad),
              y: localY + c.x * Math.sin(angleRad) + c.y * Math.cos(angleRad),
            }));

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

            const qrSizeMm = 30;
            if (rect.autoQrId && qrCodes[rect.autoQrId]) {
              pdf.addImage(qrCodes[rect.autoQrId], 'PNG', localX - qrSizeMm / 2, localY - qrSizeMm / 2, qrSizeMm, qrSizeMm);
            }
            
            // Add label above QR code
            if (rect.category.label) {
              const paddingMm = 3;
              const maxFontPt = 28;
              const minFontPt = 10;
              let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 1.2));
              
              pdf.setFont('helvetica', 'bold');
              pdf.setFontSize(fontPt);
              const textWidth = pdf.getTextWidth(rect.category.label);
              const maxTextWidth = widthMm - 2 * paddingMm;
              while (textWidth > maxTextWidth && fontPt > minFontPt) {
                fontPt -= 1;
                pdf.setFontSize(fontPt);
              }
              
              const labelY = localY - qrSizeMm / 2 - paddingMm;
              pdf.text(rect.category.label, localX, labelY, { align: 'center', baseline: 'bottom' });
            }
          } else {
            pdf.rect(localX - widthMm / 2, localY - heightMm / 2, widthMm, heightMm);

            const qrSizeMm = 30;
            if (rect.autoQrId && qrCodes[rect.autoQrId]) {
              pdf.addImage(qrCodes[rect.autoQrId], 'PNG', localX - qrSizeMm / 2, localY - qrSizeMm / 2, qrSizeMm, qrSizeMm);
            }
            
            // Add label above QR code
            if (rect.category.label) {
              const paddingMm = 3;
              const maxFontPt = 28;
              const minFontPt = 10;
              let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 1.2));
              
              pdf.setFont('helvetica', 'bold');
              pdf.setFontSize(fontPt);
              const textWidth = pdf.getTextWidth(rect.category.label);
              const maxTextWidth = widthMm - 2 * paddingMm;
              while (textWidth > maxTextWidth && fontPt > minFontPt) {
                fontPt -= 1;
                pdf.setFontSize(fontPt);
              }
              
              const labelY = localY - qrSizeMm / 2 - paddingMm;
              pdf.text(rect.category.label, localX, labelY, { align: 'center', baseline: 'bottom' });
            }
          }

          pdf.restoreGraphicsState();
        });

        // Add assembly instructions on last page
        if (sheetNum === totalSheets) {
          pdf.setFontSize(8);
          pdf.setTextColor(0, 0, 0);
          const instructions = is8Page ? [
            'Assembly Instructions:',
            '1. Print all 8 pages on A4 landscape paper',
            '2. Align sheets edge-to-edge in 4×2 grid (no gaps)',
            '3. Sheets 1,2,3,4 on top row; sheets 5,6,7,8 on bottom',
            '4. Tape sheets together on back side',
          ] : [
            'Assembly Instructions:',
            '1. Print all 6 pages on A4 landscape paper',
            '2. Align sheets edge-to-edge in 3×2 grid (no gaps)',
            '3. Sheets 1,2,3 on top row; sheets 4,5,6 on bottom',
            '4. Tape sheets together on back side',
          ];
          instructions.forEach((line, i) => {
            pdf.text(line, 10, a4HeightMm - 30 + i * 4);
          });
        }
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

        if (rect.rotation !== 0) {
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

          const qrSizeMm = 30;
          if (rect.autoQrId && qrCodes[rect.autoQrId]) {
            pdf.addImage(qrCodes[rect.autoQrId], 'PNG', xMm - qrSizeMm / 2, yMm - qrSizeMm / 2, qrSizeMm, qrSizeMm);
          }
          
          // Add label above QR code
          if (rect.category.label) {
            const paddingMm = 3;
            const maxFontPt = 16;
            const minFontPt = 6;
            let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 0.6));
            
            pdf.setFontSize(fontPt);
            const textWidth = pdf.getTextWidth(rect.category.label);
            const maxTextWidth = widthMm - 2 * paddingMm;
            while (textWidth > maxTextWidth && fontPt > minFontPt) {
              fontPt -= 0.5;
              pdf.setFontSize(fontPt);
            }
            
            const labelY = yMm - qrSizeMm / 2 - paddingMm;
            pdf.text(rect.category.label, xMm, labelY, { align: 'center', baseline: 'bottom' });
          }
        } else {
          pdf.rect(xMm - widthMm / 2, yMm - heightMm / 2, widthMm, heightMm);

          const qrSizeMm = 30;
          if (rect.autoQrId && qrCodes[rect.autoQrId]) {
            pdf.addImage(qrCodes[rect.autoQrId], 'PNG', xMm - qrSizeMm / 2, yMm - qrSizeMm / 2, qrSizeMm, qrSizeMm);
          }
          
          // Add label above QR code
          if (rect.category.label) {
            const paddingMm = 3;
            const maxFontPt = 16;
            const minFontPt = 6;
            let fontPt = Math.min(maxFontPt, Math.max(minFontPt, widthMm * 0.6));
            
            pdf.setFontSize(fontPt);
            const textWidth = pdf.getTextWidth(rect.category.label);
            const maxTextWidth = widthMm - 2 * paddingMm;
            while (textWidth > maxTextWidth && fontPt > minFontPt) {
              fontPt -= 0.5;
              pdf.setFontSize(fontPt);
            }
            
            const labelY = yMm - qrSizeMm / 2 - paddingMm;
            pdf.text(rect.category.label, xMm, labelY, { align: 'center', baseline: 'bottom' });
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
        <header className="bg-card border-b border-border px-6 py-4 print:hidden">
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
