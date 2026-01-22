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
  clientId: z.string().min(1, "クライアントIDは必須です"),
  clientSecret: z.string().min(1, "クライアントシークレットは必須です"),
  redirectUri: z.string().url("有効なURLを入力してください"),
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
        title: "認可成功",
        description: `${service === 'gmail' ? 'Gmail' : 'Google スプレッドシート'}の認可が完了しました`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/oauth/google/status'] });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauthResult === 'error') {
      const message = urlParams.get('message') || '不明なエラー';
      toast({
        title: "認可失敗",
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
        title: "認証情報を保存しました",
        description: "OAuth認証情報を保存しました。次にアプリケーションを認可してください。",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/oauth/google/status'] });
      form.reset();
      setSelectedService(null);
    },
    onError: (error: any) => {
      toast({
        title: "セットアップ失敗",
        description: error.message || "認証情報の保存に失敗しました",
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
        title: "認可失敗",
        description: error.message || "認可URLの生成に失敗しました",
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
            <h2 className="text-2xl font-bold text-foreground">Google OAuthセットアップ</h2>
            <p className="text-sm text-muted-foreground mt-1">
              スタンドアロンRaspberry Pi展開用のGoogle OAuthを設定します
            </p>
          </div>

          {/* ステータスカード */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  Gmail（メールアラート）
                </CardTitle>
                <CardDescription>メール通知のOAuthステータス</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  {status?.gmail.configured ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  <span className="text-sm">
                    {status?.gmail.configured ? '認可済み・準備完了' : '未認可'}
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
                    Gmailを認可する
                  </Button>
                )}
                {!status?.gmail.hasClientCredentials && (
                  <Button
                    onClick={() => setSelectedService('gmail')}
                    variant="outline"
                    className="w-full"
                    data-testid="button-setup-gmail"
                  >
                    認証情報をセットアップ
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5" />
                  Google スプレッドシート（ログ記録）
                </CardTitle>
                <CardDescription>スプレッドシートログ記録のOAuthステータス</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  {status?.sheets.configured ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  <span className="text-sm">
                    {status?.sheets.configured ? '認可済み・準備完了' : '未認可'}
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
                    スプレッドシートを認可する
                  </Button>
                )}
                {!status?.sheets.hasClientCredentials && (
                  <Button
                    onClick={() => setSelectedService('sheets')}
                    variant="outline"
                    className="w-full"
                    data-testid="button-setup-sheets"
                  >
                    認証情報をセットアップ
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          {/* セットアップフォーム */}
          {selectedService && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedService === 'gmail' ? 'Gmail' : 'Google スプレッドシート'} OAuth認証情報のセットアップ
                </CardTitle>
                <CardDescription>
                  Google Cloud ConsoleのOAuth 2.0認証情報を入力してください
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
                          <FormLabel>クライアントID</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
                              data-testid="input-client-id"
                            />
                          </FormControl>
                          <FormDescription>
                            Google Cloud Console → 認証情報 → OAuth 2.0クライアントIDから取得
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
                          <FormLabel>クライアントシークレット</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="password" 
                              placeholder="GOCSPX-xxxxxxxxxxxxxx"
                              data-testid="input-client-secret"
                            />
                          </FormControl>
                          <FormDescription>
                            クライアントIDに関連付けられたシークレットキー
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
                          <FormLabel>リダイレクトURI</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              placeholder="http://localhost:5000/api/oauth/google/callback"
                              data-testid="input-redirect-uri"
                            />
                          </FormControl>
                          <FormDescription>
                            Google Cloud Consoleで設定したものと完全に一致する必要があります
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
                        {setupMutation.isPending ? '保存中...' : '認証情報を保存'}
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
                        キャンセル
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          {/* 手順 */}
          <Card>
            <CardHeader>
              <CardTitle>セットアップ手順</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">1</span>
                  Google Cloudプロジェクトを作成
                </h4>
                <p className="text-sm text-muted-foreground pl-8">
                  {' '}
                  <a 
                    href="https://console.cloud.google.com" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Google Cloud Console
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {' '}にアクセスし、新しいプロジェクトを作成します
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">2</span>
                  APIを有効化
                </h4>
                <p className="text-sm text-muted-foreground pl-8">
                  プロジェクトでGmail APIとGoogle Sheets APIを有効化します
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">3</span>
                  OAuth 2.0認証情報を作成
                </h4>
                <p className="text-sm text-muted-foreground pl-8">
                  認証情報 → 認証情報を作成 → OAuth 2.0クライアントIDに移動します
                </p>
                <p className="text-sm text-muted-foreground pl-8">
                  アプリケーションの種類: ウェブアプリケーション
                </p>
                <p className="text-sm text-muted-foreground pl-8">
                  承認済みのリダイレクトURI: <code className="bg-muted px-1 py-0.5 rounded text-xs">
                    {window.location.origin}/api/oauth/google/callback
                  </code>
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">4</span>
                  設定して認可する
                </h4>
                <p className="text-sm text-muted-foreground pl-8">
                  クライアントIDとクライアントシークレットをコピーし、上記に貼り付けてから「認可する」をクリックして権限を付与します
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
