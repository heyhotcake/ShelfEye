import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Plus, Undo, Trash, ZoomIn, ZoomOut, Move, X, Save, Download, Upload, Clock, Layers } from "lucide-react";
import { CategoryManager } from "@/components/modals/category-manager";

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

export default function SlotDrawing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<SlotRegion | null>(null);
  const [regions, setRegions] = useState<SlotRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<SlotRegion | null>(null);
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Version management
  const [showVersions, setShowVersions] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [savedVersions, setSavedVersions] = useState<Array<{
    name: string;
    timestamp: string;
    regions: SlotRegion[];
  }>>([]);
  
  // Category manager
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  
  // Paper size configuration
  const [paperSize, setPaperSize] = useState('A4-landscape');
  
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
  };
  
  const canvasDimensions = paperDimensions[paperSize] || paperDimensions['A4-landscape'];

  const { data: cameras } = useQuery<any[]>({
    queryKey: ['/api/cameras'],
  });

  const { data: slots } = useQuery<any[]>({
    queryKey: ['/api/slots'],
  });

  // Load saved versions from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('slotConfigVersions');
    if (saved) {
      try {
        setSavedVersions(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved versions:', e);
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
    
    // Draw paper outline with margins
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)'; // slate-500
    ctx.lineWidth = 3 / zoom;
    ctx.strokeRect(canvasMargin, canvasMargin, paperWidth, paperHeight);
    
    // Calculate 3cm border in pixels (relative to paper size)
    const paperInfo = paperDimensions[paperSize] || paperDimensions['A4-landscape'];
    const pxPerMm = paperWidth / paperInfo.realWidthMm;
    const borderMm = 30; // 3cm = 30mm
    const borderPx = borderMm * pxPerMm;
    
    // ArUco marker size (typically 5cm = 50mm)
    const markerSizeMm = 50;
    const markerSize = markerSizeMm * pxPerMm;
    
    // Position markers 3cm from paper edges
    const markers = [
      { x: canvasMargin + borderPx, y: canvasMargin + borderPx, id: '17' },  // Top-left
      { x: canvasMargin + paperWidth - borderPx - markerSize, y: canvasMargin + borderPx, id: '18' },  // Top-right
      { x: canvasMargin + paperWidth - borderPx - markerSize, y: canvasMargin + paperHeight - borderPx - markerSize, id: '19' },  // Bottom-right
      { x: canvasMargin + borderPx, y: canvasMargin + paperHeight - borderPx - markerSize, id: '20' },  // Bottom-left
    ];
    
    markers.forEach(marker => {
      // Draw marker outline
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(marker.x, marker.y, markerSize, markerSize);
      
      // Draw marker ID
      ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
      ctx.font = `${14 / zoom}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(marker.id, marker.x + markerSize / 2, marker.y + markerSize / 2);
    });
    
    // Draw grid area outline (area between markers)
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)'; // green
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    const gridX1 = canvasMargin + borderPx + markerSize;
    const gridY1 = canvasMargin + borderPx + markerSize;
    const gridX2 = canvasMargin + paperWidth - borderPx;
    const gridY2 = canvasMargin + paperHeight - borderPx;
    ctx.moveTo(gridX1, gridY1);
    ctx.lineTo(gridX2, gridY1);
    ctx.lineTo(gridX2, gridY2);
    ctx.lineTo(gridX1, gridY2);
    ctx.closePath();
    ctx.stroke();

    // Draw existing regions
    regions.forEach((region, index) => {
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
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();

        // Draw label
        const centerX = region.points.reduce((sum, p) => sum + p.x, 0) / region.points.length;
        const centerY = region.points.reduce((sum, p) => sum + p.y, 0) / region.points.length;
        
        ctx.fillStyle = 'white';
        ctx.font = `${12 / zoom}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(region.slotId, centerX, centerY);
      }
    });

    // Draw current region being drawn
    if (currentRegion && currentRegion.points.length > 0) {
      ctx.strokeStyle = 'rgb(239, 68, 68)';
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.moveTo(currentRegion.points[0].x, currentRegion.points[0].y);
      currentRegion.points.forEach(point => ctx.lineTo(point.x, point.y));
      if (currentRegion.points.length > 2) {
        ctx.closePath();
      }
      ctx.stroke();

      // Draw points
      currentRegion.points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4 / zoom, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgb(239, 68, 68)';
        ctx.fill();
      });
    }
    
    // Restore context state
    ctx.restore();
  }, [regions, currentRegion, selectedRegion, zoom, panOffset, canvasDimensions]);

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

    // Check if click is inside any region
    for (const region of regions) {
      if (isPointInPolygon({ x, y }, region.points)) {
        setSelectedRegion(region);
        return;
      }
    }
    
    setSelectedRegion(null);
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
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPanOffset({
        x: event.clientX - panStart.x,
        y: event.clientY - panStart.y,
      });
    }
  };

  const handleMouseUp = () => {
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

  const configuredSlotIds = slots?.map((s: any) => s.slotId) || [];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="slot-drawing-title">
                Draw Slot Regions
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Click to define slot boundaries on the rectified image</p>
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
              {/* Paper Size Selector */}
              <div className="mb-4 flex items-center gap-3 justify-between">
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
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Match your ArUco grid paper size
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowCategoryManager(true)}
                  data-testid="button-category-manager"
                >
                  <Layers className="w-4 h-4 mr-2" />
                  Tool Categories
                </Button>
              </div>

              <div className="canvas-container mb-4 flex justify-center">
                <canvas 
                  ref={canvasRef}
                  width={canvasDimensions.width}
                  height={canvasDimensions.height}
                  className="drawing-canvas rounded bg-muted"
                  style={{ 
                    cursor: isPanning ? 'grabbing' : isDrawing ? 'crosshair' : 'grab',
                    maxWidth: '100%',
                    height: 'auto'
                  }}
                  onClick={isDrawing ? handleCanvasClick : handleRegionClick}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                  data-testid="slot-canvas"
                />
              </div>
              
              <div className="flex items-center gap-3">
                <Button 
                  className="flex-1"
                  onClick={startNewSlot}
                  disabled={isDrawing}
                  data-testid="button-new-slot"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Slot
                </Button>
                
                {isDrawing && currentRegion && currentRegion.points.length >= 3 && (
                  <Button 
                    onClick={finishCurrentRegion}
                    data-testid="button-finish-region"
                  >
                    <Save className="w-4 h-4" />
                  </Button>
                )}
                
                <Button 
                  variant="outline"
                  onClick={isDrawing ? cancelCurrentRegion : () => {}}
                  disabled={!isDrawing && !selectedRegion}
                  data-testid="button-undo"
                >
                  <Undo className="w-4 h-4" />
                </Button>
                
                <Button 
                  variant="outline"
                  onClick={deleteSelectedRegion}
                  disabled={!selectedRegion}
                  data-testid="button-delete"
                >
                  <Trash className="w-4 h-4" />
                </Button>
                
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

                {/* Drawing Instructions */}
                {isDrawing && (
                  <Card className="mt-4">
                    <CardContent className="p-4">
                      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                        <h4 className="text-sm font-medium text-blue-500 mb-2">Drawing Mode Active</h4>
                        <p className="text-sm text-muted-foreground">
                          Click to add points to define the slot boundary. 
                          {currentRegion && currentRegion.points.length >= 3 
                            ? ' Click the save button to finish this region.' 
                            : ` Need at least 3 points (${currentRegion?.points.length || 0}/3).`
                          }
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Version Management */}
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Clock className="w-4 h-4" />
                      Configuration Versions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Save Version */}
                      <div className="flex gap-2">
                        <Input
                          placeholder="Version name (e.g., Workshop Layout v1)"
                          value={versionName}
                          onChange={(e) => setVersionName(e.target.value)}
                          data-testid="input-version-name"
                        />
                        <Button onClick={saveVersion} data-testid="button-save-version">
                          <Save className="w-4 h-4 mr-2" />
                          Save
                        </Button>
                      </div>

                      {/* Saved Versions List */}
                      {savedVersions.length > 0 && (
                        <div className="border rounded-lg p-3 space-y-2">
                          <p className="text-sm font-medium">Saved Versions ({savedVersions.length})</p>
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {savedVersions.map((version) => (
                              <div
                                key={version.timestamp}
                                className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                              >
                                <div className="flex-1">
                                  <p className="font-medium">{version.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {new Date(version.timestamp).toLocaleString()} • {version.regions.length} regions
                                  </p>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => loadVersion(version)}
                                    data-testid={`button-load-version-${version.timestamp}`}
                                  >
                                    <Download className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => deleteVersion(version.timestamp)}
                                    data-testid={`button-delete-version-${version.timestamp}`}
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
            
            {/* Slot Configuration */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedRegion ? `Slot ${selectedRegion.slotId}` : 'Select a Slot'}
                </CardTitle>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {selectedRegion ? (
                  <>
                    <div>
                      <Label htmlFor="slotId">Slot ID</Label>
                      <Input 
                        id="slotId"
                        value={selectedRegion.slotId}
                        onChange={(e) => updateSelectedRegion({ slotId: e.target.value })}
                        data-testid="input-slot-id"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="toolName">Tool Name</Label>
                      <Input 
                        id="toolName"
                        placeholder="e.g., Scissors"
                        value={selectedRegion.toolName}
                        onChange={(e) => updateSelectedRegion({ toolName: e.target.value })}
                        data-testid="input-tool-name"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="expectedQrId">Expected QR ID</Label>
                      <Input 
                        id="expectedQrId"
                        placeholder="e.g., S001"
                        value={selectedRegion.expectedQrId}
                        onChange={(e) => updateSelectedRegion({ expectedQrId: e.target.value })}
                        data-testid="input-expected-qr"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="graceWindow">Grace Window</Label>
                      <Input 
                        id="graceWindow"
                        value={selectedRegion.graceWindow}
                        onChange={(e) => updateSelectedRegion({ graceWindow: e.target.value })}
                        placeholder="e.g., 08:30-16:30"
                        data-testid="input-grace-window"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Time range when slot is monitored (HH:MM-HH:MM format)
                      </p>
                    </div>
                    
                    <div className="pt-4 border-t border-border">
                      <p className="text-xs text-muted-foreground">
                        All slots set to: <span className="font-medium text-foreground">High Priority</span> • <span className="font-medium text-foreground">Checkout Allowed</span>
                      </p>
                    </div>
                    
                    <div className="flex gap-2 mt-6">
                      <Button 
                        className="flex-1"
                        onClick={saveSlotConfiguration}
                        disabled={!selectedRegion.toolName || createSlotMutation.isPending || updateSlotMutation.isPending}
                        data-testid="button-save-slot"
                      >
                        {createSlotMutation.isPending || updateSlotMutation.isPending 
                          ? 'Saving...' 
                          : 'Save Slot Configuration'
                        }
                      </Button>
                      
                      {/* Show delete button only for existing saved slots */}
                      {slots?.some((s: any) => s.id === selectedRegion.id) && (
                        <Button 
                          variant="destructive"
                          onClick={() => deleteSlotMutation.mutate(selectedRegion.id)}
                          disabled={deleteSlotMutation.isPending}
                          data-testid="button-delete-slot"
                        >
                          <Trash className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      Click on a slot region to configure it, or create a new slot region.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Configured Slots List */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Configured Slots ({configuredSlotIds.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                  {configuredSlotIds.map((slotId: string) => (
                    <Badge 
                      key={slotId}
                      className="px-3 py-2 bg-green-500/20 border border-green-500/30 text-green-500 text-center justify-center"
                      data-testid={`configured-slot-${slotId}`}
                    >
                      {slotId}
                    </Badge>
                  ))}
                  
                  {configuredSlotIds.length === 0 && (
                    <p className="col-span-full text-muted-foreground text-sm text-center py-4">
                      No slots configured yet. Draw slot regions on the camera image above.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      
      <CategoryManager
        open={showCategoryManager}
        onOpenChange={setShowCategoryManager}
      />
    </div>
  );
}
