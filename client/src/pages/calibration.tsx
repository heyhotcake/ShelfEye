import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Camera, CheckCircle, Ruler, X } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";

const TIMEZONE = "Asia/Tokyo";

interface CalibrationResult {
  ok: boolean;
  homographyMatrix: number[];
  reprojectionError: number;
  markersDetected: number;
}

interface CameraPreview {
  ok: boolean;
  image?: string;
  error?: string;
  width?: number;
  height?: number;
}

export default function Calibration() {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);

  const formatJSTTimestamp = (timestamp: string | Date) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    const zonedDate = toZonedTime(date, TIMEZONE);
    return format(zonedDate, "yyyy-MM-dd HH:mm:ss", { timeZone: TIMEZONE });
  };

  const { data: cameras } = useQuery<any[]>({
    queryKey: ['/api/cameras'],
  });

  const { data: templateRectangles } = useQuery<any[]>({
    queryKey: ['/api/template-rectangles'],
    queryFn: async () => {
      const response = await fetch('/api/template-rectangles');
      return response.json();
    },
  });

  const activeCamera = cameras?.find((c: any) => c.isActive);

  // Clear calibration result when active camera changes
  useEffect(() => {
    setCalibrationResult(null);
  }, [activeCamera?.id]);

  // Camera preview - poll every 1 second, but pause during calibration
  const { data: preview } = useQuery<CameraPreview>({
    queryKey: ['/api/camera-preview', activeCamera?.id],
    enabled: !!activeCamera?.id,
    refetchInterval: 1000,
  });

  // Rectified preview - fetch after successful calibration
  const { data: rectifiedPreview, refetch: refetchRectified } = useQuery<CameraPreview>({
    queryKey: ['/api/rectified-preview', activeCamera?.id],
    queryFn: async () => {
      if (!activeCamera?.id) throw new Error('No active camera');
      const response = await fetch(`/api/rectified-preview/${activeCamera.id}`);
      if (!response.ok) throw new Error('Failed to fetch rectified preview');
      return response.json();
    },
    enabled: false, // Don't auto-fetch, trigger manually after calibration
  });

  const calibrationMutation = useMutation({
    mutationFn: (cameraId: string) => apiRequest('POST', `/api/calibrate/${cameraId}`),
    onSuccess: async (response) => {
      const data: CalibrationResult = await response.json();
      setCalibrationResult(data);
      toast({
        title: "Calibration Successful",
        description: `Markers detected: ${data.markersDetected}, Error: ${data.reprojectionError.toFixed(2)} px`,
      });
      // Invalidate cameras query to update calibration badge
      queryClient.invalidateQueries({ queryKey: ['/api/cameras'] });
      // Fetch rectified preview after successful calibration
      refetchRectified();
    },
    onError: (error) => {
      toast({
        title: "Calibration Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="calibration-title">
                Camera Calibration
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Position camera to see all 4 corner markers (A/B/C/D)</p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              data-testid="button-close-calibration"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Live View */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-3">Live Camera View</h3>
                <div className="canvas-container">
                  <div className="aspect-[4/3] bg-muted rounded relative overflow-hidden">
                    {preview?.ok && preview?.image ? (
                      <img 
                        src={preview.image} 
                        alt="Camera preview" 
                        className="w-full h-full object-contain"
                        data-testid="img-camera-preview"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                        <div className="text-center">
                          <Camera className="w-12 h-12 text-muted-foreground mx-auto mb-2 animate-pulse" />
                          <p className="text-sm text-muted-foreground">
                            {preview?.error ? `Error: ${preview.error}` : 'Loading camera feed...'}
                          </p>
                        </div>
                      </div>
                    )}
                    
                    {/* ArUco markers overlay - shown when camera is visible */}
                    {preview?.ok && (
                      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 800 600">
                        {/* Corner markers A/B/C/D (clockwise from top-left) */}
                        <rect x="100" y="100" width="50" height="50" fill="hsl(217, 91%, 60%)" opacity="0.3"/>
                        <text x="115" y="130" fill="white" fontSize="18" fontWeight="bold">A</text>
                        
                        <rect x="650" y="100" width="50" height="50" fill="hsl(217, 91%, 60%)" opacity="0.3"/>
                        <text x="665" y="130" fill="white" fontSize="18" fontWeight="bold">B</text>
                        
                        <rect x="650" y="450" width="50" height="50" fill="hsl(217, 91%, 60%)" opacity="0.3"/>
                        <text x="665" y="480" fill="white" fontSize="18" fontWeight="bold">C</text>
                        
                        <rect x="100" y="450" width="50" height="50" fill="hsl(217, 91%, 60%)" opacity="0.3"/>
                        <text x="115" y="480" fill="white" fontSize="18" fontWeight="bold">D</text>
                        
                        {/* Grid outline */}
                        <polyline 
                          points="125,125 675,125 675,475 125,475 125,125" 
                          fill="none" 
                          stroke="hsl(142, 76%, 45%)" 
                          strokeWidth="2"
                        />
                      </svg>
                    )}
                  </div>
                </div>
                
                <div className="mt-4 space-y-2">
                  <Card>
                    <CardContent className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <span className="text-sm text-foreground">Markers Detected</span>
                      </div>
                      <span className="text-sm font-mono text-foreground" data-testid="text-markers-detected">
                        {calibrationResult ? `${calibrationResult.markersDetected}/4` : '-'}
                      </span>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-2">
                        <Ruler className="w-5 h-5 text-primary" />
                        <span className="text-sm text-foreground">Reprojection Error</span>
                      </div>
                      <span className="text-sm font-mono text-foreground" data-testid="text-reprojection-error">
                        {calibrationResult ? `${calibrationResult.reprojectionError.toFixed(2)} px` : '-'}
                      </span>
                    </CardContent>
                  </Card>
                </div>
              </div>
              
              {/* Configuration */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-3">Calibration Settings</h3>
                
                <div className="space-y-6">
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Active Camera</label>
                    <Select value={activeCamera?.id || ""} disabled>
                      <SelectTrigger data-testid="select-active-camera">
                        <SelectValue placeholder="No active camera" />
                      </SelectTrigger>
                      <SelectContent>
                        {cameras?.map((camera: any) => (
                          <SelectItem key={camera.id} value={camera.id}>
                            {camera.name} (Device {camera.deviceIndex})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Template Design (optional)</label>
                    <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                      <SelectTrigger data-testid="select-template">
                        <SelectValue placeholder="Select template to preview" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No template overlay</SelectItem>
                        {templateRectangles && templateRectangles.length > 0 && (
                          templateRectangles.map((template: any) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.paperSize} - {template.categoryName || template.id.slice(0, 8)}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a template to preview tool positions on the camera feed
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-foreground">Calibration Status</h4>
                    
                    {activeCamera?.homographyMatrix ? (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="text-sm font-medium text-green-500">Calibrated</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Last calibrated: {activeCamera.calibrationTimestamp 
                            ? formatJSTTimestamp(activeCamera.calibrationTimestamp)
                            : 'Unknown'}
                        </p>
                      </div>
                    ) : (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Camera className="w-4 h-4 text-amber-500" />
                          <span className="text-sm font-medium text-amber-500">Not Calibrated</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Run calibration to enable slot detection
                        </p>
                      </div>
                    )}
                  </div>

                  <Button 
                    className="w-full"
                    onClick={() => activeCamera && calibrationMutation.mutate(activeCamera.id)}
                    disabled={!activeCamera || calibrationMutation.isPending}
                    data-testid="button-start-calibration"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    {calibrationMutation.isPending ? 'Calibrating...' : 'Start Calibration'}
                  </Button>
                </div>
                
                {/* Rectified Preview */}
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-foreground mb-3">Rectified Preview</h4>
                  <div className="canvas-container">
                    <div className="aspect-[4/3] bg-muted rounded overflow-hidden">
                      {rectifiedPreview?.ok && rectifiedPreview?.image ? (
                        <img 
                          src={rectifiedPreview.image} 
                          alt="Rectified preview" 
                          className="w-full h-full object-contain"
                          data-testid="img-rectified-preview"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-muted to-muted/30 flex items-center justify-center">
                          <p className="text-sm text-muted-foreground">
                            {rectifiedPreview?.error 
                              ? `Error: ${rectifiedPreview.error}` 
                              : 'Rectified grid will appear after calibration'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
