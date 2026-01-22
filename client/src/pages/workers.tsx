import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Printer, Trash2, User } from "lucide-react";
import { insertWorkerSchema, type InsertWorker } from "@shared/schema";

interface Worker {
  id: string;
  workerCode: string;
  arucoId: number;
  name: string;
  team: string | null;
  department: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function Workers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [isAddWorkerOpen, setIsAddWorkerOpen] = useState(false);
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);

  const form = useForm<InsertWorker>({
    resolver: zodResolver(insertWorkerSchema),
    defaultValues: {
      name: "",
      team: "",
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
        title: "作業者追加完了",
        description: "作業者が正常に登録されました",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/workers'] });
      setIsAddWorkerOpen(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "作業者の追加に失敗しました",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteWorkerMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/workers/${id}`),
    onSuccess: (_data, deletedId) => {
      toast({
        title: "作業者削除完了",
        description: "作業者が削除され、ArUco IDが再利用可能になりました",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/workers'] });
      setSelectedWorkers(prev => prev.filter(id => id !== deletedId));
    },
    onError: (error) => {
      toast({
        title: "作業者の削除に失敗しました",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddWorker = (data: InsertWorker) => {
    createWorkerMutation.mutate(data);
  };

  const handleToggleWorker = (workerId: string) => {
    setSelectedWorkers(prev => {
      if (prev.includes(workerId)) {
        return prev.filter(id => id !== workerId);
      } else {
        return [...prev, workerId];
      }
    });
  };

  const handleSelectAll = () => {
    if (workers) {
      setSelectedWorkers(workers.map(w => w.id));
    }
  };

  const handleDeselectAll = () => {
    setSelectedWorkers([]);
  };

  const handlePrintTags = () => {
    if (selectedWorkers.length === 0) {
      toast({
        title: "作業者が選択されていません",
        description: "タグを印刷する作業者を選択してください",
        variant: "destructive",
      });
      return;
    }

    const workerIds = selectedWorkers.join(',');
    navigate(`/worker-tags?workers=${workerIds}`);
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">作業者管理</h1>
              <p className="text-muted-foreground mt-2">ArUcoマーカータグで作業者を登録（ID 50-95）</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handlePrintTags}
                disabled={selectedWorkers.length === 0}
                data-testid="button-print-tags"
              >
                <Printer className="mr-2 h-4 w-4" />
                タグを印刷 ({selectedWorkers.length})
              </Button>
              <Dialog open={isAddWorkerOpen} onOpenChange={setIsAddWorkerOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-worker">
                    <UserPlus className="mr-2 h-4 w-4" />
                    作業者を追加
                  </Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                  <DialogTitle>新規作業者追加</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleAddWorker)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>名前 *</FormLabel>
                          <FormControl>
                            <Input placeholder="田中 広" data-testid="input-worker-name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="team"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>チーム（任意）</FormLabel>
                          <FormControl>
                            <Input placeholder="組立ラインA" data-testid="input-worker-team" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                      ArUcoマーカーIDは自動割り当て（50-95）
                    </div>
                    <Button
                      type="submit"
                      disabled={createWorkerMutation.isPending}
                      className="w-full"
                      data-testid="button-save-worker"
                    >
                      {createWorkerMutation.isPending ? "追加中..." : "作業者を追加"}
                    </Button>
                  </form>
                </Form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>登録済み作業者 ({workers?.length || 0} / 最大45名)</CardTitle>
              {workers && workers.length > 0 && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectAll} data-testid="button-select-all">
                    すべて選択
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDeselectAll} data-testid="button-deselect-all">
                    選択解除
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p data-testid="text-loading">作業者を読み込み中...</p>
              ) : workers && workers.length > 0 ? (
                <div className="space-y-3">
                  {workers.map((worker) => (
                    <div
                      key={worker.id}
                      data-testid={`card-worker-${worker.id}`}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div 
                        className="flex items-center gap-4 flex-1 cursor-pointer"
                        onClick={() => {
                          if (selectedWorkers.includes(worker.id)) {
                            setSelectedWorkers(prev => prev.filter(id => id !== worker.id));
                          } else {
                            setSelectedWorkers(prev => [...prev, worker.id]);
                          }
                        }}
                      >
                        <Checkbox
                          checked={selectedWorkers.includes(worker.id)}
                          onCheckedChange={(checked) => {
                            if (checked === true) {
                              setSelectedWorkers(prev => [...prev, worker.id]);
                            } else {
                              setSelectedWorkers(prev => prev.filter(id => id !== worker.id));
                            }
                          }}
                          data-testid={`checkbox-worker-${worker.id}`}
                        />
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-semibold" data-testid={`text-worker-name-${worker.id}`}>
                            {worker.name}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-2">
                            {worker.team && (
                              <>
                                <span data-testid={`text-worker-team-${worker.id}`}>{worker.team}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
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
                  <p>登録された作業者がいません</p>
                  <p className="text-sm">最初の作業者を追加して開始</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
