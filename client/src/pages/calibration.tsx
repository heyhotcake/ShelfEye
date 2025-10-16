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

interface ValidationResult {
  success: boolean;
  step: string;
  detected_count: number;
  expected_count: number;
  message: string;
  valid_qrs?: any[];
  missing_slots?: any[];
  visible_qrs?: any[];
}

export default function Calibration() {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);
  const [calibrationStep, setCalibrationStep] = useState<number>(0); // 0: ArUco, 1: QRs visible, 2: QRs covered
  const [step1Result, setStep1Result] = useState<ValidationResult | null>(null);
  const [step2Result, setStep2Result] = useState<ValidationResult | null>(null);
  const [isCameraLocked, setIsCameraLocked] = useState<boolean>(false);

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

  // Clear calibration result and template selection when active camera changes
  useEffect(() => {
    setCalibrationResult(null);
    setSelectedTemplate(""); // Reset template selection for new camera
    setCalibrationStep(0); // Reset to first step
    setStep1Result(null);
    setStep2Result(null);
  }, [activeCamera?.id]);

  // Camera preview - poll every 1 second, but pause when camera is locked
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
    enabled: !!activeCamera?.id && !isCameraLocked,
    refetchInterval: isCameraLocked ? false : 1000,
  });

  // Rectified preview - fetch after successful calibration
  const { data: rectifiedPreview, refetch: refetchRectified, isLoading: isLoadingRectified, error: rectifiedError } = useQuery<CameraPreview>({
    queryKey: ['/api/rectified-preview', activeCamera?.id],
    queryFn: async () => {
      if (!activeCamera?.id) throw new Error('No active camera');
      console.log('[Rectified Preview] Fetching for camera:', activeCamera.id);
      const response = await fetch(`/api/rectified-preview/${activeCamera.id}`);
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
    mutationFn: ({ cameraId, paperSize }: { cameraId: string; paperSize: string }) => {
      // Lock camera BEFORE starting calibration to stop preview polling
      setIsCameraLocked(true);
      return apiRequest('POST', `/api/calibrate/${cameraId}`, { paperSize });
    },
    onSuccess: async (response) => {
      const data: CalibrationResult = await response.json();
      setCalibrationResult(data);
      setCalibrationStep(1); // Move to step 1: validate QRs visible
      setIsCameraLocked(false); // Clear lock state
      
      const errorText = data.reprojectionError < 0.01 
        ? "~0.00 px (perfect fit with 4 points)" 
        : `${data.reprojectionError.toFixed(2)} px`;
      
      toast({
        title: "ArUco Calibration Complete",
        description: `Markers detected: ${data.markersDetected}, Error: ${errorText}. Starting QR validation...`,
      });
      
      // Invalidate cameras query to update calibration badge
      queryClient.invalidateQueries({ queryKey: ['/api/cameras'] });
      // Resume preview polling
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
      // Fetch rectified preview after successful calibration
      refetchRectified();
      
      // Automatically trigger Step 1: Validate QRs visible
      if (activeCamera) {
        setTimeout(() => {
          validateQRsVisibleMutation.mutate(activeCamera.id);
        }, 500); // Small delay to ensure state updates
      }
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

  const validateQRsVisibleMutation = useMutation({
    mutationFn: (cameraId: string) => {
      // Lock camera BEFORE starting validation to stop preview polling
      setIsCameraLocked(true);
      return apiRequest('POST', `/api/calibrate/${cameraId}/validate-qrs-visible`);
    },
    onSuccess: async (response) => {
      const data: ValidationResult = await response.json();
      setStep1Result(data);
      setIsCameraLocked(false); // Clear lock state
      
      if (data.success) {
        setCalibrationStep(2); // Move to step 3
        toast({
          title: "Step 2 Complete - QR Codes Visible ✓",
          description: `All ${data.detected_count} slot QR codes detected successfully. Now place ALL tools in their slots, then click the validation button.`,
          duration: 8000, // Show longer to ensure user sees the instruction
        });
      } else {
        toast({
          title: "QR Validation Failed",
          description: data.message || `Only ${data.detected_count}/${data.expected_count} QR codes detected`,
          variant: "destructive",
        });
      }
      // Resume preview polling
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
    },
    onError: async (error: any) => {
      setIsCameraLocked(false); // Clear lock state on error
      let errorMessage = "QR validation failed";
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

  const validateQRsCoveredMutation = useMutation({
    mutationFn: (cameraId: string) => {
      // Lock camera BEFORE starting validation to stop preview polling
      setIsCameraLocked(true);
      return apiRequest('POST', `/api/calibrate/${cameraId}/validate-qrs-covered`);
    },
    onSuccess: async (response) => {
      const data: ValidationResult = await response.json();
      setStep2Result(data);
      setIsCameraLocked(false); // Clear lock state
      
      if (data.success) {
        toast({
          title: "Calibration Complete",
          description: "All tools are properly covering QR codes. System is ready!",
        });
      } else {
        toast({
          title: "Tools Not Covering QRs",
          description: data.message || `${data.detected_count} QR codes still visible`,
          variant: "destructive",
        });
      }
      // Resume preview polling
      queryClient.invalidateQueries({ queryKey: ['/api/camera-preview', activeCamera?.id] });
    },
    onError: async (error: any) => {
      setIsCameraLocked(false); // Clear lock state on error
      let errorMessage = "QR validation failed";
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

                  {/* Step-based calibration buttons */}
                  <div className="space-y-3">
                    {calibrationStep === 0 && (
                      <div className="space-y-2">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 1:</strong> Position camera to see all 4 ArUco corner markers (A/B/C/D), then run calibration.
                          </p>
                        </div>
                        <Button 
                          className="w-full"
                          onClick={() => {
                            if (activeCamera) {
                              // Get templates for this camera
                              const cameraTemplates = templateRectangles?.filter(
                                (t: any) => t.cameraId === activeCamera.id
                              );
                              
                              // Determine paper size from selected template
                              let paperSize = 'A4-landscape'; // default fallback
                              
                              // Priority 1: Use selected template if provided
                              if (selectedTemplate && selectedTemplate !== 'none') {
                                const template = templateRectangles?.find((t: any) => t.id === selectedTemplate);
                                if (template && template.cameraId === activeCamera.id) {
                                  paperSize = template.paperSize || 'A4-landscape';
                                } else {
                                  // Template doesn't belong to this camera, show error
                                  toast({
                                    title: "Invalid Template",
                                    description: "The selected template doesn't belong to this camera. Please select a valid template.",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                              } 
                              // Priority 2: Check camera templates
                              else if (cameraTemplates && cameraTemplates.length > 1) {
                                // Multiple templates exist but none selected
                                toast({
                                  title: "Template Required",
                                  description: "Please select a template design before calibrating. This camera has multiple templates with different paper sizes.",
                                  variant: "destructive",
                                });
                                return;
                              } else if (cameraTemplates && cameraTemplates.length === 1) {
                                // Exactly one template, automatically use it
                                paperSize = cameraTemplates[0].paperSize || 'A4-landscape';
                              }
                              // Priority 3: No templates - use default A4-landscape
                              
                              calibrationMutation.mutate({ cameraId: activeCamera.id, paperSize });
                            }
                          }}
                          disabled={!activeCamera || calibrationMutation.isPending}
                          data-testid="button-start-calibration"
                        >
                          <Camera className="w-4 h-4 mr-2" />
                          {calibrationMutation.isPending ? 'Calibrating...' : 'Run ArUco Calibration'}
                        </Button>
                      </div>
                    )}

                    {calibrationStep === 1 && (
                      <div className="space-y-2">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 2:</strong> Ensure all tool slots are EMPTY (QR codes should be visible). Click to validate.
                          </p>
                        </div>
                        <Button 
                          className="w-full"
                          onClick={() => {
                            if (activeCamera) {
                              validateQRsVisibleMutation.mutate(activeCamera.id);
                            }
                          }}
                          disabled={!activeCamera || validateQRsVisibleMutation.isPending}
                          data-testid="button-validate-qrs-visible"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {validateQRsVisibleMutation.isPending ? 'Validating...' : 'Validate QR Codes Visible'}
                        </Button>
                        {step1Result && !step1Result.success && step1Result.missing_slots && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-2">
                            <p className="text-xs text-red-500 font-semibold mb-1">Missing QR Codes:</p>
                            <ul className="text-xs text-muted-foreground list-disc list-inside">
                              {step1Result.missing_slots.map((slot: any, idx: number) => (
                                <li key={idx}>{slot.slotId} - {slot.toolName}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {calibrationStep === 2 && (
                      <div className="space-y-2">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 3:</strong> Place ALL tools in their slots so they cover the QR codes. When ready, click the button below to verify.
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
                              validateQRsCoveredMutation.mutate(activeCamera.id);
                            }
                          }}
                          disabled={!activeCamera || validateQRsCoveredMutation.isPending}
                          data-testid="button-validate-qrs-covered"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {validateQRsCoveredMutation.isPending ? 'Validating...' : 'Verify Tools Are Covering QR Codes'}
                        </Button>
                        {step2Result && !step2Result.success && step2Result.visible_qrs && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-2">
                            <p className="text-xs text-red-500 font-semibold mb-1">QR Codes Still Visible:</p>
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
                              All tools are properly covering QR codes. System is ready for monitoring.
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
                        }}
                        data-testid="button-reset-calibration"
                      >
                        Reset Calibration
                      </Button>
                    )}
                  </div>
                </div>
                
                {/* Rectified Preview */}
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-foreground mb-3">Rectified Preview with Template Overlay</h4>
                  <div className="canvas-container">
                    <div className="aspect-[4/3] bg-muted rounded overflow-hidden">
                      {isLoadingRectified ? (
                        <div className="w-full h-full bg-gradient-to-br from-muted to-muted/30 flex items-center justify-center">
                          <p className="text-sm text-muted-foreground">Loading rectified view...</p>
                        </div>
                      ) : rectifiedPreview?.ok && rectifiedPreview?.image ? (
                        <img 
                          src={rectifiedPreview.image} 
                          alt="Rectified preview with template overlay" 
                          className="w-full h-full object-contain"
                          data-testid="img-rectified-preview"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-muted to-muted/30 flex items-center justify-center">
                          <p className="text-sm text-muted-foreground">
                            {rectifiedError ? `Error: ${rectifiedError.message}` :
                             rectifiedPreview?.error ? `Error: ${rectifiedPreview.error}` : 
                             'Rectified view with slot overlay will appear after calibration'}
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
