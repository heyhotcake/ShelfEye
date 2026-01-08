import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Camera, Clock, CheckCircle, AlertTriangle, HelpCircle, ClipboardCheck, Users, Activity, XCircle, BellOff, Ruler } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";
import type { CaptureRun } from "@shared/schema";
import { CameraSelector } from "@/components/ui/camera-selector";

const TIMEZONE = "Asia/Tokyo";

interface AnalyticsSummary {
  totalSlots: number;
  activeSlots: number;
  statusCounts: {
    present: number;
    empty: number;
    checkedOut: number;
    occupied: number;
    error: number;
  };
  alertCounts: {
    pending: number;
    failed: number;
    active: number;
  };
  lastUpdate: string;
}

interface CaptureNowResponse {
  ok: boolean;
  camerasCaptured: number;
  slotsProcessed: number;
  failureCount: number;
  status: 'success' | 'partial_failure' | 'failure';
  results?: any[];
}

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(undefined);
  const [showResultsDialog, setShowResultsDialog] = useState(false);
  const [captureResults, setCaptureResults] = useState<CaptureNowResponse | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery<AnalyticsSummary>({
    queryKey: ['/api/analytics/summary'],
    refetchInterval: 30000,
  });

  const { data: latestCaptureRun } = useQuery<CaptureRun[]>({
    queryKey: ['/api/capture-runs'],
    queryFn: async () => {
      const response = await fetch('/api/capture-runs?limit=1');
      return response.json();
    },
  });

  const { data: cameras } = useQuery<any[]>({
    queryKey: ['/api/cameras'],
  });

  // Initialize selected camera to first camera or saved preference
  useEffect(() => {
    if (cameras && cameras.length > 0 && !selectedCameraId) {
      const savedCameraId = localStorage.getItem('selectedCameraId');
      const initialCameraId = savedCameraId && cameras.find(c => c.id === savedCameraId)
        ? savedCameraId
        : cameras[0].id;
      setSelectedCameraId(initialCameraId);
    }
  }, [cameras, selectedCameraId]);

  // Handle camera change
  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    localStorage.setItem('selectedCameraId', cameraId);
  };

  const selectedCamera = cameras?.find((c: any) => c.id === selectedCameraId);

  const { data: slots } = useQuery<any[]>({
    queryKey: ['/api/slots'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: detectionLogs } = useQuery<any[]>({
    queryKey: ['/api/detection-logs'],
    queryFn: async () => {
      const response = await fetch('/api/detection-logs?limit=100');
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Fetch recent alerts from alert queue
  const { data: alertQueue } = useQuery<any[]>({
    queryKey: ['/api/alert-queue'],
    refetchInterval: 30000,
  });

  // Fetch recent capture runs (includes diagnostic failures)
  const { data: recentCaptureRuns } = useQuery<CaptureRun[]>({
    queryKey: ['/api/capture-runs', { limit: 10 }],
    queryFn: async () => {
      const response = await fetch('/api/capture-runs?limit=10');
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Get calibration config for active camera card
  const { data: calibrationConfig } = useQuery<any>({
    queryKey: ['/api/config/calibration-info'],
    queryFn: async () => {
      const response = await fetch('/api/config/calibration-info');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Filter slots by selected camera and get their latest status
  const selectedCameraSlots = slots?.filter((slot: any) => slot.cameraId === selectedCamera?.id) || [];
  
  // Create a map of latest detection status for each slot
  const slotStatusMap = new Map();
  const logsArray = Array.isArray(detectionLogs) ? detectionLogs : [];
  logsArray.forEach((log: any) => {
    if (!slotStatusMap.has(log.slotId)) {
      slotStatusMap.set(log.slotId, {
        status: log.state,
        qrId: log.qrId,
        workerName: log.workerName,
        timestamp: log.timestamp,
      });
    }
  });

  const captureMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/capture-now'),
    onSuccess: async (response) => {
      const data: CaptureNowResponse = await response.json();
      setCaptureResults(data);
      setShowResultsDialog(true);
      
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/detection-logs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capture-runs'] });
    },
    onError: (error) => {
      toast({
        title: "Capture Failed", 
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const stopAlarmMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/alert-led/stop'),
    onSuccess: (data: any) => {
      toast({
        title: "Alarm Stopped",
        description: data.message || "Alert LED has been turned off",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Stop Alarm",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const formatJSTTimestamp = (timestamp: Date | string) => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const zonedDate = toZonedTime(date, TIMEZONE);
    return format(zonedDate, "yyyy-MM-dd HH:mm:ss", { timeZone: TIMEZONE });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-500 bg-green-500/20';
      case 'partial_failure':
        return 'text-amber-500 bg-amber-500/20';
      case 'failure':
        return 'text-red-500 bg-red-500/20';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ITEM_PRESENT':
        return <CheckCircle className="w-3 h-3 text-green-500" />;
      case 'EMPTY':
        return <AlertTriangle className="w-3 h-3 text-red-500" />;
      case 'CHECKED_OUT':
        return <ClipboardCheck className="w-3 h-3 text-blue-500" />;
      case 'TRAINING_ERROR':
        return <HelpCircle className="w-3 h-3 text-purple-500" />;
      default:
        return <HelpCircle className="w-3 h-3 text-amber-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      'ITEM_PRESENT': 'bg-green-500/20 text-green-500',
      'EMPTY': 'bg-red-500/20 text-red-500', 
      'CHECKED_OUT': 'bg-blue-500/20 text-blue-500',
      'TRAINING_ERROR': 'bg-purple-500/20 text-purple-500',
      default: 'bg-amber-500/20 text-amber-500',
    };
    
    return variants[status] || variants.default;
  };

  // Merge slots with their latest detection status
  const slotGrid = selectedCameraSlots.map((slot: any) => {
    const latestStatus = slotStatusMap.get(slot.id);
    return {
      slotId: slot.slotId,
      toolName: slot.toolName,
      status: latestStatus?.status || 'ITEM_PRESENT',
      qrId: latestStatus?.qrId || null,
      workerName: latestStatus?.workerName || null,
    };
  }).slice(0, 24); // Show first 24 slots

  if (summaryLoading) {
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
              <h2 className="text-2xl font-bold text-foreground" data-testid="dashboard-title">
                Monitoring Dashboard
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Last updated: <span className="font-mono">{summary ? formatJSTTimestamp(summary.lastUpdate) : '--'}</span>
              </p>
            </div>
            <div className="flex items-center gap-4">
              <CameraSelector
                cameras={cameras || []}
                selectedCameraId={selectedCameraId}
                onCameraChange={handleCameraChange}
              />
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-sm font-medium">System Online</span>
              </div>
              
              {latestCaptureRun && latestCaptureRun.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary" data-testid="badge-last-capture">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">
                    Last capture: <span className="font-mono font-medium">{formatJSTTimestamp(latestCaptureRun[0].timestamp)}</span>
                  </span>
                </div>
              )}
              
              <Button
                onClick={() => stopAlarmMutation.mutate()}
                disabled={stopAlarmMutation.isPending}
                variant="destructive"
                className="flex items-center gap-2"
                data-testid="button-stop-alarm-header"
              >
                <BellOff className="w-4 h-4" />
                {stopAlarmMutation.isPending ? 'Stopping...' : 'Stop Alarm'}
              </Button>
              
              <Button
                onClick={() => captureMutation.mutate()}
                disabled={captureMutation.isPending}
                className="flex items-center gap-2"
                data-testid="button-capture-now"
              >
                <Camera className="w-4 h-4" />
                {captureMutation.isPending ? 'Capturing...' : 'Capture Now'}
              </Button>
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
          
          {/* Active Camera Card - Only show when fully calibrated */}
          {calibrationConfig && (
            <Card className="mb-6 border-2 border-primary/50" data-testid="card-active-camera">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Camera className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-foreground">Active Camera & Template</h3>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-muted-foreground" />
                        <span className="text-foreground font-medium" data-testid="text-active-camera-name">
                          {calibrationConfig.cameraName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Ruler className="w-4 h-4 text-muted-foreground" />
                        <span className="text-foreground font-medium" data-testid="text-active-template">
                          {calibrationConfig.paperSize}
                        </span>
                      </div>
                      {calibrationConfig.timestamp && (
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <span className="text-muted-foreground font-mono text-xs" data-testid="text-calibration-timestamp">
                            {formatJSTTimestamp(calibrationConfig.timestamp)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium text-green-500">Calibrated</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  </div>
                  <span className="text-2xl font-bold text-foreground" data-testid="text-tools-present">
                    {summary?.statusCounts.present || 0}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">Tools Present</p>
                <p className="text-xs text-green-500 mt-1">
                  {summary ? Math.round((summary.statusCounts.present / summary.activeSlots) * 100) : 0}% of total
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  </div>
                  <span className="text-2xl font-bold text-foreground" data-testid="text-missing-tools">
                    {summary?.statusCounts.empty || 0}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">Missing Tools</p>
                <p className="text-xs text-red-500 mt-1">Alerts sent</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <ClipboardCheck className="w-5 h-5 text-blue-500" />
                  </div>
                  <span className="text-2xl font-bold text-foreground" data-testid="text-checked-out">
                    {summary?.statusCounts.checkedOut || 0}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">Checked Out</p>
                <p className="text-xs text-blue-500 mt-1">By workers</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <HelpCircle className="w-5 h-5 text-amber-500" />
                  </div>
                  <span className="text-2xl font-bold text-foreground" data-testid="text-occupied-no-qr">
                    {summary?.statusCounts.occupied || 0}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">Occupied No QR</p>
                <p className="text-xs text-amber-500 mt-1">Needs attention</p>
              </CardContent>
            </Card>
          </div>
          
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Tool Grid - {selectedCamera?.name || 'No Camera Selected'}</CardTitle>
                <div className="flex items-center gap-3">
                  <Select defaultValue="all">
                    <SelectTrigger className="w-40" data-testid="select-filter-status">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="empty">Empty Only</SelectItem>
                      <SelectItem value="present">Present Only</SelectItem>
                      <SelectItem value="checked-out">Checked Out</SelectItem>
                      <SelectItem value="errors">Errors</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Button variant="outline" size="sm" data-testid="button-fullscreen">
                    <Activity className="w-4 h-4 mr-2" />
                    Fullscreen
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            <CardContent>
              {slotGrid.length === 0 ? (
                <div className="py-12 text-center">
                  <Camera className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">No slots available for the calibrated camera</p>
                  <p className="text-xs text-muted-foreground mt-1">Please calibrate a camera and create slots first</p>
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-6 gap-3">
                    {slotGrid.map((slot) => {
                      const statusClass = 
                        slot.status === 'ITEM_PRESENT' ? 'border-green-500' :
                        slot.status === 'EMPTY' ? 'border-red-500' :
                        slot.status === 'CHECKED_OUT' ? 'border-blue-500' :
                        'border-amber-500';
                      
                      return (
                        <div
                          key={slot.slotId}
                          className={`grid-slot bg-secondary rounded-lg p-3 border-2 ${statusClass}`}
                          data-testid={`slot-${slot.slotId}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-mono text-muted-foreground">{slot.slotId}</span>
                            <div className={`w-3 h-3 rounded-full ${
                              slot.status === 'ITEM_PRESENT' ? 'status-present' :
                              slot.status === 'EMPTY' ? 'status-empty' :
                              slot.status === 'CHECKED_OUT' ? 'status-checked-out' :
                              'status-occupied'
                            }`}></div>
                          </div>
                          
                          <div className="aspect-square bg-muted rounded mb-2 flex items-center justify-center overflow-hidden">
                            {slot.status === 'EMPTY' && (
                              <AlertTriangle className="w-8 h-8 text-red-500/30" />
                            )}
                            {slot.status === 'CHECKED_OUT' && (
                              <ClipboardCheck className="w-8 h-8 text-blue-500/30" />
                            )}
                            {slot.status === 'ITEM_PRESENT' && (
                              <div className="w-full h-full bg-gradient-to-br from-green-500/20 to-green-600/10 rounded flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-green-500/50" />
                              </div>
                            )}
                            {slot.status === 'TRAINING_ERROR' && (
                              <div className="w-full h-full bg-gradient-to-br from-amber-500/20 to-amber-600/10 rounded flex items-center justify-center opacity-50">
                                <HelpCircle className="w-6 h-6 text-amber-500/50" />
                              </div>
                            )}
                          </div>
                          
                          <p className="text-xs font-medium text-foreground truncate">{slot.toolName}</p>
                          
                          {slot.status === 'EMPTY' && (
                            <p className="text-xs text-red-500 mt-1">EMPTY</p>
                          )}
                          {slot.status === 'CHECKED_OUT' && slot.workerName && (
                            <p className="text-xs text-blue-500 mt-1">Worker: {slot.workerName}</p>
                          )}
                          {slot.status === 'ITEM_PRESENT' && slot.qrId && (
                            <p className="text-xs text-green-500 mt-1">QR: {slot.qrId}</p>
                          )}
                          {slot.status === 'TRAINING_ERROR' && (
                            <p className="text-xs text-amber-500 mt-1">NO QR DETECTED</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  
                  <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                    <p>Showing {slotGrid.length} of {selectedCameraSlots.length} slots</p>
                    <Button variant="link" className="text-primary p-0" data-testid="link-view-all-slots">
                      View All Slots →
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent Alerts</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => stopAlarmMutation.mutate()}
                      disabled={stopAlarmMutation.isPending}
                      variant="destructive"
                      size="sm"
                      className="flex items-center gap-2"
                      data-testid="button-stop-alarm-alerts"
                    >
                      <BellOff className="w-4 h-4" />
                      Stop Alarm
                    </Button>
                    <Button variant="link" className="text-primary p-0" data-testid="link-view-all-alerts">
                      View All
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-3">
                {(() => {
                  // Combine alerts from alert queue and diagnostic failures from capture runs
                  const combinedAlerts: Array<{
                    id: string;
                    type: 'alert' | 'diagnostic' | 'capture';
                    alertType: string;
                    message: string;
                    status: string;
                    timestamp: Date;
                  }> = [];

                  // Add alerts from alert queue
                  if (alertQueue && Array.isArray(alertQueue)) {
                    alertQueue.slice(0, 5).forEach(alert => {
                      combinedAlerts.push({
                        id: alert.id,
                        type: 'alert',
                        alertType: alert.alertType,
                        message: alert.message,
                        status: alert.status,
                        timestamp: new Date(alert.scheduledAt || alert.createdAt),
                      });
                    });
                  }

                  // Add diagnostic/capture failures from recent runs
                  if (recentCaptureRuns && Array.isArray(recentCaptureRuns)) {
                    recentCaptureRuns
                      .filter(run => run.status === 'failure' || run.status === 'partial_failure')
                      .slice(0, 5)
                      .forEach(run => {
                        combinedAlerts.push({
                          id: run.id,
                          type: run.triggerType === 'diagnostic' ? 'diagnostic' : 'capture',
                          alertType: run.triggerType === 'diagnostic' ? 'Diagnostic Failure' : 'Capture Failure',
                          message: run.errorMessages?.join(', ') || `${run.triggerType} failed with ${run.failureCount} errors`,
                          status: run.status,
                          timestamp: new Date(run.timestamp),
                        });
                      });
                  }

                  // Sort by timestamp descending and take top 5
                  combinedAlerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
                  const displayAlerts = combinedAlerts.slice(0, 5);

                  if (displayAlerts.length === 0) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500" />
                        <p className="font-medium">No Recent Alerts</p>
                        <p className="text-sm">All systems are operating normally</p>
                      </div>
                    );
                  }

                  return displayAlerts.map((alert) => {
                    const isFailure = alert.status === 'failure' || alert.type === 'diagnostic' || alert.type === 'capture';
                    const isWarning = alert.status === 'partial_failure' || alert.status === 'pending';
                    const colorClass = isFailure ? 'destructive' : isWarning ? 'amber-500' : 'blue-500';
                    
                    const formatTime = (date: Date) => {
                      try {
                        const zonedDate = toZonedTime(date, TIMEZONE);
                        return format(zonedDate, 'MM/dd HH:mm', { timeZone: TIMEZONE });
                      } catch {
                        return 'Unknown';
                      }
                    };

                    // Truncate long messages
                    const truncatedMessage = alert.message.length > 100 
                      ? alert.message.substring(0, 100) + '...' 
                      : alert.message;

                    return (
                      <div 
                        key={alert.id} 
                        className={`bg-${colorClass}/10 border border-${colorClass}/20 rounded-lg p-4`}
                        style={{
                          backgroundColor: isFailure ? 'hsl(0 84% 60% / 0.1)' : isWarning ? 'hsl(45 93% 47% / 0.1)' : 'hsl(217 91% 60% / 0.1)',
                          borderColor: isFailure ? 'hsl(0 84% 60% / 0.2)' : isWarning ? 'hsl(45 93% 47% / 0.2)' : 'hsl(217 91% 60% / 0.2)',
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div 
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{
                              backgroundColor: isFailure ? 'hsl(0 84% 60% / 0.2)' : isWarning ? 'hsl(45 93% 47% / 0.2)' : 'hsl(217 91% 60% / 0.2)',
                            }}
                          >
                            {isFailure ? (
                              <AlertTriangle className="w-4 h-4" style={{ color: 'hsl(0 84% 60%)' }} />
                            ) : (
                              <HelpCircle className="w-4 h-4" style={{ color: isWarning ? 'hsl(45 93% 47%)' : 'hsl(217 91% 60%)' }} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1 gap-2">
                              <p 
                                className="font-medium truncate" 
                                style={{ color: isFailure ? 'hsl(0 84% 60%)' : isWarning ? 'hsl(45 93% 47%)' : 'hsl(217 91% 60%)' }}
                                data-testid={`alert-title-${alert.id}`}
                              >
                                {alert.alertType}
                              </p>
                              <span className="text-xs font-mono text-muted-foreground flex-shrink-0">
                                {formatTime(alert.timestamp)}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground break-words">{truncatedMessage}</p>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <Badge 
                                className="text-xs px-2 py-1"
                                style={{
                                  backgroundColor: isFailure ? 'hsl(0 84% 60% / 0.2)' : isWarning ? 'hsl(45 93% 47% / 0.2)' : 'hsl(217 91% 60% / 0.2)',
                                  color: isFailure ? 'hsl(0 84% 60%)' : isWarning ? 'hsl(45 93% 47%)' : 'hsl(217 91% 60%)',
                                }}
                              >
                                {alert.status === 'sent' ? 'Email sent' : alert.status}
                              </Badge>
                              {alert.type === 'diagnostic' && (
                                <Badge 
                                  className="text-xs px-2 py-1"
                                  style={{
                                    backgroundColor: 'hsl(0 84% 60% / 0.2)',
                                    color: 'hsl(0 84% 60%)',
                                  }}
                                >
                                  Calibration Check
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </CardContent>
            </Card>
        </div>
      </main>

      <Dialog open={showResultsDialog} onOpenChange={setShowResultsDialog}>
        <DialogContent className="max-w-md" data-testid="dialog-capture-results">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Capture Results
            </DialogTitle>
            <DialogDescription>
              Summary of the manual capture operation
            </DialogDescription>
          </DialogHeader>
          
          {captureResults && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                <span className="text-sm font-medium text-muted-foreground">Status</span>
                <Badge 
                  className={`${getStatusColor(captureResults.status)} font-medium`}
                  data-testid="badge-capture-status"
                >
                  {captureResults.status === 'success' && <CheckCircle className="w-3 h-3 mr-1" />}
                  {captureResults.status === 'partial_failure' && <AlertTriangle className="w-3 h-3 mr-1" />}
                  {captureResults.status === 'failure' && <XCircle className="w-3 h-3 mr-1" />}
                  {captureResults.status.replace('_', ' ').toUpperCase()}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border bg-card">
                  <p className="text-xs text-muted-foreground mb-1">Cameras Captured</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="text-cameras-captured">
                    {captureResults.camerasCaptured}
                  </p>
                </div>
                
                <div className="p-3 rounded-lg border bg-card">
                  <p className="text-xs text-muted-foreground mb-1">Slots Processed</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="text-slots-processed">
                    {captureResults.slotsProcessed}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border bg-card">
                  <p className="text-xs text-muted-foreground mb-1">Failures</p>
                  <p className={`text-2xl font-bold ${captureResults.failureCount > 0 ? 'text-red-500' : 'text-foreground'}`} data-testid="text-failure-count">
                    {captureResults.failureCount}
                  </p>
                </div>
                
                <div className="p-3 rounded-lg border bg-card">
                  <p className="text-xs text-muted-foreground mb-1">Execution Time</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="text-execution-time">
                    {captureResults.results?.[0]?.executionTimeMs || 0}<span className="text-sm">ms</span>
                  </p>
                </div>
              </div>

              {captureResults.results && captureResults.results.some((r: any) => r.errors?.length > 0) && (
                <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/10">
                  <p className="text-sm font-medium text-destructive mb-2">Error Messages:</p>
                  <ul className="space-y-1" data-testid="list-error-messages">
                    {captureResults.results.flatMap((r: any) => r.errors || []).map((error: string, index: number) => (
                      <li key={index} className="text-xs text-destructive/80">• {error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Button 
                onClick={() => setShowResultsDialog(false)} 
                className="w-full"
                data-testid="button-close-dialog"
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
