import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, Clock, AlertTriangle, CheckCircle, Database } from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, toZonedTime } from "date-fns-tz";

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

interface ExtendedAnalytics {
  timeSeries: Array<{ time: string; present: number; empty: number; checkedOut: number; total: number }>;
  alertTrends: Array<{ date: string; toolMissing: number; qrFailure: number; cameraHealth: number }>;
  captureStats: {
    total: number;
    successful: number;
    successRate: number;
  };
  topTools: Array<{ tool: string; slotId: string; checkouts: number; status: string }>;
  totalSlots: number;
  activeSlots: number;
}

export default function Analytics() {
  const { data: summary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ['/api/analytics/summary'],
    refetchInterval: 30000,
  });

  const { data: extended } = useQuery<ExtendedAnalytics>({
    queryKey: ['/api/analytics/extended'],
    refetchInterval: 30000,
  });

  const formatTimeLabel = (timeStr: string) => {
    try {
      const date = new Date(timeStr);
      const zonedDate = toZonedTime(date, TIMEZONE);
      return format(zonedDate, "HH:mm", { timeZone: TIMEZONE });
    } catch {
      return timeStr;
    }
  };

  // Use real time series data or show empty state
  const timeSeriesData = extended?.timeSeries?.map(item => ({
    time: formatTimeLabel(item.time),
    present: item.present,
    empty: item.empty + item.checkedOut,
  })) || [];

  const statusDistribution = [
    { name: '存在', value: summary?.statusCounts?.present ?? 0, color: 'hsl(142, 76%, 45%)' },
    { name: '空', value: summary?.statusCounts?.empty ?? 0, color: 'hsl(0, 84%, 60%)' },
    { name: '貸出中', value: summary?.statusCounts?.checkedOut ?? 0, color: 'hsl(217, 91%, 60%)' },
    { name: '使用中', value: summary?.statusCounts?.occupied ?? 0, color: 'hsl(215, 20%, 45%)' },
    { name: 'エラー', value: summary?.statusCounts?.error ?? 0, color: 'hsl(280, 89%, 65%)' },
  ].filter(item => item.value > 0);

  // Use real alert trends or empty array
  const alertTrends = extended?.alertTrends || [];

  // Calculate availability rate safely
  const availabilityRate = summary?.activeSlots && summary.activeSlots > 0 
    ? Math.round(((summary.statusCounts?.present ?? 0) / summary.activeSlots) * 100) 
    : 0;

  // Calculate capture success rate from real data
  const captureSuccessRate = extended?.captureStats?.successRate || 0;
  const totalCaptures = extended?.captureStats?.total || 0;

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
              <h2 className="text-2xl font-bold text-foreground" data-testid="analytics-title">
                分析ダッシュボード
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                パフォーマンスの洞察とトレンド分析
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Select defaultValue="7d">
                <SelectTrigger className="w-32" data-testid="select-time-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">過去24時間</SelectItem>
                  <SelectItem value="7d">過去7日間</SelectItem>
                  <SelectItem value="30d">過去30日間</SelectItem>
                  <SelectItem value="90d">過去90日間</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">利用可能率</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="text-availability-rate">
                        {isNaN(availabilityRate) ? '--' : `${availabilityRate}%`}
                      </p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-green-500" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <Database className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {summary?.statusCounts?.present ?? 0} / {summary?.activeSlots ?? 0} スロット利用可能
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">アクティブスロット</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="text-active-slots">
                        {summary?.activeSlots || 0}
                      </p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
                      <Clock className="w-6 h-6 text-blue-500" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <Database className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      合計 {summary?.totalSlots || 0} 設定済み
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">キャプチャ成功率</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="text-system-uptime">
                        {captureSuccessRate > 0 ? `${captureSuccessRate}%` : '--'}
                      </p>
                    </div>
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${captureSuccessRate >= 95 ? 'bg-green-500/20' : captureSuccessRate >= 80 ? 'bg-amber-500/20' : 'bg-red-500/20'}`}>
                      <Activity className={`w-6 h-6 ${captureSuccessRate >= 95 ? 'text-green-500' : captureSuccessRate >= 80 ? 'text-amber-500' : 'text-red-500'}`} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    {captureSuccessRate >= 95 ? (
                      <>
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        <span className="text-xs text-green-500">優秀</span>
                      </>
                    ) : captureSuccessRate >= 80 ? (
                      <>
                        <Activity className="w-3 h-3 text-amber-500" />
                        <span className="text-xs text-amber-500">良好</span>
                      </>
                    ) : totalCaptures > 0 ? (
                      <>
                        <AlertTriangle className="w-3 h-3 text-red-500" />
                        <span className="text-xs text-red-500">要確認</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">キャプチャなし</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">保留中のアラート</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="text-critical-alerts">
                        {summary?.alertCounts?.pending ?? 0}
                      </p>
                    </div>
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${(summary?.alertCounts?.pending ?? 0) > 0 ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
                      <AlertTriangle className={`w-6 h-6 ${(summary?.alertCounts?.pending ?? 0) > 0 ? 'text-red-500' : 'text-green-500'}`} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <Database className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {summary?.alertCounts?.failed ?? 0} 件失敗
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Tool Presence Over Time */}
              <Card>
                <CardHeader>
                  <CardTitle>備品存在推移</CardTitle>
                </CardHeader>
                <CardContent>
                  {timeSeriesData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={timeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis 
                          dataKey="time" 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <YAxis 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <Tooltip 
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            color: 'hsl(var(--foreground))',
                          }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="present" 
                          stroke="hsl(142, 76%, 45%)"
                          strokeWidth={2}
                          name="備品存在"
                        />
                        <Line 
                          type="monotone" 
                          dataKey="empty" 
                          stroke="hsl(0, 84%, 60%)"
                          strokeWidth={2}
                          name="空/貸出中"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>検出データがまだありません</p>
                        <p className="text-xs mt-1">キャプチャ実行後にデータが表示されます</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Status Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>現在のステータス分布</CardTitle>
                </CardHeader>
                <CardContent>
                  {statusDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={statusDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {statusDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            color: 'hsl(var(--foreground))',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>スロットステータスデータがありません</p>
                        <p className="text-xs mt-1">スロットを設定して分布を表示</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Alert Trends */}
              <Card>
                <CardHeader>
                  <CardTitle>アラートトレンド（過去7日間）</CardTitle>
                </CardHeader>
                <CardContent>
                  {alertTrends.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={alertTrends}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis 
                          dataKey="date" 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickFormatter={(value) => format(toZonedTime(new Date(value), TIMEZONE), 'M月d日', { timeZone: TIMEZONE })}
                        />
                        <YAxis 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <Tooltip 
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            color: 'hsl(var(--foreground))',
                          }}
                          labelFormatter={(value) => format(toZonedTime(new Date(value), TIMEZONE), 'yyyy-MM-dd', { timeZone: TIMEZONE })}
                        />
                        <Bar dataKey="toolMissing" stackId="a" fill="hsl(0, 84%, 60%)" name="備品不在" />
                        <Bar dataKey="qrFailure" stackId="a" fill="hsl(38, 92%, 50%)" name="QR読取失敗" />
                        <Bar dataKey="cameraHealth" stackId="a" fill="hsl(280, 89%, 65%)" name="カメラ状態" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50 text-green-500" />
                        <p>過去7日間のアラートはありません</p>
                        <p className="text-xs mt-1">システムは正常に稼働中</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Performance Metrics */}
              <Card>
                <CardHeader>
                  <CardTitle>システム統計</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">キャプチャ成功率</span>
                      <span className="font-mono text-foreground" data-testid="text-detection-accuracy">
                        {captureSuccessRate > 0 ? `${captureSuccessRate}%` : '--'}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${captureSuccessRate >= 95 ? 'bg-green-500' : captureSuccessRate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} 
                        style={{ width: `${captureSuccessRate}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">スロット使用率</span>
                      <span className="font-mono text-foreground" data-testid="text-qr-detection-rate">
                        {summary && summary.totalSlots > 0 
                          ? `${Math.round((summary.activeSlots / summary.totalSlots) * 100)}%`
                          : '--'
                        }
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full" 
                        style={{ width: summary && summary.totalSlots > 0 ? `${(summary.activeSlots / summary.totalSlots) * 100}%` : '0%' }}
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">備品利用可能率</span>
                      <span className="font-mono text-foreground" data-testid="text-calibration-quality">
                        {availabilityRate > 0 ? `${availabilityRate}%` : '--'}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${availabilityRate >= 90 ? 'bg-green-500' : availabilityRate >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} 
                        style={{ width: `${availabilityRate || 0}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-foreground">{totalCaptures}</p>
                        <p className="text-xs text-muted-foreground">合計キャプチャ</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-foreground">
                          {captureSuccessRate > 0 ? `${captureSuccessRate}%` : '--'}
                        </p>
                        <p className="text-xs text-muted-foreground">成功率</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tool Activity Summary */}
            <Card>
              <CardHeader>
                <CardTitle>最も使用頻度の高い備品</CardTitle>
              </CardHeader>
              <CardContent>
                {extended?.topTools && extended.topTools.length > 0 ? (
                  <div className="space-y-3">
                    {extended.topTools.map((tool, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                        <div className="flex items-center gap-3">
                          <Badge 
                            className={
                              tool.status === 'present' ? 'bg-green-500/20 text-green-500' :
                              tool.status === 'checked-out' ? 'bg-blue-500/20 text-blue-500' :
                              tool.status === 'empty' ? 'bg-red-500/20 text-red-500' :
                              'bg-gray-500/20 text-gray-500'
                            }
                          >
                            {tool.status === 'present' ? '存在' : tool.status === 'checked-out' ? '貸出中' : tool.status === 'empty' ? '空' : tool.status.replace('-', ' ')}
                          </Badge>
                          <div>
                            <p className="text-sm font-medium text-foreground">{tool.tool}</p>
                            <p className="text-xs text-muted-foreground">スロット: {tool.slotId}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono text-foreground">{tool.checkouts}</p>
                          <p className="text-xs text-muted-foreground">イベント</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">
                    <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>備品アクティビティはまだ記録されていません</p>
                    <p className="text-xs mt-1">検出ログがキャプチャされるとアクティビティが表示されます</p>
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
