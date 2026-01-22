import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Calendar, Clock, Play, AlertTriangle, Settings } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";
import type { CaptureRun } from "@shared/schema";

const TIMEZONE = "Asia/Tokyo";

export default function Scheduler() {
  const { toast } = useToast();
  const [newCaptureTime, setNewCaptureTime] = useState("");
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const { data: scheduleConfig, isLoading: isLoadingConfig } = useQuery<{
    capture_times?: string[];
    timezone?: string;
    scheduler_paused?: boolean;
  }>({
    queryKey: ["/api/schedule-config"],
  });

  const { data: nextRuns } = useQuery<{
    capture?: string[];
    diagnostic?: string[];
  }>({
    queryKey: ["/api/schedule-config/next-runs"],
    refetchInterval: 30000,
  });

  const { data: captureRuns = [], isLoading: isLoadingRuns } = useQuery<CaptureRun[]>({
    queryKey: ["/api/capture-runs"],
    refetchInterval: 30000,
  });

  const { data: captureTimeSettings } = useQuery<Record<string, { allowWorkerCheckout: boolean }>>({
    queryKey: ["/api/config/CAPTURE_TIME_SETTINGS"],
    select: (data: any) => data?.value || {},
  });

  const updateConfigMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/schedule-config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-config/next-runs"] });
      toast({
        title: "スケジュール更新完了",
        description: "スケジューラー設定が更新されました",
      });
    },
    onError: (error) => {
      toast({
        title: "更新失敗",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  const reloadMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/schedule-config/reload", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-config/next-runs"] });
      toast({
        title: "スケジューラー再読込完了",
        description: "新しい設定でスケジュールが再読込されました",
      });
    },
  });

  const updateCaptureTimeSettingsMutation = useMutation({
    mutationFn: (data: { time: string; settings: { allowWorkerCheckout: boolean } }) =>
      apiRequest("POST", "/api/config", {
        key: "CAPTURE_TIME_SETTINGS",
        value: {
          ...captureTimeSettings,
          [data.time]: data.settings,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/CAPTURE_TIME_SETTINGS"] });
      toast({
        title: "設定更新完了",
        description: "撮影時間の設定が更新されました",
      });
      setCustomizeDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "更新失敗",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  const captureTimes = scheduleConfig?.capture_times || [];
  const timezone = scheduleConfig?.timezone || TIMEZONE;
  const isPaused = scheduleConfig?.scheduler_paused || false;

  const handleTogglePause = () => {
    updateConfigMutation.mutate({
      scheduler_paused: !isPaused,
    });
  };

  const handleAddTime = () => {
    if (!newCaptureTime) {
      toast({
        title: "無効な時間",
        description: "HH:mm形式で時間を入力してください",
        variant: "destructive",
      });
      return;
    }

    const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timeRegex.test(newCaptureTime)) {
      toast({
        title: "無効な時間形式",
        description: "時間はHH:mm形式で入力してください（例：08:00）",
        variant: "destructive",
      });
      return;
    }

    if (captureTimes.includes(newCaptureTime)) {
      toast({
        title: "重複した時間",
        description: "この撮影時間は既に存在します",
        variant: "destructive",
      });
      return;
    }

    const updatedTimes = [...captureTimes, newCaptureTime].sort();
    updateConfigMutation.mutate({
      capture_times: updatedTimes,
    });
    setNewCaptureTime("");
  };

  const handleRemoveTime = (time: string) => {
    const updatedTimes = captureTimes.filter((t: string) => t !== time);
    updateConfigMutation.mutate({
      capture_times: updatedTimes,
    });
  };

  const handleCustomizeTime = (time: string) => {
    setSelectedTime(time);
    setCustomizeDialogOpen(true);
  };

  const handleSaveSettings = () => {
    if (!selectedTime) return;

    const currentSettings = captureTimeSettings?.[selectedTime] || { allowWorkerCheckout: true };
    updateCaptureTimeSettingsMutation.mutate({
      time: selectedTime,
      settings: currentSettings,
    });
  };

  const toggleWorkerCheckout = (time: string) => {
    const currentSettings = captureTimeSettings?.[time] || { allowWorkerCheckout: true };
    updateCaptureTimeSettingsMutation.mutate({
      time,
      settings: { allowWorkerCheckout: !currentSettings.allowWorkerCheckout },
    });
  };

  const formatJSTTimestamp = (timestamp: string | Date) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    const zonedDate = toZonedTime(date, TIMEZONE);
    return format(zonedDate, "yyyy年MM月dd日 HH:mm:ss", { timeZone: TIMEZONE });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-green-600 dark:text-green-400";
      case "partial_failure":
        return "text-yellow-600 dark:text-yellow-400";
      case "failure":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      partial_failure: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
      failure: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    };

    const statusLabels: Record<string, string> = {
      success: "成功",
      partial_failure: "一部失敗",
      failure: "失敗",
    };

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status as keyof typeof colors] || "bg-gray-100 text-gray-800"}`}>
        {statusLabels[status] || status.replace("_", " ").toUpperCase()}
      </span>
    );
  };

  if (isLoadingConfig) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">スケジューラー設定を読み込み中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">スケジューラー</h1>
              <p className="text-muted-foreground mt-1">自動撮影スケジュールの設定</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">スケジューラー</span>
                <Switch
                  checked={!isPaused}
                  onCheckedChange={handleTogglePause}
                  disabled={updateConfigMutation.isPending}
                  data-testid="switch-scheduler-pause"
                />
                <span className={`text-sm font-medium ${isPaused ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                  {isPaused ? "一時停止中" : "有効"}
                </span>
              </div>
            </div>
          </div>

          <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">撮影時間設定 (JST)</h2>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {captureTimes.map((time: string) => {
                const settings = captureTimeSettings?.[time] || { allowWorkerCheckout: true };
                return (
                  <div
                    key={time}
                    className="flex items-center justify-between p-3 border rounded-lg bg-card"
                    data-testid={`capture-time-${time}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="font-mono text-lg">{time}</span>
                        <span className="text-sm text-muted-foreground">JST</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {settings.allowWorkerCheckout 
                          ? "✓ 作業者チェックアウト許可" 
                          : "✗ 全ての備品が必要"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCustomizeTime(time)}
                        disabled={updateConfigMutation.isPending}
                        data-testid={`button-customize-time-${time}`}
                      >
                        <Settings className="w-4 h-4 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveTime(time)}
                        disabled={updateConfigMutation.isPending}
                        data-testid={`button-remove-time-${time}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Input
                type="time"
                value={newCaptureTime}
                onChange={(e) => setNewCaptureTime(e.target.value)}
                placeholder="HH:mm"
                className="max-w-xs"
                data-testid="input-new-capture-time"
              />
              <Button
                onClick={handleAddTime}
                disabled={updateConfigMutation.isPending}
                data-testid="button-add-capture-time"
              >
                <Plus className="w-4 h-4 mr-2" />
                時間を追加
              </Button>
            </div>
          </div>
          </Card>

          <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">次回の撮影予定</h2>
          </div>

          {isPaused ? (
            <div className="text-center text-muted-foreground py-4">
              <AlertTriangle className="w-12 h-12 mx-auto mb-2 text-yellow-500" />
              <p>スケジューラーが一時停止中です。撮影予定はありません。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {nextRuns?.capture?.map((time: string, index: number) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                  <div className="flex items-center gap-3">
                    <Play className="w-4 h-4 text-green-600" />
                    <div>
                      <div className="font-medium">撮影 #{index + 1}</div>
                      <div className="text-sm text-muted-foreground">{time}</div>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    診断: {nextRuns.diagnostic[index]}
                  </div>
                </div>
              ))}
            </div>
          )}
          </Card>

          <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-semibold">最近の撮影履歴</h2>
            </div>
          </div>

          {isLoadingRuns ? (
            <div className="text-center text-muted-foreground py-4">履歴を読み込み中...</div>
          ) : captureRuns.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>撮影履歴がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="text-left text-sm text-muted-foreground">
                    <th className="pb-3 font-medium">タイムスタンプ (JST)</th>
                    <th className="pb-3 font-medium">トリガー</th>
                    <th className="pb-3 font-medium">ステータス</th>
                    <th className="pb-3 font-medium text-right">カメラ</th>
                    <th className="pb-3 font-medium text-right">スロット</th>
                    <th className="pb-3 font-medium text-right">失敗</th>
                    <th className="pb-3 font-medium text-right">時間 (ms)</th>
                  </tr>
                </thead>
                <tbody>
                  {captureRuns.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b last:border-0 hover:bg-muted/50"
                      data-testid={`capture-run-${run.id}`}
                    >
                      <td className="py-3 text-sm">{formatJSTTimestamp(run.timestamp)}</td>
                      <td className="py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-primary/10 text-primary">
                          {run.triggerType.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3">{getStatusBadge(run.status)}</td>
                      <td className="py-3 text-right text-sm">{run.camerasCaptured}</td>
                      <td className="py-3 text-right text-sm">{run.slotsProcessed}</td>
                      <td className="py-3 text-right">
                        <span className={`text-sm font-medium ${run.failureCount > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                          {run.failureCount}
                        </span>
                      </td>
                      <td className="py-3 text-right text-sm text-muted-foreground">
                        {run.executionTimeMs?.toLocaleString() || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </Card>
        </div>
      </main>

      <Dialog open={customizeDialogOpen} onOpenChange={setCustomizeDialogOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-customize-capture-time">
          <DialogHeader>
            <DialogTitle>撮影時間のカスタマイズ: {selectedTime}</DialogTitle>
            <DialogDescription>
              この撮影時間の検出動作を設定
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-4">
            <div className="flex items-start justify-between space-x-4 rounded-lg border p-4">
              <div className="flex-1 space-y-1">
                <Label className="text-base font-medium">作業者チェックアウトを許可</Label>
                <p className="text-sm text-muted-foreground">
                  有効にすると、作業者の名前タグQRコードがアラームをトリガーしません（チェックアウト状態が許容されます）。
                  無効にすると、備品が不足している場合にアラームがトリガーされます - 全ての備品が必要です。
                </p>
                <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                  <strong>注意:</strong> 空のスロット（スロットQRコードが見える状態）は、この設定に関係なく常にアラームをトリガーします。
                </p>
              </div>
              <Switch
                checked={captureTimeSettings?.[selectedTime || ""]?.allowWorkerCheckout ?? true}
                onCheckedChange={() => selectedTime && toggleWorkerCheckout(selectedTime)}
                disabled={updateCaptureTimeSettingsMutation.isPending}
                data-testid="switch-allow-worker-checkout"
              />
            </div>

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="text-sm font-medium">例:</h4>
              <div className="text-xs space-y-1 text-muted-foreground">
                <p>
                  <strong>最初/最後の撮影 (オフ):</strong> 始業/終業時 - 全ての備品が必要、チェックアウト不可
                </p>
                <p>
                  <strong>日中の撮影 (オン):</strong> 勤務時間中は作業者が備品をチェックアウト可能
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => setCustomizeDialogOpen(false)}
                data-testid="button-cancel-customize"
              >
                閉じる
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
