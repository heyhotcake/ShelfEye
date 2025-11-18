import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, Clock, AlertTriangle, CheckCircle } from "lucide-react";
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

export default function Analytics() {
  const { data: summary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ['/api/analytics/summary'],
    refetchInterval: 30000,
  });

  const { data: detectionHistory } = useQuery({
    queryKey: ['/api/detection-logs', { limit: 100 }],
  });

  const formatJSTTimestamp = (timestamp: string | Date) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    const zonedDate = toZonedTime(date, TIMEZONE);
    return format(zonedDate, "yyyy-MM-dd HH:mm:ss", { timeZone: TIMEZONE });
  };

  // Generate sample time series data
  const timeSeriesData = [
    { time: '00:00', present: 58, empty: 2, alerts: 0 },
    { time: '04:00', present: 57, empty: 3, alerts: 1 },
    { time: '08:00', present: 52, empty: 6, alerts: 3 },
    { time: '09:00', present: 48, empty: 8, alerts: 4 },
    { time: '12:00', present: 54, empty: 4, alerts: 2 },
    { time: '13:00', present: 46, empty: 10, alerts: 6 },
    { time: '17:00', present: 55, empty: 3, alerts: 1 },
    { time: '20:00', present: 59, empty: 1, alerts: 0 },
  ];

  const statusDistribution = [
    { name: 'Present', value: summary?.statusCounts.present || 0, color: 'hsl(142, 76%, 45%)' },
    { name: 'Empty', value: summary?.statusCounts.empty || 0, color: 'hsl(0, 84%, 60%)' },
    { name: 'Checked Out', value: summary?.statusCounts.checkedOut || 0, color: 'hsl(217, 91%, 60%)' },
    { name: 'Occupied', value: summary?.statusCounts.occupied || 0, color: 'hsl(215, 20%, 45%)' },
    { name: 'Error', value: summary?.statusCounts.error || 0, color: 'hsl(280, 89%, 65%)' },
  ];

  const alertTrends = [
    { date: '2025-01-05', toolMissing: 2, qrFailure: 1, cameraHealth: 0 },
    { date: '2025-01-06', toolMissing: 4, qrFailure: 2, cameraHealth: 1 },
    { date: '2025-01-07', toolMissing: 1, qrFailure: 0, cameraHealth: 0 },
    { date: '2025-01-08', toolMissing: 3, qrFailure: 1, cameraHealth: 0 },
    { date: '2025-01-09', toolMissing: 5, qrFailure: 3, cameraHealth: 1 },
  ];

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
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="analytics-title">
                Analytics Dashboard
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Performance insights and trend analysis
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Select defaultValue="7d">
                <SelectTrigger className="w-32" data-testid="select-time-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24H</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="90d">Last 90 Days</SelectItem>
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
                      <p className="text-sm text-muted-foreground">Availability Rate</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="text-availability-rate">
                        {summary ? Math.round((summary.statusCounts.present / summary.activeSlots) * 100) : 0}%
                      </p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-green-500" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <TrendingUp className="w-3 h-3 text-green-500" />
                    <span className="text-xs text-green-500">+2.3% from yesterday</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Alert Response Time</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="text-response-time">
                        4.2m
                      </p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
                      <Clock className="w-6 h-6 text-blue-500" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <TrendingDown className="w-3 h-3 text-green-500" />
                    <span className="text-xs text-green-500">-1.2m from yesterday</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">System Uptime</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="text-system-uptime">
                        99.8%
                      </p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
                      <Activity className="w-6 h-6 text-green-500" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span className="text-xs text-green-500">Excellent</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Critical Alerts</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="text-critical-alerts">
                        {summary?.alertCounts.active || 0}
                      </p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-red-500/20 flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6 text-red-500" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <TrendingDown className="w-3 h-3 text-green-500" />
                    <span className="text-xs text-green-500">-2 from yesterday</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Tool Presence Over Time */}
              <Card>
                <CardHeader>
                  <CardTitle>Tool Presence Over Time</CardTitle>
                </CardHeader>
                <CardContent>
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
                        name="Tools Present"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="empty" 
                        stroke="hsl(0, 84%, 60%)"
                        strokeWidth={2}
                        name="Empty Slots"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Status Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Current Status Distribution</CardTitle>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Alert Trends */}
              <Card>
                <CardHeader>
                  <CardTitle>Alert Trends (Last 7 Days)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={alertTrends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="date" 
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickFormatter={(value) => format(toZonedTime(new Date(value), TIMEZONE), 'MMM dd', { timeZone: TIMEZONE })}
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
                      <Bar dataKey="toolMissing" stackId="a" fill="hsl(0, 84%, 60%)" name="Tool Missing" />
                      <Bar dataKey="qrFailure" stackId="a" fill="hsl(38, 92%, 50%)" name="QR Failure" />
                      <Bar dataKey="cameraHealth" stackId="a" fill="hsl(280, 89%, 65%)" name="Camera Health" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Performance Metrics */}
              <Card>
                <CardHeader>
                  <CardTitle>Performance Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Detection Accuracy</span>
                      <span className="font-mono text-foreground" data-testid="text-detection-accuracy">98.7%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: '98.7%' }}></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">QR Detection Rate</span>
                      <span className="font-mono text-foreground" data-testid="text-qr-detection-rate">94.2%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{ width: '94.2%' }}></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Camera Calibration</span>
                      <span className="font-mono text-foreground" data-testid="text-calibration-quality">0.82 px</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: '95%' }}></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Processing Speed</span>
                      <span className="font-mono text-foreground" data-testid="text-processing-speed">3.2s/capture</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className="bg-amber-500 h-2 rounded-full" style={{ width: '75%' }}></div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-foreground">1,247</p>
                        <p className="text-xs text-muted-foreground">Total Captures</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-foreground">99.1%</p>
                        <p className="text-xs text-muted-foreground">Success Rate</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tool Activity Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Most Active Tools</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { tool: 'Scissors (A1)', checkouts: 12, avgDuration: '2.3h', status: 'present' },
                    { tool: 'Wire Cutters (A4)', checkouts: 8, avgDuration: '1.8h', status: 'checked-out' },
                    { tool: 'Pliers (A3)', checkouts: 6, avgDuration: '3.1h', status: 'empty' },
                    { tool: 'Tape Cutter (A2)', checkouts: 5, avgDuration: '1.2h', status: 'present' },
                    { tool: 'Measure Tape (A5)', checkouts: 4, avgDuration: '4.2h', status: 'present' },
                  ].map((tool, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                      <div className="flex items-center gap-3">
                        <Badge 
                          className={
                            tool.status === 'present' ? 'bg-green-500/20 text-green-500' :
                            tool.status === 'checked-out' ? 'bg-blue-500/20 text-blue-500' :
                            'bg-red-500/20 text-red-500'
                          }
                        >
                          {tool.status.replace('-', ' ')}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium text-foreground">{tool.tool}</p>
                          <p className="text-xs text-muted-foreground">Avg duration: {tool.avgDuration}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono text-foreground">{tool.checkouts}</p>
                        <p className="text-xs text-muted-foreground">checkouts</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
