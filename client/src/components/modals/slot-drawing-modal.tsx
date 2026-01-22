import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SlotCanvas } from "@/components/canvas/slot-canvas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Undo, Trash, ZoomIn, X, Save } from "lucide-react";

interface SlotDrawingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Point {
  x: number;
  y: number;
}

interface SlotRegion {
  id: string;
  slotId: string;
  slotNumber?: number;
  points: Point[];
  toolName: string;
  expectedQrId: string;
  priority: 'high' | 'medium' | 'low';
  allowCheckout: boolean;
  graceWindow: string;
}

export function SlotDrawingModal({ open, onOpenChange }: SlotDrawingModalProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<SlotRegion | null>(null);
  const [regions, setRegions] = useState<SlotRegion[]>([]);

  const startNewSlot = () => {
    setIsDrawing(true);
    setSelectedRegion(null);
  };

  const updateSelectedRegion = (updates: Partial<SlotRegion>) => {
    if (!selectedRegion) return;
    
    const updated = { ...selectedRegion, ...updates };
    setSelectedRegion(updated);
    setRegions(regions.map(r => r.id === selectedRegion.id ? updated : r));
  };

  const deleteSelectedRegion = () => {
    if (selectedRegion) {
      setRegions(regions.filter(r => r.id !== selectedRegion.id));
      setSelectedRegion(null);
    }
  };

  const configuredSlotIds = Array.from({ length: 12 }, (_, i) => 
    String.fromCharCode(65 + Math.floor(i / 6)) + ((i % 6) + 1)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold text-foreground">
                スロット領域描画
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">クリックして矯正画像上にスロット境界を定義</p>
            </div>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-close-slot-drawing"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
          {/* Drawing Canvas */}
          <div className="lg:col-span-2">
            <div className="canvas-container mb-4">
              <SlotCanvas
                width={800}
                height={600}
                isDrawing={isDrawing}
                onDrawingComplete={(region) => {
                  setRegions([...regions, region]);
                  setSelectedRegion(region);
                  setIsDrawing(false);
                }}
                onRegionSelect={setSelectedRegion}
                regions={regions}
                selectedRegion={selectedRegion}
              />
            </div>
            
            <div className="flex items-center gap-3">
              <Button 
                className="flex-1"
                onClick={startNewSlot}
                disabled={isDrawing}
                data-testid="button-new-slot"
              >
                <Plus className="w-4 h-4 mr-2" />
                新規スロット
              </Button>
              
              <Button 
                variant="outline"
                onClick={() => setIsDrawing(false)}
                disabled={!isDrawing}
                data-testid="button-undo"
              >
                <Undo className="w-4 h-4" />
              </Button>
              
              <Button 
                variant="outline"
                onClick={deleteSelectedRegion}
                disabled={!selectedRegion}
                data-testid="button-delete"
              >
                <Trash className="w-4 h-4" />
              </Button>
              
              <Button 
                variant="outline"
                data-testid="button-zoom"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
            </div>

            {/* Drawing Instructions */}
            {isDrawing && (
              <Card className="mt-4">
                <CardContent className="p-4">
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-blue-500 mb-2">描画モード有効</h4>
                    <p className="text-sm text-muted-foreground">
                      クリックしてスロット境界を定義するポイントを追加します。完了するには少なくとも3ポイントが必要です。
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          
          {/* Slot Configuration */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedRegion ? `スロット ${selectedRegion.slotId}` : 'スロットを選択'}
                </CardTitle>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {selectedRegion ? (
                  <>
                    <div>
                      <Label htmlFor="slotId">スロットID</Label>
                      <Input 
                        id="slotId"
                        value={selectedRegion.slotId}
                        onChange={(e) => updateSelectedRegion({ slotId: e.target.value })}
                        data-testid="input-slot-id"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="toolName">備品名</Label>
                      <Input 
                        id="toolName"
                        placeholder="例: はさみ"
                        value={selectedRegion.toolName}
                        onChange={(e) => updateSelectedRegion({ toolName: e.target.value })}
                        data-testid="input-tool-name"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="expectedQrId">
                        予想QR ID 
                        {selectedRegion.slotNumber && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (QRコード: "{selectedRegion.slotNumber}")
                          </span>
                        )}
                      </Label>
                      <Input 
                        id="expectedQrId"
                        placeholder="例: S001 (オプション - スロット番号を使用)"
                        value={selectedRegion.expectedQrId}
                        onChange={(e) => updateSelectedRegion({ expectedQrId: e.target.value })}
                        data-testid="input-expected-qr"
                      />
                      {selectedRegion.slotNumber && (
                        <p className="text-xs text-muted-foreground mt-1">
                          このスロット用に "{selectedRegion.slotNumber}" のQRコードを印刷してください
                        </p>
                      )}
                    </div>
                    
                    <div>
                      <Label htmlFor="priority">優先度</Label>
                      <Select 
                        value={selectedRegion.priority} 
                        onValueChange={(value) => updateSelectedRegion({ priority: value as any })}
                      >
                        <SelectTrigger data-testid="select-priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">高</SelectItem>
                          <SelectItem value="medium">中</SelectItem>
                          <SelectItem value="low">低</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="pt-4 border-t border-border">
                      <h4 className="text-sm font-semibold text-foreground mb-3">ビジネスルール</h4>
                      
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Checkbox 
                            id="allowCheckout"
                            checked={selectedRegion.allowCheckout}
                            onCheckedChange={(checked) => updateSelectedRegion({ allowCheckout: !!checked })}
                            data-testid="checkbox-allow-checkout"
                          />
                          <Label htmlFor="allowCheckout" className="text-sm text-foreground">
                            持出許可
                          </Label>
                        </div>
                        
                        <div>
                          <Label htmlFor="graceWindow">猶予時間</Label>
                          <Input 
                            id="graceWindow"
                            value={selectedRegion.graceWindow}
                            onChange={(e) => updateSelectedRegion({ graceWindow: e.target.value })}
                            data-testid="input-grace-window"
                          />
                        </div>
                      </div>
                    </div>
                    
                    <Button 
                      className="w-full mt-6"
                      disabled={!selectedRegion.toolName}
                      data-testid="button-save-slot"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      スロット設定を保存
                    </Button>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      設定するスロット領域をクリックするか、新しいスロット領域を作成してください。
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
        
        {/* Configured Slots List */}
        <div className="px-6 pb-6">
          <Card>
            <CardHeader>
              <CardTitle>設定済みスロット ({configuredSlotIds.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                {configuredSlotIds.map((slotId: string) => (
                  <Badge 
                    key={slotId}
                    className="px-3 py-2 bg-green-500/20 border border-green-500/30 text-green-500 text-center justify-center"
                    data-testid={`configured-slot-${slotId}`}
                  >
                    {slotId}
                  </Badge>
                ))}
                
                {configuredSlotIds.length === 0 && (
                  <p className="col-span-full text-muted-foreground text-sm text-center py-4">
                    まだスロットが設定されていません。上のカメラ画像にスロット領域を描画してください。
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
