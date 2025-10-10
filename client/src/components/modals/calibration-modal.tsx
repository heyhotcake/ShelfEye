import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Camera, CheckCircle, Ruler, X } from "lucide-react";

interface CalibrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CalibrationResult {
  ok: boolean;
  homographyMatrix: number[];
  reprojectionError: number;
  markersDetected: number;
}

export function CalibrationModal({ open, onOpenChange }: CalibrationModalProps) {
  const { toast } = useToast();
  const [errorThreshold, setErrorThreshold] = useState([1.5]);
  const [selectedResolution, setSelectedResolution] = useState("1920x1080");

  const { data: cameras } = useQuery({
    queryKey: ['/api/cameras'],
    enabled: open,
  });

  const calibrationMutation = useMutation({
    mutationFn: (cameraId: string) => apiRequest('POST', `/api/calibrate/${cameraId}`),
    onSuccess: async (response) => {
      const data: CalibrationResult = await response.json();
      toast({
        title: "Calibration Successful",
        description: `Markers detected: ${data.markersDetected}, Error: ${data.reprojectionError.toFixed(2)} px`,
      });
    },
    onError: (error) => {
      toast({
        title: "Calibration Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const activeCamera = cameras?.find((c: any) => c.isActive);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold text-foreground">
                ArUco GridBoard Calibration
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">Align the camera with the grid markers</p>
            </div>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-close-calibration"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
          {/* Live View */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">Live Camera View</h3>
            <div className="canvas-container">
              <div className="aspect-[4/3] bg-muted rounded relative overflow-hidden">
                <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Camera feed will appear here</p>
                  </div>
                </div>
                
                {/* ArUco markers overlay */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 600">
                  <rect x="100" y="100" width="50" height="50" fill="hsl(217, 91%, 60%)" opacity="0.3"/>
                  <text x="110" y="130" fill="white" fontSize="14" fontWeight="bold">17</text>
                  
                  <rect x="650" y="100" width="50" height="50" fill="hsl(217, 91%, 60%)" opacity="0.3"/>
                  <text x="660" y="130" fill="white" fontSize="14" fontWeight="bold">18</text>
                  
                  <rect x="650" y="450" width="50" height="50" fill="hsl(217, 91%, 60%)" opacity="0.3"/>
                  <text x="660" y="480" fill="white" fontSize="14" fontWeight="bold">19</text>
                  
                  <rect x="100" y="450" width="50" height="50" fill="hsl(217, 91%, 60%)" opacity="0.3"/>
                  <text x="110" y="480" fill="white" fontSize="14" fontWeight="bold">20</text>
                  
                  <polyline 
                    points="125,125 675,125 675,475 125,475 125,125" 
                    fill="none" 
                    stroke="hsl(142, 76%, 45%)" 
                    strokeWidth="2"
                  />
                </svg>
              </div>
            </div>
            
            <div className="mt-4 space-y-2">
              <Card>
                <CardContent className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span className="text-sm text-foreground">Markers Detected</span>
                  </div>
                  <span className="text-sm font-mono text-foreground" data-testid="text-markers-detected">4/4</span>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-2">
                    <Ruler className="w-5 h-5 text-primary" />
                    <span className="text-sm text-foreground">Reprojection Error</span>
                  </div>
                  <span className="text-sm font-mono text-foreground" data-testid="text-reprojection-error">0.74 px</span>
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
                <label className="text-sm text-muted-foreground mb-2 block">Grid Resolution</label>
                <Select value={selectedResolution} onValueChange={setSelectedResolution}>
                  <SelectTrigger data-testid="select-resolution">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1920x1080">1920 x 1080 (Recommended)</SelectItem>
                    <SelectItem value="1280x720">1280 x 720</SelectItem>
                    <SelectItem value="2560x1440">2560 x 1440</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">
                  Error Threshold (px)
                </label>
                <div className="px-3">
                  <Slider
                    value={errorThreshold}
                    onValueChange={setErrorThreshold}
                    max={3}
                    min={0.5}
                    step={0.1}
                    className="w-full"
                    data-testid="slider-error-threshold"
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>0.5</span>
                  <span className="font-medium text-foreground">{errorThreshold[0]}</span>
                  <span>3.0</span>
                </div>
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
                        ? new Date(activeCamera.calibrationTimestamp).toLocaleString() 
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
