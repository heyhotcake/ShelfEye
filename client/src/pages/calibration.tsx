import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Camera, CheckCircle, Ruler, X, Upload, Image as ImageIcon } from "lucide-react";
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
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
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

  // Filter designs that belong to the active camera
  // Include designs without cameraId (backward compatibility for old saved designs)
  const relevantDesigns = savedTemplateDesigns.filter(design => {
    // New designs: match by cameraId
    if (design.cameraId) {
      return design.cameraId === activeCamera?.id;
    }
    // Old designs without cameraId: check if paper size exists in camera's templates
    if (!design.cameraId && templateRectangles && activeCamera) {
      return templateRectangles.some((rect: any) => 
        rect.paperSize === design.paperSize && rect.cameraId === activeCamera.id
      );
    }
    return false;
  });

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
      
      // Auto-select template if only one exists for this camera
      if (activeCamera && relevantDesigns.length === 1) {
        console.log('[Calibration] Auto-selecting template:', relevantDesigns[0].timestamp);
        setSelectedTemplate(relevantDesigns[0].timestamp);
      } else {
        console.log('[Calibration] Clearing template selection');
        setSelectedTemplate("");
      }
      
      // Update ref to current camera ID
      previousCameraIdRef.current = currentCameraId;
    } else {
      console.log('[Calibration] Camera same, no reset');
    }
  }, [activeCamera?.id, relevantDesigns]);

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

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploadedImage(file);
      // Create preview URL
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const calibrationMutation = useMutation({
    mutationFn: async ({ cameraId, paperSize }: { cameraId: string; paperSize: string }) => {
      // Lock camera BEFORE starting calibration to stop preview polling
      setIsCameraLocked(true);
      
      // If uploaded image exists, send it as multipart/form-data
      if (uploadedImage) {
        const formData = new FormData();
        formData.append('image', uploadedImage);
        formData.append('paperSize', paperSize);
        
        const response = await fetch(`/api/calibrate/${cameraId}`, {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          throw new Error(await response.text());
        }
        
        return response;
      }
      
      // Otherwise use camera capture (original behavior)
      return apiRequest('POST', `/api/calibrate/${cameraId}`, { paperSize });
    },
    onSuccess: async (response) => {
      const data: CalibrationResult = await response.json();
      console.log('[Calibration] ArUco calibration SUCCESS, setting step to 1');
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
      // Fetch rectified preview after successful calibration
      refetchRectified();
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
        setCalibrationStep(3); // Move to step 4 (tools covering QRs)
        toast({
          title: "Step 3 Complete - QR Codes Visible ✓",
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
                        {relevantDesigns.length > 0 && (
                          relevantDesigns.map((design) => (
                            <SelectItem key={design.timestamp} value={design.timestamp}>
                              {design.paperSize} - {design.name}
                            </SelectItem>
                          ))
                        )}
                        {relevantDesigns.length === 0 && (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            No saved designs for this camera
                          </div>
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

                  {/* Image Upload Section */}
                  <div className="space-y-3 mb-4">
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Upload className="w-4 h-4 text-purple-500" />
                        <span className="text-sm font-medium text-purple-500">Test Mode: Upload Image</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        Upload a calibration photo to test ArUco detection and QR validation without using the live camera
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                        id="image-upload"
                        data-testid="input-upload-image"
                      />
                      <label htmlFor="image-upload">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => document.getElementById('image-upload')?.click()}
                          data-testid="button-select-image"
                        >
                          <ImageIcon className="w-4 h-4 mr-2" />
                          {uploadedImage ? 'Change Image' : 'Select Image'}
                        </Button>
                      </label>
                      {uploadedImagePreview && (
                        <div className="mt-3">
                          <img src={uploadedImagePreview} alt="Uploaded preview" className="w-full rounded-md border" />
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-xs text-muted-foreground">{uploadedImage?.name}</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setUploadedImage(null);
                                setUploadedImagePreview(null);
                              }}
                              data-testid="button-clear-image"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step-based calibration buttons */}
                  <div className="space-y-3">
                    {calibrationStep === 0 && (
                      <div className="space-y-2">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 1:</strong> {uploadedImage ? 'Uploaded image will be used for ArUco detection.' : 'Position camera to see all 4 ArUco corner markers (A/B/C/D), then run calibration.'}
                          </p>
                        </div>
                        <Button 
                          className="w-full"
                          onClick={() => {
                            if (activeCamera) {
                              // Determine paper size from selected template design
                              let paperSize = 'A4-landscape'; // default fallback
                              
                              // Priority 1: Use selected template design if provided
                              if (selectedTemplate && selectedTemplate !== 'none') {
                                const design = relevantDesigns.find(d => d.timestamp === selectedTemplate);
                                if (design) {
                                  paperSize = design.paperSize;
                                } else {
                                  toast({
                                    title: "Invalid Template Design",
                                    description: "The selected template design is not found. Please select a valid design.",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                              } 
                              // Priority 2: Check if multiple designs exist
                              else if (relevantDesigns.length > 1) {
                                // Multiple designs exist but none selected
                                toast({
                                  title: "Template Design Required",
                                  description: "Please select a template design before calibrating. This camera has multiple saved designs.",
                                  variant: "destructive",
                                });
                                return;
                              } else if (relevantDesigns.length === 1) {
                                // Exactly one design, automatically use it
                                paperSize = relevantDesigns[0].paperSize;
                              }
                              // Priority 3: No designs - use default A4-landscape
                              
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
                        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 2:</strong> Verify template alignment below in the rectified preview. Check that tool outlines match your physical layout. If alignment is correct, proceed to QR validation.
                          </p>
                        </div>
                        <Button 
                          className="w-full"
                          onClick={() => {
                            setCalibrationStep(2); // Move to QR validation step
                          }}
                          data-testid="button-proceed-qr-validation"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Proceed to QR Validation
                        </Button>
                      </div>
                    )}

                    {calibrationStep === 2 && (
                      <div className="space-y-2">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-3">
                          <p className="text-xs text-muted-foreground">
                            <strong>Step 3:</strong> Ensure all tool slots are EMPTY (QR codes should be visible). Click to validate.
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
                          <>
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-2">
                              <p className="text-xs text-red-500 font-semibold mb-1">Missing QR Codes ({step1Result.detected_count}/{step1Result.expected_count} detected):</p>
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
                                <li>QR codes might be too small - try larger QR codes or better camera position</li>
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
                            <strong>Step 4:</strong> Place ALL tools in their slots so they cover the QR codes. When ready, click the button below to verify.
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
                
                {/* Rectified Preview - Show after ArUco calibration (Step 2) */}
                {calibrationStep >= 1 && (
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
                               'Loading rectified view...'}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded">
                      <p className="text-xs text-muted-foreground">
                        ℹ️ Verify that the tool outlines (magenta rectangles) align with your physical tool layout. If they don't align, the QR codes may be in the wrong positions.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
