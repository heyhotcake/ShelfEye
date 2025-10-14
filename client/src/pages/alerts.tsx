import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Mail, Table, Volume2, X, TestTube, MessageSquare, Settings2 } from "lucide-react";

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

export default function Alerts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newRecipient, setNewRecipient] = useState('');

  const { data: alertRules } = useQuery<AlertRule[]>({
    queryKey: ['/api/alert-rules'],
  });

  const { data: alertQueue } = useQuery<AlertQueue[]>({
    queryKey: ['/api/alert-queue'],
  });

  const { data: emailConfig } = useQuery<{ value: string[] }>({
    queryKey: ['/api/config/EMAIL_RECIPIENTS'],
  });

  const { data: sheetsUrlData } = useQuery<{ url: string | null }>({
    queryKey: ['/api/alerts/sheets-url'],
  });

  const { data: alertTemplatesConfig } = useQuery<{ value: Record<string, { subject: string; emailBody: string; sheetsMessage: string }> }>({
    queryKey: ['/api/config/ALERT_TEMPLATES'],
  });

  const { data: sheetsFormattingConfig } = useQuery<{ value: any }>({
    queryKey: ['/api/config/SHEETS_FORMATTING'],
  });

  const emailRecipients = (emailConfig?.value || []) as string[];
  const sheetsUrl = sheetsUrlData?.url || null;
  const alertTemplates = alertTemplatesConfig?.value || {};
  const sheetsFormatting = sheetsFormattingConfig?.value || {
    tabCreation: 'monthly',
    tabNamePattern: 'Alerts-{YYYY-MM}',
    columnOrder: ['timestamp', 'alertType', 'status', 'cameraId', 'slotId', 'errorMessage', 'details']
  };

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
      setNewRecipient('');
      updateConfigMutation.mutate({ key: 'EMAIL_RECIPIENTS', value: updated }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/config/EMAIL_RECIPIENTS'] });
        }
      });
    }
  };

  const removeEmailRecipient = (email: string) => {
    const updated = emailRecipients.filter(e => e !== email);
    updateConfigMutation.mutate({ key: 'EMAIL_RECIPIENTS', value: updated }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/config/EMAIL_RECIPIENTS'] });
      }
    });
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
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="alerts-title">
                Alert Management
              </h2>
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
              <Button variant="outline" size="sm" data-testid="button-close-alerts">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
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
                            readOnly
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
                    {sheetsUrl ? (
                      <a 
                        href={sheetsUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline block mb-2"
                        data-testid="link-sheets-url"
                      >
                        📊 Open Alert Log Spreadsheet
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground mb-2">
                        Spreadsheet will be created automatically on first alert
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Logs all captures, diagnostics, and alerts to Google Sheets
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
            
            {/* Alert Message Templates Configuration */}
            <Card className="mt-6">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  <CardTitle>Alert Message Templates</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Customize alert messages for each type. Use placeholders: <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{timestamp}'}</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{errorMessage}'}</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{cameraId}'}</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">{'{slotId}'}</code>
                </p>
                
                <Tabs defaultValue="diagnostic_failure" className="w-full">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="diagnostic_failure">Diagnostic</TabsTrigger>
                    <TabsTrigger value="capture_failure">Capture</TabsTrigger>
                    <TabsTrigger value="camera_offline">Camera</TabsTrigger>
                    <TabsTrigger value="test_alert">Test</TabsTrigger>
                  </TabsList>
                  
                  {Object.entries(alertTemplates).map(([alertType, template]: [string, any]) => (
                    <TabsContent key={alertType} value={alertType} className="space-y-4">
                      <div>
                        <Label htmlFor={`${alertType}-subject`}>Email Subject</Label>
                        <Input
                          id={`${alertType}-subject`}
                          value={template.subject || ''}
                          onChange={(e) => {
                            const updated = { ...alertTemplates, [alertType]: { ...template, subject: e.target.value } };
                            updateConfigMutation.mutate({ key: 'ALERT_TEMPLATES', value: updated }, {
                              onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/config/ALERT_TEMPLATES'] })
                            });
                          }}
                          data-testid={`input-${alertType}-subject`}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`${alertType}-body`}>Email Body</Label>
                        <Textarea
                          id={`${alertType}-body`}
                          value={template.emailBody || ''}
                          onChange={(e) => {
                            const updated = { ...alertTemplates, [alertType]: { ...template, emailBody: e.target.value } };
                            updateConfigMutation.mutate({ key: 'ALERT_TEMPLATES', value: updated }, {
                              onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/config/ALERT_TEMPLATES'] })
                            });
                          }}
                          rows={5}
                          data-testid={`input-${alertType}-body`}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`${alertType}-sheets`}>Sheets Message</Label>
                        <Input
                          id={`${alertType}-sheets`}
                          value={template.sheetsMessage || ''}
                          onChange={(e) => {
                            const updated = { ...alertTemplates, [alertType]: { ...template, sheetsMessage: e.target.value } };
                            updateConfigMutation.mutate({ key: 'ALERT_TEMPLATES', value: updated }, {
                              onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/config/ALERT_TEMPLATES'] })
                            });
                          }}
                          data-testid={`input-${alertType}-sheets`}
                        />
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
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

            {/* Recent Alert History */}
            <Card className="mt-6">
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
        </div>
      </main>
    </div>
  );
}
