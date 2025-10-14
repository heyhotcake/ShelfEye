import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Calendar, Clock, Play, AlertTriangle } from "lucide-react";
import { format, toZonedTime } from "date-fns-tz";
import type { CaptureRun } from "@shared/schema";

const TIMEZONE = "Asia/Tokyo";

export default function Scheduler() {
  const { toast } = useToast();
  const [newCaptureTime, setNewCaptureTime] = useState("");

  // Fetch schedule configuration
  const { data: scheduleConfig, isLoading: isLoadingConfig } = useQuery({
    queryKey: ["/api/schedule-config"],
  });

  // Fetch next scheduled runs
  const { data: nextRuns } = useQuery({
    queryKey: ["/api/schedule-config/next-runs"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch recent capture runs
  const { data: captureRuns = [], isLoading: isLoadingRuns } = useQuery<CaptureRun[]>({
    queryKey: ["/api/capture-runs"],
    refetchInterval: 30000,
  });

  // Update schedule config mutation
  const updateConfigMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/schedule-config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-config/next-runs"] });
      toast({
        title: "Schedule Updated",
        description: "Scheduler configuration has been updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  // Reload scheduler mutation
  const reloadMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/schedule-config/reload", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-config/next-runs"] });
      toast({
        title: "Scheduler Reloaded",
        description: "Schedule has been reloaded with new configuration",
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
        title: "Invalid Time",
        description: "Please enter a time in HH:mm format",
        variant: "destructive",
      });
      return;
    }

    // Validate time format
    const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timeRegex.test(newCaptureTime)) {
      toast({
        title: "Invalid Time Format",
        description: "Time must be in HH:mm format (e.g., 08:00)",
        variant: "destructive",
      });
      return;
    }

    if (captureTimes.includes(newCaptureTime)) {
      toast({
        title: "Duplicate Time",
        description: "This capture time already exists",
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

  const formatJSTTimestamp = (timestamp: string | Date) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    const zonedDate = toZonedTime(date, TIMEZONE);
    return format(zonedDate, "MMM dd, yyyy HH:mm:ss", { timeZone: TIMEZONE });
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

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status as keyof typeof colors] || "bg-gray-100 text-gray-800"}`}>
        {status.replace("_", " ").toUpperCase()}
      </span>
    );
  };

  if (isLoadingConfig) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">Loading scheduler configuration...</div>
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
              <h1 className="text-3xl font-bold tracking-tight">Scheduler</h1>
              <p className="text-muted-foreground mt-1">Configure automated capture schedule</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Scheduler</span>
                <Switch
                  checked={!isPaused}
                  onCheckedChange={handleTogglePause}
                  disabled={updateConfigMutation.isPending}
                  data-testid="switch-scheduler-pause"
                />
                <span className={`text-sm font-medium ${isPaused ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                  {isPaused ? "Paused" : "Active"}
                </span>
              </div>
            </div>
          </div>

          {/* Capture Times Configuration */}
          <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Scheduled Capture Times (JST)</h2>
          </div>

          <div className="space-y-4">
            {/* Current capture times */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {captureTimes.map((time: string) => (
                <div
                  key={time}
                  className="flex items-center justify-between p-3 border rounded-lg bg-card"
                  data-testid={`capture-time-${time}`}
                >
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="font-mono text-lg">{time}</span>
                    <span className="text-sm text-muted-foreground">JST</span>
                  </div>
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
              ))}
            </div>

            {/* Add new time */}
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
                Add Time
              </Button>
            </div>
          </div>
          </Card>

          {/* Next Scheduled Runs */}
          <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Next Scheduled Runs</h2>
          </div>

          {isPaused ? (
            <div className="text-center text-muted-foreground py-4">
              <AlertTriangle className="w-12 h-12 mx-auto mb-2 text-yellow-500" />
              <p>Scheduler is paused. No captures scheduled.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {nextRuns?.capture?.map((time: string, index: number) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                  <div className="flex items-center gap-3">
                    <Play className="w-4 h-4 text-green-600" />
                    <div>
                      <div className="font-medium">Capture #{index + 1}</div>
                      <div className="text-sm text-muted-foreground">{time}</div>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Diagnostic: {nextRuns.diagnostic[index]}
                  </div>
                </div>
              ))}
            </div>
          )}
          </Card>

          {/* Recent Capture History */}
          <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-semibold">Recent Capture History</h2>
            </div>
          </div>

          {isLoadingRuns ? (
            <div className="text-center text-muted-foreground py-4">Loading history...</div>
          ) : captureRuns.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No capture runs yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="text-left text-sm text-muted-foreground">
                    <th className="pb-3 font-medium">Timestamp (JST)</th>
                    <th className="pb-3 font-medium">Trigger</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium text-right">Cameras</th>
                    <th className="pb-3 font-medium text-right">Slots</th>
                    <th className="pb-3 font-medium text-right">Failures</th>
                    <th className="pb-3 font-medium text-right">Time (ms)</th>
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
    </div>
  );
}
