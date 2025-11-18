import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera } from "lucide-react";

interface CameraSelectorProps {
  cameras: any[];
  selectedCameraId: string | undefined;
  onCameraChange: (cameraId: string) => void;
  className?: string;
}

export function CameraSelector({ cameras, selectedCameraId, onCameraChange, className }: CameraSelectorProps) {
  if (!cameras || cameras.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-muted-foreground" />
        <Select value={selectedCameraId} onValueChange={onCameraChange}>
          <SelectTrigger className="w-[200px]" data-testid="select-camera">
            <SelectValue placeholder="Select camera" />
          </SelectTrigger>
          <SelectContent>
            {cameras.map((camera) => (
              <SelectItem key={camera.id} value={camera.id} data-testid={`camera-option-${camera.id}`}>
                {camera.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
