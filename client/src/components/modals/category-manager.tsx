import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { insertToolCategorySchema, type ToolCategory, type ScannerGrid, type Camera } from "@shared/schema";
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
import { Plus, Trash2, Edit, Save, X, Loader2, Grid3X3, Scan, Tag } from "lucide-react";

interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCameraId?: string;
  selectedCameraName?: string;
}

const formSchema = insertToolCategorySchema;
type FormData = z.infer<typeof formSchema>;

const scannerGridFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  gridType: z.enum(["scanner", "worker_tag"]),
  rows: z.number().min(1).max(10).default(2),
  cols: z.number().min(1).max(10).default(4),
  cellWidthCm: z.number().min(1, "Cell width required"),
  cellHeightCm: z.number().min(1, "Cell height required"),
  startXCm: z.number().default(5),
  startYCm: z.number().default(5),
});
type ScannerGridFormData = z.infer<typeof scannerGridFormSchema>;

export function CategoryManager({ open, onOpenChange, selectedCameraId, selectedCameraName }: CategoryManagerProps) {
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
      gridType: "scanner",
      rows: 2,
      cols: 4,
      cellWidthCm: 5,
      cellHeightCm: 5,
      startXCm: 5,
      startYCm: 5,
    },
  });

  const { data: categories = [], isLoading, error } = useQuery<ToolCategory[]>({
    queryKey: ['/api/tool-categories'],
  });

  const { data: cameras = [] } = useQuery<Camera[]>({
    queryKey: ['/api/cameras'],
  });

  const { data: scannerGrids = [], isLoading: scannerGridsLoading } = useQuery<ScannerGrid[]>({
    queryKey: ['/api/scanner-grids'],
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
    mutationFn: (data: ScannerGridFormData & { cameraId: string }) =>
      apiRequest('POST', '/api/scanner-grids', data),
    onSuccess: () => {
      toast({
        title: "Scanner Grid Created",
        description: "Scanner/tag grid has been created successfully. Go to Template Editor to position it.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/scanner-grids'] });
      scannerGridForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create Grid",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteScannerGridMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest('DELETE', `/api/scanner-grids/${id}`),
    onSuccess: () => {
      toast({
        title: "Grid Deleted",
        description: "Scanner grid has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/scanner-grids'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Grid",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateScannerGrid = (data: ScannerGridFormData) => {
    if (!selectedCameraId) {
      toast({
        title: "No Camera Selected",
        description: "Please select a camera before creating a grid.",
        variant: "destructive",
      });
      return;
    }
    createScannerGridMutation.mutate({ ...data, cameraId: selectedCameraId });
  };

  const handleCreate = (data: FormData) => {
    createMutation.mutate(data);
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

          <Card className="border-yellow-500/50 dark:border-yellow-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <Grid3X3 className="w-5 h-5 text-yellow-600" />
                <h3 className="text-sm font-medium">Color Detection Grids (Scanner & Worker Tag)</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Create 2x4 grids for tracking handheld scanners (yellow sticker detection) and worker tags (ArUco badge detection).
              </p>
              <Form {...scannerGridForm}>
                <form onSubmit={scannerGridForm.handleSubmit(handleCreateScannerGrid)} className="space-y-4">
                  {selectedCameraName && (
                    <div className="p-2 bg-muted rounded text-sm">
                      <span className="text-muted-foreground">Camera: </span>
                      <span className="font-medium">{selectedCameraName}</span>
                    </div>
                  )}
                  {!selectedCameraId && (
                    <div className="p-2 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
                      No camera selected. Please select a camera first.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={scannerGridForm.control}
                      name="gridType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Grid Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-grid-type">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="scanner">
                                <div className="flex items-center gap-2">
                                  <Scan className="w-4 h-4 text-yellow-500" />
                                  Scanner (Yellow Detection)
                                </div>
                              </SelectItem>
                              <SelectItem value="worker_tag">
                                <div className="flex items-center gap-2">
                                  <Tag className="w-4 h-4 text-blue-500" />
                                  Worker Tag (ArUco ID 51-95)
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
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
                              placeholder="e.g., Scanner Rack 1"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <FormField
                        control={scannerGridForm.control}
                        name="rows"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rows</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                data-testid="input-scanner-rows"
                                type="number"
                                min={1}
                                max={10}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 2)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={scannerGridForm.control}
                        name="cols"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Cols</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                data-testid="input-scanner-cols"
                                type="number"
                                min={1}
                                max={10}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 4)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={scannerGridForm.control}
                      name="cellWidthCm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Cell Width (cm)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-cell-width"
                              type="number"
                              step="0.5"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 5)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={scannerGridForm.control}
                      name="cellHeightCm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Cell Height (cm)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-scanner-cell-height"
                              type="number"
                              step="0.5"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 5)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <Button
                    type="submit"
                    data-testid="button-create-scanner-grid"
                    disabled={createScannerGridMutation.isPending}
                    className="bg-yellow-600 hover:bg-yellow-700"
                  >
                    {createScannerGridMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    <Plus className="w-4 h-4 mr-2" />
                    Create Grid
                  </Button>
                </form>
              </Form>

              {scannerGridsLoading ? (
                <div className="flex items-center justify-center py-4 mt-4">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : scannerGrids.length > 0 && (
                <div className="mt-6 space-y-2">
                  <h4 className="text-sm font-medium">Existing Grids</h4>
                  {scannerGrids.map((grid) => {
                    const camera = cameras.find(c => c.id === grid.cameraId);
                    return (
                      <Card key={grid.id} className="border-dashed">
                        <CardContent className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {grid.gridType === 'scanner' ? (
                              <Scan className="w-5 h-5 text-yellow-500" />
                            ) : (
                              <Tag className="w-5 h-5 text-blue-500" />
                            )}
                            <div>
                              <p className="font-medium text-sm">{grid.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {grid.gridType === 'scanner' ? 'Scanner' : 'Worker Tag'} |{' '}
                                {grid.rows}x{grid.cols} |{' '}
                                Camera: {camera?.name || 'Unknown'}
                              </p>
                            </div>
                          </div>
                          <Button
                            data-testid={`button-delete-scanner-grid-${grid.id}`}
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteScannerGridMutation.mutate(grid.id)}
                            disabled={deleteScannerGridMutation.isPending}
                          >
                            {deleteScannerGridMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
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
