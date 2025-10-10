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
import { Plus, Undo, Trash, ZoomIn, X, Save } from "lucide-react";

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

  const { data: cameras } = useQuery({
    queryKey: ['/api/cameras'],
  });

  const { data: slots } = useQuery({
    queryKey: ['/api/slots'],
  });

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

    // Draw current region being drawn
    if (currentRegion && currentRegion.points.length > 0) {
      ctx.strokeStyle = 'rgb(239, 68, 68)';
      ctx.lineWidth = 2;
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
        ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgb(239, 68, 68)';
        ctx.fill();
      });
    }
  }, [regions, currentRegion, selectedRegion]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Scale coordinates from display size to canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    if (!currentRegion) {
      // Start new region
      const newRegion: SlotRegion = {
        id: Date.now().toString(),
        slotId: `${String.fromCharCode(65 + regions.length)}${(regions.length % 6) + 1}`,
        points: [{ x, y }],
        toolName: '',
        expectedQrId: '',
        priority: 'medium',
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
    if (isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Scale coordinates from display size to canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

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
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Drawing Canvas */}
              <div className="lg:col-span-2">
                <div className="canvas-container mb-4">
                  <canvas 
                    ref={canvasRef}
                    width={800}
                    height={600}
                    className="w-full drawing-canvas rounded bg-muted cursor-crosshair"
                    onClick={isDrawing ? handleCanvasClick : handleRegionClick}
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
                    data-testid="button-zoom"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
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
              </div>
              
              {/* Slot Configuration */}
              <div>
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
                          <Label htmlFor="priority">Priority</Label>
                          <Select 
                            value={selectedRegion.priority} 
                            onValueChange={(value) => updateSelectedRegion({ priority: value as any })}
                          >
                            <SelectTrigger data-testid="select-priority">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="low">Low</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="pt-4 border-t border-border">
                          <h4 className="text-sm font-semibold text-foreground mb-3">Business Rules</h4>
                          
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <Checkbox 
                                id="allowCheckout"
                                checked={selectedRegion.allowCheckout}
                                onCheckedChange={(checked) => updateSelectedRegion({ allowCheckout: !!checked })}
                                data-testid="checkbox-allow-checkout"
                              />
                              <Label htmlFor="allowCheckout" className="text-sm text-foreground">
                                Allow checkout
                              </Label>
                            </div>
                            
                            <div>
                              <Label htmlFor="graceWindow">Grace Window</Label>
                              <Input 
                                id="graceWindow"
                                value={selectedRegion.graceWindow}
                                onChange={(e) => updateSelectedRegion({ graceWindow: e.target.value })}
                                data-testid="input-grace-window"
                              />
                            </div>
                          </div>
                        </div>
                        
                        <Button 
                          className="w-full mt-6"
                          onClick={saveSlotConfiguration}
                          disabled={!selectedRegion.toolName || createSlotMutation.isPending || updateSlotMutation.isPending}
                          data-testid="button-save-slot"
                        >
                          {createSlotMutation.isPending || updateSlotMutation.isPending 
                            ? 'Saving...' 
                            : 'Save Slot Configuration'
                          }
                        </Button>
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
              </div>
            </div>
            
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
    </div>
  );
}
