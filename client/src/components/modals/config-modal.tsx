import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, downloadFile, uploadFile } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, FileCode, FileText, RotateCcw, X } from "lucide-react";

interface ConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SystemConfig {
  key: string;
  value: any;
  description: string | null;
  updatedAt: string;
}

export function ConfigModal({ open, onOpenChange }: ConfigModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dragActive, setDragActive] = useState(false);

  const { data: config, isLoading } = useQuery<SystemConfig[]>({
    queryKey: ['/api/config'],
    enabled: open,
  });

  const { data: slots } = useQuery({
    queryKey: ['/api/slots'],
    enabled: open,
  });

  const { data: cameras } = useQuery({
    queryKey: ['/api/cameras'],
    enabled: open,
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ key, value, description }: { key: string; value: any; description?: string }) =>
      apiRequest('POST', '/api/config', { key, value, description }),
    onSuccess: () => {
      toast({
        title: "Configuration Updated",
        description: "Settings saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/config'] });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const exportConfig = async (format: 'yaml' | 'json') => {
    try {
      await downloadFile(`/api/config/export?format=${format}`, `tool-tracker-config.${format}`);
      toast({
        title: "Export Successful",
        description: `Configuration exported as ${format.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      await uploadFile('/api/config/import', file);
      toast({
        title: "Import Successful",
        description: "Configuration imported successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/config'] });
    } catch (error) {
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const configSections = {
    'BUSINESS_HOURS': { label: 'Business Hours', type: 'text' },
    'EMAIL_RECIPIENTS': { label: 'Email Recipients', type: 'json' },
    'GOOGLE_SHEETS_ID': { label: 'Google Sheets ID', type: 'text' },
    'SMTP_CONFIG': { label: 'SMTP Configuration', type: 'json' },
    'CAPTURE_SCHEDULE': { label: 'Capture Schedule', type: 'json' },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold text-foreground">
                System Configuration
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">Export, import, and manage system settings</p>
            </div>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-close-config"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>
        
        <div className="space-y-6 p-6">
          {/* Current Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Current Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Configured Slots</p>
                  <p className="font-mono font-medium text-foreground" data-testid="text-configured-slots">{slots?.length || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Active Cameras</p>
                  <p className="font-mono font-medium text-foreground" data-testid="text-active-cameras">{cameras?.filter((c: any) => c.isActive).length || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Capture Schedule</p>
                  <p className="font-mono font-medium text-foreground" data-testid="text-capture-schedule">8:00, 11:00, 14:00, 17:00</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Alert Recipients</p>
                  <p className="font-mono font-medium text-foreground" data-testid="text-alert-recipients">3 emails</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Configuration Settings */}
          {!isLoading && config && (
            <Card>
              <CardHeader>
                <CardTitle>Configuration Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {config.map((setting) => {
                  const section = configSections[setting.key as keyof typeof configSections];
                  if (!section) return null;
                  
                  return (
                    <div key={setting.key} className="space-y-2">
                      <label className="text-sm font-medium text-foreground">{section.label}</label>
                      {setting.description && (
                        <p className="text-xs text-muted-foreground">{setting.description}</p>
                      )}
                      
                      {section.type === 'json' ? (
                        <Textarea
                          value={JSON.stringify(setting.value, null, 2)}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value);
                              updateConfigMutation.mutate({
                                key: setting.key,
                                value: parsed,
                                description: setting.description || undefined,
                              });
                            } catch (error) {
                              // Invalid JSON, don't update yet
                            }
                          }}
                          className="font-mono text-sm"
                          rows={4}
                          data-testid={`textarea-${setting.key.toLowerCase().replace(/_/g, '-')}`}
                        />
                      ) : (
                        <Input
                          value={typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value)}
                          onChange={(e) => updateConfigMutation.mutate({
                            key: setting.key,
                            value: e.target.value,
                            description: setting.description || undefined,
                          })}
                          data-testid={`input-${setting.key.toLowerCase().replace(/_/g, '-')}`}
                        />
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
          
          {/* Export Section */}
          <Card>
            <CardHeader>
              <CardTitle>Export Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Button 
                  className="flex-1"
                  onClick={() => exportConfig('yaml')}
                  data-testid="button-export-yaml"
                >
                  <FileCode className="w-4 h-4 mr-2" />
                  Export as YAML
                </Button>
                <Button 
                  variant="outline"
                  className="flex-1"
                  onClick={() => exportConfig('json')}
                  data-testid="button-export-json"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Export as JSON
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Includes slots, cameras, schedules, and alert settings
              </p>
            </CardContent>
          </Card>
          
          {/* Import Section */}
          <Card>
            <CardHeader>
              <CardTitle>Import Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive ? 'border-primary bg-primary/10' : 'border-border'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                data-testid="drop-zone-import"
              >
                <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-foreground mb-2">Drop YAML or JSON file here</p>
                <p className="text-xs text-muted-foreground mb-4">or click to browse</p>
                <Button 
                  variant="outline"
                  onClick={() => document.getElementById('file-input')?.click()}
                  data-testid="button-choose-file"
                >
                  Choose File
                </Button>
                <input
                  id="file-input"
                  type="file"
                  accept=".yaml,.yml,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
              </div>
              
              <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-sm text-amber-500">
                  ⚠️ Importing will override current configuration. Create a backup first.
                </p>
              </div>
            </CardContent>
          </Card>
          
          {/* Backup History */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Backups</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="flex items-center gap-3">
                  <FileCode className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-foreground">config_2025-01-09.yaml</p>
                    <p className="text-xs text-muted-foreground">5.2 KB • 2 hours ago</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    data-testid="button-restore-latest"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Restore
                  </Button>
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="text-primary"
                    data-testid="button-download-latest"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="flex items-center gap-3">
                  <FileCode className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">config_2025-01-08.yaml</p>
                    <p className="text-xs text-muted-foreground">5.1 KB • 1 day ago</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    data-testid="button-restore-previous"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Restore
                  </Button>
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="text-primary"
                    data-testid="button-download-previous"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
