import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadFile } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Download, ChevronLeft, ChevronRight, Eye, Filter, X } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";

const TIMEZONE = "Asia/Tokyo";

interface LogsViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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
}

export function LogsViewer({ open, onOpenChange }: LogsViewerProps) {
  const { toast } = useToast();
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
    enabled: open,
  });

  const { data: slots } = useQuery({
    queryKey: ['/api/slots'],
    enabled: open,
  });

  const exportLogs = async () => {
    try {
      await downloadFile('/api/detection-logs/export', 'detection-logs.csv');
      toast({
        title: "エクスポート成功",
        description: "検出ログをCSVにエクスポートしました",
      });
    } catch (error) {
      toast({
        title: "エクスポート失敗",
        description: error instanceof Error ? error.message : "不明なエラー",
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

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'ITEM_PRESENT': '存在',
      'EMPTY': '空',
      'CHECKED_OUT': '持出中',
      'TRAINING_ERROR': 'エラー',
      'OCCUPIED_NO_QR': 'QRなし',
    };
    return labels[status] || status.replace('_', ' ');
  };

  const formatJSTTimestamp = (timestamp: string | Date) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    const zonedDate = toZonedTime(date, TIMEZONE);
    return format(zonedDate, "yyyy-MM-dd HH:mm:ss", { timeZone: TIMEZONE });
  };

  const totalPages = Math.ceil((logs?.length || 0) / logsPerPage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold text-foreground">
                検出ログ
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">検出履歴の表示とエクスポート</p>
            </div>
            <div className="flex items-center gap-3">
              <Button 
                onClick={exportLogs}
                data-testid="button-export-logs"
              >
                <Download className="w-4 h-4 mr-2" />
                CSVエクスポート
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => onOpenChange(false)}
                data-testid="button-close-logs"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        <div className="p-6 space-y-6">
          
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">開始日</label>
                  <Input 
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                    data-testid="input-start-date"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">終了日</label>
                  <Input 
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                    data-testid="input-end-date"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">スロット</label>
                  <Select 
                    value={filters.slotId} 
                    onValueChange={(value) => setFilters({ ...filters, slotId: value })}
                  >
                    <SelectTrigger data-testid="select-slot-filter">
                      <SelectValue placeholder="すべてのスロット" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">すべてのスロット</SelectItem>
                      {slots?.map((slot: any) => (
                        <SelectItem key={slot.id} value={slot.slotId}>
                          {slot.slotId} - {slot.toolName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">ステータス</label>
                  <Select 
                    value={filters.status} 
                    onValueChange={(value) => setFilters({ ...filters, status: value })}
                  >
                    <SelectTrigger data-testid="select-status-filter">
                      <SelectValue placeholder="すべての状態" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">すべての状態</SelectItem>
                      <SelectItem value="ITEM_PRESENT">存在</SelectItem>
                      <SelectItem value="EMPTY">空</SelectItem>
                      <SelectItem value="CHECKED_OUT">持出中</SelectItem>
                      <SelectItem value="TRAINING_ERROR">エラー</SelectItem>
                      <SelectItem value="OCCUPIED_NO_QR">QRなし</SelectItem>
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
                    フィルタークリア
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Logs Table */}
          <Card>
            <CardHeader>
              <CardTitle>検出履歴</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>タイムスタンプ</TableHead>
                          <TableHead>スロット</TableHead>
                          <TableHead>ステータス</TableHead>
                          <TableHead>QR ID / 作業者</TableHead>
                          <TableHead>SSIMスコア</TableHead>
                          <TableHead>姿勢品質</TableHead>
                          <TableHead>アラート</TableHead>
                          <TableHead>操作</TableHead>
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
                                {getStatusLabel(log.status)}
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
                            <TableCell className="font-mono text-sm">
                              {log.ssimScore !== null ? log.ssimScore.toFixed(3) : '—'}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {log.poseQuality !== null ? log.poseQuality.toFixed(1) : '—'}
                            </TableCell>
                            <TableCell>
                              {log.alertTriggered ? (
                                <Badge className="bg-red-500/20 text-red-500">
                                  発生
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
                                  表示
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        
                        {!logs?.length && (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-8">
                              <div className="text-muted-foreground">
                                検出ログが見つかりません
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
                      {((currentPage - 1) * logsPerPage) + 1}-{Math.min(currentPage * logsPerPage, logs?.length || 0)} / {logs?.length || 0} 件を表示
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
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
