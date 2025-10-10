import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { QrCode, Download, FileImage, Printer, X } from "lucide-react";

interface QRGeneratorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface QRGenerationRequest {
  type: 'tool' | 'worker';
  id: string;
  toolType?: string;
  workerName?: string;
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  moduleSize: number;
  includeHmac: boolean;
}

interface QRGenerationResult {
  ok: boolean;
  payload: any;
  qrCode: string;
  dimensions: { width: number; height: number };
}

export function QRGeneratorModal({ open, onOpenChange }: QRGeneratorModalProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<QRGenerationRequest>({
    type: 'tool',
    id: '',
    toolType: '',
    workerName: '',
    errorCorrection: 'L',
    moduleSize: 25,
    includeHmac: true,
  });
  const [generatedQR, setGeneratedQR] = useState<QRGenerationResult | null>(null);

  const generateQRMutation = useMutation({
    mutationFn: (data: QRGenerationRequest) => apiRequest('POST', '/api/qr-generate', data),
    onSuccess: async (response) => {
      const result: QRGenerationResult = await response.json();
      setGeneratedQR(result);
      toast({
        title: "QR Code Generated",
        description: "QR code created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    if (!formData.id) {
      toast({
        title: "Missing Information",
        description: "Please provide an ID",
        variant: "destructive",
      });
      return;
    }

    if (formData.type === 'tool' && !formData.toolType) {
      toast({
        title: "Missing Information",
        description: "Please provide a tool type",
        variant: "destructive",
      });
      return;
    }

    if (formData.type === 'worker' && !formData.workerName) {
      toast({
        title: "Missing Information",
        description: "Please provide a worker name",
        variant: "destructive",
      });
      return;
    }

    generateQRMutation.mutate(formData);
  };

  const downloadQR = (format: 'png' | 'pdf') => {
    if (!generatedQR) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      if (format === 'png') {
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `qr-${formData.id}.png`;
            link.click();
            URL.revokeObjectURL(url);
          }
        });
      } else {
        toast({
          title: "PDF Export",
          description: "PDF export requires additional setup",
          variant: "destructive",
        });
      }
    };
    img.src = `data:image/png;base64,${generatedQR.qrCode}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold text-foreground">
                QR Code Generator
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">Generate signed QR codes for tools and worker badges</p>
            </div>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-close-qr-generator"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
          {/* QR Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>QR Configuration</CardTitle>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="qrType">QR Type</Label>
                <Select 
                  value={formData.type} 
                  onValueChange={(value: 'tool' | 'worker') => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger id="qrType" data-testid="select-qr-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tool">Tool Tag</SelectItem>
                    <SelectItem value="worker">Worker Badge</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="qrId">{formData.type === 'tool' ? 'Tool ID' : 'Worker ID'}</Label>
                <Input 
                  id="qrId"
                  placeholder={formData.type === 'tool' ? 'e.g., S001' : 'e.g., W001'}
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  data-testid="input-qr-id"
                />
              </div>
              
              {formData.type === 'tool' ? (
                <div>
                  <Label htmlFor="toolType">Tool Type</Label>
                  <Input 
                    id="toolType"
                    placeholder="e.g., Scissors"
                    value={formData.toolType}
                    onChange={(e) => setFormData({ ...formData, toolType: e.target.value })}
                    data-testid="input-tool-type"
                  />
                </div>
              ) : (
                <div>
                  <Label htmlFor="workerName">Worker Name</Label>
                  <Input 
                    id="workerName"
                    placeholder="e.g., Y. Tanaka"
                    value={formData.workerName}
                    onChange={(e) => setFormData({ ...formData, workerName: e.target.value })}
                    data-testid="input-worker-name"
                  />
                </div>
              )}
              
              <div>
                <Label htmlFor="errorCorrection">Error Correction Level</Label>
                <Select 
                  value={formData.errorCorrection} 
                  onValueChange={(value: 'L' | 'M' | 'Q' | 'H') => setFormData({ ...formData, errorCorrection: value })}
                >
                  <SelectTrigger id="errorCorrection" data-testid="select-error-correction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">L (7%)</SelectItem>
                    <SelectItem value="M">M (15%)</SelectItem>
                    <SelectItem value="Q">Q (25%)</SelectItem>
                    <SelectItem value="H">H (30%) - Recommended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="moduleSize">Module Size (mm)</Label>
                <Input 
                  id="moduleSize"
                  type="number"
                  min="20"
                  max="35"
                  value={formData.moduleSize}
                  onChange={(e) => setFormData({ ...formData, moduleSize: parseInt(e.target.value) })}
                  data-testid="input-module-size"
                />
              </div>
              
              <div className="pt-4 border-t border-border">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="includeHmac"
                    checked={formData.includeHmac}
                    onCheckedChange={(checked) => setFormData({ ...formData, includeHmac: !!checked })}
                    data-testid="checkbox-include-hmac"
                  />
                  <Label htmlFor="includeHmac" className="text-sm text-foreground">
                    Include HMAC signature
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Prevents QR code spoofing</p>
              </div>
              
              <Button 
                className="w-full"
                onClick={handleGenerate}
                disabled={generateQRMutation.isPending}
                data-testid="button-generate-qr"
              >
                <QrCode className="w-4 h-4 mr-2" />
                {generateQRMutation.isPending ? 'Generating...' : 'Generate QR Code'}
              </Button>
            </CardContent>
          </Card>
          
          {/* QR Preview & Download */}
          <Card>
            <CardHeader>
              <CardTitle>Preview & Download</CardTitle>
            </CardHeader>
            
            <CardContent>
              <div className="bg-white rounded-lg p-8 flex items-center justify-center mb-4">
                {generatedQR ? (
                  <img 
                    src={`data:image/png;base64,${generatedQR.qrCode}`}
                    alt="Generated QR Code"
                    className="max-w-64 max-h-64"
                    data-testid="img-generated-qr"
                  />
                ) : (
                  <div className="w-64 h-64 bg-gray-200 flex items-center justify-center rounded">
                    <QrCode className="w-16 h-16 text-gray-400" />
                  </div>
                )}
              </div>
              
              {generatedQR && (
                <div className="space-y-3">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Payload Preview</p>
                      <pre className="text-xs font-mono text-foreground overflow-auto bg-muted p-2 rounded">
                        {JSON.stringify(generatedQR.payload, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <Button 
                      variant="outline"
                      onClick={() => downloadQR('png')}
                      data-testid="button-download-png"
                    >
                      <FileImage className="w-4 h-4 mr-2" />
                      PNG
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => downloadQR('pdf')}
                      data-testid="button-download-pdf"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      PDF
                    </Button>
                  </div>
                  
                  <Button 
                    variant="outline"
                    className="w-full"
                    data-testid="button-print-label"
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print Label ({formData.moduleSize}mm x {formData.moduleSize}mm)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
