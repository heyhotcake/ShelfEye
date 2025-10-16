import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, QrCode, Download, Trash2, User } from "lucide-react";
import { insertWorkerSchema, type InsertWorker } from "@shared/schema";

interface Worker {
  id: string;
  workerCode: string;
  name: string;
  department: string | null;
  qrPayload: any;
  isActive: boolean;
  createdAt: string;
}

export default function Workers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddWorkerOpen, setIsAddWorkerOpen] = useState(false);
  const [selectedQR, setSelectedQR] = useState<{ worker: Worker; qrData: string } | null>(null);

  const form = useForm<InsertWorker>({
    resolver: zodResolver(insertWorkerSchema),
    defaultValues: {
      workerCode: "",
      name: "",
      department: "",
      isActive: true,
    },
  });

  const { data: workers, isLoading } = useQuery<Worker[]>({
    queryKey: ['/api/workers'],
  });

  const createWorkerMutation = useMutation({
    mutationFn: (workerData: InsertWorker) =>
      apiRequest('POST', '/api/workers', workerData),
    onSuccess: () => {
      toast({
        title: "Worker Added",
        description: "Worker registered successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/workers'] });
      setIsAddWorkerOpen(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Failed to Add Worker",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteWorkerMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/workers/${id}`),
    onSuccess: () => {
      toast({
        title: "Worker Deleted",
        description: "Worker removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/workers'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Worker",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateQRMutation = useMutation({
    mutationFn: async (workerId: string) => {
      const response = await apiRequest('POST', `/api/workers/${workerId}/generate-qr`);
      return response.json();
    },
    onSuccess: async (data: any, workerId: string) => {
      const worker = workers?.find(w => w.id === workerId);
      if (worker && data.qrCode) {
        setSelectedQR({ worker, qrData: data.qrCode });
        toast({
          title: "QR Code Generated",
          description: `Worker badge ready for ${worker.name} (ID: ${worker.workerCode})`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/workers'] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Generate QR",
        description: error.message || "An error occurred while generating the QR code",
        variant: "destructive",
      });
    },
  });

  const handleAddWorker = (data: InsertWorker) => {
    createWorkerMutation.mutate(data);
  };

  const downloadQRBadge = () => {
    if (!selectedQR) return;

    const { worker, qrData } = selectedQR;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: true }); // Enable RGBA
    if (!ctx) return;

    canvas.width = 400;
    canvas.height = 500;

    // Fill with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Worker name
    ctx.fillStyle = 'black';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(worker.name, 200, 40);

    // Worker code
    ctx.font = '16px Arial';
    ctx.fillText(worker.workerCode, 200, 70);

    // Department (optional)
    if (worker.department) {
      ctx.font = '14px Arial';
      ctx.fillStyle = '#666';
      ctx.fillText(worker.department, 200, 95);
    }

    const img = new Image();
    img.onload = () => {
      // Draw QR code
      ctx.drawImage(img, 50, 120, 300, 300);

      // Draw border
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

      // Export as RGBA PNG
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `worker-badge-${worker.workerCode}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          toast({
            title: "Badge Downloaded",
            description: `Badge for ${worker.name} saved as RGBA PNG`,
          });
        }
      }, 'image/png'); // Explicitly specify PNG format
    };

    img.onerror = () => {
      toast({
        title: "Download Failed",
        description: "Failed to load QR code image",
        variant: "destructive",
      });
    };

    img.src = `data:image/png;base64,${qrData}`;
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Worker Management</h1>
              <p className="text-muted-foreground mt-2">Manage workers and generate QR badge IDs</p>
            </div>
            <Dialog open={isAddWorkerOpen} onOpenChange={setIsAddWorkerOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-worker">
                  <UserPlus className="mr-2 h-4 w-4" />
                  Add Worker
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Worker</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleAddWorker)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="workerCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Worker Code *</FormLabel>
                          <FormControl>
                            <Input placeholder="W-001" data-testid="input-worker-code" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="Tanaka Hiroshi" data-testid="input-worker-name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="department"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Department</FormLabel>
                          <FormControl>
                            <Input placeholder="Assembly Line A" data-testid="input-worker-department" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      disabled={createWorkerMutation.isPending}
                      className="w-full"
                      data-testid="button-save-worker"
                    >
                      {createWorkerMutation.isPending ? "Adding..." : "Add Worker"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Registered Workers</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p data-testid="text-loading">Loading workers...</p>
              ) : workers && workers.length > 0 ? (
                <div className="space-y-3">
                  {workers.map((worker) => (
                    <div
                      key={worker.id}
                      data-testid={`card-worker-${worker.id}`}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-semibold" data-testid={`text-worker-name-${worker.id}`}>
                            {worker.name}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <span data-testid={`text-worker-code-${worker.id}`}>{worker.workerCode}</span>
                            {worker.department && (
                              <>
                                <span>•</span>
                                <span data-testid={`text-worker-department-${worker.id}`}>{worker.department}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {worker.qrPayload ? (
                          <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300">
                            QR Generated
                          </Badge>
                        ) : (
                          <Badge variant="outline">No QR</Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => generateQRMutation.mutate(worker.id)}
                          disabled={generateQRMutation.isPending}
                          data-testid={`button-generate-qr-${worker.id}`}
                        >
                          <QrCode className="h-4 w-4 mr-1" />
                          Generate QR
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteWorkerMutation.mutate(worker.id)}
                          disabled={deleteWorkerMutation.isPending}
                          data-testid={`button-delete-worker-${worker.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-no-workers">
                  <User className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No workers registered</p>
                  <p className="text-sm">Add your first worker to get started</p>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedQR && (
            <Dialog open={!!selectedQR} onOpenChange={() => setSelectedQR(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Worker QR Badge</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="text-center">
                    <h3 className="font-semibold text-lg">{selectedQR.worker.name}</h3>
                    <p className="text-sm text-muted-foreground">{selectedQR.worker.workerCode}</p>
                    {selectedQR.worker.department && (
                      <p className="text-sm text-muted-foreground">{selectedQR.worker.department}</p>
                    )}
                  </div>
                  <div className="flex justify-center bg-white p-4 rounded-lg">
                    <img
                      src={`data:image/png;base64,${selectedQR.qrData}`}
                      alt="Worker QR Code"
                      className="w-64 h-64"
                      data-testid="img-qr-code"
                    />
                  </div>
                  <Button
                    onClick={downloadQRBadge}
                    className="w-full"
                    data-testid="button-download-badge"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Badge
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </div>
  );
}
