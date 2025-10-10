import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Printer, ArrowLeft } from "lucide-react";
import type { TemplateRectangle, ToolCategory } from "@shared/schema";

interface TemplateRectangleWithCategory extends TemplateRectangle {
  category: ToolCategory;
}

export default function TemplatePrint() {
  const [, setLocation] = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paperSize, setPaperSize] = useState('A4-landscape');

  const paperDimensions: Record<string, { 
    width: number; 
    height: number;
    realWidthMm: number;
    realHeightMm: number;
  }> = {
    'A5-landscape': { width: 600, height: 424, realWidthMm: 210, realHeightMm: 148 },
    'A4-landscape': { width: 800, height: 566, realWidthMm: 297, realHeightMm: 210 },
    'A3-landscape': { width: 1131, height: 800, realWidthMm: 420, realHeightMm: 297 },
    '2xA5-landscape': { width: 1200, height: 424, realWidthMm: 420, realHeightMm: 148 },
    '3xA5-landscape': { width: 1800, height: 424, realWidthMm: 630, realHeightMm: 148 },
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
    queryKey: ['/api/aruco-corner-markers'],
    queryFn: async () => {
      const response = await fetch('/api/aruco-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'single',
          markerIds: [17, 18, 19, 20],
          markerLengthCm: 5.0,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate ArUco markers');
      }
      
      return response.json();
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

      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, canvas.width, canvas.height);

      // Render 4 corner ArUco markers (3cm from edges, 5cm size)
      if (arucoMarkers?.ok && arucoMarkers.markers) {
        const borderCm = 3;
        const markerSizeCm = 5;
        const paperWidthCm = canvasDimensions.realWidthMm / 10;
        const paperHeightCm = canvasDimensions.realHeightMm / 10;
        
        const cornerPositions = [
          { id: 17, xCm: borderCm, yCm: borderCm }, // Top-left
          { id: 18, xCm: paperWidthCm - borderCm - markerSizeCm, yCm: borderCm }, // Top-right
          { id: 19, xCm: paperWidthCm - borderCm - markerSizeCm, yCm: paperHeightCm - borderCm - markerSizeCm }, // Bottom-right
          { id: 20, xCm: borderCm, yCm: paperHeightCm - borderCm - markerSizeCm }, // Bottom-left
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
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {templatesWithCategories.length} template{templatesWithCategories.length !== 1 ? 's' : ''} on this paper
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="print:h-screen print:flex print:items-center print:justify-center">
              <div className="canvas-container flex justify-center print:block">
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
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
