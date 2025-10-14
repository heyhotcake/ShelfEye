import { useState } from "react";
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
import { Camera, Clock, CheckCircle, AlertTriangle, HelpCircle, ClipboardCheck, Users, Activity, XCircle } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";
import type { CaptureRun } from "@shared/schema";

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

  const generateSlotGrid = () => {
    const slots = [];
    const statuses = ['ITEM_PRESENT', 'EMPTY', 'CHECKED_OUT'];
    const toolNames = ['Scissors', 'Tape Cutter', 'Pliers', 'Wire Cutters', 'Measure Tape', 'Utility Knife', 'Screwdriver', 'Allen Keys', 'Box Cutter', 'Wrench', 'Marker Set', 'Hammer'];
    
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 6; col++) {
        const slotId = `${String.fromCharCode(65 + row)}${col + 1}`;
        const toolName = toolNames[(row * 6 + col) % toolNames.length];
        const status = row === 0 && col === 2 ? 'EMPTY' : 
                     row === 0 && col === 3 ? 'CHECKED_OUT' :
                     row === 0 && col === 5 ? 'TRAINING_ERROR' : 'ITEM_PRESENT';
        
        slots.push({
          slotId,
          toolName,
          status,
          qrId: status === 'EMPTY' ? null : `${slotId.charAt(0)}${String(row * 6 + col + 1).padStart(3, '0')}`,
          workerName: status === 'CHECKED_OUT' ? (col === 3 ? 'Y.Tanaka' : 'K.Sato') : null,
        });
      }
    }
    return slots;
  };

  const slotGrid = generateSlotGrid();

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
        
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="dashboard-title">
                Monitoring Dashboard
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Camera Station A - Last updated: <span className="font-mono">{summary ? formatJSTTimestamp(summary.lastUpdate) : '--'}</span>
              </p>
            </div>
            <div className="flex items-center gap-4">
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
                <CardTitle>Tool Grid - Station A</CardTitle>
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
                <p>Showing 24 of {summary?.totalSlots || 60} slots</p>
                <Button variant="link" className="text-primary p-0" data-testid="link-view-all-slots">
                  View All Slots →
                </Button>
              </div>
            </CardContent>
          </Card>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent Alerts</CardTitle>
                  <Button variant="link" className="text-primary p-0" data-testid="link-view-all-alerts">
                    View All
                  </Button>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-3">
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-destructive/20 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-destructive" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-destructive" data-testid="alert-title-A3">Tool Missing: Slot A3</p>
                        <span className="text-xs font-mono text-muted-foreground">14:15</span>
                      </div>
                      <p className="text-sm text-muted-foreground">Pliers detected empty for 5+ minutes</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge className="text-xs px-2 py-1 bg-destructive/20 text-destructive">Email sent</Badge>
                        <Badge className="text-xs px-2 py-1 bg-destructive/20 text-destructive">Alert active</Badge>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <HelpCircle className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-amber-500" data-testid="alert-title-A6">QR Not Detected: Slot A6</p>
                        <span className="text-xs font-mono text-muted-foreground">13:45</span>
                      </div>
                      <p className="text-sm text-muted-foreground">Utility Knife occupied but QR unreadable</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge className="text-xs px-2 py-1 bg-amber-500/20 text-amber-500">Needs check</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Camera Preview</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-sm text-muted-foreground">Live</span>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="canvas-container">
                  <div className="relative aspect-[4/3] bg-muted rounded overflow-hidden">
                    <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                      <div className="text-center">
                        <Camera className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">Camera feed will appear here</p>
                      </div>
                    </div>
                    
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 600">
                      <rect x="50" y="50" width="700" height="500" fill="none" stroke="hsl(217, 91%, 60%)" strokeWidth="2" strokeDasharray="5,5"/>
                      
                      <rect x="70" y="70" width="110" height="110" fill="none" stroke="hsl(142, 76%, 45%)" strokeWidth="2"/>
                      <text x="75" y="90" fill="hsl(142, 76%, 45%)" fontSize="12" fontFamily="monospace">A1</text>
                      
                      <rect x="200" y="70" width="110" height="110" fill="none" stroke="hsl(142, 76%, 45%)" strokeWidth="2"/>
                      <text x="205" y="90" fill="hsl(142, 76%, 45%)" fontSize="12" fontFamily="monospace">A2</text>
                      
                      <rect x="330" y="70" width="110" height="110" fill="none" stroke="hsl(0, 84%, 60%)" strokeWidth="2"/>
                      <text x="335" y="90" fill="hsl(0, 84%, 60%)" fontSize="12" fontFamily="monospace">A3 - EMPTY</text>
                    </svg>
                  </div>
                </div>
                
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground mb-1">Homography Error</p>
                      <p className="text-sm font-mono font-medium text-foreground" data-testid="text-homography-error">0.82 px</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground mb-1">Detection Yield</p>
                      <p className="text-sm font-mono font-medium text-foreground" data-testid="text-detection-yield">98.3%</p>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </div>
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
