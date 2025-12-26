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
import { Plus, Trash2, Edit, Save, X, Loader2, Grid3X3 } from "lucide-react";

interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formSchema = insertToolCategorySchema;
type FormData = z.infer<typeof formSchema>;

const scannerGridFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  label: z.string().min(1, "Label is required"),
  widthCm: z.number().min(1, "Width must be at least 1cm"),
  heightCm: z.number().min(1, "Height must be at least 1cm"),
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
    },
  });

  const editForm = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      label: "",
      widthCm: 0,
      heightCm: 0,
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
        title: "Category Created",
        description: "Tool category has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create",
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
        title: "Category Updated",
        description: "Tool category has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });
      setEditingId(null);
      editForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update",
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
        title: "Category Deleted",
        description: "Tool category has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete",
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
        title: "Scanner Grid Created",
        description: "Scanner grid and worker tag grid have been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });
      scannerGridForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create Scanner Grid",
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
          <DialogTitle>Tool Category Manager</DialogTitle>
          <DialogDescription>
            Create and manage tool category templates with dimensions
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-sm font-medium mb-4">Create New Category</h3>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category Name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-category-name"
                              placeholder="e.g., Pen, Scissors, Wrench"
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
                          <FormLabel>Label</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-label"
                              placeholder="e.g., ドライバー, はさみ, カッター"
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
                          <FormLabel>Width (cm)</FormLabel>
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
                          <FormLabel>Height (cm)</FormLabel>
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
                  <Button
                    type="submit"
                    data-testid="button-create-category"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    <Plus className="w-4 h-4 mr-2" />
                    Create Category
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <Grid3X3 className="w-5 h-5 text-yellow-500" />
                <h3 className="text-sm font-medium">Create Scanner Grid</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Creates a scanner grid for yellow sticker detection AND a linked worker tag grid for checkout tracking.
              </p>
              <Form {...scannerGridForm}>
                <form onSubmit={scannerGridForm.handleSubmit(handleCreateScannerGrid)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={scannerGridForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Grid Name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-grid-name"
                              placeholder="e.g., Scanner Rack A"
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
                          <FormLabel>Label (Japanese)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-grid-label"
                              placeholder="e.g., スキャナー棚A"
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
                          <FormLabel>Cell Width (cm)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-grid-width"
                              type="number"
                              step="0.1"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormDescription>Width of each cell</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="heightCm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Cell Height (cm)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-grid-height"
                              type="number"
                              step="0.1"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormDescription>Height of each cell</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="detectionColor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Detection Color</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-detection-color">
                                <SelectValue placeholder="Select color" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="#EAB308">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded bg-yellow-500" />
                                  Yellow (Fluorescent)
                                </div>
                              </SelectItem>
                              <SelectItem value="#22C55E">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded bg-green-500" />
                                  Green
                                </div>
                              </SelectItem>
                              <SelectItem value="#EF4444">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded bg-red-500" />
                                  Red
                                </div>
                              </SelectItem>
                              <SelectItem value="#F97316">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded bg-orange-500" />
                                  Orange
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>Color of stickers to detect</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="gridRows"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Grid Rows</FormLabel>
                          <Select onValueChange={(v) => field.onChange(parseInt(v))} defaultValue={String(field.value)}>
                            <FormControl>
                              <SelectTrigger data-testid="select-grid-rows">
                                <SelectValue placeholder="Select rows" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                                <SelectItem key={n} value={String(n)}>{n} row{n > 1 ? 's' : ''}</SelectItem>
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
                          <FormLabel>Grid Columns</FormLabel>
                          <Select onValueChange={(v) => field.onChange(parseInt(v))} defaultValue={String(field.value)}>
                            <FormControl>
                              <SelectTrigger data-testid="select-grid-cols">
                                <SelectValue placeholder="Select columns" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                                <SelectItem key={n} value={String(n)}>{n} column{n > 1 ? 's' : ''}</SelectItem>
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
                      <span className="text-sm text-muted-foreground">Grid Preview:</span>
                      <span className="text-sm font-medium">{scannerGridForm.watch('gridRows')} × {scannerGridForm.watch('gridCols')} = {scannerGridForm.watch('gridRows') * scannerGridForm.watch('gridCols')} cells</span>
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
                            Total: {totalW} × {totalH} cm (cells: {cellW} × {cellH} cm each)
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
                    Create Scanner Grid
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <div>
            <h3 className="text-sm font-medium mb-4">Existing Categories</h3>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-sm text-destructive">Failed to load categories: {error.message}</div>
            ) : (
              <div className="space-y-2">
                {categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No categories yet. Create one above.</p>
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
                                      <FormLabel>Category Name</FormLabel>
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
                                      <FormLabel>Label</FormLabel>
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
                                      <FormLabel>Width (cm)</FormLabel>
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
                                      <FormLabel>Height (cm)</FormLabel>
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
                              <div className="flex gap-2">
                                <Button
                                  type="submit"
                                  data-testid="button-save-edit"
                                  disabled={updateMutation.isPending}
                                >
                                  {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                  <Save className="w-4 h-4 mr-2" />
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  data-testid="button-cancel-edit"
                                  variant="outline"
                                  onClick={handleCancelEdit}
                                >
                                  <X className="w-4 h-4 mr-2" />
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          </Form>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-medium">{category.name}</h4>
                              <p className="text-sm text-muted-foreground">
                                Label: {category.label} | Dimensions: {category.widthCm} × {category.heightCm} cm
                              </p>
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
