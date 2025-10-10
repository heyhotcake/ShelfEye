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
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Edit, Save, X, Loader2 } from "lucide-react";

interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formSchema = insertToolCategorySchema;
type FormData = z.infer<typeof formSchema>;

export function CategoryManager({ open, onOpenChange }: CategoryManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      toolType: "",
      widthCm: 0,
      heightCm: 0,
    },
  });

  const editForm = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      toolType: "",
      widthCm: 0,
      heightCm: 0,
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

  const handleCreate = (data: FormData) => {
    createMutation.mutate(data);
  };

  const handleEdit = (category: ToolCategory) => {
    setEditingId(category.id);
    editForm.reset({
      name: category.name,
      toolType: category.toolType,
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
                      name="toolType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tool Type</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-tool-type"
                              placeholder="e.g., Writing, Cutting, Hand Tool"
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
                                  name="toolType"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Tool Type</FormLabel>
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
                                Type: {category.toolType} | Dimensions: {category.widthCm} × {category.heightCm} cm
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
