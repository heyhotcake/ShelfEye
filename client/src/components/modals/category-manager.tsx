import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { insertToolCategorySchema, type ToolCategory } from "@shared/schema";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Edit, Save, X, Loader2, Grid3X3, Palette } from "lucide-react";

const LABEL_COLOR_PRESETS = [
  { color: "#FFFFFF", name: "White" },
  { color: "#FEE2E2", name: "Rose" },
  { color: "#FFEDD5", name: "Peach" },
  { color: "#FEF3C7", name: "Amber" },
  { color: "#FEF9C3", name: "Yellow" },
  { color: "#ECFCCB", name: "Lime" },
  { color: "#D1FAE5", name: "Emerald" },
  { color: "#CCFBF1", name: "Teal" },
  { color: "#CFFAFE", name: "Cyan" },
  { color: "#DBEAFE", name: "Sky" },
  { color: "#E0E7FF", name: "Indigo" },
  { color: "#EDE9FE", name: "Violet" },
  { color: "#F3E8FF", name: "Purple" },
  { color: "#FCE7F3", name: "Pink" },
  { color: "#F5F5F4", name: "Stone" },
  { color: "#E5E7EB", name: "Gray" },
];

interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formSchema = insertToolCategorySchema;
type FormData = z.infer<typeof formSchema>;

const scannerGridFormSchema = z.object({
  name: z.string().min(1, "名前は必須です"),
  label: z.string().min(1, "ラベルは必須です"),
  widthCm: z.number().min(1, "幅は1cm以上必要です"),
  heightCm: z.number().min(1, "高さは1cm以上必要です"),
  detectionColor: z.string().default("#EAB308"),
  gridRows: z.number().min(1).max(8).default(2),
  gridCols: z.number().min(1).max(8).default(4),
});
type ScannerGridFormData = z.infer<typeof scannerGridFormSchema>;

