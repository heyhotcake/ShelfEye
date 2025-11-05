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
      alert("Marker ID must be between 1 and 50");
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
      alert("Failed to generate marker");
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
          <CardTitle>ArUco Marker Generator (DICT_4X4_100)</CardTitle>
          <CardDescription>
            Generate individual ArUco markers for your slots (IDs 1-50)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Marker ID (1-50)</label>
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
              {loading ? "Generating..." : "Generate Marker"}
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
                  Download Marker {markerId}
                </Button>
              </div>

              <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg">
                <p className="font-medium mb-2">Printing Instructions:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Print at actual size (no scaling)</li>
                  <li>Marker should be exactly 3×3 cm</li>
                  <li>Center within your 4×4 cm slot area (0.5cm margin on all sides)</li>
                  <li>Use high-quality white paper and black ink</li>
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
