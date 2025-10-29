import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Upload, PlayCircle, Clock, HardDrive, Cpu, CheckCircle2, XCircle, AlertTriangle, ScanLine, Image as ImageIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

interface TestImage {
  fileName: string;
  path: string;
  size: number;
  source: 'calibration' | 'uploaded';
  created: string;
}

interface DetectionResult {
  slotId: string;
  qrData: string;
  detected: boolean;
  qrType: 'slot' | 'worker' | null;
  detectedQrData: string | null;
}

interface TestResults {
  results: DetectionResult[];
  processingTimeMs: number;
  imageSize: { width: number; height: number };
  slotCount: number;
  detectedCount: number;
  simulationEnabled: boolean;
}

interface CalibrationData {
  success: boolean;
  timestamp: string;
  paperSize: string;
  homographyMatrix: number[][];
  markersDetected: number;
  rectifiedImage: string;
  paperWidthCm: number;
  paperHeightCm: number;
}

export default function TestMode() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [paperSize, setPaperSize] = useState<string>("A4-landscape");
  const [calibrationData, setCalibrationData] = useState<CalibrationData | null>(null);
  const [useTestCalibration, setUseTestCalibration] = useState<boolean>(false);

  // Get simulation status
  const { data: status, refetch: refetchStatus } = useQuery<{
    simulationEnabled: boolean;
    memory: { used: number; limit: number; percentUsed: number; warning: boolean };
  }>({
    queryKey: ['/api/test-mode/status'],
  });

  // Get available test images
  const { data: imagesData, refetch: refetchImages } = useQuery<{ images: TestImage[] }>({
    queryKey: ['/api/test-mode/images'],
  });

  // Toggle simulation mutation
  const toggleSimulation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch('/api/test-mode/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error('Failed to toggle simulation');
      return response.json();
    },
    onSuccess: () => {
      refetchStatus();
    },
  });

  // Upload image mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('image', file);
      
      const response = await fetch('/api/test-mode/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      refetchImages();
      setSelectedImage(data.path);
      setUploadFile(null);
    },
  });

  // Get test calibration data
  const { data: testCalibration, refetch: refetchCalibration } = useQuery<CalibrationData>({
    queryKey: ['/api/test-mode/calibration'],
    retry: false,
  });

  // Hydrate calibration data from server on load
  if (testCalibration && !calibrationData) {
    setCalibrationData(testCalibration);
    setUseTestCalibration(true);
  }

  // Run calibration mutation
  const runCalibration = useMutation<CalibrationData, Error, string>({
    mutationFn: async (imagePath: string) => {
      const response = await fetch('/api/test-mode/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath, paperSize }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Calibration failed');
      }
      return response.json();
    },
    onSuccess: (data: CalibrationData) => {
      setCalibrationData(data);
      refetchCalibration();
      setUseTestCalibration(true);
    },
  });

  // Run detection mutation
  const runDetection = useMutation<TestResults, Error, { imagePath: string; useCalibration: boolean }>({
    mutationFn: async ({ imagePath, useCalibration }) => {
      const response = await fetch('/api/test-mode/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath, useTestCalibration: useCalibration }),
      });
      if (!response.ok) throw new Error('Detection failed');
      return response.json();
    },
    onSuccess: (data: TestResults) => {
      setTestResults(data);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadFile(e.target.files[0]);
    }
  };

  const handleUpload = () => {
    if (uploadFile) {
      uploadMutation.mutate(uploadFile);
    }
  };

  const handleRunCalibration = () => {
    if (selectedImage) {
      setCalibrationData(null);
      runCalibration.mutate(selectedImage);
    }
  };

  const handleRunTest = () => {
    if (selectedImage) {
      setTestResults(null);
      runDetection.mutate({ imagePath: selectedImage, useCalibration: useTestCalibration });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return ms.toFixed(0) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Test Mode</h1>
          <p className="text-gray-400 mt-1">
            Test detection in Replit with Pi hardware simulation
          </p>
        </div>
        
        <div className="flex items-center space-x-3 bg-gray-800 px-4 py-3 rounded-lg border border-gray-700">
          <Label htmlFor="simulation-toggle" className="text-gray-300">
            Pi Simulation
          </Label>
          <Switch
            id="simulation-toggle"
            checked={status?.simulationEnabled ?? true}
            onCheckedChange={(checked) => toggleSimulation.mutate(checked)}
            data-testid="switch-simulation"
          />
          {status?.simulationEnabled && (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
              <Cpu className="w-3 h-3 mr-1" />
              Pi Mode
            </Badge>
          )}
        </div>
      </div>

      {status?.simulationEnabled && status.memory.limit > 0 && (
        <Alert className="bg-blue-500/10 border-blue-500/30">
          <AlertDescription className="text-blue-300">
            <div className="flex items-center justify-between">
              <span>
                <strong>Hardware Simulation Active:</strong> Testing with Pi Model B constraints
                (4-core ARM, 1.5GB RAM limit)
              </span>
              <div className="flex items-center space-x-2">
                <HardDrive className="w-4 h-4" />
                <span className="text-sm">
                  Memory: {status.memory.used.toFixed(0)}MB / {status.memory.limit}MB
                  ({status.memory.percentUsed.toFixed(1)}%)
                </span>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Image Selection & Upload */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Select Test Image</CardTitle>
            <CardDescription className="text-gray-400">
              Use calibration image or upload your own test photo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Upload New Image */}
            <div className="border-2 border-dashed border-gray-600 rounded-lg p-6 text-center">
              <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
                data-testid="input-upload-image"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer text-blue-400 hover:text-blue-300"
              >
                Choose an image file
              </label>
              {uploadFile && (
                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="text-gray-300">{uploadFile.name}</span>
                  <Button
                    onClick={handleUpload}
                    disabled={uploadMutation.isPending}
                    size="sm"
                    data-testid="button-upload"
                  >
                    {uploadMutation.isPending ? "Uploading..." : "Upload"}
                  </Button>
                </div>
              )}
            </div>

            <Separator className="bg-gray-700" />

            {/* Available Images */}
            <div className="space-y-2">
              <Label className="text-gray-300">Available Images</Label>
              {imagesData?.images && imagesData.images.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {imagesData.images.map((img) => (
                    <div
                      key={img.path}
                      onClick={() => setSelectedImage(img.path)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedImage === img.path
                          ? 'bg-blue-500/20 border-blue-500'
                          : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                      }`}
                      data-testid={`image-option-${img.source}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-medium truncate">
                              {img.fileName}
                            </span>
                            <Badge
                              variant={img.source === 'calibration' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {img.source}
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {formatBytes(img.size)} • {new Date(img.created).toLocaleString()}
                          </div>
                        </div>
                        {selectedImage === img.path && (
                          <CheckCircle2 className="w-5 h-5 text-blue-400 ml-2 flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No test images available. Upload one or run calibration first.
                </div>
              )}
            </div>

            {selectedImage && (
              <>
                <Separator className="bg-gray-700" />
                
                {/* Calibration Section */}
                <div className="space-y-3">
                  <Label className="text-gray-300">Step 1: Run ArUco Calibration</Label>
                  <div className="space-y-2">
                    <Select value={paperSize} onValueChange={setPaperSize}>
                      <SelectTrigger className="bg-gray-700 border-gray-600 text-white" data-testid="select-paper-size">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A4-landscape">A4 Landscape</SelectItem>
                        <SelectItem value="A4-portrait">A4 Portrait</SelectItem>
                        <SelectItem value="6-page-3x2">6-Page (3x2 A4)</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Button
                      onClick={handleRunCalibration}
                      disabled={runCalibration.isPending}
                      className="w-full"
                      variant="outline"
                      data-testid="button-run-calibration"
                    >
                      <ScanLine className="w-5 h-5 mr-2" />
                      {runCalibration.isPending ? "Running Calibration..." : "Run ArUco Calibration"}
                    </Button>
                  </div>
                  
                  {/* Calibration Results */}
                  {runCalibration.isError && (
                    <Alert className="bg-red-500/10 border-red-500/30">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <AlertDescription className="text-red-300">
                        {runCalibration.error?.message || "Calibration failed"}
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {calibrationData && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-green-400 mb-2">
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="font-medium">Calibration Successful!</span>
                      </div>
                      <div className="text-sm text-gray-300 space-y-1">
                        <div>✓ Detected {calibrationData.markersDetected} ArUco markers</div>
                        <div>✓ Paper size: {calibrationData.paperSize}</div>
                        <div>✓ Rectified image ready for detection</div>
                      </div>
                    </div>
                  )}
                </div>

                <Separator className="bg-gray-700" />
                
                {/* Detection Section */}
                <div className="space-y-3">
                  <Label className="text-gray-300">Step 2: Run QR Detection</Label>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="use-calibration"
                      checked={useTestCalibration}
                      onCheckedChange={(checked) => setUseTestCalibration(checked === true)}
                      disabled={!calibrationData}
                      data-testid="checkbox-use-calibration"
                    />
                    <label
                      htmlFor="use-calibration"
                      className={`text-sm ${calibrationData ? 'text-gray-300' : 'text-gray-500'}`}
                    >
                      Use rectified image from calibration
                    </label>
                  </div>
                  
                  <Button
                    onClick={handleRunTest}
                    disabled={runDetection.isPending}
                    className="w-full"
                    size="lg"
                    data-testid="button-run-test"
                  >
                    <PlayCircle className="w-5 h-5 mr-2" />
                    {runDetection.isPending ? "Running Detection..." : "Run QR Detection Test"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Results */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Test Results</CardTitle>
            <CardDescription className="text-gray-400">
              Detection results and performance metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            {runDetection.isPending && (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p className="text-gray-400">Processing image with Pi simulation...</p>
              </div>
            )}

            {runDetection.isError && (
              <Alert className="bg-red-500/10 border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <AlertDescription className="text-red-300">
                  Detection test failed. Check console for details.
                </AlertDescription>
              </Alert>
            )}

            {testResults && (
              <div className="space-y-6">
                {/* Performance Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <Clock className="w-4 h-4" />
                      Processing Time
                    </div>
                    <div className="text-2xl font-bold text-white">
                      {formatTime(testResults.processingTimeMs)}
                    </div>
                    {testResults.simulationEnabled && (
                      <div className="text-xs text-blue-400 mt-1">Pi simulated</div>
                    )}
                  </div>
                  
                  <div className="bg-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <CheckCircle2 className="w-4 h-4" />
                      Detected
                    </div>
                    <div className="text-2xl font-bold text-white">
                      {testResults.detectedCount} / {testResults.slotCount}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {((testResults.detectedCount / testResults.slotCount) * 100).toFixed(0)}% detection rate
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Detection Results */}
                <div>
                  <Label className="text-gray-300 mb-3 block">Slot Detection Results</Label>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {testResults.results.map((result) => (
                      <div
                        key={result.slotId}
                        className="bg-gray-700 rounded-lg p-3 border border-gray-600"
                        data-testid={`result-${result.slotId}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {result.detected ? (
                              <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                            ) : (
                              <XCircle className="w-5 h-5 text-gray-500 flex-shrink-0" />
                            )}
                            <div>
                              <div className="text-white font-medium">{result.slotId}</div>
                              <div className="text-xs text-gray-400">
                                Expected: {result.qrData}
                              </div>
                              {result.detected && result.detectedQrData && (
                                <div className="text-xs text-green-400 mt-1">
                                  Detected: {result.detectedQrData}
                                </div>
                              )}
                            </div>
                          </div>
                          {result.qrType && (
                            <Badge
                              variant={result.qrType === 'slot' ? 'destructive' : 'default'}
                              className="text-xs"
                            >
                              {result.qrType === 'slot' ? 'Missing' : 'Checked Out'}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!testResults && !runDetection.isPending && !runDetection.isError && (
              <div className="text-center py-12 text-gray-500">
                Select an image and click "Run Detection Test" to see results
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