export function CategoryManager({ open, onOpenChange }: CategoryManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      label: "",
      widthCm: 0,
      heightCm: 0,
      labelColor: "#FFFFFF",
    },
  });

  const editForm = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      label: "",
      widthCm: 0,
      heightCm: 0,
      labelColor: "#FFFFFF",
    },
  });

  const scannerGridForm = useForm<ScannerGridFormData>({
    resolver: zodResolver(scannerGridFormSchema),
    defaultValues: {
      name: "",
      label: "",
      widthCm: 32,
      heightCm: 16,
      detectionColor: "#EAB308",
      gridRows: 2,
      gridCols: 4,
    },
  });

  const { data: categories = [], isLoading, error } = useQuery<ToolCategory[]>({
    queryKey: ['/api/tool-categories'],
  });

  const createMutation = useMutation({
    mutationFn: (data: FormData) =>
      apiRequest('POST', '/api/tool-categories', data),
    onSuccess: () => {
      toast({
        title: "カテゴリ作成完了",
        description: "備品カテゴリが正常に作成されました",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "作成失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormData }) =>
      apiRequest('PUT', `/api/tool-categories/${id}`, data),
    onSuccess: () => {
      toast({
        title: "カテゴリ更新完了",
        description: "備品カテゴリが正常に更新されました",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });
      setEditingId(null);
      editForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "更新失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest('DELETE', `/api/tool-categories/${id}`),
    onSuccess: () => {
      toast({
        title: "カテゴリ削除完了",
        description: "備品カテゴリが正常に削除されました",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });
    },
    onError: (error: Error) => {
      toast({
        title: "削除失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createScannerGridMutation = useMutation({
    mutationFn: (data: ScannerGridFormData) =>
      apiRequest('POST', '/api/tool-categories/scanner-grid', data),
    onSuccess: () => {
      toast({
        title: "スキャナーグリッド作成完了",
        description: "スキャナーグリッドと作業者タググリッドが正常に作成されました",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });
      scannerGridForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "スキャナーグリッド作成失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreate = (data: FormData) => {
    createMutation.mutate(data);
  };

  const handleCreateScannerGrid = (data: ScannerGridFormData) => {
    createScannerGridMutation.mutate(data);
  };

  const handleEdit = (category: ToolCategory) => {
    setEditingId(category.id);
    editForm.reset({
      name: category.name,
      label: category.label,
      widthCm: category.widthCm,
      heightCm: category.heightCm,
      labelColor: category.labelColor || "#FFFFFF",
    });
  };

  const handleUpdate = (data: FormData) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    editForm.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>備品カテゴリ管理</DialogTitle>
          <DialogDescription>
            寸法付きの備品カテゴリテンプレートを作成・管理
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-sm font-medium mb-4">新規カテゴリ作成</h3>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>カテゴリ名</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-category-name"
                              placeholder="例: ペン, はさみ, レンチ"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="label"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ラベル</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-label"
                              placeholder="例: ドライバー, はさみ, カッター"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="widthCm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>幅 (cm)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-width"
                              type="number"
                              step="0.1"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="heightCm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>高さ (cm)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-height"
                              type="number"
                              step="0.1"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="labelColor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Palette className="w-4 h-4" />
                          ラベル背景色
                        </FormLabel>
                        <FormControl>
                          <div className="flex flex-wrap gap-2">
                            {LABEL_COLOR_PRESETS.map((preset) => (
                              <button
                                key={preset.color}
                                type="button"
                                data-testid={`color-${preset.name.toLowerCase()}`}
                                title={preset.name}
                                className={`w-8 h-8 rounded-md border-2 transition-all ${
                                  field.value === preset.color
                                    ? 'border-primary ring-2 ring-primary/30 scale-110'
                                    : 'border-gray-300 hover:border-gray-400'
                                }`}
                                style={{ backgroundColor: preset.color }}
                                onClick={() => field.onChange(preset.color)}
                              />
                            ))}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    data-testid="button-create-category"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    <Plus className="w-4 h-4 mr-2" />
                    カテゴリ作成
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <Grid3X3 className="w-5 h-5 text-yellow-500" />
                <h3 className="text-sm font-medium">スキャナーグリッド作成</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                黄色ステッカー検出用のスキャナーグリッドと、持出追跡用の作業者タググリッドを作成します。
              </p>
              <Form {...scannerGridForm}>
                <form onSubmit={scannerGridForm.handleSubmit(handleCreateScannerGrid)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={scannerGridForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>グリッド名</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-grid-name"
                              placeholder="例: スキャナーラックA"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="label"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ラベル (日本語)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-grid-label"
                              placeholder="例: スキャナー棚A"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="widthCm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>セル幅 (cm)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-grid-width"
                              type="number"
                              step="0.1"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormDescription>各セルの幅</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="heightCm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>セル高さ (cm)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-grid-height"
                              type="number"
                              step="0.1"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormDescription>各セルの高さ</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="detectionColor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>検出色</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-detection-color">
                                <SelectValue placeholder="色を選択" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="#EAB308">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded bg-yellow-500" />
                                  黄色 (蛍光)
                                </div>
                              </SelectItem>
                              <SelectItem value="#22C55E">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded bg-green-500" />
                                  緑
                                </div>
                              </SelectItem>
                              <SelectItem value="#EF4444">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded bg-red-500" />
                                  赤
                                </div>
                              </SelectItem>
                              <SelectItem value="#F97316">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded bg-orange-500" />
                                  オレンジ
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>検出するステッカーの色</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="gridRows"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>グリッド行数</FormLabel>
                          <Select onValueChange={(v) => field.onChange(parseInt(v))} defaultValue={String(field.value)}>
                            <FormControl>
                              <SelectTrigger data-testid="select-grid-rows">
                                <SelectValue placeholder="行数を選択" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                                <SelectItem key={n} value={String(n)}>{n} 行</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="gridCols"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>グリッド列数</FormLabel>
                          <Select onValueChange={(v) => field.onChange(parseInt(v))} defaultValue={String(field.value)}>
                            <FormControl>
                              <SelectTrigger data-testid="select-grid-cols">
                                <SelectValue placeholder="列数を選択" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                                <SelectItem key={n} value={String(n)}>{n} 列</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-muted-foreground">グリッドプレビュー:</span>
                      <span className="text-sm font-medium">{scannerGridForm.watch('gridRows')} × {scannerGridForm.watch('gridCols')} = {scannerGridForm.watch('gridRows') * scannerGridForm.watch('gridCols')} セル</span>
                    </div>
                    {(() => {
                      const cellW = scannerGridForm.watch('widthCm');
                      const cellH = scannerGridForm.watch('heightCm');
                      const cols = scannerGridForm.watch('gridCols');
                      const rows = scannerGridForm.watch('gridRows');
                      const totalW = cellW * cols;
                      const totalH = cellH * rows;
                      const scale = Math.min(300 / totalW, 150 / totalH, 8);
                      return (
                        <>
                          <div 
                            className="border-2 border-yellow-500 rounded mx-auto"
                            style={{
                              width: totalW * scale,
                              height: totalH * scale,
                              display: 'grid',
                              gridTemplateColumns: `repeat(${cols}, 1fr)`,
                              gridTemplateRows: `repeat(${rows}, 1fr)`,
                            }}
                          >
                            {Array.from({ length: rows * cols }).map((_, i) => (
                              <div 
                                key={i} 
                                className="border border-yellow-500/50 flex items-center justify-center text-xs text-yellow-600 font-medium"
                                style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)' }}
                              >
                                {i + 1}
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground text-center mt-2">
                            合計: {totalW} × {totalH} cm (セル: 各{cellW} × {cellH} cm)
                          </p>
                        </>
                      );
                    })()}
                  </div>
                  <Button
                    type="submit"
                    data-testid="button-create-scanner-grid"
                    disabled={createScannerGridMutation.isPending}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black"
                  >
                    {createScannerGridMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    <Grid3X3 className="w-4 h-4 mr-2" />
                    スキャナーグリッド作成
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <div>
            <h3 className="text-sm font-medium mb-4">既存カテゴリ</h3>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-sm text-destructive">カテゴリの読み込みに失敗しました: {error.message}</div>
            ) : (
              <div className="space-y-2">
                {categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">まだカテゴリがありません。上で作成してください。</p>
                ) : (
                  categories.map((category) => (
                    <Card key={category.id}>
                      <CardContent className="p-4">
                        {editingId === category.id ? (
                          <Form {...editForm}>
                            <form onSubmit={editForm.handleSubmit(handleUpdate)} className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={editForm.control}
                                  name="name"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>カテゴリ名</FormLabel>
                                      <FormControl>
                                        <Input {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={editForm.control}
                                  name="label"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>ラベル</FormLabel>
                                      <FormControl>
                                        <Input {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={editForm.control}
                                  name="widthCm"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>幅 (cm)</FormLabel>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.1"
                                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={editForm.control}
                                  name="heightCm"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>高さ (cm)</FormLabel>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.1"
                                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                              <FormField
                                control={editForm.control}
                                name="labelColor"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="flex items-center gap-2">
                                      <Palette className="w-4 h-4" />
                                      ラベル背景色
                                    </FormLabel>
                                    <FormControl>
                                      <div className="flex flex-wrap gap-2">
                                        {LABEL_COLOR_PRESETS.map((preset) => (
                                          <button
                                            key={preset.color}
                                            type="button"
                                            data-testid={`edit-color-${preset.name.toLowerCase()}`}
                                            title={preset.name}
                                            className={`w-6 h-6 rounded-md border-2 transition-all ${
                                              field.value === preset.color
                                                ? 'border-primary ring-2 ring-primary/30 scale-110'
                                                : 'border-gray-300 hover:border-gray-400'
                                            }`}
                                            style={{ backgroundColor: preset.color }}
                                            onClick={() => field.onChange(preset.color)}
                                          />
                                        ))}
                                      </div>
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="submit"
                                  data-testid="button-save-edit"
                                  disabled={updateMutation.isPending}
                                >
                                  {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                  <Save className="w-4 h-4 mr-2" />
                                  保存
                                </Button>
                                <Button
                                  type="button"
                                  data-testid="button-cancel-edit"
                                  variant="outline"
                                  onClick={handleCancelEdit}
                                >
                                  <X className="w-4 h-4 mr-2" />
                                  キャンセル
                                </Button>
                              </div>
                            </form>
                          </Form>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {category.labelColor && category.labelColor !== "#FFFFFF" && (
                                <div
                                  className="w-6 h-6 rounded-md border border-gray-300 shrink-0"
                                  style={{ backgroundColor: category.labelColor }}
                                  title="ラベル色"
                                />
                              )}
                              <div>
                                <h4 className="font-medium">{category.name}</h4>
                                <p className="text-sm text-muted-foreground">
                                  ラベル: {category.label} | 寸法: {category.widthCm} × {category.heightCm} cm
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                data-testid={`button-edit-${category.id}`}
                                variant="outline"
                                size="sm"
                                onClick={() => handleEdit(category)}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                data-testid={`button-delete-${category.id}`}
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteMutation.mutate(category.id)}
                                disabled={deleteMutation.isPending}
                              >
                                {deleteMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
