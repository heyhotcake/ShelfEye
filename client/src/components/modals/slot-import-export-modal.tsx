import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { Download, Upload, AlertCircle, CheckCircle, FileJson } from "lucide-react";

interface SlotImportExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cameraId?: string;
  cameraName?: string;
}

interface ValidationError {
  slotId: string;
  code: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export function SlotImportExportModal({ open, onOpenChange, cameraId, cameraName }: SlotImportExportModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [importData, setImportData] = useState<any>(null);
  const [importStep, setImportStep] = useState<'upload' | 'validate' | 'confirm'>('upload');

  // Export slots for current camera
  const exportSlots = async () => {
    if (!cameraId) {
      toast({
        title: "No Camera Selected",
        description: "Please select a camera to export slots",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch(`/api/slots/export/${cameraId}`);
      if (!response.ok) {
        throw new Error("Failed to export slots");
      }

      const exportData = await response.json();
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `slots_${cameraName || cameraId}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Slots Exported",
        description: `Downloaded ${exportData.slots?.length || 0} slots for ${cameraName || 'camera'}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export slots",
        variant: "destructive",
      });
    }
  };

  // Validate slots from file
  const validateMutation = useMutation({
    mutationFn: async (data: { json: any; targetCameraId: string }) => {
      try {
        const response = await apiRequest('POST', '/api/slots/import', {
          ...data,
          validateOnly: true
        });
        const result = await response.json();
        
        // Successful validation (200 response means no errors, but may have warnings)
        return {
          valid: true,  // 200 = validation passed
          errors: [],
          warnings: result.warnings || []
        };
      } catch (error: any) {
        // Handle 400 validation errors
        // apiRequest throws errors as "STATUS: BODY", extract the JSON body
        if (error.message && error.message.startsWith('400:')) {
          try {
            const jsonBody = error.message.substring(4).trim(); // Remove "400:" prefix
            const errorData = JSON.parse(jsonBody);
            return {
              valid: false,
              errors: errorData.errors || [],
              warnings: errorData.warnings || []
            };
          } catch (parseError) {
            // Fallback if we can't parse the JSON
            console.error('Failed to parse validation error response:', parseError);
            throw error;
          }
        }
        throw error;
      }
    },
    onSuccess: (result) => {
      setValidationResult(result);
      if (result.valid) {
        if (result.warnings.length > 0) {
          // Has warnings - show them and allow user to proceed
          setImportStep('confirm');
          toast({
            title: "Validation Passed with Warnings",
            description: `${importData.slots.length} slots validated. Review ${result.warnings.length} warnings below before importing.`,
          });
        } else {
          // No errors, no warnings - ready to import
          setImportStep('confirm');
          toast({
            title: "Validation Passed",
            description: `All ${importData.slots.length} slots are valid and ready to import`,
          });
        }
      } else {
        // Has errors - block import
        setImportStep('validate');
        toast({
          title: "Validation Failed",
          description: `Found ${result.errors.length} errors${result.warnings.length > 0 ? ` and ${result.warnings.length} warnings` : ''}. Fix errors before importing.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      setImportStep('upload');
      toast({
        title: "Validation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Import slots
  const importMutation = useMutation({
    mutationFn: async (data: { json: any; targetCameraId: string }) => {
      const response = await apiRequest('POST', '/api/slots/import', data);
      const result = await response.json();
      return result;
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/slots'] });
      toast({
        title: "Import Successful",
        description: `Imported ${result.imported} slots for ${cameraName || 'camera'}`,
      });
      onOpenChange(false);
      resetState();
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Basic structure validation
        if (!data.cameraId || !Array.isArray(data.slots)) {
          throw new Error("Invalid file format. Expected cameraId and slots array.");
        }

        if (data.cameraId !== cameraId) {
          toast({
            title: "Camera Mismatch",
            description: `File is for camera ${data.cameraId}, but you have ${cameraName} selected. Import anyway?`,
          });
        }

        if (!cameraId) {
          toast({
            title: "No Camera Selected",
            description: "Please select a camera before importing slots",
            variant: "destructive",
          });
          return;
        }

        setImportData(data);
        setImportStep('validate');
        validateMutation.mutate({ json: data, targetCameraId: cameraId });
      } catch (error) {
        toast({
          title: "Invalid File",
          description: error instanceof Error ? error.message : "Failed to parse JSON file",
          variant: "destructive",
        });
      }
    };
    input.click();
  };

  const confirmImport = () => {
    if (!importData || !cameraId) return;
    importMutation.mutate({ json: importData, targetCameraId: cameraId });
  };

  const resetState = () => {
    setImportData(null);
    setValidationResult(null);
    setImportStep('upload');
  };

  const handleClose = () => {
    // If we're in the confirm step with validation results showing,
    // require explicit user action (don't allow accidental dismissal)
    if (importStep === 'confirm' && validationResult) {
      // User must click Cancel button explicitly
      return;
    }
    
    onOpenChange(false);
    setTimeout(resetState, 300);
  };

  const handleCancel = () => {
    // Explicit cancel action - always close
    onOpenChange(false);
    setTimeout(resetState, 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" data-testid="dialog-slot-import-export">
        <DialogHeader>
          <DialogTitle>Slot Import/Export</DialogTitle>
          <DialogDescription>
            {cameraName ? `Managing slots for ${cameraName}` : 'Select a camera to manage slots'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Export Section */}
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export Current Slots
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Download all slots for the selected camera as a JSON file
            </p>
            <Button
              onClick={exportSlots}
              disabled={!cameraId}
              data-testid="button-export-slots"
              variant="outline"
            >
              <Download className="w-4 h-4 mr-2" />
              Export to JSON
            </Button>
          </div>

          {/* Import Section */}
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Import Slots from File
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Upload a JSON file to import and validate slot configurations
            </p>

            {importStep === 'upload' && (
              <Button
                onClick={handleFileUpload}
                disabled={!cameraId || validateMutation.isPending}
                data-testid="button-import-slots"
              >
                <Upload className="w-4 h-4 mr-2" />
                {validateMutation.isPending ? 'Validating...' : 'Select JSON File'}
              </Button>
            )}

            {/* Validation Results */}
            {validationResult && importStep !== 'upload' && (
              <div className="space-y-3 mt-4">
                <Alert variant={validationResult.valid ? "default" : "destructive"}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {validationResult.valid ? (
                      <>
                        <CheckCircle className="w-4 h-4 inline mr-2" />
                        All {importData?.slots?.length || 0} slots validated successfully
                      </>
                    ) : (
                      <>
                        Found {validationResult.errors.length} errors and {validationResult.warnings.length} warnings
                      </>
                    )}
                  </AlertDescription>
                </Alert>

                {/* Errors Table */}
                {validationResult.errors.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-destructive">Errors</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Slot ID</TableHead>
                          <TableHead>Field</TableHead>
                          <TableHead>Error Code</TableHead>
                          <TableHead>Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validationResult.errors.map((error, idx) => (
                          <TableRow key={idx} data-testid={`error-row-${idx}`}>
                            <TableCell className="font-mono text-sm">{error.slotId}</TableCell>
                            <TableCell className="font-mono text-sm">{error.field}</TableCell>
                            <TableCell>
                              <Badge variant="destructive" className="font-mono text-xs">
                                {error.code}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{error.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Warnings Table */}
                {validationResult.warnings.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-yellow-600">Warnings</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Slot ID</TableHead>
                          <TableHead>Field</TableHead>
                          <TableHead>Warning Code</TableHead>
                          <TableHead>Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validationResult.warnings.map((warning, idx) => (
                          <TableRow key={idx} data-testid={`warning-row-${idx}`}>
                            <TableCell className="font-mono text-sm">{warning.slotId}</TableCell>
                            <TableCell className="font-mono text-sm">{warning.field}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs border-yellow-600 text-yellow-600">
                                {warning.code}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{warning.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={importStep === 'confirm' ? handleCancel : handleClose} 
            data-testid="button-cancel"
          >
            {importStep === 'confirm' ? 'Cancel' : 'Close'}
          </Button>
          {importStep === 'validate' && !validationResult?.valid && (
            <Button
              variant="outline"
              onClick={() => {
                resetState();
              }}
              data-testid="button-try-again"
            >
              <FileJson className="w-4 h-4 mr-2" />
              Try Another File
            </Button>
          )}
          {importStep === 'confirm' && validationResult?.valid && (
            <Button
              onClick={confirmImport}
              disabled={importMutation.isPending}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? 'Importing...' : `Import ${importData?.slots?.length || 0} Slots`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
