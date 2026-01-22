import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Download } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function MarkerGenerator() {
  const [markerId, setMarkerId] = useState(1);
  const [markerImage, setMarkerImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generateMarker = async () => {
    if (markerId < 1 || markerId > 50) {
      alert("マーカーIDは1〜50の範囲で指定してください");
      return;
    }

    setLoading(true);
    try {
      const result: any = await apiRequest("POST", "/api/aruco-generate", {
        mode: "single",
        markerId: markerId
      });

      if (result.ok && result.image) {
        setMarkerImage(result.image);
      }
    } catch (error) {
      console.error("Failed to generate marker:", error);
      alert("マーカーの生成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const downloadMarker = () => {
    if (!markerImage) return;

    const link = document.createElement("a");
    link.href = `data:image/png;base64,${markerImage}`;
    link.download = `aruco_marker_${markerId}.png`;
    link.click();
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>ArUcoマーカー生成 (DICT_4X4_100)</CardTitle>
          <CardDescription>
            スロット用のArUcoマーカーを個別に生成します（ID 1-50）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">マーカーID（1-50）</label>
              <Input
                type="number"
                min={1}
                max={50}
                value={markerId}
                onChange={(e) => setMarkerId(Number(e.target.value))}
                data-testid="input-marker-id"
              />
            </div>
            <Button 
              onClick={generateMarker} 
              disabled={loading}
              data-testid="button-generate"
            >
              {loading ? "生成中..." : "マーカー生成"}
            </Button>
          </div>

          {markerImage && (
            <div className="space-y-4">
              <div className="border rounded-lg p-8 bg-white flex justify-center">
                <img 
                  src={`data:image/png;base64,${markerImage}`} 
                  alt={`ArUco Marker ${markerId}`}
                  className="w-64 h-64"
                  data-testid="img-marker"
                />
              </div>
              
              <div className="flex justify-center">
                <Button 
                  onClick={downloadMarker}
                  variant="outline"
                  data-testid="button-download"
                >
                  <Download className="w-4 h-4 mr-2" />
                  マーカー {markerId} をダウンロード
                </Button>
              </div>

              <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg">
                <p className="font-medium mb-2">印刷手順：</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>実寸で印刷してください（拡大縮小なし）</li>
                  <li>マーカーは正確に3×3 cmにしてください</li>
                  <li>4×4 cmのスロット領域の中央に配置（全側面に0.5cmの余白）</li>
                  <li>高品質な白い紙と黒インクを使用してください</li>
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
