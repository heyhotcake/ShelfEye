import { useState, useEffect } from "react";
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
import { Download, ChevronLeft, ChevronRight, Eye, Filter, Settings2, Clock, Play, RefreshCw, Save } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";

interface TimelineConfig {
  enabled: boolean;
  spreadsheetId: string | null;
  templateTabName: string;
  temperatureRow: number;
  humidityRow: number;
  confirmerRow: number;
  dataStartColumn: number;
}

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

  const { data: timelineConfig, isLoading: timelineLoading } = useQuery<TimelineConfig>({
    queryKey: ['/api/timeline/config'],
  });

  // Local state for timeline config editing (explicit save)
  const [localTimelineConfig, setLocalTimelineConfig] = useState<Partial<TimelineConfig>>({});
  const [timelineConfigDirty, setTimelineConfigDirty] = useState(false);

  // Sync local state when server config loads
  useEffect(() => {
    if (timelineConfig) {
      setLocalTimelineConfig({
        enabled: timelineConfig.enabled,
        spreadsheetId: timelineConfig.spreadsheetId,
        templateTabName: timelineConfig.templateTabName,
        temperatureRow: timelineConfig.temperatureRow,
        humidityRow: timelineConfig.humidityRow,
        confirmerRow: timelineConfig.confirmerRow,
      });
      setTimelineConfigDirty(false);
    }
  }, [timelineConfig]);

  const sheetsFormatting = sheetsFormattingConfig?.value || {
    tabCreation: 'monthly',
    tabNamePattern: 'Alerts-{YYYY-MM}',
    columnOrder: ['timestamp', 'alertType', 'status', 'cameraId', 'slotId', 'errorMessage', 'details']
  };

  const updateTimelineConfigMutation = useMutation({
    mutationFn: (config: Partial<TimelineConfig>) =>
      apiRequest('POST', '/api/timeline/config', config),
    onSuccess: () => {
      toast({
        title: "タイムライン設定が更新されました",
        description: "設定が正常に保存されました",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/timeline/config'] });
    },
    onError: (error) => {
      toast({
        title: "更新に失敗しました",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const scanTemplateMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/timeline/scan-template', {}),
    onSuccess: () => {
      toast({
        title: "テンプレートスキャン完了",
        description: "テンプレートのレイアウトをスキャンしました",
      });
    },
    onError: (error) => {
      toast({
        title: "スキャンに失敗しました",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const runCycleMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/timeline/run-cycle', {}),
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "サイクル実行完了" : "エラー",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error) => {
      toast({
        title: "実行に失敗しました",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: any }) =>
      apiRequest('POST', '/api/config', { key, value }),
    onSuccess: () => {
      toast({
        title: "設定が更新されました",
        description: "設定が正常に保存されました",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/config'] });
    },
    onError: (error) => {
      toast({
        title: "更新に失敗しました",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const exportLogs = async () => {
    try {
      await downloadFile('/api/detection-logs/export', 'detection-logs.csv');
      toast({
        title: "エクスポート成功",
        description: "検出ログがCSVにエクスポートされました",
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
      'CHECKED_OUT': '貸出中',
      'TRAINING_ERROR': 'エラー',
      'OCCUPIED_NO_QR': 'QRなし占有',
    };
    return labels[status] || status.replace('_', ' ');
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
          <span className="ml-2 text-muted-foreground">読み込み中...</span>
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
                検出ログ
              </h2>
              <p className="text-sm text-muted-foreground mt-1">検出履歴の表示とエクスポート</p>
            </div>
            <Button 
              onClick={exportLogs}
              data-testid="button-export-logs"
            >
              <Download className="w-4 h-4 mr-2" />
              CSVエクスポート
            </Button>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto">
            
            {/* フィルター */}
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">開始日付</label>
                    <Input 
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                      data-testid="input-start-date"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">終了日付</label>
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
                        <SelectValue placeholder="すべてのステータス" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">すべてのステータス</SelectItem>
                        <SelectItem value="ITEM_PRESENT">存在</SelectItem>
                        <SelectItem value="EMPTY">空</SelectItem>
                        <SelectItem value="CHECKED_OUT">貸出中</SelectItem>
                        <SelectItem value="TRAINING_ERROR">エラー</SelectItem>
                        <SelectItem value="OCCUPIED_NO_QR">QRなし占有</SelectItem>
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

            {/* ログテーブル */}
            <Card>
              <CardHeader>
                <CardTitle>検出履歴</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日時</TableHead>
                        <TableHead>スロット</TableHead>
                        <TableHead>ステータス</TableHead>
                        <TableHead>QR ID / 作業者</TableHead>
                        <TableHead>検出方法</TableHead>
                        <TableHead>SSIM</TableHead>
                        <TableHead>姿勢</TableHead>
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
                          <TableCell className="font-mono text-xs">
                            {log.rawDetectionData?.detection_method ? (
                              <span 
                                className="text-gray-400"
                                title={log.rawDetectionData.detection_method}
                              >
                                {log.rawDetectionData.detection_method}
                              </span>
                            ) : log.status === 'ITEM_PRESENT' ? (
                              <span className="text-muted-foreground italic">QRなし</span>
                            ) : (
                              <span className="text-red-400">未検出</span>
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
                                発動
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
                          <TableCell colSpan={9} className="text-center py-8">
                            <div className="text-muted-foreground">
                              検出ログが見つかりません
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                
                {/* ページネーション */}
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
              </CardContent>
            </Card>

            {/* Google スプレッドシート書式設定 */}
            <Card className="mt-6">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-primary" />
                  <CardTitle>Google スプレッドシート書式設定</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="tab-creation">タブ作成ルール</Label>
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
                      <SelectItem value="single">単一シート（すべて1つのタブ）</SelectItem>
                      <SelectItem value="monthly">月別タブ（月ごと）</SelectItem>
                      <SelectItem value="weekly">週別タブ（週ごと）</SelectItem>
                      <SelectItem value="daily">日別タブ（日ごと）</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    スプレッドシートで新しいタブを作成するタイミングを制御します
                  </p>
                </div>

                <div>
                  <Label htmlFor="tab-pattern">タブ名パターン</Label>
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
                    使用可能: <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{YYYY}'}</code> 年, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{MM}'}</code> 月, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{DD}'}</code> 日, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{WW}'}</code> 週
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>ヘッダーを含める</Label>
                    <p className="text-xs text-muted-foreground">新しいタブに列ヘッダーを追加</p>
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
                    <Label>ヘッダー行を固定</Label>
                    <p className="text-xs text-muted-foreground">スクロール時にヘッダーを表示したままにする</p>
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

            {/* 15分タイムラインロガー設定 */}
            <Card className="mt-6">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-primary" />
                    <CardTitle>15分タイムラインロガー</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {timelineConfigDirty && (
                      <Badge variant="outline" className="text-orange-500 border-orange-500">未保存</Badge>
                    )}
                    <Badge className={timelineConfig?.enabled ? "bg-green-500/20 text-green-500" : "bg-gray-500/20 text-gray-500"}>
                      {timelineConfig?.enabled ? "有効" : "無効"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  15分ごとに備品の使用状況をGoogle スプレッドシートに記録します。
                  作業者名と使用時間帯がタイムライン形式で表示されます。
                </p>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>タイムラインロガーを有効化</Label>
                    <p className="text-xs text-muted-foreground">15分間隔でスプレッドシートを更新</p>
                  </div>
                  <Switch
                    checked={localTimelineConfig.enabled || false}
                    onCheckedChange={(checked) => {
                      setLocalTimelineConfig(prev => ({ ...prev, enabled: checked }));
                      setTimelineConfigDirty(true);
                    }}
                    disabled={!localTimelineConfig.spreadsheetId}
                    data-testid="switch-timeline-enabled"
                  />
                </div>

                <div>
                  <Label htmlFor="timeline-spreadsheet-id">スプレッドシートID</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="timeline-spreadsheet-id"
                      value={localTimelineConfig.spreadsheetId || ''}
                      onChange={(e) => {
                        setLocalTimelineConfig(prev => ({ ...prev, spreadsheetId: e.target.value }));
                        setTimelineConfigDirty(true);
                      }}
                      placeholder="例: 13QFikKubrrvlK44YL-zZtgeISLo4JKWfzAhyxiYqBj8"
                      data-testid="input-timeline-spreadsheet-id"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Google スプレッドシートのURLからIDを抽出してください
                  </p>
                </div>

                <div>
                  <Label htmlFor="timeline-template-tab">テンプレートタブ名</Label>
                  <Input
                    id="timeline-template-tab"
                    value={localTimelineConfig.templateTabName || 'ひな形'}
                    onChange={(e) => {
                      setLocalTimelineConfig(prev => ({ ...prev, templateTabName: e.target.value }));
                      setTimelineConfigDirty(true);
                    }}
                    placeholder="ひな形"
                    data-testid="input-timeline-template-tab"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    日次シートのコピー元となるテンプレートタブの名前
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="timeline-temp-row">温度行</Label>
                    <Input
                      id="timeline-temp-row"
                      type="number"
                      value={localTimelineConfig.temperatureRow || 65}
                      onChange={(e) => {
                        setLocalTimelineConfig(prev => ({ ...prev, temperatureRow: parseInt(e.target.value) || 65 }));
                        setTimelineConfigDirty(true);
                      }}
                      data-testid="input-timeline-temp-row"
                    />
                  </div>
                  <div>
                    <Label htmlFor="timeline-humidity-row">湿度行</Label>
                    <Input
                      id="timeline-humidity-row"
                      type="number"
                      value={localTimelineConfig.humidityRow || 66}
                      onChange={(e) => {
                        setLocalTimelineConfig(prev => ({ ...prev, humidityRow: parseInt(e.target.value) || 66 }));
                        setTimelineConfigDirty(true);
                      }}
                      data-testid="input-timeline-humidity-row"
                    />
                  </div>
                  <div>
                    <Label htmlFor="timeline-confirmer-row">確認者行</Label>
                    <Input
                      id="timeline-confirmer-row"
                      type="number"
                      value={localTimelineConfig.confirmerRow || 68}
                      onChange={(e) => {
                        setLocalTimelineConfig(prev => ({ ...prev, confirmerRow: parseInt(e.target.value) || 68 }));
                        setTimelineConfigDirty(true);
                      }}
                      data-testid="input-timeline-confirmer-row"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => {
                      updateTimelineConfigMutation.mutate(localTimelineConfig, {
                        onSuccess: () => setTimelineConfigDirty(false),
                      });
                    }}
                    disabled={!timelineConfigDirty || updateTimelineConfigMutation.isPending}
                    data-testid="button-save-timeline-config"
                  >
                    <Save className={`w-4 h-4 mr-2 ${updateTimelineConfigMutation.isPending ? 'animate-spin' : ''}`} />
                    設定を保存
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => scanTemplateMutation.mutate()}
                    disabled={scanTemplateMutation.isPending || !timelineConfig?.spreadsheetId}
                    data-testid="button-scan-template"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${scanTemplateMutation.isPending ? 'animate-spin' : ''}`} />
                    テンプレートスキャン
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => runCycleMutation.mutate()}
                    disabled={runCycleMutation.isPending || !timelineConfig?.enabled}
                    data-testid="button-run-cycle"
                  >
                    <Play className={`w-4 h-4 mr-2 ${runCycleMutation.isPending ? 'animate-spin' : ''}`} />
                    手動実行
                  </Button>
                </div>

                {localTimelineConfig.spreadsheetId && (
                  <div className="pt-2">
                    <a 
                      href={`https://docs.google.com/spreadsheets/d/${localTimelineConfig.spreadsheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      スプレッドシートを開く →
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
