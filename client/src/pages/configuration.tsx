import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiCall } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { X, Plus, Camera, Trash, Power, Lightbulb, Search, Edit } from "lucide-react";

interface SystemConfig {
  key: string;
  value: any;
  description: string | null;
  updatedAt: string;
}

export default function Configuration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery<SystemConfig[]>({
    queryKey: ['/api/config'],
  });

  const { data: slots } = useQuery<any[]>({
    queryKey: ['/api/slots'],
  });

  const { data: cameras } = useQuery<any[]>({
    queryKey: ['/api/cameras'],
  });

  const [newCameraName, setNewCameraName] = useState("");
  const [newCameraDevice, setNewCameraDevice] = useState("0");
  const [newCameraDevicePath, setNewCameraDevicePath] = useState("");
  const [showDetectedCameras, setShowDetectedCameras] = useState(false);
  const [detectedCameras, setDetectedCameras] = useState<any[]>([]);
  
  // Edit camera state
  const [editingCamera, setEditingCamera] = useState<any>(null);
  const [editCameraName, setEditCameraName] = useState("");
  const [editResolutionWidth, setEditResolutionWidth] = useState("");
  const [editResolutionHeight, setEditResolutionHeight] = useState("");
  
  // Email input state
  const [newEmailInput, setNewEmailInput] = useState("");

  const detectCamerasMutation = useMutation({
    mutationFn: async () => {
      const result = await apiCall('GET', '/api/cameras/detect');
      if (!result.ok || !result.data) {
        throw new Error(result.error || 'Failed to detect cameras');
      }
      return result.data;
    },
    onSuccess: (data: any) => {
      if (data.success && data.cameras && data.cameras.length > 0) {
        setDetectedCameras(data.cameras);
        setShowDetectedCameras(true);
        toast({
          title: "Cameras Detected",
          description: `Found ${data.cameras.length} available camera(s)`,
        });
      } else {
        toast({
          title: "No Cameras Found",
          description: "No available cameras detected on this system",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Detection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createCameraMutation = useMutation({
    mutationFn: (cameraData: { name: string; deviceIndex?: number; devicePath?: string }) =>
      apiRequest('POST', '/api/cameras', cameraData),
    onSuccess: () => {
      toast({
        title: "Camera Added",
        description: "New camera added successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/cameras'] });
      setNewCameraName("");
      setNewCameraDevice("0");
      setNewCameraDevicePath("");
    },
    onError: (error) => {
      toast({
        title: "Failed to Add Camera",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleCameraMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest('PUT', `/api/cameras/${id}`, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/api/cameras'] });
      await queryClient.refetchQueries({ queryKey: ['/api/cameras'] });
    },
  });

  const updateCameraMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: any }) =>
      apiRequest('PUT', `/api/cameras/${id}`, updates),
    onSuccess: async () => {
      toast({
        title: "Camera Updated",
        description: "Camera settings saved successfully",
      });
      setEditingCamera(null);
      await queryClient.invalidateQueries({ queryKey: ['/api/cameras'] });
      await queryClient.refetchQueries({ queryKey: ['/api/cameras'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Camera",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteCameraMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/cameras/${id}`),
    onSuccess: async () => {
      toast({
        title: "Camera Deleted",
        description: "Camera removed successfully",
      });
      await queryClient.invalidateQueries({ queryKey: ['/api/cameras'] });
      await queryClient.refetchQueries({ queryKey: ['/api/cameras'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Camera",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const checkCapabilitiesMutation = useMutation({
    mutationFn: async (cameraId: string) => {
      const result = await apiCall('GET', `/api/cameras/${cameraId}/capabilities`);
      if (!result.ok || !result.data) {
        throw new Error(result.error || 'Failed to check camera capabilities');
      }
      return result.data;
    },
    onSuccess: (data: any) => {
      // Create formatted message from output
      const output = data.output || 'No capability information available';
      toast({
        title: `${data.cameraName} - Supported Resolutions`,
        description: (
          <pre className="text-xs whitespace-pre-wrap max-h-96 overflow-y-auto font-mono">
            {output}
          </pre>
        ),
        duration: 15000,
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Check Capabilities",
        description: error.message,
        variant: "destructive",
      });
    },
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

  const lightControlMutation = useMutation({
    mutationFn: (action: 'on' | 'off') => {
      console.log('[Light Control] Sending action:', action);
      return apiRequest('POST', '/api/gpio/light', { action });
    },
    onSuccess: (data: any) => {
      console.log('[Light Control] Received response:', data);
      console.log('[Light Control] data.message:', data.message);
      console.log('[Light Control] data.action:', data.action);
      toast({
        title: "Light Control",
        description: data.message || `Light ${data.action === 'on' ? 'turned on' : 'turned off'}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Light Control Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const alertLEDMutation = useMutation({
    mutationFn: (action: 'flash' | 'stop' | 'test') => {
      if (action === 'test') {
        return apiRequest('POST', '/api/alert-led/test');
      } else if (action === 'stop') {
        return apiRequest('POST', '/api/alert-led/stop');
      } else {
        return apiRequest('POST', '/api/alert-led/flash', { pattern: 'fast' });
      }
    },
    onSuccess: (data: any) => {
      toast({
        title: "Alert LED",
        description: data.message || 'Alert LED action completed',
      });
    },
    onError: (error) => {
      toast({
        title: "Alert LED Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const configSections = {
    'BUSINESS_HOURS': { label: 'Business Hours', type: 'text' },
    'EMAIL_RECIPIENTS': { label: 'Email Recipients', type: 'email_list' },
    'GOOGLE_SHEETS_ID': { label: 'Google Sheets ID', type: 'text' },
    'SMTP_CONFIG': { label: 'SMTP Configuration', type: 'json' },
    'CAPTURE_SCHEDULE': { label: 'Capture Schedule', type: 'json' },
  };

  if (isLoading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="configuration-title">
                System Configuration
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Export, import, and manage system settings</p>
            </div>
            <Button variant="outline" size="sm" data-testid="button-close-config">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
          <div className="space-y-6">
            
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

            {/* Camera Management */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="w-5 h-5" />
                    Camera Management
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => detectCamerasMutation.mutate()}
                    disabled={detectCamerasMutation.isPending}
                    data-testid="button-detect-cameras"
                  >
                    <Search className="w-4 h-4 mr-2" />
                    {detectCamerasMutation.isPending ? "Detecting..." : "Detect Cameras"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Existing Cameras */}
                {cameras && cameras.length > 0 ? (
                  <div className="space-y-2">
                    {cameras.map((camera: any) => (
                      <div
                        key={camera.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Camera className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-foreground">{camera.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {camera.devicePath ? (
                                <>
                                  {camera.devicePath} • {camera.resolution || '2560x1440'}
                                </>
                              ) : (
                                <>
                                  Device {camera.deviceIndex} • {camera.resolution || '2560x1440'}
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            className={
                              camera.isActive
                                ? "bg-green-500/20 text-green-500 border-green-500/30"
                                : "bg-muted text-muted-foreground border-border"
                            }
                          >
                            {camera.isActive ? "Active" : "Inactive"}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => checkCapabilitiesMutation.mutate(camera.id)}
                            disabled={checkCapabilitiesMutation.isPending}
                            title="Check supported resolutions"
                            data-testid={`button-check-capabilities-${camera.id}`}
                          >
                            <Search className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingCamera(camera);
                              setEditCameraName(camera.name);
                              setEditResolutionWidth(camera.resolution?.[0]?.toString() || "1920");
                              setEditResolutionHeight(camera.resolution?.[1]?.toString() || "1080");
                            }}
                            data-testid={`button-edit-camera-${camera.id}`}
                          >
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              toggleCameraMutation.mutate({
                                id: camera.id,
                                isActive: !camera.isActive,
                              })
                            }
                            data-testid={`button-toggle-camera-${camera.id}`}
                          >
                            <Power className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteCameraMutation.mutate(camera.id)}
                            data-testid={`button-delete-camera-${camera.id}`}
                          >
                            <Trash className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No cameras configured. Add a camera below.
                  </p>
                )}

                {/* Add New Camera */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-3">Add New Camera</h4>
                  <div>
                    <Label htmlFor="camera-name">Camera Name</Label>
                    <Input
                      id="camera-name"
                      placeholder="e.g., Camera Station A"
                      value={newCameraName}
                      onChange={(e) => setNewCameraName(e.target.value)}
                      data-testid="input-camera-name"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Device index will be assigned automatically. Use "Detect Available Cameras" to select a specific device.
                    </p>
                  </div>
                  <Button
                    className="w-full mt-3"
                    onClick={() => {
                      const cameraData: any = { name: newCameraName };
                      
                      // Include device path if provided (from detected cameras)
                      if (newCameraDevicePath) {
                        cameraData.devicePath = newCameraDevicePath;
                      }
                      
                      createCameraMutation.mutate(cameraData);
                    }}
                    disabled={!newCameraName || createCameraMutation.isPending}
                    data-testid="button-add-camera"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {createCameraMutation.isPending ? "Adding..." : "Add Camera"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Alert LED Control */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Power className="w-5 h-5 text-red-500" />
                  Alert LED Control
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-3">
                      Red flashing LED that activates automatically when errors occur (tool missing, QR failures, camera issues).
                      Test the alert LED or manually control it here.
                    </p>
                    <div className="flex gap-3">
                      <Button
                        onClick={() => alertLEDMutation.mutate('test')}
                        disabled={alertLEDMutation.isPending}
                        variant="outline"
                        data-testid="button-test-alert-led"
                      >
                        Test Alert (5s Flash)
                      </Button>
                      <Button
                        onClick={() => alertLEDMutation.mutate('flash')}
                        disabled={alertLEDMutation.isPending}
                        variant="destructive"
                        data-testid="button-start-flash"
                      >
                        Start Flashing
                      </Button>
                      <Button
                        onClick={() => alertLEDMutation.mutate('stop')}
                        disabled={alertLEDMutation.isPending}
                        variant="secondary"
                        data-testid="button-stop-flash"
                      >
                        Stop Flash
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* LED Light Strip Control */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="w-5 h-5" />
                  LED Light Strip Control
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-3">
                      Controls the LED light strip on GPIO 18 for consistent lighting during captures.
                      The light automatically turns on before captures and off after.
                    </p>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => lightControlMutation.mutate('on')}
                        disabled={lightControlMutation.isPending}
                        data-testid="button-light-on"
                      >
                        <Lightbulb className="w-4 h-4 mr-2" />
                        Turn On
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => lightControlMutation.mutate('off')}
                        disabled={lightControlMutation.isPending}
                        data-testid="button-light-off"
                      >
                        <Power className="w-4 h-4 mr-2" />
                        Turn Off
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <p><strong>GPIO Pin:</strong> 18 (Physical Pin 12)</p>
                    <p><strong>Connected to:</strong> LED Light Strip WS2812B (27 LEDs)</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Configuration Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Configuration Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {config?.map((setting) => {
                  const section = configSections[setting.key as keyof typeof configSections];
                  if (!section) return null;
                  
                  return (
                    <div key={setting.key} className="space-y-2">
                      <Label htmlFor={setting.key}>{section.label}</Label>
                      {setting.description && (
                        <p className="text-xs text-muted-foreground">{setting.description}</p>
                      )}
                      
                      {section.type === 'email_list' ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {(Array.isArray(setting.value) ? setting.value : []).map((email: string, idx: number) => (
                              <Badge 
                                key={idx} 
                                variant="secondary" 
                                className="px-3 py-1.5 text-sm flex items-center gap-2"
                                data-testid={`badge-email-${idx}`}
                              >
                                {email}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newList = (setting.value as string[]).filter((_, i) => i !== idx);
                                    updateConfigMutation.mutate({
                                      key: setting.key,
                                      value: newList,
                                      description: setting.description || undefined,
                                    });
                                  }}
                                  className="ml-1 hover:text-destructive"
                                  data-testid={`button-remove-email-${idx}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              type="email"
                              placeholder="Enter email address"
                              value={newEmailInput}
                              onChange={(e) => setNewEmailInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newEmailInput.trim()) {
                                  e.preventDefault();
                                  const currentList = Array.isArray(setting.value) ? setting.value : [];
                                  if (!currentList.includes(newEmailInput.trim())) {
                                    updateConfigMutation.mutate({
                                      key: setting.key,
                                      value: [...currentList, newEmailInput.trim()],
                                      description: setting.description || undefined,
                                    });
                                    setNewEmailInput("");
                                  }
                                }
                              }}
                              data-testid="input-add-email"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                if (newEmailInput.trim()) {
                                  const currentList = Array.isArray(setting.value) ? setting.value : [];
                                  if (!currentList.includes(newEmailInput.trim())) {
                                    updateConfigMutation.mutate({
                                      key: setting.key,
                                      value: [...currentList, newEmailInput.trim()],
                                      description: setting.description || undefined,
                                    });
                                    setNewEmailInput("");
                                  }
                                }
                              }}
                              data-testid="button-add-email"
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ) : section.type === 'json' ? (
                        <Textarea
                          id={setting.key}
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
                          id={setting.key}
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
            
          </div>
        </div>
      </main>

      {/* Detected Cameras Dialog */}
      <Dialog open={showDetectedCameras} onOpenChange={setShowDetectedCameras}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detected Cameras</DialogTitle>
            <DialogDescription>
              Found {detectedCameras.length} available camera(s). Click on a camera to use its device path.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            {detectedCameras.map((cam, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => {
                  // Prioritize device path for Raspberry Pi, fallback to index
                  if (cam.devicePath) {
                    setNewCameraDevicePath(cam.devicePath);
                    // Also set index if available for fallback
                    if (cam.deviceIndex !== null && cam.deviceIndex !== undefined) {
                      setNewCameraDevice(cam.deviceIndex.toString());
                    }
                    toast({
                      title: "Camera Selected",
                      description: `Device path: ${cam.devicePath}`,
                    });
                  } else if (cam.deviceIndex !== null && cam.deviceIndex !== undefined) {
                    setNewCameraDevice(cam.deviceIndex.toString());
                    setNewCameraDevicePath(""); // Clear path if only index available
                    toast({
                      title: "Camera Selected",
                      description: `Device index: ${cam.deviceIndex}`,
                    });
                  }
                  setShowDetectedCameras(false);
                }}
                data-testid={`detected-camera-${index}`}
              >
                <div className="flex items-center gap-3">
                  <Camera className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">{cam.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {cam.devicePath && <span className="font-mono">{cam.devicePath}</span>}
                      {cam.devicePath && cam.deviceIndex !== null && <span> • </span>}
                      {cam.deviceIndex !== null && <span>Index {cam.deviceIndex}</span>}
                      {cam.width && cam.height && (
                        <span> • {cam.width}x{cam.height}</span>
                      )}
                    </p>
                  </div>
                </div>
                <Badge variant="outline">Available</Badge>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Camera Dialog */}
      <Dialog open={!!editingCamera} onOpenChange={(open) => !open && setEditingCamera(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Camera Settings</DialogTitle>
            <DialogDescription>
              Update camera name and resolution. Recalibrate after changing resolution.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <Label htmlFor="edit-camera-name">Camera Name</Label>
              <Input
                id="edit-camera-name"
                value={editCameraName}
                onChange={(e) => setEditCameraName(e.target.value)}
                placeholder="e.g., Camera 2 (Shelf 2)"
                data-testid="input-edit-camera-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit-resolution-width">Resolution Width</Label>
                <Input
                  id="edit-resolution-width"
                  type="number"
                  value={editResolutionWidth}
                  onChange={(e) => setEditResolutionWidth(e.target.value)}
                  placeholder="1920"
                  data-testid="input-edit-resolution-width"
                />
                <p className="text-xs text-muted-foreground mt-1">Common: 1920, 2560, 3840</p>
              </div>
              <div>
                <Label htmlFor="edit-resolution-height">Resolution Height</Label>
                <Input
                  id="edit-resolution-height"
                  type="number"
                  value={editResolutionHeight}
                  onChange={(e) => setEditResolutionHeight(e.target.value)}
                  placeholder="1080"
                  data-testid="input-edit-resolution-height"
                />
                <p className="text-xs text-muted-foreground mt-1">Common: 1080, 1440, 2160</p>
              </div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                <strong>Important:</strong> After changing resolution, you must recalibrate the camera. The actual resolution used will be logged during calibration - check the server logs to verify.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setEditingCamera(null)}
                className="flex-1"
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const width = parseInt(editResolutionWidth);
                  const height = parseInt(editResolutionHeight);
                  
                  if (!editCameraName || isNaN(width) || isNaN(height)) {
                    toast({
                      title: "Invalid Input",
                      description: "Please provide valid camera name and resolution values",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  updateCameraMutation.mutate({
                    id: editingCamera.id,
                    updates: {
                      name: editCameraName,
                      resolution: [width, height],
                    },
                  });
                }}
                disabled={updateCameraMutation.isPending}
                className="flex-1"
                data-testid="button-save-camera"
              >
                {updateCameraMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
