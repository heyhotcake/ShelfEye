import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Undo, Trash, ZoomIn, ZoomOut, Move, X, Save, Download, Upload, Clock, Layers, RotateCcw, RotateCw, Printer, Eye } from "lucide-react";
import { CategoryManager } from "@/components/modals/category-manager";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

interface TemplateRectangle {
  id: string;
  categoryId: string;
  xCm: number;
  yCm: number;
  rotation: number;
  widthCm: number;
  heightCm: number;
  categoryName: string;
  toolType: string;
  autoQrId?: string;
}

export default function SlotDrawing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Legacy slot drawing state (kept for backwards compatibility, but UI removed)
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<SlotRegion | null>(null);
  const [regions, setRegions] = useState<SlotRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<SlotRegion | null>(null);
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Slot version management
  const [showVersions, setShowVersions] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [savedVersions, setSavedVersions] = useState<Array<{
    name: string;
    timestamp: string;
    regions: SlotRegion[];
  }>>([]);
  
  // Template version management
  const [templateVersionName, setTemplateVersionName] = useState('');
  const [savedTemplateVersions, setSavedTemplateVersions] = useState<Array<{
    name: string;
    timestamp: string;
    templateRectangles: TemplateRectangle[];
    categories: any[];
    paperSize: string;
  }>>([]);
  
  // Category manager
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  
  // Paper size configuration
  const [paperSize, setPaperSize] = useState('A4-landscape');
  
  // Camera selection
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  
  // Template rectangle state
  const [templateRectangles, setTemplateRectangles] = useState<TemplateRectangle[]>([]);
  const [draggingRectId, setDraggingRectId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedTemplateRect, setSelectedTemplateRect] = useState<TemplateRectangle | null>(null);
  
  // Preview state
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<any>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  
  // Paper size dimensions (width x height in pixels, landscape orientation)
  // ISO A-series aspect ratio is √2:1 (1.414:1)
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
    '6-page-3x2': { width: 2400, height: 1131, realWidthMm: 891, realHeightMm: 420 },
  };
  
  const canvasDimensions = paperDimensions[paperSize] || paperDimensions['A4-landscape'];

  const { data: cameras } = useQuery<any[]>({
    queryKey: ['/api/cameras'],
  });

  const { data: slots } = useQuery<any[]>({
    queryKey: ['/api/slots'],
  });

  const { data: toolCategories = [] } = useQuery<any[]>({
    queryKey: ['/api/tool-categories'],
  });

  const { data: templateRects = [] } = useQuery<any[]>({
    queryKey: ['/api/template-rectangles', paperSize],
    queryFn: async () => {
      const response = await fetch(`/api/template-rectangles?paperSize=${paperSize}`);
      if (!response.ok) throw new Error('Failed to fetch template rectangles');
      return response.json();
    },
  });

  // Load saved slot versions from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('slotConfigVersions');
    if (saved) {
      try {
        setSavedVersions(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved slot versions:', e);
      }
    }
  }, []);

  // Load saved template versions from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('templateConfigVersions');
    if (saved) {
      try {
        setSavedTemplateVersions(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved template versions:', e);
      }
    }
  }, []);

  // Load existing slots as regions when slots data changes
  useEffect(() => {
    if (slots && slots.length > 0 && regions.length === 0) {
      const loadedRegions: SlotRegion[] = slots.map((slot: any) => ({
        id: slot.id,
        slotId: slot.slotId,
        points: slot.regionCoords.map((coord: number[]) => ({ x: coord[0], y: coord[1] })),
        toolName: slot.toolName,
        expectedQrId: slot.expectedQrId || '',
        priority: slot.priority || 'high',
        allowCheckout: slot.allowCheckout !== false,
        graceWindow: slot.graceWindow || '08:30-16:30',
      }));
      setRegions(loadedRegions);
    }
  }, [slots]);

  // Set default camera when cameras load
  useEffect(() => {
    if (cameras && cameras.length > 0 && !selectedCameraId) {
      setSelectedCameraId(cameras[0].id);
    }
  }, [cameras, selectedCameraId]);

  // Load template rectangles when data changes
  useEffect(() => {
    if (templateRects && templateRects.length > 0) {
      const loadedRects: TemplateRectangle[] = templateRects.map((rect: any) => {
        const category = toolCategories.find((c: any) => c.id === rect.categoryId);
        return {
          id: rect.id,
          categoryId: rect.categoryId,
          xCm: rect.xCm,
          yCm: rect.yCm,
          rotation: rect.rotation,
          widthCm: category?.widthCm || 0,
          heightCm: category?.heightCm || 0,
          categoryName: category?.name || '',
          toolType: category?.toolType || '',
        };
      });
      setTemplateRectangles(loadedRects);
    } else {
      setTemplateRectangles([]);
    }
  }, [templateRects, toolCategories]);

  const createSlotMutation = useMutation({
    mutationFn: (slotData: any) => apiRequest('POST', '/api/slots', slotData),
    onSuccess: () => {
      toast({
        title: "Slot Created",
        description: "Slot configuration saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/slots'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Save Slot",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSlotMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => 
      apiRequest('PUT', `/api/slots/${id}`, data),
    onSuccess: () => {
      toast({
        title: "Slot Updated", 
        description: "Slot configuration updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/slots'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Slot",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteSlotMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/slots/${id}`),
    onSuccess: () => {
      toast({
        title: "Slot Deleted",
        description: "Slot removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/slots'] });
      setSelectedRegion(null);
      setRegions(prev => prev.filter(r => r.id !== selectedRegion?.id));
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Slot",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createTemplateRectMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/template-rectangles', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles', paperSize] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Create Template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateTemplateRectMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => 
      apiRequest('PUT', `/api/template-rectangles/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles', paperSize] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteTemplateRectMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/template-rectangles/${id}`),
    onSuccess: () => {
      toast({
        title: "Template Deleted",
        description: "Template rectangle removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles', paperSize] });
      setSelectedTemplateRect(null);
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Helper functions for cm to pixels conversion
  const cmToPixels = (cm: number, isWidth = true): number => {
    const canvasMargin = 40;
    const paperWidth = canvasDimensions.width - (canvasMargin * 2);
    const paperHeight = canvasDimensions.height - (canvasMargin * 2);
    const pxPerMm = isWidth 
      ? paperWidth / canvasDimensions.realWidthMm 
      : paperHeight / canvasDimensions.realHeightMm;
    return cm * 10 * pxPerMm; // cm to mm, then to pixels
  };

  const pixelsToCm = (pixels: number, isWidth = true): number => {
    const canvasMargin = 40;
    const paperWidth = canvasDimensions.width - (canvasMargin * 2);
    const paperHeight = canvasDimensions.height - (canvasMargin * 2);
    const pxPerMm = isWidth 
      ? paperWidth / canvasDimensions.realWidthMm 
      : paperHeight / canvasDimensions.realHeightMm;
    return pixels / pxPerMm / 10; // pixels to mm, then to cm
  };

  const snapToGrid = (cm: number): number => {
    const gridSize = 0.5; // 0.5cm grid
    return Math.round(cm / gridSize) * gridSize;
  };

  // Helper function to get sheet boundaries for 6-page format
  const getSheetBounds = (xCm: number, yCm: number): { minX: number; maxX: number; minY: number; maxY: number } | null => {
    if (paperSize !== '6-page-3x2') return null;
    
    const gutterMm = 0;  // No gutters - sheets touch edge-to-edge
    const a4WidthMm = 297;  // A4 landscape
    const a4HeightMm = 210;
    
    // Convert cm to mm
    const xMm = xCm * 10;
    const yMm = yCm * 10;
    
    // Determine which sheet (column and row)
    const totalWidthPerSheet = a4WidthMm + gutterMm;
    const totalHeightPerSheet = a4HeightMm + gutterMm;
    
    const col = Math.floor(xMm / totalWidthPerSheet);
    const row = Math.floor(yMm / totalHeightPerSheet);
    
    // Clamp to valid sheet range
    const clampedCol = Math.max(0, Math.min(2, col));
    const clampedRow = Math.max(0, Math.min(1, row));
    
    // Calculate sheet boundaries in cm
    const minXCm = (clampedCol * totalWidthPerSheet) / 10;
    const maxXCm = (clampedCol * a4WidthMm + clampedCol * gutterMm + a4WidthMm) / 10;
    const minYCm = (clampedRow * totalHeightPerSheet) / 10;
    const maxYCm = (clampedRow * a4HeightMm + clampedRow * gutterMm + a4HeightMm) / 10;
    
    return { minX: minXCm, maxX: maxXCm, minY: minYCm, maxY: maxYCm };
  };

  // Constrain position to sheet boundaries
  const constrainToSheet = (xCm: number, yCm: number, rectWidthCm: number, rectHeightCm: number): { x: number; y: number } => {
    const bounds = getSheetBounds(xCm, yCm);
    if (!bounds) return { x: xCm, y: yCm };
    
    // Add safe margin (1cm) to keep rectangles inside printable area
    const safeMarginCm = 1;
    const halfWidth = rectWidthCm / 2;
    const halfHeight = rectHeightCm / 2;
    
    const constrainedX = Math.max(
      bounds.minX + safeMarginCm + halfWidth,
      Math.min(bounds.maxX - safeMarginCm - halfWidth, xCm)
    );
    const constrainedY = Math.max(
      bounds.minY + safeMarginCm + halfHeight,
      Math.min(bounds.maxY - safeMarginCm - halfHeight, yCm)
    );
    
    return { x: constrainedX, y: constrainedY };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context state
    ctx.save();
    
    // Apply zoom and pan transforms
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(zoom, zoom);

    // Draw background grid pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1 / zoom;
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

    // Add canvas margins (40px from edges)
    const canvasMargin = 40;
    const paperWidth = canvas.width - (canvasMargin * 2);
    const paperHeight = canvas.height - (canvasMargin * 2);
    
    // Calculate pixel conversion (relative to paper size)
    const paperInfo = paperDimensions[paperSize] || paperDimensions['A4-landscape'];
    const pxPerMm = paperWidth / paperInfo.realWidthMm;
    
    // Check if this is 6-page format
    const is6Page = paperSize === '6-page-3x2';
    
    if (is6Page) {
      // 6-Page (3×2) layout - sheets touch edge-to-edge
      const gutterMm = 0;  // No gutters
      const gutterPx = 0;
      const a4WidthMm = 297;  // A4 landscape
      const a4HeightMm = 210;
      const sheetWidth = a4WidthMm * pxPerMm;
      const sheetHeight = a4HeightMm * pxPerMm;
      const safeMarginMm = 10; // 1cm safe zone
      const safeMarginPx = safeMarginMm * pxPerMm;
      
      // Draw 6 sheets (3 columns × 2 rows)
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const sheetNum = row * 3 + col + 1;
          const x = canvasMargin + col * (sheetWidth + gutterPx);
          const y = canvasMargin + row * (sheetHeight + gutterPx);
          
          // Draw sheet outline
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
          ctx.lineWidth = 2 / zoom;
          ctx.strokeRect(x, y, sheetWidth, sheetHeight);
          
          // Draw safe zone (grey margin 1cm inset)
          ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)'; // gray-400
          ctx.lineWidth = 1 / zoom;
          ctx.strokeRect(
            x + safeMarginPx, 
            y + safeMarginPx, 
            sheetWidth - 2 * safeMarginPx, 
            sheetHeight - 2 * safeMarginPx
          );
          
          // Draw sheet number
          ctx.fillStyle = 'rgba(100, 116, 139, 0.6)';
          ctx.font = `${12 / zoom}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`Sheet ${sheetNum}`, x + sheetWidth / 2, y + 5 / zoom);
        }
      }
      
      // Draw gutters (white gaps between sheets)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      // Vertical gutters
      for (let i = 0; i < 2; i++) {
        const x = canvasMargin + (i + 1) * sheetWidth + i * gutterPx;
        ctx.fillRect(x, canvasMargin, gutterPx, paperHeight);
      }
      // Horizontal gutter
      const y = canvasMargin + sheetHeight + gutterPx / 2;
      ctx.fillRect(canvasMargin, y - gutterPx / 2, paperWidth, gutterPx);
    } else {
      // Single sheet layout
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)'; // slate-500
      ctx.lineWidth = 3 / zoom;
      ctx.strokeRect(canvasMargin, canvasMargin, paperWidth, paperHeight);
    }
    
    // ArUco marker size (5cm = 50mm)
    const markerSizeMm = 50;
    const markerSize = markerSizeMm * pxPerMm;
    const markerInsetMm = 10; // 10mm inset from edge (inside safe zone)
    const markerInset = markerInsetMm * pxPerMm;
    
    // Position markers based on format
    let markers: Array<{ x: number; y: number; id: string; arucoId: number; }> = [];
    
    if (is6Page) {
      // 6-page format: markers only on corner sheets (1, 3, 4, 6)
      const gutterMm = 0;  // No gutters
      const gutterPx = 0;
      const a4WidthMm = 297;  // A4 landscape
      const a4HeightMm = 210;
      const sheetWidth = a4WidthMm * pxPerMm;
      const sheetHeight = a4HeightMm * pxPerMm;
      
      // Sheet 1 (top-left) - ArUco 17 at top-left corner
      const sheet1X = canvasMargin;
      const sheet1Y = canvasMargin;
      markers.push({ 
        x: sheet1X + markerInset, 
        y: sheet1Y + markerInset, 
        id: '1-A', 
        arucoId: 17 
      });
      
      // Sheet 3 (top-right) - ArUco 18 at top-right corner
      const sheet3X = canvasMargin + 2 * (sheetWidth + gutterPx);
      const sheet3Y = canvasMargin;
      markers.push({ 
        x: sheet3X + sheetWidth - markerSize - markerInset, 
        y: sheet3Y + markerInset, 
        id: '3-B', 
        arucoId: 18 
      });
      
      // Sheet 4 (bottom-left) - ArUco 20 at bottom-left corner
      const sheet4X = canvasMargin;
      const sheet4Y = canvasMargin + sheetHeight + gutterPx;
      markers.push({ 
        x: sheet4X + markerInset, 
        y: sheet4Y + sheetHeight - markerSize - markerInset, 
        id: '4-D', 
        arucoId: 20 
      });
      
      // Sheet 6 (bottom-right) - ArUco 19 at bottom-right corner
      const sheet6X = canvasMargin + 2 * (sheetWidth + gutterPx);
      const sheet6Y = canvasMargin + sheetHeight + gutterPx;
      markers.push({ 
        x: sheet6X + sheetWidth - markerSize - markerInset, 
        y: sheet6Y + sheetHeight - markerSize - markerInset, 
        id: '6-C', 
        arucoId: 19 
      });
    } else {
      // Standard layout: markers at extreme corners
      markers = [
        { x: canvasMargin, y: canvasMargin, id: 'A', arucoId: 17 },  // Top-left
        { x: canvasMargin + paperWidth - markerSize, y: canvasMargin, id: 'B', arucoId: 18 },  // Top-right
        { x: canvasMargin + paperWidth - markerSize, y: canvasMargin + paperHeight - markerSize, id: 'C', arucoId: 19 },  // Bottom-right
        { x: canvasMargin, y: canvasMargin + paperHeight - markerSize, id: 'D', arucoId: 20 },  // Bottom-left
      ];
    }
    
    // Draw ArUco markers
    markers.forEach(marker => {
      // Draw marker outline
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(marker.x, marker.y, markerSize, markerSize);
      
      // Draw marker ID and ArUco ID
      ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
      ctx.font = `${12 / zoom}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`ID${marker.arucoId}`, marker.x + markerSize / 2, marker.y + markerSize / 2);
    });

    // Draw template rectangles (black outlines)
    templateRectangles.forEach((rect) => {
      // xCm and yCm represent the CENTER of the rectangle
      const centerX = canvasMargin + cmToPixels(rect.xCm, true);
      const centerY = canvasMargin + cmToPixels(rect.yCm, false);
      const width = cmToPixels(rect.widthCm, true);
      const height = cmToPixels(rect.heightCm, false);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate((rect.rotation * Math.PI) / 180);

      // Draw rectangle (centered at origin after translation)
      const isSelected = selectedTemplateRect?.id === rect.id;
      ctx.strokeStyle = isSelected ? 'rgb(59, 130, 246)' : 'rgb(0, 0, 0)';
      ctx.lineWidth = isSelected ? 3 / zoom : 2 / zoom;
      ctx.strokeRect(-width / 2, -height / 2, width, height);

      // Draw category name label (at center)
      ctx.fillStyle = isSelected ? 'rgb(59, 130, 246)' : 'rgb(0, 0, 0)';
      ctx.font = `${10 / zoom}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rect.categoryName, 0, 0);

      ctx.restore();
    });

    // Slot drawing removed - slots are now auto-generated from templates during calibration
    
    // Restore context state
    ctx.restore();
  }, [regions, currentRegion, selectedRegion, zoom, panOffset, canvasDimensions, templateRectangles, selectedTemplateRect]);

  // Helper function to convert screen coordinates to canvas coordinates with zoom/pan
  const screenToCanvas = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const screenX = (event.clientX - rect.left) * scaleX;
    const screenY = (event.clientY - rect.top) * scaleY;
    
    // Apply inverse zoom and pan
    const x = (screenX - panOffset.x) / zoom;
    const y = (screenY - panOffset.y) / zoom;
    
    return { x, y };
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || isPanning) return;

    const { x, y } = screenToCanvas(event);

    if (!currentRegion) {
      // Start new region
      const newRegion: SlotRegion = {
        id: Date.now().toString(),
        slotId: `${String.fromCharCode(65 + regions.length)}${(regions.length % 6) + 1}`,
        points: [{ x, y }],
        toolName: '',
        expectedQrId: '',
        priority: 'high',
        allowCheckout: true,
        graceWindow: '08:30-16:30',
      };
      setCurrentRegion(newRegion);
    } else {
      // Add point to current region
      const updatedRegion = {
        ...currentRegion,
        points: [...currentRegion.points, { x, y }],
      };
      setCurrentRegion(updatedRegion);
    }
  };

  const handleRegionClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDrawing || isPanning) return;

    const { x, y } = screenToCanvas(event);

    // Check if click is inside any template rectangle first (using rotation-aware hit-testing)
    for (const rect of templateRectangles) {
      if (isPointInRotatedRect(x, y, rect)) {
        setSelectedTemplateRect(rect);
        setSelectedRegion(null);
        return;
      }
    }

    // Check if click is inside any slot region
    for (const region of regions) {
      if (isPointInPolygon({ x, y }, region.points)) {
        setSelectedRegion(region);
        setSelectedTemplateRect(null);
        return;
      }
    }
    
    setSelectedRegion(null);
    setSelectedTemplateRect(null);
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

  const isPointInRotatedRect = (px: number, py: number, rect: TemplateRectangle): boolean => {
    const canvasMargin = 40;
    // xCm and yCm represent the CENTER of the rectangle
    const centerX = canvasMargin + cmToPixels(rect.xCm, true);
    const centerY = canvasMargin + cmToPixels(rect.yCm, false);
    const rectWidth = cmToPixels(rect.widthCm, true);
    const rectHeight = cmToPixels(rect.heightCm, false);

    const dx = px - centerX;
    const dy = py - centerY;

    const angleRad = (rect.rotation * Math.PI) / 180;
    const rotatedX = dx * Math.cos(-angleRad) - dy * Math.sin(-angleRad);
    const rotatedY = dx * Math.sin(-angleRad) + dy * Math.cos(-angleRad);

    return Math.abs(rotatedX) <= rectWidth / 2 && Math.abs(rotatedY) <= rectHeight / 2;
  };

  const startNewSlot = () => {
    setIsDrawing(true);
    setCurrentRegion(null);
    setSelectedRegion(null);
  };

  const finishCurrentRegion = () => {
    if (currentRegion && currentRegion.points.length >= 3) {
      setRegions([...regions, currentRegion]);
      setSelectedRegion(currentRegion);
      setCurrentRegion(null);
      setIsDrawing(false);
    }
  };

  const cancelCurrentRegion = () => {
    setCurrentRegion(null);
    setIsDrawing(false);
  };

  const deleteSelectedRegion = () => {
    if (selectedRegion) {
      setRegions(regions.filter(r => r.id !== selectedRegion.id));
      setSelectedRegion(null);
    }
  };

  const saveSlotConfiguration = () => {
    if (!selectedRegion) return;

    const activeCamera = cameras?.find((c: any) => c.isActive);
    if (!activeCamera) {
      toast({
        title: "No Active Camera",
        description: "Please activate a camera first",
        variant: "destructive",
      });
      return;
    }

    const slotData = {
      slotId: selectedRegion.slotId,
      cameraId: activeCamera.id,
      toolName: selectedRegion.toolName,
      expectedQrId: selectedRegion.expectedQrId,
      priority: selectedRegion.priority,
      regionCoords: selectedRegion.points.map(p => [p.x, p.y]),
      allowCheckout: selectedRegion.allowCheckout,
      graceWindow: selectedRegion.graceWindow,
      isActive: true,
    };

    // Check if slot already exists
    const existingSlot = slots?.find((s: any) => s.slotId === selectedRegion.slotId);
    if (existingSlot) {
      updateSlotMutation.mutate({ id: existingSlot.id, data: slotData });
    } else {
      createSlotMutation.mutate(slotData);
    }
  };

  const updateSelectedRegion = (updates: Partial<SlotRegion>) => {
    if (!selectedRegion) return;
    
    const updated = { ...selectedRegion, ...updates };
    setSelectedRegion(updated);
    setRegions(regions.map(r => r.id === selectedRegion.id ? updated : r));
  };

  // Zoom handlers
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.2, 5));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.2, 0.5));
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(Math.max(prev * delta, 0.5), 5));
  };

  // Pan handlers
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: event.clientX - panOffset.x, y: event.clientY - panOffset.y });
      event.preventDefault();
      return;
    }

    // Check if clicking on a template rectangle to start dragging (using rotation-aware hit-testing)
    if (event.button === 0 && !isDrawing) {
      const { x, y } = screenToCanvas(event);

      for (const rect of templateRectangles) {
        if (isPointInRotatedRect(x, y, rect)) {
          setDraggingRectId(rect.id);
          setDragStartPos({ x, y });
          event.preventDefault();
          return;
        }
      }
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPanOffset({
        x: event.clientX - panStart.x,
        y: event.clientY - panStart.y,
      });
      return;
    }

    // Handle template rectangle dragging
    if (draggingRectId && dragStartPos) {
      const { x, y } = screenToCanvas(event);
      const canvasMargin = 40;
      
      const rect = templateRectangles.find(r => r.id === draggingRectId);
      if (!rect) return;

      const deltaX = x - dragStartPos.x;
      const deltaY = y - dragStartPos.y;

      const newXPixels = canvasMargin + cmToPixels(rect.xCm, true) + deltaX;
      const newYPixels = canvasMargin + cmToPixels(rect.yCm, false) + deltaY;

      let newXCm = snapToGrid(pixelsToCm(newXPixels - canvasMargin, true));
      let newYCm = snapToGrid(pixelsToCm(newYPixels - canvasMargin, false));

      // Constrain to sheet boundaries for 6-page format
      const constrained = constrainToSheet(newXCm, newYCm, rect.widthCm, rect.heightCm);
      newXCm = constrained.x;
      newYCm = constrained.y;

      // Update local state immediately for smooth dragging
      setTemplateRectangles(prev => prev.map(r => 
        r.id === draggingRectId ? { ...r, xCm: newXCm, yCm: newYCm } : r
      ));
      setDragStartPos({ x, y });
    }
  };

  const handleMouseUp = () => {
    if (draggingRectId) {
      // Save the new position to database
      const rect = templateRectangles.find(r => r.id === draggingRectId);
      if (rect) {
        updateTemplateRectMutation.mutate({
          id: rect.id,
          data: {
            categoryId: rect.categoryId,
            paperSize: paperSize,
            xCm: rect.xCm,
            yCm: rect.yCm,
            rotation: rect.rotation,
          }
        });
      }
      setDraggingRectId(null);
      setDragStartPos(null);
    }
    setIsPanning(false);
  };

  // Version save/load handlers
  const saveVersion = () => {
    if (!versionName.trim()) {
      toast({
        title: "Version Name Required",
        description: "Please enter a name for this version",
        variant: "destructive",
      });
      return;
    }

    const newVersion = {
      name: versionName,
      timestamp: new Date().toISOString(),
      regions: regions,
    };

    const updated = [...savedVersions, newVersion];
    setSavedVersions(updated);
    localStorage.setItem('slotConfigVersions', JSON.stringify(updated));
    
    toast({
      title: "Version Saved",
      description: `Configuration saved as "${versionName}"`,
    });
    
    setVersionName('');
  };

  const loadVersion = (version: typeof savedVersions[0]) => {
    setRegions(version.regions);
    setSelectedRegion(null);
    toast({
      title: "Version Loaded",
      description: `Loaded configuration "${version.name}"`,
    });
  };

  const deleteVersion = (timestamp: string) => {
    const updated = savedVersions.filter(v => v.timestamp !== timestamp);
    setSavedVersions(updated);
    localStorage.setItem('slotConfigVersions', JSON.stringify(updated));
    toast({
      title: "Version Deleted",
      description: "Configuration version removed",
    });
  };

  // Template version save/load handlers
  const saveTemplateVersion = () => {
    if (!templateVersionName.trim()) {
      toast({
        title: "Design Name Required",
        description: "Please enter a name for this template design",
        variant: "destructive",
      });
      return;
    }

    // templateRectangles are already filtered for current paper size by the query
    if (templateRectangles.length === 0) {
      toast({
        title: "No Templates to Save",
        description: "Add some tool templates before saving",
        variant: "destructive",
      });
      return;
    }

    // Get only the categories used in current templates
    const usedCategoryIds = new Set(templateRectangles.map(t => t.categoryId));
    const relevantCategories = toolCategories.filter((c: any) => usedCategoryIds.has(c.id));

    const newVersion = {
      name: templateVersionName,
      timestamp: new Date().toISOString(),
      paperSize: paperSize,
      cameraId: selectedCameraId,
      templateRectangles: templateRectangles,
      categories: relevantCategories,
    };

    const updated = [...savedTemplateVersions, newVersion];
    setSavedTemplateVersions(updated);
    localStorage.setItem('templateConfigVersions', JSON.stringify(updated));
    
    toast({
      title: "Template Design Saved",
      description: `"${paperSize} - ${templateVersionName}" saved with ${templateRectangles.length} tools`,
    });
    
    setTemplateVersionName('');
  };

  const loadTemplateVersion = async (version: typeof savedTemplateVersions[0]) => {
    try {
      // First, we need to ensure categories exist in the database
      for (const category of version.categories) {
        // Check if category exists, if not create it
        const existingCategory = toolCategories.find((c: any) => c.name === category.name);
        if (!existingCategory) {
          await apiRequest('POST', '/api/tool-categories', {
            name: category.name,
            toolType: category.toolType,
            widthCm: category.widthCm,
            heightCm: category.heightCm,
          });
        }
      }

      // Refresh categories
      await queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });

      // Fetch existing template rectangles for the TARGET paper size
      const response = await fetch(`/api/template-rectangles?paperSize=${version.paperSize}`);
      if (!response.ok) {
        throw new Error('Failed to fetch existing template rectangles');
      }
      const existingRects = await response.json();

      // Delete existing template rectangles for the target paper size
      for (const rect of existingRects) {
        await apiRequest('DELETE', `/api/template-rectangles/${rect.id}`);
      }

      // Set paper size AFTER deletion so state is consistent
      setPaperSize(version.paperSize);

      // Create new template rectangles
      for (const rect of version.templateRectangles) {
        await apiRequest('POST', '/api/template-rectangles', {
          categoryId: rect.categoryId,
          paperSize: version.paperSize,
          xCm: rect.xCm,
          yCm: rect.yCm,
          rotation: rect.rotation,
          autoQrId: rect.autoQrId,
        });
      }

      // Refresh template rectangles to show the loaded design
      await queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles'] });
      setSelectedTemplateRect(null);

      toast({
        title: "Template Design Loaded",
        description: `Loaded "${version.paperSize} - ${version.name}" with ${version.templateRectangles.length} tools`,
      });
    } catch (error) {
      toast({
        title: "Load Failed",
        description: "Failed to load template design",
        variant: "destructive",
      });
    }
  };

  const deleteTemplateVersion = (timestamp: string) => {
    const versionToDelete = savedTemplateVersions.find(v => v.timestamp === timestamp);
    const updated = savedTemplateVersions.filter(v => v.timestamp !== timestamp);
    setSavedTemplateVersions(updated);
    localStorage.setItem('templateConfigVersions', JSON.stringify(updated));
    toast({
      title: "Template Design Deleted",
      description: versionToDelete ? `"${versionToDelete.paperSize} - ${versionToDelete.name}" removed` : "Design removed",
    });
  };
  
  const previewTemplateVersion = (version: any) => {
    setPreviewTemplate(version);
    setShowPreviewDialog(true);
  };

  const addTemplateRectangle = async (categoryId: string) => {
    const category = toolCategories.find((c: any) => c.id === categoryId);
    if (!category) return;

    // Generate unique QR ID
    const categoryRects = templateRectangles.filter(r => r.categoryId === categoryId);
    const nextIndex = categoryRects.length + 1;
    const qrId = `${category.name}-${String(nextIndex).padStart(3, '0')}`;

    try {
      // Show loading toast
      toast({
        title: "Generating QR Code",
        description: `Creating QR code for ${qrId}...`,
      });

      // Call QR generation API
      const qrResponse = await apiRequest('POST', '/api/qr-generate', {
        type: 'slot',
        id: qrId,
        toolType: category.toolType,
        errorCorrection: 'L',
        moduleSize: 25,
        includeHmac: true,
      });

      const qrData = await qrResponse.json();

      // Place at center of canvas
      const canvasMargin = 40;
      const paperWidth = canvasDimensions.width - (canvasMargin * 2);
      const paperHeight = canvasDimensions.height - (canvasMargin * 2);
      
      const centerXPixels = paperWidth / 2;
      const centerYPixels = paperHeight / 2;
      
      const centerXCm = snapToGrid(pixelsToCm(centerXPixels, true));
      const centerYCm = snapToGrid(pixelsToCm(centerYPixels, false));

      createTemplateRectMutation.mutate({
        categoryId: categoryId,
        cameraId: selectedCameraId,
        paperSize: paperSize,
        xCm: centerXCm,
        yCm: centerYCm,
        rotation: 0,
        autoQrId: qrId,
      });

      // Show success toast
      toast({
        title: "QR Code Generated",
        description: `Successfully created QR code: ${qrId}`,
      });
    } catch (error) {
      toast({
        title: "Failed to Generate QR",
        description: error instanceof Error ? error.message : "Failed to generate QR code",
        variant: "destructive",
      });
    }
  };

  const deleteSelectedTemplateRect = () => {
    if (selectedTemplateRect) {
      deleteTemplateRectMutation.mutate(selectedTemplateRect.id);
    }
  };

  const rotateTemplateLeft = () => {
    if (!selectedTemplateRect) return;
    
    const currentRotation = selectedTemplateRect.rotation || 0;
    const newRotation = currentRotation - 45 < 0 ? 315 : currentRotation - 45;
    
    setTemplateRectangles(prev => prev.map(r => 
      r.id === selectedTemplateRect.id ? { ...r, rotation: newRotation } : r
    ));
    setSelectedTemplateRect({ ...selectedTemplateRect, rotation: newRotation });
    
    updateTemplateRectMutation.mutate({
      id: selectedTemplateRect.id,
      data: {
        categoryId: selectedTemplateRect.categoryId,
        paperSize: paperSize,
        xCm: selectedTemplateRect.xCm,
        yCm: selectedTemplateRect.yCm,
        rotation: newRotation,
      }
    });
  };

  const rotateTemplateRight = () => {
    if (!selectedTemplateRect) return;
    
    const currentRotation = selectedTemplateRect.rotation || 0;
    const newRotation = currentRotation + 45 >= 360 ? 0 : currentRotation + 45;
    
    setTemplateRectangles(prev => prev.map(r => 
      r.id === selectedTemplateRect.id ? { ...r, rotation: newRotation } : r
    ));
    setSelectedTemplateRect({ ...selectedTemplateRect, rotation: newRotation });
    
    updateTemplateRectMutation.mutate({
      id: selectedTemplateRect.id,
      data: {
        categoryId: selectedTemplateRect.categoryId,
        paperSize: paperSize,
        xCm: selectedTemplateRect.xCm,
        yCm: selectedTemplateRect.yCm,
        rotation: newRotation,
      }
    });
  };

  const configuredSlotIds = slots?.map((s: any) => s.slotId) || [];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="slot-drawing-title">
                Template Design
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Design your tool layout - ArUco markers, templates, and QR codes on one sheet</p>
            </div>
            <Button variant="outline" size="sm" data-testid="button-close-slot-drawing">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Drawing Canvas */}
            <div>
              {/* Paper Size & Camera Selector */}
              <div className="mb-4 flex items-center gap-3 justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-3">
                    <Label htmlFor="camera-select" className="text-sm font-medium">Camera:</Label>
                    <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
                      <SelectTrigger className="w-48" id="camera-select" data-testid="select-camera">
                        <SelectValue placeholder="Select camera" />
                      </SelectTrigger>
                      <SelectContent>
                        {cameras?.map((camera: any) => (
                          <SelectItem key={camera.id} value={camera.id}>
                            {camera.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3">
                    <Label htmlFor="paper-size" className="text-sm font-medium">Paper Size:</Label>
                    <Select value={paperSize} onValueChange={setPaperSize}>
                      <SelectTrigger className="w-48" id="paper-size" data-testid="select-paper-size">
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
                      Match your ArUco grid paper size
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowCategoryManager(true)}
                    data-testid="button-category-manager"
                  >
                    <Layers className="w-4 h-4 mr-2" />
                    Tool Categories
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setLocation('/template-print')}
                    data-testid="button-print-preview"
                    disabled={templateRectangles.length === 0}
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print Preview
                  </Button>
                </div>
              </div>

              <div className="canvas-container mb-4 flex justify-center">
                <canvas 
                  ref={canvasRef}
                  width={canvasDimensions.width}
                  height={canvasDimensions.height}
                  className="drawing-canvas rounded bg-muted"
                  style={{ 
                    cursor: isPanning ? 'grabbing' : 'grab',
                    maxWidth: '100%',
                    height: 'auto'
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                  data-testid="slot-canvas"
                />
              </div>
              
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline"
                    onClick={handleZoomIn}
                    data-testid="button-zoom-in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  
                  <Button 
                    variant="outline"
                    onClick={handleZoomOut}
                    data-testid="button-zoom-out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  
                  <div className="px-3 py-1 bg-muted rounded text-sm font-mono">
                    {Math.round(zoom * 100)}%
                  </div>
                </div>
              </div>

                {/* Template Rectangles */}
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Layers className="w-4 h-4" />
                      Template Tool Outlines
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {toolCategories && toolCategories.length > 0 ? (
                      <div className="grid grid-cols-1 gap-2">
                        {toolCategories.map((category: any) => (
                          <div
                            key={category.id}
                            className="flex items-center justify-between p-3 bg-muted rounded-lg"
                          >
                            <div className="flex-1">
                              <p className="font-medium text-sm">{category.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {category.toolType} • {category.widthCm}×{category.heightCm} cm
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => addTemplateRectangle(category.id)}
                              disabled={createTemplateRectMutation.isPending}
                              data-testid={`button-add-template-${category.id}`}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-muted-foreground">
                          No tool categories defined. Create categories to add template rectangles.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => setShowCategoryManager(true)}
                          data-testid="button-manage-categories"
                        >
                          Manage Categories
                        </Button>
                      </div>
                    )}

                    {/* Selected Template Rectangle Info */}
                    {selectedTemplateRect && (
                      <div className="border-t pt-3 mt-3">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-blue-500">Selected Template</h4>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={deleteSelectedTemplateRect}
                              disabled={deleteTemplateRectMutation.isPending}
                              data-testid="button-delete-template"
                            >
                              <Trash className="w-4 h-4" />
                            </Button>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p><span className="font-medium">Category:</span> {selectedTemplateRect.categoryName}</p>
                            <p><span className="font-medium">Size:</span> {selectedTemplateRect.widthCm}×{selectedTemplateRect.heightCm} cm</p>
                            <p><span className="font-medium">Position:</span> ({selectedTemplateRect.xCm.toFixed(1)}, {selectedTemplateRect.yCm.toFixed(1)}) cm</p>
                            <p><span className="font-medium">Rotation:</span> {selectedTemplateRect.rotation || 0}°</p>
                          </div>
                          
                          <div className="mt-3 pt-3 border-t border-blue-500/20">
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={rotateTemplateLeft}
                                disabled={updateTemplateRectMutation.isPending}
                                data-testid="button-rotate-left"
                                className="flex-1"
                              >
                                <RotateCcw className="w-4 h-4 mr-1" />
                                Rotate Left
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={rotateTemplateRight}
                                disabled={updateTemplateRectMutation.isPending}
                                data-testid="button-rotate-right"
                                className="flex-1"
                              >
                                <RotateCw className="w-4 h-4 mr-1" />
                                Rotate Right
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground text-center mt-2">
                              Rotate by 45° increments
                            </p>
                          </div>
                          
                          <p className="text-xs text-muted-foreground mt-2 italic">
                            Drag to reposition (snaps to 0.5cm grid)
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Template Rectangles Count */}
                    {templateRectangles.length > 0 && (
                      <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                        {templateRectangles.length} template{templateRectangles.length !== 1 ? 's' : ''} placed
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Template Version Management */}
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Clock className="w-4 h-4" />
                      Template Designs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Save Template Design */}
                      <div className="flex gap-2">
                        <Input
                          placeholder="Design name (e.g., Workshop Layout)"
                          value={templateVersionName}
                          onChange={(e) => setTemplateVersionName(e.target.value)}
                          data-testid="input-template-version-name"
                        />
                        <Button onClick={saveTemplateVersion} data-testid="button-save-template-version">
                          <Save className="w-4 h-4 mr-2" />
                          Save
                        </Button>
                      </div>

                      {/* Saved Template Designs List */}
                      {savedTemplateVersions.length > 0 && (
                        <div className="border rounded-lg p-3 space-y-2">
                          <p className="text-sm font-medium">Saved Designs ({savedTemplateVersions.length})</p>
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {savedTemplateVersions.map((version) => (
                              <div
                                key={version.timestamp}
                                className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                              >
                                <div className="flex-1">
                                  <p className="font-medium">{version.paperSize} - {version.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {new Date(version.timestamp).toLocaleString()} • {version.templateRectangles.length} tools
                                  </p>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => previewTemplateVersion(version)}
                                    data-testid={`button-preview-template-version-${version.timestamp}`}
                                    title="Preview template overlay"
                                  >
                                    <Eye className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => loadTemplateVersion(version)}
                                    data-testid={`button-load-template-version-${version.timestamp}`}
                                    title="Load template"
                                  >
                                    <Download className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => deleteTemplateVersion(version.timestamp)}
                                    data-testid={`button-delete-template-version-${version.timestamp}`}
                                    title="Delete template"
                                  >
                                    <Trash className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

            </div>
          </div>
        </div>
      </main>
      
      <CategoryManager
        open={showCategoryManager}
        onOpenChange={setShowCategoryManager}
      />
      
      {/* Template Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Template Preview: {previewTemplate?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {previewTemplate && (
              <div className="space-y-3">
                <TemplatePreviewCanvas 
                  template={previewTemplate}
                  paperDimensions={paperDimensions}
                />
                <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3">
                  <p className="text-sm text-muted-foreground">
                    <strong>Paper Size:</strong> {previewTemplate.paperSize}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <strong>Tools:</strong> {previewTemplate.templateRectangles?.length || 0} items
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    ℹ️ This shows your template layout. Print the ArUco markers and place tools in the magenta areas.
                  </p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
