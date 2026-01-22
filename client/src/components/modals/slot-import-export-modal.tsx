import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { Download, Upload, AlertCircle, CheckCircle, FileJson } from "lucide-react";

interface SlotImportExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cameraId?: string;
  cameraName?: string;
}

interface ValidationError {
  slotId: string;
  code: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export function SlotImportExportModal({ open, onOpenChange, cameraId, cameraName }: SlotImportExportModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [importData, setImportData] = useState<any>(null);
  const [importStep, setImportStep] = useState<'upload' | 'validate' | 'confirm'>('upload');

  const exportSlots = async () => {
    if (!cameraId) {
      toast({
        title: "カメラ未選択",
        description: "スロットをエクスポートするカメラを選択してください",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch(`/api/slots/export/${cameraId}`);
      if (!response.ok) {
        throw new Error("スロットのエクスポートに失敗しました");
      }

      const exportData = await response.json();
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `slots_${cameraName || cameraId}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "スロットエクスポート完了",
        description: `${cameraName || 'カメラ'}の${exportData.slots?.length || 0}スロットをダウンロードしました`,
      });
    } catch (error) {
      toast({
        title: "エクスポート失敗",
        description: error instanceof Error ? error.message : "スロットのエクスポートに失敗しました",
        variant: "destructive",
      });
    }
  };

  const validateMutation = useMutation({
    mutationFn: async (data: { json: any; targetCameraId: string }) => {
      try {
        const response = await apiRequest('POST', '/api/slots/import', {
          ...data,
          validateOnly: true
        });
        const result = await response.json();
        
        return {
          valid: true,
          errors: [],
          warnings: result.warnings || []
        };
      } catch (error: any) {
        if (error.message && error.message.startsWith('400:')) {
          try {
            const jsonBody = error.message.substring(4).trim();
            const errorData = JSON.parse(jsonBody);
            return {
              valid: false,
              errors: errorData.errors || [],
              warnings: errorData.warnings || []
            };
          } catch (parseError) {
            console.error('Failed to parse validation error response:', parseError);
            throw error;
          }
        }
        throw error;
      }
    },
    onSuccess: (result) => {
      setValidationResult(result);
      if (result.valid) {
        if (result.warnings.length > 0) {
          setImportStep('confirm');
          toast({
            title: "警告付きで検証通過",
            description: `${importData.slots.length}スロットが検証されました。インポート前に${result.warnings.length}件の警告を確認してください。`,
          });
        } else {
          setImportStep('confirm');
          toast({
            title: "検証通過",
            description: `すべての${importData.slots.length}スロットが有効でインポート準備完了`,
          });
        }
      } else {
        setImportStep('validate');
        toast({
          title: "検証失敗",
          description: `${result.errors.length}件のエラー${result.warnings.length > 0 ? `と${result.warnings.length}件の警告` : ''}が見つかりました。インポート前にエラーを修正してください。`,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      setImportStep('upload');
      toast({
        title: "検証失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: { json: any; targetCameraId: string }) => {
      const response = await apiRequest('POST', '/api/slots/import', data);
      const result = await response.json();
      return result;
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/slots'] });
      toast({
        title: "インポート成功",
        description: `${cameraName || 'カメラ'}に${result.imported}スロットをインポートしました`,
      });
      onOpenChange(false);
      resetState();
    },
    onError: (error: Error) => {
      toast({
        title: "インポート失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.cameraId || !Array.isArray(data.slots)) {
          throw new Error("無効なファイル形式です。cameraIdとslotsの配列が必要です。");
        }

        if (data.cameraId !== cameraId) {
          toast({
            title: "カメラ不一致",
            description: `ファイルはカメラ${data.cameraId}用ですが、${cameraName}が選択されています。インポートしますか？`,
          });
        }

        if (!cameraId) {
          toast({
            title: "カメラ未選択",
            description: "スロットをインポートする前にカメラを選択してください",
            variant: "destructive",
          });
          return;
        }

        setImportData(data);
        setImportStep('validate');
        validateMutation.mutate({ json: data, targetCameraId: cameraId });
      } catch (error) {
        toast({
          title: "無効なファイル",
          description: error instanceof Error ? error.message : "JSONファイルの解析に失敗しました",
          variant: "destructive",
        });
      }
    };
    input.click();
  };

  const confirmImport = () => {
    if (!importData || !cameraId) return;
    importMutation.mutate({ json: importData, targetCameraId: cameraId });
  };

  const resetState = () => {
    setImportData(null);
    setValidationResult(null);
    setImportStep('upload');
  };

  const handleClose = () => {
    if (importStep === 'confirm' && validationResult) {
      return;
    }
    
    onOpenChange(false);
    setTimeout(resetState, 300);
  };

  const handleCancel = () => {
    onOpenChange(false);
    setTimeout(resetState, 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" data-testid="dialog-slot-import-export">
        <DialogHeader>
          <DialogTitle>スロット インポート/エクスポート</DialogTitle>
          <DialogDescription>
            {cameraName ? `${cameraName}のスロットを管理` : 'スロットを管理するカメラを選択してください'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Export Section */}
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Download className="w-4 h-4" />
              現在のスロットをエクスポート
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              選択したカメラのすべてのスロットをJSONファイルとしてダウンロード
            </p>
            <Button
              onClick={exportSlots}
              disabled={!cameraId}
              data-testid="button-export-slots"
              variant="outline"
            >
              <Download className="w-4 h-4 mr-2" />
              JSONにエクスポート
            </Button>
          </div>

          {/* Import Section */}
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Upload className="w-4 h-4" />
              ファイルからスロットをインポート
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              JSONファイルをアップロードしてスロット設定をインポートおよび検証
            </p>

            {importStep === 'upload' && (
              <Button
                onClick={handleFileUpload}
                disabled={!cameraId || validateMutation.isPending}
                data-testid="button-import-slots"
              >
                <Upload className="w-4 h-4 mr-2" />
                {validateMutation.isPending ? '検証中...' : 'JSONファイルを選択'}
              </Button>
            )}

            {/* Validation Results */}
            {validationResult && importStep !== 'upload' && (
              <div className="space-y-3 mt-4">
                <Alert variant={validationResult.valid ? "default" : "destructive"}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {validationResult.valid ? (
                      <>
                        <CheckCircle className="w-4 h-4 inline mr-2" />
                        すべての{importData?.slots?.length || 0}スロットが正常に検証されました
                      </>
                    ) : (
                      <>
                        {validationResult.errors.length}件のエラーと{validationResult.warnings.length}件の警告が見つかりました
                      </>
                    )}
                  </AlertDescription>
                </Alert>

                {/* Errors Table */}
                {validationResult.errors.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-destructive">エラー</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>スロットID</TableHead>
                          <TableHead>フィールド</TableHead>
                          <TableHead>エラーコード</TableHead>
                          <TableHead>メッセージ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validationResult.errors.map((error, idx) => (
                          <TableRow key={idx} data-testid={`error-row-${idx}`}>
                            <TableCell className="font-mono text-sm">{error.slotId}</TableCell>
                            <TableCell className="font-mono text-sm">{error.field}</TableCell>
                            <TableCell>
                              <Badge variant="destructive" className="font-mono text-xs">
                                {error.code}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{error.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Warnings Table */}
                {validationResult.warnings.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-yellow-600">警告</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>スロットID</TableHead>
                          <TableHead>フィールド</TableHead>
                          <TableHead>警告コード</TableHead>
                          <TableHead>メッセージ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validationResult.warnings.map((warning, idx) => (
                          <TableRow key={idx} data-testid={`warning-row-${idx}`}>
                            <TableCell className="font-mono text-sm">{warning.slotId}</TableCell>
                            <TableCell className="font-mono text-sm">{warning.field}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs border-yellow-600 text-yellow-600">
                                {warning.code}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{warning.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={importStep === 'confirm' ? handleCancel : handleClose} 
            data-testid="button-cancel"
          >
            {importStep === 'confirm' ? 'キャンセル' : '閉じる'}
          </Button>
          {importStep === 'validate' && !validationResult?.valid && (
            <Button
              variant="outline"
              onClick={() => {
                resetState();
              }}
              data-testid="button-try-again"
            >
              <FileJson className="w-4 h-4 mr-2" />
              別のファイルを試す
            </Button>
          )}
          {importStep === 'confirm' && validationResult?.valid && (
            <Button
              onClick={confirmImport}
              disabled={importMutation.isPending}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? 'インポート中...' : `${importData?.slots?.length || 0}スロットをインポート`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
