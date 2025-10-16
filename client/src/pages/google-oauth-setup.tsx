import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, ExternalLink, Key, Mail, FileSpreadsheet } from "lucide-react";
import { z } from "zod";

const setupSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  redirectUri: z.string().url("Must be a valid URL"),
});

type SetupForm = z.infer<typeof setupSchema>;

interface OAuthStatus {
  gmail: {
    configured: boolean;
    hasClientCredentials: boolean;
  };
  sheets: {
    configured: boolean;
    hasClientCredentials: boolean;
  };
}

export default function GoogleOAuthSetup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedService, setSelectedService] = useState<'gmail' | 'sheets' | null>(null);

  const form = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      clientId: "",
      clientSecret: "",
      redirectUri: `${window.location.origin}/api/oauth/google/callback`,
    },
  });

  const { data: status } = useQuery<OAuthStatus>({
    queryKey: ['/api/oauth/google/status'],
  });

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const oauthResult = urlParams.get('oauth');
    const service = urlParams.get('service');

    if (oauthResult === 'success' && service) {
      toast({
        title: "Authorization Successful",
        description: `${service.charAt(0).toUpperCase() + service.slice(1)} has been authorized successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/oauth/google/status'] });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauthResult === 'error') {
      const message = urlParams.get('message') || 'Unknown error';
      toast({
        title: "Authorization Failed",
        description: decodeURIComponent(message),
        variant: "destructive",
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [toast, queryClient]);

  const setupMutation = useMutation({
    mutationFn: async (data: SetupForm & { service: 'gmail' | 'sheets' }) => {
      const response = await apiRequest('POST', '/api/oauth/google/setup', data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Credentials Saved",
        description: "OAuth client credentials saved. Now authorize the application.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/oauth/google/status'] });
      form.reset();
      setSelectedService(null);
    },
    onError: (error: any) => {
      toast({
        title: "Setup Failed",
        description: error.message || "Failed to save credentials",
        variant: "destructive",
      });
    },
  });

  const authorizeMutation = useMutation({
    mutationFn: async (service: 'gmail' | 'sheets') => {
      const response = await fetch(`/api/oauth/google/auth-url/${service}`);
      const data = await response.json();
      return data.authUrl;
    },
    onSuccess: (authUrl: string) => {
      window.location.href = authUrl;
    },
    onError: (error: any) => {
      toast({
        title: "Authorization Failed",
        description: error.message || "Failed to generate authorization URL",
        variant: "destructive",
      });
    },
  });

  const handleSetup = (data: SetupForm) => {
    if (selectedService) {
      setupMutation.mutate({ ...data, service: selectedService });
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Google OAuth Setup</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Configure Google OAuth for standalone Raspberry Pi deployment
            </p>
          </div>

          {/* Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  Gmail (Email Alerts)
                </CardTitle>
                <CardDescription>OAuth status for email notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  {status?.gmail.configured ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  <span className="text-sm">
                    {status?.gmail.configured ? 'Authorized & Ready' : 'Not Authorized'}
                  </span>
                </div>
                {status?.gmail.hasClientCredentials && !status?.gmail.configured && (
                  <Button
                    onClick={() => authorizeMutation.mutate('gmail')}
                    disabled={authorizeMutation.isPending}
                    className="w-full"
                    data-testid="button-authorize-gmail"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Authorize Gmail
                  </Button>
                )}
                {!status?.gmail.hasClientCredentials && (
                  <Button
                    onClick={() => setSelectedService('gmail')}
                    variant="outline"
                    className="w-full"
                    data-testid="button-setup-gmail"
                  >
                    Setup Credentials
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5" />
                  Google Sheets (Logging)
                </CardTitle>
                <CardDescription>OAuth status for spreadsheet logging</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  {status?.sheets.configured ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  <span className="text-sm">
                    {status?.sheets.configured ? 'Authorized & Ready' : 'Not Authorized'}
                  </span>
                </div>
                {status?.sheets.hasClientCredentials && !status?.sheets.configured && (
                  <Button
                    onClick={() => authorizeMutation.mutate('sheets')}
                    disabled={authorizeMutation.isPending}
                    className="w-full"
                    data-testid="button-authorize-sheets"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Authorize Sheets
                  </Button>
                )}
                {!status?.sheets.hasClientCredentials && (
                  <Button
                    onClick={() => setSelectedService('sheets')}
                    variant="outline"
                    className="w-full"
                    data-testid="button-setup-sheets"
                  >
                    Setup Credentials
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Setup Form */}
          {selectedService && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Setup {selectedService === 'gmail' ? 'Gmail' : 'Google Sheets'} OAuth Credentials
                </CardTitle>
                <CardDescription>
                  Enter your Google Cloud Console OAuth 2.0 credentials
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleSetup)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="clientId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client ID</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
                              data-testid="input-client-id"
                            />
                          </FormControl>
                          <FormDescription>
                            From Google Cloud Console → Credentials → OAuth 2.0 Client IDs
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="clientSecret"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client Secret</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="password" 
                              placeholder="GOCSPX-xxxxxxxxxxxxxx"
                              data-testid="input-client-secret"
                            />
                          </FormControl>
                          <FormDescription>
                            The secret key associated with your Client ID
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="redirectUri"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Redirect URI</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              placeholder="http://localhost:5000/api/oauth/google/callback"
                              data-testid="input-redirect-uri"
                            />
                          </FormControl>
                          <FormDescription>
                            Must match exactly what you configured in Google Cloud Console
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex gap-2">
                      <Button 
                        type="submit" 
                        disabled={setupMutation.isPending}
                        data-testid="button-save-credentials"
                      >
                        {setupMutation.isPending ? 'Saving...' : 'Save Credentials'}
                      </Button>
                      <Button 
                        type="button" 
                        variant="outline" 
                        onClick={() => {
                          setSelectedService(null);
                          form.reset();
                        }}
                        data-testid="button-cancel"
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Setup Instructions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">1</span>
                  Create Google Cloud Project
                </h4>
                <p className="text-sm text-muted-foreground pl-8">
                  Go to{' '}
                  <a 
                    href="https://console.cloud.google.com" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Google Cloud Console
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {' '}and create a new project
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">2</span>
                  Enable APIs
                </h4>
                <p className="text-sm text-muted-foreground pl-8">
                  Enable Gmail API and Google Sheets API for your project
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">3</span>
                  Create OAuth 2.0 Credentials
                </h4>
                <p className="text-sm text-muted-foreground pl-8">
                  Go to Credentials → Create Credentials → OAuth 2.0 Client ID
                </p>
                <p className="text-sm text-muted-foreground pl-8">
                  Application type: Web application
                </p>
                <p className="text-sm text-muted-foreground pl-8">
                  Authorized redirect URI: <code className="bg-muted px-1 py-0.5 rounded text-xs">
                    {window.location.origin}/api/oauth/google/callback
                  </code>
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">4</span>
                  Configure & Authorize
                </h4>
                <p className="text-sm text-muted-foreground pl-8">
                  Copy Client ID and Client Secret, paste them above, then click "Authorize" to grant permissions
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
