import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Mail, Table, Volume2, X, TestTube } from "lucide-react";

interface AlertPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AlertRule {
  id: string;
  name: string;
  ruleType: string;
  isEnabled: boolean;
  verificationWindow: number;
  businessHoursOnly: boolean;
  priority: string;
  conditions: Record<string, any>;
}

interface AlertQueue {
  id: string;
  alertType: string;
  message: string;
  status: string;
  retryCount: number;
  scheduledAt: string;
  sentAt: string | null;
}

export function AlertPanel({ open, onOpenChange }: AlertPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [emailRecipients, setEmailRecipients] = useState<string[]>(['manager@factory.com', 'supervisor@factory.com']);
  const [newRecipient, setNewRecipient] = useState('');

  const { data: alertRules } = useQuery<AlertRule[]>({
    queryKey: ['/api/alert-rules'],
    enabled: open,
  });

  const { data: alertQueue } = useQuery<AlertQueue[]>({
    queryKey: ['/api/alert-queue'],
    enabled: open,
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<AlertRule> }) =>
      apiRequest('PUT', `/api/alert-rules/${id}`, updates),
    onSuccess: () => {
      toast({
        title: "Rule Updated",
        description: "Alert rule updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/alert-rules'] });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
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

  const testAlertMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/alerts/test'),
    onSuccess: () => {
      toast({
        title: "Test Alert Sent",
        description: "Check your email and other notification channels",
      });
    },
    onError: (error) => {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addEmailRecipient = () => {
    if (newRecipient && !emailRecipients.includes(newRecipient)) {
      const updated = [...emailRecipients, newRecipient];
      setEmailRecipients(updated);
      setNewRecipient('');
      updateConfigMutation.mutate({ key: 'EMAIL_RECIPIENTS', value: updated });
    }
  };

  const removeEmailRecipient = (email: string) => {
    const updated = emailRecipients.filter(e => e !== email);
    setEmailRecipients(updated);
    updateConfigMutation.mutate({ key: 'EMAIL_RECIPIENTS', value: updated });
  };

  const getRuleIcon = (ruleType: string) => {
    switch (ruleType) {
      case 'TOOL_MISSING': return '🔧';
      case 'QR_FAILURE': return '📱';
      case 'CAMERA_HEALTH': return '📷';
      default: return '⚠️';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-500/20 text-amber-500';
      case 'sent': return 'bg-green-500/20 text-green-500';
      case 'failed': return 'bg-red-500/20 text-red-500';
      default: return 'bg-gray-500/20 text-gray-500';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold text-foreground">
                Alert Management
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">Configure alert rules and notification channels</p>
            </div>
            <div className="flex items-center gap-3">
              <Button 
                variant="outline"
                onClick={() => testAlertMutation.mutate()}
                disabled={testAlertMutation.isPending}
                data-testid="button-test-alerts"
              >
                <TestTube className="w-4 h-4 mr-2" />
                Test Alerts
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => onOpenChange(false)}
                data-testid="button-close-alerts"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
          
          {/* Alert Rules */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Alert Rules</h3>
            
            {alertRules?.map((rule) => (
              <Card key={rule.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${rule.isEnabled ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                      <p className="font-medium text-foreground">
                        {getRuleIcon(rule.ruleType)} {rule.name}
                      </p>
                    </div>
                    <Switch
                      checked={rule.isEnabled}
                      onCheckedChange={(checked) => 
                        updateRuleMutation.mutate({ id: rule.id, updates: { isEnabled: checked } })
                      }
                      data-testid={`switch-${rule.name.toLowerCase().replace(/\s+/g, '-')}`}
                    />
                  </div>
                  
                  <p className="text-sm text-muted-foreground mb-3">
                    {rule.ruleType === 'TOOL_MISSING' && 
                      `Trigger when slot is empty for ${rule.verificationWindow}+ minutes during business hours`}
                    {rule.ruleType === 'QR_FAILURE' && 
                      `Alert when QR is unreadable ${rule.conditions.consecutiveFailures || 3}+ consecutive captures`}
                    {rule.ruleType === 'CAMERA_HEALTH' && 
                      `Alert on calibration drift or capture failures`}
                  </p>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Verification:</span>
                      <span className="text-foreground">{rule.verificationWindow} minutes</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Active:</span>
                      <span className="text-foreground">
                        {rule.businessHoursOnly ? '08:00-20:00 (weekdays)' : 'Always'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Priority:</span>
                      <Badge 
                        className={
                          rule.priority === 'high' ? 'bg-red-500/20 text-red-500' :
                          rule.priority === 'medium' ? 'bg-amber-500/20 text-amber-500' :
                          'bg-gray-500/20 text-gray-500'
                        }
                      >
                        {rule.priority}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          {/* Notification Channels */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Notification Channels</h3>
            
            {/* Email Alerts */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Mail className="w-5 h-5 text-primary" />
                    <p className="font-medium text-foreground">Email Alerts</p>
                  </div>
                  <Switch defaultChecked data-testid="switch-email-alerts" />
                </div>
                
                <div className="space-y-2">
                  {emailRecipients.map((email, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={email}
                        onChange={(e) => {
                          const updated = [...emailRecipients];
                          updated[index] = e.target.value;
                          setEmailRecipients(updated);
                        }}
                        onBlur={() => updateConfigMutation.mutate({ key: 'EMAIL_RECIPIENTS', value: emailRecipients })}
                        className="text-sm"
                        data-testid={`input-email-${index}`}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeEmailRecipient(email)}
                        data-testid={`button-remove-email-${index}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Add recipient email"
                      value={newRecipient}
                      onChange={(e) => setNewRecipient(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addEmailRecipient()}
                      className="text-sm"
                      data-testid="input-new-email"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addEmailRecipient}
                      data-testid="button-add-email"
                    >
                      +
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Google Sheets */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Table className="w-5 h-5 text-green-500" />
                    <p className="font-medium text-foreground">Google Sheets Log</p>
                  </div>
                  <Switch defaultChecked data-testid="switch-sheets-log" />
                </div>
                <Input
                  placeholder="Sheet ID or URL"
                  className="text-sm"
                  data-testid="input-sheets-id"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Logs all detections and alerts to Google Sheets
                </p>
              </CardContent>
            </Card>
            
            {/* Sound Alert */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-amber-500" />
                    <p className="font-medium text-foreground">Sound Alert</p>
                  </div>
                  <Switch defaultChecked data-testid="switch-sound-alert" />
                </div>
                <Select defaultValue="tone1">
                  <SelectTrigger data-testid="select-sound-tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tone1">Alert Tone 1 (Beep)</SelectItem>
                    <SelectItem value="tone2">Alert Tone 2 (Chime)</SelectItem>
                    <SelectItem value="tone3">Alert Tone 3 (Siren)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  Play sound on local machine when alert triggers
                </p>
              </CardContent>
            </Card>
            
            {/* Alert Queue Status */}
            <Card>
              <CardContent className="p-4">
                <h4 className="font-medium text-foreground mb-3">Alert Queue Status</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Pending</span>
                    <span className="font-mono text-foreground" data-testid="text-pending-alerts">
                      {alertQueue?.filter(a => a.status === 'pending').length || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Failed (will retry)</span>
                    <span className="font-mono text-foreground" data-testid="text-failed-alerts">
                      {alertQueue?.filter(a => a.status === 'failed').length || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Sent (24h)</span>
                    <span className="font-mono text-foreground" data-testid="text-sent-alerts">
                      {alertQueue?.filter(a => a.status === 'sent' && 
                        new Date(a.sentAt || '').getTime() > Date.now() - 24 * 60 * 60 * 1000
                      ).length || 0}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        
        {/* Recent Alert History */}
        <div className="px-6 pb-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Alert History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alertQueue?.slice(0, 10).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                    <div className="flex items-center gap-3">
                      <Badge className={getStatusColor(alert.status)}>
                        {alert.status}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium text-foreground">{alert.alertType}</p>
                        <p className="text-xs text-muted-foreground">{alert.message}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        {new Date(alert.scheduledAt).toLocaleString()}
                      </p>
                      {alert.retryCount > 0 && (
                        <p className="text-xs text-amber-500">
                          Retries: {alert.retryCount}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                
                {!alertQueue?.length && (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No alerts in queue</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
