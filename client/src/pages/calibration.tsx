import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Camera, CheckCircle, Ruler, X, Download } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";
import { RectifiedPreviewCanvas } from "@/components/canvas/rectified-preview-canvas";

const TIMEZONE = "Asia/Tokyo";

interface CalibrationResult {
  ok: boolean;
  homographyMatrix: number[];
  reprojectionError: number;
  markersDetected: number;
  rectifiedPreview?: string; // base64 encoded image from calibration
}

interface CameraPreview {
  ok: boolean;
  image?: string;
  error?: string;
  width?: number;
  height?: number;
}

interface ValidationResult {
  success: boolean;
  step: string;
  detected_count: number;
  expected_count: number;
  message: string;
  error?: string;
  valid_qrs?: any[];
  invalid_qrs?: any[];
  missing_slots?: any[];
  visible_qrs?: any[];
  total_qrs_detected?: number;
}

interface TemplateDesign {
  name: string;
  timestamp: string;
  paperSize: string;
  cameraId?: string; // Optional for backward compatibility with old saved designs
  templateRectangles: any[];
  categories: any[];
}

export default function Calibration() {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);
  const [calibrationStep, setCalibrationStep] = useState<number>(0); // 0: ArUco, 1: QRs visible, 2: QRs covered
  const [step1Result, setStep1Result] = useState<ValidationResult | null>(null);
  const [step2Result, setStep2Result] = useState<ValidationResult | null>(null);
  const [isCameraLocked, setIsCameraLocked] = useState<boolean>(false);
  const [savedTemplateDesigns, setSavedTemplateDesigns] = useState<TemplateDesign[]>([]);
  const [adjustedTemplates, setAdjustedTemplates] = useState<any[]>([]);
  const [hasTemplateAdjustments, setHasTemplateAdjustments] = useState<boolean>(false);
  const previousCameraIdRef = useRef<string | undefined>(undefined);

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

  // Fetch template rectangles from DATABASE for the selected paper size (for calibration overlay)
  const selectedDesignForQuery = savedTemplateDesigns.find(d => d.timestamp === selectedTemplate);
  const paperSizeForQuery = selectedDesignForQuery?.paperSize || '6-page-3x2';
  const { data: dbTemplateRectangles } = useQuery<any[]>({
    queryKey: ['/api/template-rectangles', paperSizeForQuery], // Fixed: use string instead of object
    enabled: calibrationStep >= 1 && !!paperSizeForQuery,
    queryFn: async () => {
      console.log('[CalibrationOverlay] Fetching templates for paper size:', paperSizeForQuery);
      const response = await fetch(`/api/template-rectangles?paperSize=${paperSizeForQuery}`);
      const data = await response.json();
      console.log('[CalibrationOverlay] DB templates loaded:', data.length, 'templates');
      console.log('[CalibrationOverlay] First template:', data[0]);
      return data;
    },
  });

  // Load saved template designs from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('templateConfigVersions');
    if (saved) {
      try {
        setSavedTemplateDesigns(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved template designs:', e);
      }
    }
  }, []);

  // Show all saved template designs (camera-independent)
  // Templates are now standalone designs that can be used with any camera
  const relevantDesigns = savedTemplateDesigns;

  // Reset calibration when camera ACTUALLY changes (not just refetches)
  useEffect(() => {
    const currentCameraId = activeCamera?.id;
    const previousCameraId = previousCameraIdRef.current;
    
    console.log('[Calibration] Effect running - current:', currentCameraId, 'previous:', previousCameraId);
    
    // Only reset if camera ID actually changed
    if (currentCameraId !== previousCameraId) {
      console.log('[Calibration] Camera CHANGED, resetting...');
      setCalibrationResult(null);
      setCalibrationStep(0);
      setStep1Result(null);
      setStep2Result(null);
      setIsCameraLocked(false);
      setSelectedTemplate(""); // Clear template selection when camera changes
      
      // Update ref to current camera ID
      previousCameraIdRef.current = currentCameraId;
    } else {
      console.log('[Calibration] Camera same, no reset');
    }
  }, [activeCamera?.id]);

  // Camera preview - poll every 3 seconds, but pause when camera is locked
  // For 4K cameras, backend automatically uses 1920x1080 for preview to prevent memory issues
  // Calibration/capture still uses full 4K resolution
  const { data: preview } = useQuery<CameraPreview>({
    queryKey: ['/api/camera-preview', activeCamera?.id],
    queryFn: async () => {
      if (!activeCamera?.id) throw new Error('No active camera');
      const response = await fetch(`/api/camera-preview/${activeCamera.id}`);
      
      // Handle camera locked during calibration
      if (response.status === 423) {
        const data = await response.json();
        setIsCameraLocked(true);
        return { ok: false, error: data.message || 'Camera is busy with calibration' };
      }
      
      // Clear locked state on successful response
      setIsCameraLocked(false);
      
      if (!response.ok) {
        const data = await response.json();
        return { ok: false, error: data.message || 'Failed to fetch preview' };
      }
      
      return response.json();
    },
    enabled: !!activeCamera && !isCameraLocked, // Enable low-res preview when camera not in use
    refetchInterval: 5000, // Low framerate: 1 frame every 5 seconds (0.2 fps) to avoid Pi overload
  });

  // Rectified preview - fetch after successful calibration
  const { data: rectifiedPreview, refetch: refetchRectified, isLoading: isLoadingRectified, error: rectifiedError } = useQuery<CameraPreview>({
    queryKey: ['/api/rectified-preview', activeCamera?.id, selectedTemplate],
    queryFn: async () => {
      if (!activeCamera?.id) throw new Error('No active camera');
      console.log('[Rectified Preview] Fetching for camera:', activeCamera.id);
      console.log('[Rectified Preview] Selected template:', selectedTemplate);
      
      // Add template timestamp to query if selected
      const url = selectedTemplate 
        ? `/api/rectified-preview/${activeCamera.id}?templateTimestamp=${encodeURIComponent(selectedTemplate)}`
        : `/api/rectified-preview/${activeCamera.id}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Rectified Preview] Error:', errorData);
        throw new Error(errorData.message || 'Failed to fetch rectified preview');
      }
      const data = await response.json();
      console.log('[Rectified Preview] Success:', data.ok);
      return data;
    },
    enabled: false, // Don't auto-fetch, trigger manually after calibration
  });

  const calibrationMutation = useMutation({
    mutationFn: ({ cameraId, paperSize, templateTimestamp }: { cameraId: string; paperSize: string; templateTimestamp?: string }) => {
      // Lock camera BEFORE starting calibration to stop preview polling
      setIsCameraLocked(true);
      return apiRequest('POST', `/api/calibrate/${cameraId}`, { paperSize, templateTimestamp });
    },
    onSuccess: async (response) => {
      const data: CalibrationResult = await response.json();
      console.log('[Calibration] ArUco calibration SUCCESS, setting step to 1');
      console.log('[Calibration] Rectified preview included:', !!data.rectifiedPreview);
      setCalibrationResult(data);
      setCalibrationStep(1); // Move to step 1: show rectified preview
      setIsCameraLocked(false); // Clear lock state
      
      const errorText = data.reprojectionError < 0.01 
        ? "~0.00 px (perfect fit with 4 points)" 
        : `${data.reprojectionError.toFixed(2)} px`;
      
      toast({
        title: "ArUco Calibration Complete",
        description: `Markers detected: ${data.markersDetected}, Error: ${errorText}. Verify template alignment below.`,
      });
      
      // Invalidate cameras query to update calibration badge
      queryClient.invalidateQueries({ queryKey: ['/api/cameras'] });
      // Resume preview polling
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
      // Note: Rectified preview is now included in calibration response, no separate fetch needed
    },
    onError: async (error: any) => {
      setIsCameraLocked(false); // Clear lock state on error
      // Try to extract the server's detailed error message
      let errorMessage = "An error occurred during calibration";
      if (error.response) {
        try {
          const errorData = await error.response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          errorMessage = error.message || errorMessage;
        }
      } else {
        errorMessage = error.message || errorMessage;
      }
      
      toast({
        title: "Calibration Failed",
        description: errorMessage,
        variant: "destructive",
      });
      // Resume preview polling even on error
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
    },
  });

  const verifyAdjustedPositionsMutation = useMutation({
    mutationFn: ({ cameraId, adjustedTemplates, paperSize }: { cameraId: string; adjustedTemplates: any[]; paperSize: string }) => {
      return apiRequest('POST', `/api/calibrate/${cameraId}/verify-positions`, { adjustedTemplates, paperSize });
    },
    onSuccess: async (response) => {
      const data = await response.json();
      if (data.ok && data.rectifiedPreview) {
        // Update the calibration result with the new verified preview
        setCalibrationResult(prev => prev ? { ...prev, rectifiedPreview: data.rectifiedPreview } : null);
        toast({
          title: "Verification Complete",
          description: "Preview regenerated with adjusted coordinates. Verify the alignment matches your expectations.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Verification Failed",
        description: error.message || "Failed to regenerate preview with adjusted positions.",
        variant: "destructive",
      });
    },
  });

  const validateMarkersVisibleMutation = useMutation({
    mutationFn: (cameraId: string) => {
      // Lock camera BEFORE starting validation to stop preview polling
      setIsCameraLocked(true);
      return apiRequest('POST', `/api/calibrate/${cameraId}/validate-markers-visible`);
    },
    onSuccess: async (response) => {
      const data: ValidationResult = await response.json();
      setStep1Result(data);
      setIsCameraLocked(false); // Clear lock state
      
      if (data.success) {
        setCalibrationStep(3); // Move to step 4 (tools covering markers)
        toast({
          title: "Step 3 Complete - ArUco Markers Visible ✓",
          description: `All ${data.detected_count} slot ArUco markers detected successfully. Now place ALL tools in their slots, then click the validation button.`,
          duration: 8000, // Show longer to ensure user sees the instruction
        });
      } else {
        // Handle error cases (camera open failure, etc.)
        if (data.error) {
          toast({
            title: "Marker Validation Failed",
            description: data.error,
            variant: "destructive",
            duration: 10000,
          });
        } else {
          // Handle validation failure with counts
          const invalidMarkersInfo = data.invalid_qrs && data.invalid_qrs.length > 0 
            ? ` (Found ${data.invalid_qrs.length} non-matching marker(s): ${data.invalid_qrs.map((qr: any) => qr.data).join(', ')})`
            : '';
          const totalMarkersInfo = data.total_qrs_detected !== undefined 
            ? ` Total markers detected: ${data.total_qrs_detected}.` 
            : '';
          
          let description = data.message;
          if (!description && data.detected_count !== undefined && data.expected_count !== undefined) {
            description = `Only ${data.detected_count}/${data.expected_count} ArUco markers matched.`;
          }
          if (!description) {
            description = 'Validation failed. Please check the camera and try again.';
          }
          
          toast({
            title: "Marker Validation Failed",
            description: `${description}${totalMarkersInfo}${invalidMarkersInfo}`,
            variant: "destructive",
            duration: 10000,
          });
        }
      }
      // Resume preview polling
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
    },
    onError: async (error: any) => {
      setIsCameraLocked(false); // Clear lock state on error
      let errorMessage = "Marker validation failed";
      if (error.response) {
        try {
          const errorData = await error.response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          errorMessage = error.message || errorMessage;
        }
      }
      toast({
        title: "Validation Error",
        description: errorMessage,
        variant: "destructive",
      });
      // Resume preview polling even on error
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
    },
  });

  const validateMarkersCoveredMutation = useMutation({
    mutationFn: (cameraId: string) => {
      // Lock camera BEFORE starting validation to stop preview polling
      setIsCameraLocked(true);
      return apiRequest('POST', `/api/calibrate/${cameraId}/validate-markers-covered`);
    },
    onSuccess: async (response) => {
      const data: ValidationResult = await response.json();
      setStep2Result(data);
      setIsCameraLocked(false); // Clear lock state
      
      if (data.success) {
        toast({
          title: "Calibration Complete",
          description: "All tools are properly covering ArUco markers. System is ready!",
        });
        // Invalidate calibration-info query to immediately show Active Camera card on dashboard
        queryClient.invalidateQueries({ queryKey: ['/api/config/calibration-info'] });
      } else {
        // Handle error cases (camera open failure, etc.)
        if (data.error) {
          toast({
            title: "Marker Validation Failed",
            description: data.error,
            variant: "destructive",
          });
        } else {
          const description = data.message || 
            (data.detected_count !== undefined ? `${data.detected_count} ArUco markers still visible` : 'Validation failed. Please check the camera and try again.');
          toast({
            title: "Tools Not Covering Markers",
            description,
            variant: "destructive",
          });
        }
      }
      // Resume preview polling
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
    },
    onError: async (error: any) => {
      setIsCameraLocked(false); // Clear lock state on error
      let errorMessage = "Marker validation failed";
      if (error.response) {
        try {
          const errorData = await error.response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          errorMessage = error.message || errorMessage;
        }
      }
      toast({
        title: "Validation Error",
        description: errorMessage,
        variant: "destructive",
      });
      // Resume preview polling even on error
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
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
                
                {/* Calibration in progress banner */}
                {(calibrationMutation.isPending || isCameraLocked) && (
                  <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                      Calibration in progress... Preview paused
                    </p>
                  </div>
                )}
                
                <div className="canvas-container">
                  <div className="aspect-[4/3] bg-muted rounded relative overflow-hidden">
                    {preview?.ok && preview?.image ? (
                      <img 
                        key={preview.image.substring(0, 100)} 
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
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-mono text-foreground" data-testid="text-reprojection-error">
                          {calibrationResult ? `${calibrationResult.reprojectionError.toFixed(2)} px` : '-'}
                        </span>
                        {calibrationResult && calibrationResult.reprojectionError < 0.01 && (
                          <span className="text-xs text-muted-foreground">
                            (perfect fit with 4 points)
                          </span>
                        )}
                      </div>
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
                    <label className="text-sm text-muted-foreground mb-2 block">
                      Template Design {relevantDesigns.length > 0 ? "(required)" : "(no templates available)"}
                    </label>
                    <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                      <SelectTrigger data-testid="select-template">
                        <SelectValue placeholder="Select template design for calibration" />
                      </SelectTrigger>
                      <SelectContent>
                        {relevantDesigns.length > 0 ? (
                          relevantDesigns.map((design) => (
                            <SelectItem key={design.timestamp} value={design.timestamp}>
                              {design.paperSize} - {design.name}
                            </SelectItem>
                          ))
                        ) : (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            No saved designs for this camera - create one in Template Designer first
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {relevantDesigns.length > 0 
                        ? "Template defines the paper size and tool layout for calibration" 
                        : "Go to Template Designer to create a template for this camera"}
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

                  {/* Step-based calibration buttons */}
                  <div className="space-y-3">
                    {calibrationStep === 0 && (
                      <div className="space-y-2">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 1:</strong> Position camera to see all 4 ArUco corner markers (A/B/C/D), then run calibration.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                            <p className="text-xs text-muted-foreground">
                              <strong>Note:</strong> Calibration includes a 40-second camera warmup for optimal auto-focus and auto-exposure. Please be patient during this process.
                            </p>
                          </div>
                          
                          <Button 
                            className="w-full"
                            onClick={() => {
                              if (activeCamera) {
                                // Determine paper size from selected template design
                                let paperSize = 'A4-landscape'; // default fallback
                                
                                // Template is REQUIRED when templates exist
                                if (relevantDesigns.length > 0) {
                                  if (!selectedTemplate || selectedTemplate === '') {
                                    toast({
                                      title: "Template Design Required",
                                      description: "Please select a template design before calibrating.",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  
                                  const design = relevantDesigns.find(d => d.timestamp === selectedTemplate);
                                  if (!design) {
                                    toast({
                                      title: "Invalid Template Design",
                                      description: "The selected template design is not found.",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  paperSize = design.paperSize;
                                } else {
                                  // No templates exist - cannot calibrate
                                  toast({
                                    title: "No Templates Available",
                                    description: "Please create a template design in Template Designer first.",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                                
                                calibrationMutation.mutate({ cameraId: activeCamera.id, paperSize, templateTimestamp: selectedTemplate });
                              }
                            }}
                            disabled={
                              !activeCamera || 
                              calibrationMutation.isPending ||
                              (relevantDesigns.length > 0 && !selectedTemplate)
                            }
                            data-testid="button-start-calibration"
                          >
                            <Camera className="w-4 h-4 mr-2" />
                            {calibrationMutation.isPending ? 'Warming up camera & calibrating (~60s)...' : 'Run ArUco Calibration'}
                          </Button>
                        </div>
                      </div>
                    )}

                    {calibrationStep === 1 && (
                      <div className="space-y-2">
                        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 2:</strong> Verify template alignment below in the rectified preview. Check that tool outlines match your physical layout. {hasTemplateAdjustments && <span className="text-green-600 font-semibold">Adjustments detected - they will be saved when you proceed.</span>}
                          </p>
                        </div>
                        
                        {/* Verify button - appears when adjustments are made */}
                        {hasTemplateAdjustments && adjustedTemplates.length > 0 && activeCamera && (
                          <Button 
                            variant="outline"
                            className="w-full border-amber-500/50 hover:bg-amber-500/10"
                            onClick={() => {
                              const selectedDesign = relevantDesigns.find(d => d.timestamp === selectedTemplate);
                              if (selectedDesign && activeCamera) {
                                verifyAdjustedPositionsMutation.mutate({
                                  cameraId: activeCamera.id,
                                  adjustedTemplates: adjustedTemplates,
                                  paperSize: selectedDesign.paperSize
                                });
                              }
                            }}
                            disabled={verifyAdjustedPositionsMutation.isPending}
                            data-testid="button-verify-adjusted-positions"
                          >
                            <Ruler className="w-4 h-4 mr-2" />
                            {verifyAdjustedPositionsMutation.isPending ? 'Verifying...' : 'Verify Adjusted Positions (Re-run with new coordinates)'}
                          </Button>
                        )}
                        
                        <Button 
                          className="w-full"
                          onClick={async () => {
                            console.log('[SaveButton] Click detected', { hasTemplateAdjustments, adjustedTemplatesCount: adjustedTemplates.length });
                            
                            // Save adjusted template positions if any
                            if (hasTemplateAdjustments && adjustedTemplates.length > 0) {
                              console.log('[SaveButton] Saving adjusted templates to database...');
                              try {
                                const selectedDesign = relevantDesigns.find(d => d.timestamp === selectedTemplate);
                                if (selectedDesign) {
                                  // Fetch actual database template rectangles by paper size
                                  const paperSize = selectedDesign.paperSize;
                                  console.log('[SaveButton] Fetching DB templates for paper size:', paperSize);
                                  const dbRectsResponse = await fetch(`/api/template-rectangles?paperSize=${paperSize}`);
                                  if (dbRectsResponse.ok) {
                                    const dbRects = await dbRectsResponse.json();
                                    console.log('[SaveButton] Found DB templates:', dbRects.length);
                                    
                                    // Match adjusted templates to database rectangles by autoQrId and update DB
                                    for (const adjusted of adjustedTemplates) {
                                      const dbRect = dbRects.find((r: any) => r.autoQrId === adjusted.autoQrId);
                                      if (dbRect) {
                                        console.log(`[SaveButton] Updating ${dbRect.autoQrId}: (${adjusted.xCm}, ${adjusted.yCm})`);
                                        await apiRequest('PUT', `/api/template-rectangles/${dbRect.id}`, {
                                          xCm: adjusted.xCm,
                                          yCm: adjusted.yCm,
                                        });
                                      } else {
                                        console.warn(`[SaveButton] No DB match for autoQrId: ${adjusted.autoQrId}`);
                                      }
                                    }
                                    
                                    // Only update localStorage AFTER database save succeeds
                                    const updatedRectangles = selectedDesign.templateRectangles.map((rect: any) => {
                                      const adjusted = adjustedTemplates.find(t => t.autoQrId === rect.autoQrId);
                                      if (adjusted) {
                                        return { ...rect, xCm: adjusted.xCm, yCm: adjusted.yCm };
                                      }
                                      return rect;
                                    });
                                    
                                    const updatedDesign = { ...selectedDesign, templateRectangles: updatedRectangles };
                                    const updatedDesigns = savedTemplateDesigns.map(d => 
                                      d.timestamp === selectedTemplate ? updatedDesign : d
                                    );
                                    localStorage.setItem('templateConfigVersions', JSON.stringify(updatedDesigns));
                                    setSavedTemplateDesigns(updatedDesigns);
                                    
                                    console.log('[SaveButton] Successfully saved to DB and localStorage');
                                    toast({
                                      title: "Positions Saved",
                                      description: `Updated ${adjustedTemplates.length} template positions in database and localStorage.`,
                                    });
                                  } else {
                                    throw new Error('Failed to fetch database template rectangles');
                                  }
                                } else {
                                  console.error('[SaveButton] Selected design not found');
                                }
                              } catch (error) {
                                console.error('[SaveButton] Failed to save adjusted positions:', error);
                                toast({
                                  title: "Save Failed",
                                  description: "Failed to save adjusted positions. LocalStorage NOT updated to prevent inconsistency.",
                                  variant: "destructive",
                                });
                                // Don't proceed if save failed
                                return;
                              }
                            } else {
                              console.log('[SaveButton] No adjustments to save, proceeding to marker validation');
                            }
                            
                            setCalibrationStep(2); // Move to marker validation step
                          }}
                          data-testid="button-proceed-marker-validation"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {hasTemplateAdjustments ? 'Save Adjustments & Proceed to Marker Validation' : 'Proceed to Marker Validation'}
                        </Button>
                      </div>
                    )}

                    {calibrationStep === 2 && (
                      <div className="space-y-2">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 3:</strong> Ensure all tool slots are EMPTY (ArUco markers should be visible). Click to validate.
                          </p>
                        </div>
                        <Button 
                          className="w-full"
                          onClick={() => {
                            if (activeCamera) {
                              validateMarkersVisibleMutation.mutate(activeCamera.id);
                            }
                          }}
                          disabled={!activeCamera || validateMarkersVisibleMutation.isPending}
                          data-testid="button-validate-markers-visible"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {validateMarkersVisibleMutation.isPending ? 'Validating...' : 'Validate ArUco Markers Visible'}
                        </Button>
                        {step1Result && !step1Result.success && step1Result.missing_slots && (
                          <>
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-2">
                              <p className="text-xs text-red-500 font-semibold mb-1">Missing ArUco Markers ({step1Result.detected_count}/{step1Result.expected_count} detected):</p>
                              <ul className="text-xs text-muted-foreground list-disc list-inside">
                                {step1Result.missing_slots.map((slot: any, idx: number) => (
                                  <li key={idx}>{slot.slotId} - {slot.toolName}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-2">
                              <p className="text-xs font-semibold text-amber-600 mb-1">Troubleshooting:</p>
                              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                                <li>Check rectified preview above - are template outlines aligned?</li>
                                <li>ArUco markers might be too small - try larger markers or better camera position</li>
                                <li>Image quality might be poor - check lighting and camera focus</li>
                                <li>Template positions might not match physical layout</li>
                              </ul>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {calibrationStep === 3 && (
                      <div className="space-y-2">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 4:</strong> Place ALL tools in their slots so they cover the ArUco markers. When ready, click the button below to verify.
                          </p>
                        </div>
                        {!step2Result && (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 mb-2">
                            <p className="text-xs text-amber-600">
                              ⏳ Awaiting verification - Place tools then click button
                            </p>
                          </div>
                        )}
                        <Button 
                          className="w-full"
                          onClick={() => {
                            if (activeCamera) {
                              validateMarkersCoveredMutation.mutate(activeCamera.id);
                            }
                          }}
                          disabled={!activeCamera || validateMarkersCoveredMutation.isPending}
                          data-testid="button-validate-markers-covered"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {validateMarkersCoveredMutation.isPending ? 'Validating...' : 'Verify Tools Are Covering ArUco Markers'}
                        </Button>
                        {step2Result && !step2Result.success && step2Result.visible_qrs && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-2">
                            <p className="text-xs text-red-500 font-semibold mb-1">ArUco Markers Still Visible:</p>
                            <ul className="text-xs text-muted-foreground list-disc list-inside">
                              {step2Result.visible_qrs.map((qr: any, idx: number) => (
                                <li key={idx}>{qr.slotId} - {qr.toolName}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {step2Result && step2Result.success && (
                          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mt-2">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-green-500" />
                              <p className="text-xs text-green-500 font-semibold">Calibration Complete!</p>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              All tools are properly covering ArUco markers. System is ready for monitoring.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Reset button - show if calibration started */}
                    {calibrationStep > 0 && (
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => {
                          setCalibrationStep(0);
                          setStep1Result(null);
                          setStep2Result(null);
                          setCalibrationResult(null);
                          setIsCameraLocked(false); // Clear camera lock
                          queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] }); // Resume preview
                        }}
                        data-testid="button-reset-calibration"
                      >
                        Reset Calibration
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Rectified Preview - Show after ArUco calibration (Step 2) - FULL WIDTH */}
            {calibrationStep >= 1 && (() => {
              // Get paper dimensions from selected template
              const selectedDesign = relevantDesigns.find(d => d.timestamp === selectedTemplate);
              const paperSize = selectedDesign?.paperSize || 'A4-landscape';
              
              const getPaperDimensions = (paperSize: string): { width: number; height: number } => {
                const dimensions: Record<string, { width: number; height: number }> = {
                  'A5-landscape': { width: 21.0, height: 14.8 },
                  'A4-landscape': { width: 29.7, height: 21.0 },
                  'A3-landscape': { width: 42.0, height: 29.7 },
                  '2xA5-landscape': { width: 42.0, height: 14.8 },
                  '3xA5-landscape': { width: 63.0, height: 14.8 },
                  '6-page-3x2': { width: 89.1, height: 42.0 },
                };
                return dimensions[paperSize] || { width: 29.7, height: 21.0 }; // Default A4
              };
              
              const paperDimensions = getPaperDimensions(paperSize);
              const aspectRatio = paperDimensions.width / paperDimensions.height;
              
              // Get templates with categories for the canvas - use DB data if available, fallback to localStorage
              // dbTemplateRectangles is fetched at top level (lines 93-96)
              const templatesWithCategories = (dbTemplateRectangles || selectedDesign?.templateRectangles || []).map((rect: any) => {
                // Match category from selectedDesign for dimension info
                const category = selectedDesign?.categories?.find((c: any) => c.id === rect.categoryId);
                return {
                  id: rect.id,
                  categoryId: rect.categoryId,
                  categoryName: category?.name || 'Unknown',
                  xCm: rect.xCm,
                  yCm: rect.yCm,
                  widthCm: category?.widthCm || 0,
                  heightCm: category?.heightCm || 0,
                  rotation: rect.rotation || 0,
                  autoQrId: rect.autoQrId,
                };
              });
              
              return (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-foreground">Rectified Preview with Template Overlay</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      window.open('/api/calibrate/download-rectified', '_blank');
                    }}
                    data-testid="button-download-rectified"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download High-Res
                  </Button>
                </div>
                <div className="canvas-container w-full">
                  <div className="bg-muted rounded overflow-hidden" style={{ aspectRatio: `${aspectRatio.toFixed(3)} / 1` }}>
                    {calibrationResult?.rectifiedPreview && templatesWithCategories.length > 0 ? (
                      <RectifiedPreviewCanvas
                        baseImage={calibrationResult.rectifiedPreview}
                        templates={adjustedTemplates.length > 0 ? adjustedTemplates : templatesWithCategories}
                        paperWidthCm={paperDimensions.width}
                        paperHeightCm={paperDimensions.height}
                        onTemplatesAdjusted={(templates) => {
                          setAdjustedTemplates(templates);
                          setHasTemplateAdjustments(true);
                        }}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-muted to-muted/30 flex flex-col items-center justify-center p-6 text-center">
                        <div className="text-amber-500 mb-3">
                          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-foreground mb-2">Preview Not Available</p>
                        <p className="text-xs text-muted-foreground max-w-md">
                          The rectified preview was not generated during calibration. This may indicate a camera or processing issue.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              );
            })()}
          </div>
        </div>
      </main>
    </div>
  );
}
