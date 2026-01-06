import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadFile, apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Download, ChevronLeft, ChevronRight, Eye, Filter, Settings2 } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";

const TIMEZONE = "Asia/Tokyo";

interface DetectionLog {
  id: string;
  slotId: string;
  timestamp: string;
  status: string;
  qrId: string | null;
  workerName: string | null;
  ssimScore: number | null;
  poseQuality: number | null;
  imagePath: string | null;
  alertTriggered: boolean;
  rawDetectionData: any;
}

export default function DetectionLogs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    slotId: 'all',
    status: 'all',
    startDate: '',
    endDate: '',
  });

  const logsPerPage = 20;

  const { data: logs, isLoading } = useQuery<DetectionLog[]>({
    queryKey: ['/api/detection-logs', { 
      limit: logsPerPage, 
      offset: (currentPage - 1) * logsPerPage,
      ...filters 
    }],
  });

  const { data: slots } = useQuery<any[]>({
    queryKey: ['/api/slots'],
  });

  const { data: sheetsFormattingConfig } = useQuery<{ value: any }>({
    queryKey: ['/api/config/SHEETS_FORMATTING'],
  });

  const sheetsFormatting = sheetsFormattingConfig?.value || {
    tabCreation: 'monthly',
    tabNamePattern: 'Alerts-{YYYY-MM}',
    columnOrder: ['timestamp', 'alertType', 'status', 'cameraId', 'slotId', 'errorMessage', 'details']
  };

  const updateConfigMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: any }) =>
      apiRequest('POST', '/api/config', { key, value }),
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

  const exportLogs = async () => {
    try {
      await downloadFile('/api/detection-logs/export', 'detection-logs.csv');
      toast({
        title: "Export Successful",
        description: "Detection logs exported to CSV",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      'ITEM_PRESENT': 'bg-green-500/20 text-green-500',
      'EMPTY': 'bg-red-500/20 text-red-500',
      'CHECKED_OUT': 'bg-blue-500/20 text-blue-500',
      'TRAINING_ERROR': 'bg-purple-500/20 text-purple-500',
      'OCCUPIED_NO_QR': 'bg-amber-500/20 text-amber-500',
    };
    return variants[status] || 'bg-gray-500/20 text-gray-500';
  };

  const formatJSTTimestamp = (timestamp: string | Date) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    const zonedDate = toZonedTime(date, TIMEZONE);
    return format(zonedDate, "yyyy-MM-dd HH:mm:ss", { timeZone: TIMEZONE });
  };

  const totalPages = Math.ceil((logs?.length || 0) / logsPerPage);

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
              <h2 className="text-2xl font-bold text-foreground" data-testid="detection-logs-title">
                Detection Logs
              </h2>
              <p className="text-sm text-muted-foreground mt-1">View and export detection history</p>
            </div>
            <Button 
              onClick={exportLogs}
              data-testid="button-export-logs"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto">
            
            {/* Filters */}
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Date From</label>
                    <Input 
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                      data-testid="input-start-date"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Date To</label>
                    <Input 
                      type="date"
                      value={filters.endDate}
                      onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                      data-testid="input-end-date"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Slot</label>
                    <Select 
                      value={filters.slotId} 
                      onValueChange={(value) => setFilters({ ...filters, slotId: value })}
                    >
                      <SelectTrigger data-testid="select-slot-filter">
                        <SelectValue placeholder="All Slots" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Slots</SelectItem>
                        {slots?.map((slot: any) => (
                          <SelectItem key={slot.id} value={slot.slotId}>
                            {slot.slotId} - {slot.toolName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Status</label>
                    <Select 
                      value={filters.status} 
                      onValueChange={(value) => setFilters({ ...filters, status: value })}
                    >
                      <SelectTrigger data-testid="select-status-filter">
                        <SelectValue placeholder="All States" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All States</SelectItem>
                        <SelectItem value="ITEM_PRESENT">Present</SelectItem>
                        <SelectItem value="EMPTY">Empty</SelectItem>
                        <SelectItem value="CHECKED_OUT">Checked Out</SelectItem>
                        <SelectItem value="TRAINING_ERROR">Error</SelectItem>
                        <SelectItem value="OCCUPIED_NO_QR">Occupied No QR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => setFilters({ slotId: 'all', status: 'all', startDate: '', endDate: '' })}
                      data-testid="button-clear-filters"
                    >
                      <Filter className="w-4 h-4 mr-2" />
                      Clear Filters
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Logs Table */}
            <Card>
              <CardHeader>
                <CardTitle>Detection History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Slot</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>QR ID / Worker</TableHead>
                        <TableHead>Detection Method</TableHead>
                        <TableHead>SSIM</TableHead>
                        <TableHead>Pose</TableHead>
                        <TableHead>Alert</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs?.map((log) => (
                        <TableRow key={log.id} className="hover:bg-muted/50">
                          <TableCell className="font-mono text-sm">
                            {formatJSTTimestamp(log.timestamp)}
                          </TableCell>
                          <TableCell className="font-medium">
                            {log.slotId}
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusBadge(log.status)}>
                              {log.status.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {log.status === 'CHECKED_OUT' && log.workerName ? (
                              <span className="text-blue-500">{log.workerName}</span>
                            ) : log.qrId ? (
                              <span className="text-green-500">{log.qrId}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {log.rawDetectionData?.detection_method ? (
                              <span 
                                className="text-gray-400"
                                title={log.rawDetectionData.detection_method}
                              >
                                {log.rawDetectionData.detection_method}
                              </span>
                            ) : log.status === 'ITEM_PRESENT' ? (
                              <span className="text-muted-foreground italic">no QR</span>
                            ) : (
                              <span className="text-red-400">not detected</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {log.ssimScore !== null ? log.ssimScore.toFixed(3) : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {log.poseQuality !== null ? log.poseQuality.toFixed(1) : '—'}
                          </TableCell>
                          <TableCell>
                            {log.alertTriggered ? (
                              <Badge className="bg-red-500/20 text-red-500">
                                Triggered
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {log.imagePath && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => window.open(`/api/roi/${log.slotId}.png`, '_blank')}
                                data-testid={`button-view-image-${log.id}`}
                              >
                                <Eye className="w-3 h-3 mr-1" />
                                View
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      
                      {!logs?.length && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8">
                            <div className="text-muted-foreground">
                              No detection logs found
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                
                {/* Pagination */}
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Showing {((currentPage - 1) * logsPerPage) + 1}-{Math.min(currentPage * logsPerPage, logs?.length || 0)} of {logs?.length || 0} entries
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      const page = i + Math.max(1, currentPage - 2);
                      return (
                        <Button
                          key={page}
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(page)}
                          data-testid={`button-page-${page}`}
                        >
                          {page}
                        </Button>
                      );
                    })}
                    
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Google Sheets Formatting Configuration */}
            <Card className="mt-6">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-primary" />
                  <CardTitle>Google Sheets Formatting</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="tab-creation">Tab Creation Rule</Label>
                  <Select
                    value={sheetsFormatting.tabCreation || 'monthly'}
                    onValueChange={(value) => {
                      const updated = { ...sheetsFormatting, tabCreation: value };
                      updateConfigMutation.mutate({ key: 'SHEETS_FORMATTING', value: updated }, {
                        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/config/SHEETS_FORMATTING'] })
                      });
                    }}
                  >
                    <SelectTrigger id="tab-creation" data-testid="select-tab-creation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single Sheet (All in one tab)</SelectItem>
                      <SelectItem value="monthly">Monthly Tabs (One per month)</SelectItem>
                      <SelectItem value="weekly">Weekly Tabs (One per week)</SelectItem>
                      <SelectItem value="daily">Daily Tabs (One per day)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Controls when new tabs are created in the spreadsheet
                  </p>
                </div>

                <div>
                  <Label htmlFor="tab-pattern">Tab Name Pattern</Label>
                  <Input
                    id="tab-pattern"
                    value={sheetsFormatting.tabNamePattern || 'Alerts-{YYYY-MM}'}
                    onChange={(e) => {
                      const updated = { ...sheetsFormatting, tabNamePattern: e.target.value };
                      updateConfigMutation.mutate({ key: 'SHEETS_FORMATTING', value: updated }, {
                        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/config/SHEETS_FORMATTING'] })
                      });
                    }}
                    data-testid="input-tab-pattern"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use: <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{YYYY}'}</code> for year, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{MM}'}</code> for month, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{DD}'}</code> for day, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{WW}'}</code> for week
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Include Headers</Label>
                    <p className="text-xs text-muted-foreground">Add column headers to new tabs</p>
                  </div>
                  <Switch
                    checked={sheetsFormatting.includeHeaders !== false}
                    onCheckedChange={(checked) => {
                      const updated = { ...sheetsFormatting, includeHeaders: checked };
                      updateConfigMutation.mutate({ key: 'SHEETS_FORMATTING', value: updated }, {
                        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/config/SHEETS_FORMATTING'] })
                      });
                    }}
                    data-testid="switch-include-headers"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Freeze Header Row</Label>
                    <p className="text-xs text-muted-foreground">Keep headers visible when scrolling</p>
                  </div>
                  <Switch
                    checked={sheetsFormatting.freezeHeaderRow !== false}
                    onCheckedChange={(checked) => {
                      const updated = { ...sheetsFormatting, freezeHeaderRow: checked };
                      updateConfigMutation.mutate({ key: 'SHEETS_FORMATTING', value: updated }, {
                        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/config/SHEETS_FORMATTING'] })
                      });
                    }}
                    data-testid="switch-freeze-headers"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
