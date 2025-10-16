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

export default function TemplatePrint() {
  const [, setLocation] = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paperSize, setPaperSize] = useState('A4-landscape');

  // Load paper size from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('templateConfigVersions');
    if (saved) {
      try {
        const versions = JSON.parse(saved);
        if (versions.current) {
          const currentVersion = versions.versions.find((v: any) => v.id === versions.current);
          if (currentVersion && currentVersion.paperSize) {
            setPaperSize(currentVersion.paperSize);
          }
        }
      } catch (error) {
        console.error('Failed to load paper size from localStorage:', error);
      }
    }
  }, []);

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
    '6-page-3x2': { width: 10701, height: 5049, realWidthMm: 906, realHeightMm: 427.5 },
  };

  const canvasDimensions = paperDimensions[paperSize] || paperDimensions['A4-landscape'];

  const { data: templateRectangles = [] } = useQuery<TemplateRectangle[]>({
    queryKey: ['/api/template-rectangles', paperSize],
    queryFn: async () => {
      const response = await fetch(`/api/template-rectangles?paperSize=${paperSize}`);
      if (!response.ok) throw new Error('Failed to fetch template rectangles');
      return response.json();
    },
  });

  const { data: categories = [] } = useQuery<ToolCategory[]>({
    queryKey: ['/api/tool-categories'],
  });

  const { data: qrCodes = {} } = useQuery<Record<string, string>>({
    queryKey: ['/api/qr-codes', templateRectangles],
    queryFn: async () => {
      const codes: Record<string, string> = {};
      
      for (const rect of templateRectangles) {
        if (rect.autoQrId) {
          try {
            const response = await fetch('/api/qr-generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'slot',
                id: rect.autoQrId,
                errorCorrection: 'L',
                moduleSize: 15,
                includeHmac: true,
              }),
            });
            
            if (response.ok) {
              const result = await response.json();
              codes[rect.autoQrId] = `data:image/png;base64,${result.qrCode}`;
            }
          } catch (error) {
            console.error(`Failed to generate QR for ${rect.autoQrId}:`, error);
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
      const markerIds = [17, 18, 19, 20];
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
          { id: 17, xCm: 0, yCm: 0 }, // Top-left
          { id: 18, xCm: paperWidthCm - markerSizeCm, yCm: 0 }, // Top-right
          { id: 19, xCm: paperWidthCm - markerSizeCm, yCm: paperHeightCm - markerSizeCm }, // Bottom-right
          { id: 20, xCm: 0, yCm: paperHeightCm - markerSizeCm }, // Bottom-left
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
        if (rect.autoQrId && qrImageCache[rect.autoQrId]) {
          const qrSizeCm = 3;
          const qrSizePx = cmToPixels(qrSizeCm, true);
          ctx.drawImage(qrImageCache[rect.autoQrId], -qrSizePx / 2, -qrSizePx / 2, qrSizePx, qrSizePx);
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

    const is6Page = paperSize === '6-page-3x2';

    if (is6Page) {
      // 6-Page format: Create PDF with 6 A4 landscape pages
      const a4WidthMm = 297;  // A4 landscape
      const a4HeightMm = 210;
      const gutterMm = 7.5;
      const markerSizeMm = 50;
      const markerInsetMm = 10;  // Inside safe zone
      const safeMarginMm = 10; // 1cm safe zone

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      // Helper to determine which sheet a rectangle belongs to
      const getSheetForRect = (xMm: number, yMm: number): number => {
        const col = Math.floor(xMm / (a4WidthMm + gutterMm));
        const row = Math.floor(yMm / (a4HeightMm + gutterMm));
        return row * 3 + col + 1; // Sheet number 1-6
      };

      // Process each of the 6 sheets
      for (let sheetNum = 1; sheetNum <= 6; sheetNum++) {
        if (sheetNum > 1) pdf.addPage();

        const row = Math.floor((sheetNum - 1) / 3);
        const col = (sheetNum - 1) % 3;
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
        if ([1, 3, 4, 6].includes(sheetNum)) {
          const markerIndex = { 1: 0, 3: 1, 4: 3, 6: 2 }[sheetNum] as number;
          const marker = arucoMarkers.markers[markerIndex];
          
          let markerX = 0;
          let markerY = 0;

          if (sheetNum === 1) { // Top-left
            markerX = markerInsetMm;
            markerY = markerInsetMm;
          } else if (sheetNum === 3) { // Top-right
            markerX = a4WidthMm - markerSizeMm - markerInsetMm;
            markerY = markerInsetMm;
          } else if (sheetNum === 4) { // Bottom-left
            markerX = markerInsetMm;
            markerY = a4HeightMm - markerSizeMm - markerInsetMm;
          } else if (sheetNum === 6) { // Bottom-right
            markerX = a4WidthMm - markerSizeMm - markerInsetMm;
            markerY = a4HeightMm - markerSizeMm - markerInsetMm;
          }

          if (marker && marker.image) {
            pdf.addImage(marker.image, 'PNG', markerX, markerY, markerSizeMm, markerSizeMm);
          }
        }

        // Draw template rectangles that belong to this sheet
        templatesWithCategories.forEach((rect) => {
          const xMm = cmToMm(rect.xCm);
          const yMm = cmToMm(rect.yCm);
          const rectSheet = getSheetForRect(xMm, yMm);

          if (rectSheet !== sheetNum) return; // Skip if not on this sheet

          const widthMm = cmToMm(rect.category.widthCm);
          const heightMm = cmToMm(rect.category.heightCm);

          // Adjust coordinates relative to sheet
          const localX = xMm - sheetOffsetX;
          const localY = yMm - sheetOffsetY;

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

            if (rect.autoQrId && qrCodes[rect.autoQrId]) {
              const qrSizeMm = 30;
              pdf.addImage(qrCodes[rect.autoQrId], 'PNG', localX - qrSizeMm / 2, localY - qrSizeMm / 2, qrSizeMm, qrSizeMm);
            }
          } else {
            pdf.rect(localX - widthMm / 2, localY - heightMm / 2, widthMm, heightMm);

            if (rect.autoQrId && qrCodes[rect.autoQrId]) {
              const qrSizeMm = 30;
              pdf.addImage(qrCodes[rect.autoQrId], 'PNG', localX - qrSizeMm / 2, localY - qrSizeMm / 2, qrSizeMm, qrSizeMm);
            }
          }

          pdf.restoreGraphicsState();
        });

        // Add assembly instructions on last page
        if (sheetNum === 6) {
          pdf.setFontSize(8);
          pdf.setTextColor(0, 0, 0);
          const instructions = [
            'Assembly Instructions:',
            '1. Print all 6 pages on A4 paper',
            '2. Tape sheets edge-to-edge in 3×2 grid (no gaps/overlaps)',
            '3. Sheets 1,2,3 on top row; sheets 4,5,6 on bottom',
            '4. White borders create 7.5mm gutters (expected)',
          ];
          instructions.forEach((line, i) => {
            pdf.text(line, 10, a4HeightMm - 30 + i * 4);
          });
        }
      }

      pdf.save(`template-6page-3x2-${new Date().toISOString().slice(0, 10)}.pdf`);
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

          if (rect.autoQrId && qrCodes[rect.autoQrId]) {
            const qrSizeMm = 30;
            pdf.addImage(qrCodes[rect.autoQrId], 'PNG', xMm - qrSizeMm / 2, yMm - qrSizeMm / 2, qrSizeMm, qrSizeMm);
          }
        } else {
          pdf.rect(xMm - widthMm / 2, yMm - heightMm / 2, widthMm, heightMm);

          if (rect.autoQrId && qrCodes[rect.autoQrId]) {
            const qrSizeMm = 30;
            pdf.addImage(qrCodes[rect.autoQrId], 'PNG', xMm - qrSizeMm / 2, yMm - qrSizeMm / 2, qrSizeMm, qrSizeMm);
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
                <div className="flex items-center gap-3">
                  <Label htmlFor="print-paper-size" className="text-sm font-medium">Paper Size:</Label>
                  <Select value={paperSize} onValueChange={setPaperSize}>
                    <SelectTrigger className="w-48" id="print-paper-size" data-testid="select-print-paper-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A5-landscape">A5 Landscape</SelectItem>
                      <SelectItem value="A4-landscape">A4 Landscape</SelectItem>
                      <SelectItem value="A3-landscape">A3 Landscape</SelectItem>
                      <SelectItem value="2xA5-landscape">2× A5 Landscape</SelectItem>
                      <SelectItem value="3xA5-landscape">3× A5 Landscape</SelectItem>
                      <SelectItem value="6-page-3x2">6-Page (3×2 A4)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {templatesWithCategories.length} template{templatesWithCategories.length !== 1 ? 's' : ''} on this paper
                  </p>
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
