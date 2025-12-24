import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/api";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { clampToBounds, checkBoundaryViolations, PAPER_BOUNDS } from "@/lib/templateBounds";
import { Plus, Undo, Trash, ZoomIn, ZoomOut, Move, X, Save, Download, Upload, Clock, Layers, RotateCcw, RotateCw, Printer, Eye, CheckCircle, FileJson } from "lucide-react";
import { CategoryManager } from "@/components/modals/category-manager";
import { SlotImportExportModal } from "@/components/modals/slot-import-export-modal";

interface Point {
  x: number;
  y: number;
}

interface SlotRegion {
  id: string;
  slotId: string;
  points: Point[];
  toolName: string;
  expectedQrId: string;
  priority: 'high' | 'medium' | 'low';
  allowCheckout: boolean;
  graceWindow: string;
}

interface TemplateRectangle {
  id: string;
  categoryId: string;
  xCm: number;
  yCm: number;
  rotation: number;
  widthCm: number;
  heightCm: number;
  categoryName: string;
  label: string; // Display label for printing (supports Japanese)
  autoQrId?: string;
}

export default function SlotDrawing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(undefined);
  // Legacy slot drawing state (kept for backwards compatibility, but UI removed)
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<SlotRegion | null>(null);
  const [regions, setRegions] = useState<SlotRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<SlotRegion | null>(null);
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [snapEnabled, setSnapEnabled] = useState(true); // Toggle snapping on/off
  const [gridSize, setGridSize] = useState(0.5); // Adjustable grid size (0.5cm default)
  
  // Slot version management
  const [showVersions, setShowVersions] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [savedVersions, setSavedVersions] = useState<Array<{
    name: string;
    timestamp: string;
    regions: SlotRegion[];
  }>>([]);
  
  // Template version management
  const [templateVersionName, setTemplateVersionName] = useState('');
  const [savedTemplateVersions, setSavedTemplateVersions] = useState<Array<{
    id?: string; // Database ID (optional for backward compatibility during migration)
    name: string;
    timestamp: string;
    templateRectangles: TemplateRectangle[];
    categories: any[];
    paperSize: string;
  }>>([]);
  
  // Category manager
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  
  // Slot import/export modal
  const [showSlotImportExport, setShowSlotImportExport] = useState(false);
  
  // Paper size configuration
  const [paperSize, setPaperSize] = useState('A4-landscape');
  
  // Paper size dimensions (width x height in pixels, landscape orientation)
  // Calculated to maintain EXACT aspect ratios after 40px margins on each side
  // Formula: paperWidth = width - 80, paperHeight = paperWidth * (realHeightMm/realWidthMm), height = paperHeight + 80
  const paperDimensions: Record<string, { 
    width: number; 
    height: number;
    realWidthMm: number;
    realHeightMm: number;
  }> = {
    'A5-landscape': { width: 600, height: 447, realWidthMm: 210, realHeightMm: 148 },      // 520 * (148/210) + 80 = 447
    'A4-landscape': { width: 800, height: 589, realWidthMm: 297, realHeightMm: 210 },      // 720 * (210/297) + 80 = 589
    'A3-landscape': { width: 1131, height: 823, realWidthMm: 420, realHeightMm: 297 },     // 1051 * (297/420) + 80 = 823
    '2xA5-landscape': { width: 1200, height: 475, realWidthMm: 420, realHeightMm: 148 },   // 1120 * (148/420) + 80 = 475
    '3xA5-landscape': { width: 1800, height: 484, realWidthMm: 630, realHeightMm: 148 },   // 1720 * (148/630) + 80 = 484
    '6-page-3x2': { width: 2400, height: 1173, realWidthMm: 891, realHeightMm: 420 },      // 2320 * (420/891) + 80 = 1173
    '8-page-4x2': { width: 3200, height: 1183, realWidthMm: 1188, realHeightMm: 420 },     // 3120 * (420/1188) + 80 = 1183
  };
  
  const canvasDimensions = paperDimensions[paperSize] || paperDimensions['A4-landscape'];
  
  // Calculate auto-fit zoom based on container size
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Get container dimensions
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    if (containerWidth === 0 || containerHeight === 0) return;

    // Calculate zoom to fit entire canvas in container with 5% padding
    const paddingFactor = 0.90; // Use 90% of container space
    const scaleX = (containerWidth * paddingFactor) / canvasDimensions.width;
    const scaleY = (containerHeight * paddingFactor) / canvasDimensions.height;
    const autoZoom = Math.min(scaleX, scaleY);
    
    // Center the canvas
    const scaledWidth = canvasDimensions.width * autoZoom;
    const scaledHeight = canvasDimensions.height * autoZoom;
    const centerX = (containerWidth - scaledWidth) / 2;
    const centerY = (containerHeight - scaledHeight) / 2;
    
    setZoom(autoZoom);
    setPanOffset({ x: centerX, y: centerY });
  }, [paperSize, canvasDimensions.width, canvasDimensions.height]);
  
  // Recalculate on window resize
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      
      if (containerWidth === 0 || containerHeight === 0) return;

      const paddingFactor = 0.90;
      const scaleX = (containerWidth * paddingFactor) / canvasDimensions.width;
      const scaleY = (containerHeight * paddingFactor) / canvasDimensions.height;
      const autoZoom = Math.min(scaleX, scaleY);
      
      const scaledWidth = canvasDimensions.width * autoZoom;
      const scaledHeight = canvasDimensions.height * autoZoom;
      const centerX = (containerWidth - scaledWidth) / 2;
      const centerY = (containerHeight - scaledHeight) / 2;
      
      setZoom(autoZoom);
      setPanOffset({ x: centerX, y: centerY });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [canvasDimensions.width, canvasDimensions.height]);
  
  // Dialog states for confirmations and warnings
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [unsavedWarningOpen, setUnsavedWarningOpen] = useState(false);
  const [templateToLoad, setTemplateToLoad] = useState<typeof savedTemplateVersions[0] | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Camera selection (removed - templates are now camera-independent)
  
  // Template rectangle state
  const [templateRectangles, setTemplateRectangles] = useState<TemplateRectangle[]>([]);
  const [draggingRectId, setDraggingRectId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedTemplateRect, setSelectedTemplateRect] = useState<TemplateRectangle | null>(null);

  const { data: cameras } = useQuery<any[]>({
    queryKey: ['/api/cameras'],
  });

  // Initialize selected camera to first camera or saved preference
  useEffect(() => {
    if (cameras && cameras.length > 0 && !selectedCameraId) {
      const savedCameraId = localStorage.getItem('selectedCameraId');
      const initialCameraId = savedCameraId && cameras.find(c => c.id === savedCameraId)
        ? savedCameraId
        : cameras[0].id;
      setSelectedCameraId(initialCameraId);
    }
  }, [cameras, selectedCameraId]);

  // Handle camera change
  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    localStorage.setItem('selectedCameraId', cameraId);
  };

  const selectedCamera = cameras?.find((c: any) => c.id === selectedCameraId);

  const { data: slots} = useQuery<any[]>({
    queryKey: ['/api/slots'],
  });

  const { data: toolCategories = [] } = useQuery<any[]>({
    queryKey: ['/api/tool-categories'],
  });

  const { data: templateRects = [] } = useQuery<any[]>({
    queryKey: ['/api/template-rectangles', paperSize],
    queryFn: async () => {
      const response = await fetch(`/api/template-rectangles?paperSize=${paperSize}`);
      if (!response.ok) throw new Error('Failed to fetch template rectangles');
      return response.json();
    },
  });

  // Fetch saved template designs from database
  const { data: templateDesignsFromDb = [], isLoading: isLoadingDesigns } = useQuery<any[]>({
    queryKey: ['/api/template-designs'],
    queryFn: async () => {
      const response = await fetch('/api/template-designs');
      if (!response.ok) throw new Error('Failed to fetch template designs');
      return response.json();
    },
  });

  // Map database designs to legacy savedTemplateVersions structure
  useEffect(() => {
    const mapped = templateDesignsFromDb.map((design: any) => ({
      id: design.id, // Store database ID for future operations
      name: design.name,
      timestamp: design.createdAt || new Date().toISOString(),
      paperSize: design.paperSize,
      templateRectangles: design.templateRectangles || [],
      categories: design.categories || [],
    }));
    setSavedTemplateVersions(mapped);
    console.log(`[SlotDrawing] Loaded ${mapped.length} template designs from database`);
  }, [templateDesignsFromDb]);

  // One-time localStorage migration to database
  const hasMigratedRef = useRef(false);
  useEffect(() => {
    // Only run once, and only if database is empty but localStorage has data
    if (hasMigratedRef.current || isLoadingDesigns || templateDesignsFromDb.length > 0) return;
    
    const legacyData = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!legacyData) {
      hasMigratedRef.current = true;
      return;
    }
    
    try {
      const legacyDesigns = JSON.parse(legacyData);
      if (!Array.isArray(legacyDesigns) || legacyDesigns.length === 0) {
        hasMigratedRef.current = true;
        return;
      }
      
      // Set flag IMMEDIATELY to prevent double-firing
      hasMigratedRef.current = true;
      
      console.log(`[Migration] Found ${legacyDesigns.length} legacy template designs in localStorage, migrating to database...`);
      
      // Migrate each design
      const migrationPromises = legacyDesigns.map(async (design: any) => {
        try {
          const rectangles = (design.templateRectangles || []).map((r: any) => ({
            categoryId: r.categoryId,
            paperSize: design.paperSize, // Required field
            xCm: r.xCm,
            yCm: r.yCm,
            rotation: r.rotation,
            autoQrId: r.autoQrId,
          }));
          
          await apiRequest('POST', '/api/template-designs', {
            name: design.name,
            paperSize: design.paperSize,
            rectangles: rectangles,
          });
          
          console.log(`[Migration] Migrated design: ${design.name}`);
        } catch (error) {
          console.error(`[Migration] Failed to migrate design: ${design.name}`, error);
        }
      });
      
      Promise.all(migrationPromises).then(() => {
        console.log('[Migration] All designs migrated successfully');
        localStorage.removeItem(TEMPLATE_STORAGE_KEY);
        queryClient.invalidateQueries({ queryKey: ['/api/template-designs'] });
        toast({
          title: "Migration Complete",
          description: `Migrated ${legacyDesigns.length} template designs from localStorage to database`,
        });
      }).catch((error) => {
        console.error('[Migration] Migration failed:', error);
        toast({
          title: "Migration Warning",
          description: "Some template designs could not be migrated. Check console for details.",
          variant: "destructive",
        });
      });
    } catch (error) {
      console.error('[Migration] Failed to parse legacy data:', error);
      // Flag is already set above
    }
  }, [templateDesignsFromDb, isLoadingDesigns]);

  // Load saved slot versions from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('slotConfigVersions');
    if (saved) {
      try {
        setSavedVersions(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved slot versions:', e);
      }
    }
  }, []);

  // Templates are loaded from database via React Query (see useQuery above)
  const TEMPLATE_STORAGE_KEY = 'templateConfigVersions'; // Legacy key for migration only

  // Load existing slots as regions when slots data changes
  useEffect(() => {
    if (slots && slots.length > 0 && regions.length === 0) {
      const loadedRegions: SlotRegion[] = slots.map((slot: any) => ({
        id: slot.id,
        slotId: slot.slotId,
        points: slot.regionCoords.map((coord: number[]) => ({ x: coord[0], y: coord[1] })),
        toolName: slot.toolName,
        expectedQrId: slot.expectedQrId || '',
        priority: slot.priority || 'high',
        allowCheckout: slot.allowCheckout !== false,
        graceWindow: slot.graceWindow || '08:30-16:30',
      }));
      setRegions(loadedRegions);
    }
  }, [slots]);

  // Camera selection removed - templates are now camera-independent

  // Track the last loaded snapshot for unsaved changes comparison
  const [lastLoadedSnapshot, setLastLoadedSnapshot] = useState<string>('[]');
  
  // Don't auto-load template rectangles when query data changes
  // Templates are only loaded via Eye button or explicit load actions
  // This keeps the canvas blank when paper size changes
  
  // Track unsaved changes by comparing current templateRectangles with last loaded snapshot
  useEffect(() => {
    const currentSnapshot = JSON.stringify(templateRectangles.map(r => ({
      id: r.id,
      categoryId: r.categoryId,
      xCm: r.xCm,
      yCm: r.yCm,
      rotation: r.rotation,
      autoQrId: r.autoQrId,
    })).sort((a, b) => a.id.localeCompare(b.id)));
    
    setHasUnsavedChanges(currentSnapshot !== lastLoadedSnapshot);
  }, [templateRectangles, lastLoadedSnapshot]);
  
  // Clear canvas when paper size changes
  useEffect(() => {
    setTemplateRectangles([]);
    setSelectedTemplateRect(null);
  }, [paperSize]);

  // Prevent page scroll when zooming on canvas (must use native event listener with { passive: false })
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.min(Math.max(prev * delta, 0.5), 5));
    };

    // Attach with { passive: false } to allow preventDefault
    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  const createSlotMutation = useMutation({
    mutationFn: (slotData: any) => apiRequest('POST', '/api/slots', slotData),
    onSuccess: () => {
      toast({
        title: "Slot Created",
        description: "Slot configuration saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/slots'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Save Slot",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSlotMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => 
      apiRequest('PUT', `/api/slots/${id}`, data),
    onSuccess: () => {
      toast({
        title: "Slot Updated", 
        description: "Slot configuration updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/slots'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Slot",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteSlotMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/slots/${id}`),
    onSuccess: () => {
      toast({
        title: "Slot Deleted",
        description: "Slot removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/slots'] });
      setSelectedRegion(null);
      setRegions(prev => prev.filter(r => r.id !== selectedRegion?.id));
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Slot",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createTemplateRectMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/template-rectangles', data),
    onSuccess: async (response) => {
      const createdRect = await response.json();
      const category = toolCategories.find((c: any) => c.id === createdRect.categoryId);
      
      if (category) {
        const newTemplateRect: TemplateRectangle = {
          id: createdRect.id,
          categoryId: createdRect.categoryId,
          xCm: createdRect.xCm,
          yCm: createdRect.yCm,
          rotation: createdRect.rotation,
          widthCm: category.widthCm,
          heightCm: category.heightCm,
          categoryName: category.name,
          label: category.label,
          autoQrId: createdRect.autoQrId,
        };
        
        setTemplateRectangles(prev => [...prev, newTemplateRect]);
        setSelectedTemplateRect(newTemplateRect);
      }
      
      queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles', paperSize] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Create Template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateTemplateRectMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => 
      apiRequest('PUT', `/api/template-rectangles/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles', paperSize] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const validateAndFixMutation = useMutation({
    mutationFn: (paperSize: string) => 
      apiRequest('POST', '/api/template-rectangles/validate', { paperSize }),
    onSuccess: (data: any) => {
      if (data.fixed > 0) {
        toast({
          title: "Rectangles Auto-Corrected",
          description: `Fixed ${data.fixed} rectangle(s) that were outside safe zones. Details: ${data.details.fixed.map((f: any) => f.autoQrId).join(', ')}`,
          variant: "default",
        });
        queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles', paperSize] });
      } else {
        toast({
          title: "All Clear",
          description: "All rectangles are within safe zones.",
          variant: "default",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Validation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteTemplateRectMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/template-rectangles/${id}`),
    onSuccess: (_response, id) => {
      toast({
        title: "Template Deleted",
        description: "Template rectangle removed successfully",
      });
      setTemplateRectangles(prev => prev.filter(r => r.id !== id));
      setSelectedTemplateRect(null);
      queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles', paperSize] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Template",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Template design mutations (save/delete whole designs)
  const saveTemplateDesignMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/template-designs', data),
    onSuccess: (response: any) => {
      // Check for partial save warning
      if (response.partialSave) {
        toast({
          title: "⚠️ Partial Save",
          description: `Only ${response.rectangleCount}/${response.requested} tools saved. Some tools may have invalid categories.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Design Saved",
          description: `Template saved with ${response.rectangleCount} tools`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/template-designs'] });
      setTemplateVersionName(''); // Clear input after save
    },
    onError: (error: any) => {
      // Parse error response for detailed info
      const errorData = error?.data || {};
      const message = errorData.message || error.message || "Unknown error";
      const details = errorData.saved !== undefined 
        ? ` (${errorData.saved}/${errorData.requested} tools saved)`
        : '';
      
      toast({
        title: "Failed to Save Design",
        description: `${message}${details}`,
        variant: "destructive",
      });
    },
  });

  const deleteTemplateDesignMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/template-designs/${id}`),
    onSuccess: () => {
      toast({
        title: "Design Deleted",
        description: "Template design removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/template-designs'] });
    },
    onError: (error) => {
      toast({
        title: "Failed to Delete Design",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Helper functions for cm to pixels conversion
  // CRITICAL: Use UNIFORM scale for both axes to maintain aspect ratio
  const cmToPixels = (cm: number, isWidth = true): number => {
    const canvasMargin = 40;
    const paperWidth = canvasDimensions.width - (canvasMargin * 2);
    // Always use width-based scale to ensure uniform conversion
    const pxPerMm = paperWidth / canvasDimensions.realWidthMm;
    return cm * 10 * pxPerMm; // cm to mm, then to pixels
  };

  const pixelsToCm = (pixels: number, isWidth = true): number => {
    const canvasMargin = 40;
    const paperWidth = canvasDimensions.width - (canvasMargin * 2);
    // Always use width-based scale to ensure uniform conversion
    const pxPerMm = paperWidth / canvasDimensions.realWidthMm;
    return pixels / pxPerMm / 10; // pixels to mm, then to cm
  };

  const snapToGrid = (cm: number, enableSnap: boolean = snapEnabled): number => {
    if (!enableSnap) return cm; // Skip snapping if disabled
    return Math.round(cm / gridSize) * gridSize;
  };

  // Helper function to get sheet boundaries for 6-page format
  const getSheetBounds = (xCm: number, yCm: number): { minX: number; maxX: number; minY: number; maxY: number } | null => {
    if (paperSize !== '6-page-3x2' && paperSize !== '8-page-4x2') return null;
    
    const gutterMm = 0;  // No gutters - sheets touch edge-to-edge
    const a4WidthMm = 297;  // A4 landscape
    const a4HeightMm = 210;
    
    // Convert cm to mm
    const xMm = xCm * 10;
    const yMm = yCm * 10;
    
    // Determine which sheet (column and row)
    const totalWidthPerSheet = a4WidthMm + gutterMm;
    const totalHeightPerSheet = a4HeightMm + gutterMm;
    
    const col = Math.floor(xMm / totalWidthPerSheet);
    const row = Math.floor(yMm / totalHeightPerSheet);
    
    // Clamp to valid sheet range
    const clampedCol = Math.max(0, Math.min(2, col));
    const clampedRow = Math.max(0, Math.min(1, row));
    
    // Calculate sheet boundaries in cm
    const minXCm = (clampedCol * totalWidthPerSheet) / 10;
    const maxXCm = (clampedCol * a4WidthMm + clampedCol * gutterMm + a4WidthMm) / 10;
    const minYCm = (clampedRow * totalHeightPerSheet) / 10;
    const maxYCm = (clampedRow * a4HeightMm + clampedRow * gutterMm + a4HeightMm) / 10;
    
    return { minX: minXCm, maxX: maxXCm, minY: minYCm, maxY: maxYCm };
  };

  // Constrain position to canvas boundaries (entire area, not individual sheets)
  const constrainToSheet = (xCm: number, yCm: number, rectWidthCm: number, rectHeightCm: number): { x: number; y: number } => {
    // Get canvas dimensions in cm
    const canvasWidthCm = canvasDimensions.realWidthMm / 10;
    const canvasHeightCm = canvasDimensions.realHeightMm / 10;
    
    // Add safe margin (1cm) to keep rectangles inside canvas
    const safeMarginCm = 1;
    const halfWidth = rectWidthCm / 2;
    const halfHeight = rectHeightCm / 2;
    
    // Constrain to entire canvas area, not individual sheets
    const constrainedX = Math.max(
      safeMarginCm + halfWidth,
      Math.min(canvasWidthCm - safeMarginCm - halfWidth, xCm)
    );
    const constrainedY = Math.max(
      safeMarginCm + halfHeight,
      Math.min(canvasHeightCm - safeMarginCm - halfHeight, yCm)
    );
    
    return { x: constrainedX, y: constrainedY };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context state
    ctx.save();
    
    // Apply zoom and pan transforms
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(zoom, zoom);

    // Draw background grid pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1 / zoom;
    for (let x = 0; x <= canvas.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Add canvas margins (40px from edges)
    const canvasMargin = 40;
    const paperWidth = canvas.width - (canvasMargin * 2);
    const paperHeight = canvas.height - (canvasMargin * 2);
    
    // Calculate pixel conversion (relative to paper size)
    const paperInfo = paperDimensions[paperSize] || paperDimensions['A4-landscape'];
    const pxPerMm = paperWidth / paperInfo.realWidthMm;
    
    // Check if this is 6-page format
    const isMultiPage = paperSize === '6-page-3x2' || paperSize === '8-page-4x2';
    const is6Page = paperSize === '6-page-3x2';
    const is8Page = paperSize === '8-page-4x2';
    
    if (isMultiPage) {
      // Multi-page layout - sheets touch edge-to-edge
      const gutterMm = 0;  // No gutters
      const gutterPx = 0;
      const a4WidthMm = 297;  // A4 landscape
      const a4HeightMm = 210;
      // CRITICAL: Use UNIFORM px-per-mm scale (width-based) for both axes
      const sheetWidth = a4WidthMm * pxPerMm;
      const sheetHeight = a4HeightMm * pxPerMm;
      const safeMarginMm = 10; // 1cm safe zone
      const safeMarginPx = safeMarginMm * pxPerMm;
      const gridCols = is8Page ? 4 : 3;
      const gridRows = 2;
      
      // Draw sheets
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const sheetNum = row * gridCols + col + 1;
          const x = canvasMargin + col * (sheetWidth + gutterPx);
          const y = canvasMargin + row * (sheetHeight + gutterPx);
          
          // Draw sheet outline
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
          ctx.lineWidth = 2 / zoom;
          ctx.strokeRect(x, y, sheetWidth, sheetHeight);
          
          // Draw safe zone (grey margin 1cm inset) - uniform margin for symmetric borders
          ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)'; // gray-400
          ctx.lineWidth = 1 / zoom;
          ctx.strokeRect(
            x + safeMarginPx, 
            y + safeMarginPx, 
            sheetWidth - 2 * safeMarginPx, 
            sheetHeight - 2 * safeMarginPx
          );
          
          // Draw sheet number
          ctx.fillStyle = 'rgba(100, 116, 139, 0.6)';
          ctx.font = `${12 / zoom}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`Sheet ${sheetNum}`, x + sheetWidth / 2, y + 5 / zoom);
        }
      }
      
      // Draw gutters (white gaps between sheets)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      // Vertical gutters
      for (let i = 0; i < gridCols - 1; i++) {
        const x = canvasMargin + (i + 1) * sheetWidth + i * gutterPx;
        ctx.fillRect(x, canvasMargin, gutterPx, paperHeight);
      }
      // Horizontal gutter
      const y = canvasMargin + sheetHeight + gutterPx / 2;
      ctx.fillRect(canvasMargin, y - gutterPx / 2, paperWidth, gutterPx);
    } else {
      // Single sheet layout - draw sheet outline
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)'; // slate-500
      ctx.lineWidth = 3 / zoom;
      ctx.strokeRect(canvasMargin, canvasMargin, paperWidth, paperHeight);
      
      // Draw safe zone (1cm inset from all edges)
      const safeZonePx = 10 * pxPerMm; // 10mm safe zone
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)'; // gray-400
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([5 / zoom, 5 / zoom]);
      ctx.strokeRect(
        canvasMargin + safeZonePx,
        canvasMargin + safeZonePx,
        paperWidth - 2 * safeZonePx,
        paperHeight - 2 * safeZonePx
      );
      ctx.setLineDash([]); // Reset line dash
    }
    
    // ArUco marker size (5cm = 50mm) - use uniform scale
    const markerSizeMm = 50;
    const markerSize = markerSizeMm * pxPerMm;
    const safeMarginMm = 10; // 1cm safe zone from sheet edge
    const markerInsetMm = safeMarginMm; // Markers at inner corners of safe zone
    const markerInset = markerInsetMm * pxPerMm;
    
    // Position markers based on format
    let markers: Array<{ x: number; y: number; id: string; arucoId: number; }> = [];
    
    if (isMultiPage) {
      // Multi-page format: markers only on corner sheets
      // For 6-page (3×2): corners are sheets 1, 3, 4, 6
      // For 8-page (4×2): corners are sheets 1, 4, 5, 8
      const gutterMm = 0;  // No gutters
      const gutterPx = 0;
      const a4WidthMm = 297;  // A4 landscape
      const a4HeightMm = 210;
      // Use uniform scale (same as sheet rendering)
      const sheetWidth = a4WidthMm * pxPerMm;
      const sheetHeight = a4HeightMm * pxPerMm;
      const gridCols = is8Page ? 4 : 3;
      
      const topLeft = 1;
      const topRight = gridCols; // 3 for 6-page, 4 for 8-page
      const bottomLeft = gridCols + 1; // 4 for 6-page, 5 for 8-page
      const bottomRight = gridCols * 2; // 6 for 6-page, 8 for 8-page
      
      // Top-left corner sheet - ArUco 17
      const sheet1X = canvasMargin;
      const sheet1Y = canvasMargin;
      markers.push({ 
        x: sheet1X + markerInset, 
        y: sheet1Y + markerInset, 
        id: `${topLeft}-A`, 
        arucoId: 17 
      });
      
      // Top-right corner sheet - ArUco 18
      const sheetTRX = canvasMargin + (gridCols - 1) * (sheetWidth + gutterPx);
      const sheetTRY = canvasMargin;
      markers.push({ 
        x: sheetTRX + sheetWidth - markerSize - markerInset, 
        y: sheetTRY + markerInset, 
        id: `${topRight}-B`, 
        arucoId: 18 
      });
      
      // Bottom-left corner sheet - ArUco 20
      const sheetBLX = canvasMargin;
      const sheetBLY = canvasMargin + sheetHeight + gutterPx;
      markers.push({ 
        x: sheetBLX + markerInset, 
        y: sheetBLY + sheetHeight - markerSize - markerInset, 
        id: `${bottomLeft}-D`, 
        arucoId: 20 
      });
      
      // Bottom-right corner sheet - ArUco 19
      const sheetBRX = canvasMargin + (gridCols - 1) * (sheetWidth + gutterPx);
      const sheetBRY = canvasMargin + sheetHeight + gutterPx;
      markers.push({ 
        x: sheetBRX + sheetWidth - markerSize - markerInset, 
        y: sheetBRY + sheetHeight - markerSize - markerInset, 
        id: `${bottomRight}-C`, 
        arucoId: 19 
      });
    } else {
      // Standard layout: markers at INNER corners of safe zone (not sheet edges)
      const safeZonePx = safeMarginMm * pxPerMm;
      markers = [
        { x: canvasMargin + safeZonePx, y: canvasMargin + safeZonePx, id: 'A', arucoId: 17 },  // Top-left (inside safe zone)
        { x: canvasMargin + paperWidth - markerSize - safeZonePx, y: canvasMargin + safeZonePx, id: 'B', arucoId: 18 },  // Top-right
        { x: canvasMargin + paperWidth - markerSize - safeZonePx, y: canvasMargin + paperHeight - markerSize - safeZonePx, id: 'C', arucoId: 19 },  // Bottom-right
        { x: canvasMargin + safeZonePx, y: canvasMargin + paperHeight - markerSize - safeZonePx, id: 'D', arucoId: 20 },  // Bottom-left
      ];
    }
    
    // Draw ArUco markers
    markers.forEach(marker => {
      // Draw marker outline
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(marker.x, marker.y, markerSize, markerSize);
      
      // Draw marker ID and ArUco ID
      ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
      ctx.font = `${12 / zoom}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`ID${marker.arucoId}`, marker.x + markerSize / 2, marker.y + markerSize / 2);
    });

    // Draw template rectangles (black outlines)
    templateRectangles.forEach((rect) => {
      // xCm and yCm represent the CENTER of the rectangle
      const centerX = canvasMargin + cmToPixels(rect.xCm, true);
      const centerY = canvasMargin + cmToPixels(rect.yCm, false);
      const width = cmToPixels(rect.widthCm, true);
      const height = cmToPixels(rect.heightCm, false);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate((rect.rotation * Math.PI) / 180);

      // Draw rectangle (centered at origin after translation)
      const isSelected = selectedTemplateRect?.id === rect.id;
      ctx.strokeStyle = isSelected ? 'rgb(59, 130, 246)' : 'rgb(0, 0, 0)';
      ctx.lineWidth = isSelected ? 3 / zoom : 2 / zoom;
      ctx.strokeRect(-width / 2, -height / 2, width, height);

      // Draw category name label (at center)
      ctx.fillStyle = isSelected ? 'rgb(59, 130, 246)' : 'rgb(0, 0, 0)';
      ctx.font = `${10 / zoom}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rect.categoryName, 0, 0);

      ctx.restore();
    });

    // Slot drawing removed - slots are now auto-generated from templates during calibration
    
    // Restore context state
    ctx.restore();
  }, [regions, currentRegion, selectedRegion, zoom, panOffset, canvasDimensions, templateRectangles, selectedTemplateRect]);

  // Helper function to convert screen coordinates to canvas coordinates with zoom/pan
  const screenToCanvas = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const screenX = (event.clientX - rect.left) * scaleX;
    const screenY = (event.clientY - rect.top) * scaleY;
    
    // Apply inverse zoom and pan
    const x = (screenX - panOffset.x) / zoom;
    const y = (screenY - panOffset.y) / zoom;
    
    return { x, y };
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || isPanning) return;

    const { x, y } = screenToCanvas(event);

    if (!currentRegion) {
      // Start new region
      const newRegion: SlotRegion = {
        id: Date.now().toString(),
        slotId: `${String.fromCharCode(65 + regions.length)}${(regions.length % 6) + 1}`,
        points: [{ x, y }],
        toolName: '',
        expectedQrId: '',
        priority: 'high',
        allowCheckout: true,
        graceWindow: '08:30-16:30',
      };
      setCurrentRegion(newRegion);
    } else {
      // Add point to current region
      const updatedRegion = {
        ...currentRegion,
        points: [...currentRegion.points, { x, y }],
      };
      setCurrentRegion(updatedRegion);
    }
  };

  const handleRegionClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDrawing || isPanning) return;

    const { x, y } = screenToCanvas(event);

    // Check if click is inside any template rectangle first (using rotation-aware hit-testing)
    for (const rect of templateRectangles) {
      if (isPointInRotatedRect(x, y, rect)) {
        setSelectedTemplateRect(rect);
        setSelectedRegion(null);
        return;
      }
    }

    // Check if click is inside any slot region
    for (const region of regions) {
      if (isPointInPolygon({ x, y }, region.points)) {
        setSelectedRegion(region);
        setSelectedTemplateRect(null);
        return;
      }
    }
    
    setSelectedRegion(null);
    setSelectedTemplateRect(null);
  };

  const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (
        polygon[i].y > point.y !== polygon[j].y > point.y &&
        point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x
      ) {
        inside = !inside;
      }
    }
    return inside;
  };

  const isPointInRotatedRect = (px: number, py: number, rect: TemplateRectangle): boolean => {
    const canvasMargin = 40;
    // xCm and yCm represent the CENTER of the rectangle
    const centerX = canvasMargin + cmToPixels(rect.xCm, true);
    const centerY = canvasMargin + cmToPixels(rect.yCm, false);
    const rectWidth = cmToPixels(rect.widthCm, true);
    const rectHeight = cmToPixels(rect.heightCm, false);

    const dx = px - centerX;
    const dy = py - centerY;

    const angleRad = (rect.rotation * Math.PI) / 180;
    const rotatedX = dx * Math.cos(-angleRad) - dy * Math.sin(-angleRad);
    const rotatedY = dx * Math.sin(-angleRad) + dy * Math.cos(-angleRad);

    return Math.abs(rotatedX) <= rectWidth / 2 && Math.abs(rotatedY) <= rectHeight / 2;
  };

  const startNewSlot = () => {
    setIsDrawing(true);
    setCurrentRegion(null);
    setSelectedRegion(null);
  };

  const finishCurrentRegion = () => {
    if (currentRegion && currentRegion.points.length >= 3) {
      setRegions([...regions, currentRegion]);
      setSelectedRegion(currentRegion);
      setCurrentRegion(null);
      setIsDrawing(false);
    }
  };

  const cancelCurrentRegion = () => {
    setCurrentRegion(null);
    setIsDrawing(false);
  };

  const deleteSelectedRegion = () => {
    if (selectedRegion) {
      setRegions(regions.filter(r => r.id !== selectedRegion.id));
      setSelectedRegion(null);
    }
  };

  const saveSlotConfiguration = () => {
    if (!selectedRegion) return;

    const activeCamera = cameras?.find((c: any) => c.isActive);
    if (!activeCamera) {
      toast({
        title: "No Active Camera",
        description: "Please activate a camera first",
        variant: "destructive",
      });
      return;
    }

    const slotData = {
      slotId: selectedRegion.slotId,
      cameraId: activeCamera.id,
      toolName: selectedRegion.toolName,
      expectedQrId: selectedRegion.expectedQrId,
      priority: selectedRegion.priority,
      regionCoords: selectedRegion.points.map(p => [p.x, p.y]),
      allowCheckout: selectedRegion.allowCheckout,
      graceWindow: selectedRegion.graceWindow,
      isActive: true,
    };

    // Check if slot already exists
    const existingSlot = slots?.find((s: any) => s.slotId === selectedRegion.slotId);
    if (existingSlot) {
      updateSlotMutation.mutate({ id: existingSlot.id, data: slotData });
    } else {
      createSlotMutation.mutate(slotData);
    }
  };

  const updateSelectedRegion = (updates: Partial<SlotRegion>) => {
    if (!selectedRegion) return;
    
    const updated = { ...selectedRegion, ...updates };
    setSelectedRegion(updated);
    setRegions(regions.map(r => r.id === selectedRegion.id ? updated : r));
  };

  // Zoom handlers
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.2, 5));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.2, 0.5));
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent scroll from bubbling to parent
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(Math.max(prev * delta, 0.5), 5));
  };

  // Pan handlers
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: event.clientX - panOffset.x, y: event.clientY - panOffset.y });
      event.preventDefault();
      return;
    }

    // Check if clicking on a template rectangle to start dragging (using rotation-aware hit-testing)
    if (event.button === 0 && !isDrawing) {
      const { x, y } = screenToCanvas(event);

      for (const rect of templateRectangles) {
        if (isPointInRotatedRect(x, y, rect)) {
          setSelectedTemplateRect(rect); // Select the rectangle to show details panel
          setDraggingRectId(rect.id);
          setDragStartPos({ x, y });
          event.preventDefault();
          return;
        }
      }
      
      // If clicked outside any rectangle, start panning instead of just deselecting
      setSelectedTemplateRect(null);
      setIsPanning(true);
      setPanStart({ x: event.clientX - panOffset.x, y: event.clientY - panOffset.y });
      event.preventDefault();
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPanOffset({
        x: event.clientX - panStart.x,
        y: event.clientY - panStart.y,
      });
      return;
    }

    // Handle template rectangle dragging
    if (draggingRectId && dragStartPos) {
      const { x, y } = screenToCanvas(event);
      const canvasMargin = 40;
      
      const rect = templateRectangles.find(r => r.id === draggingRectId);
      if (!rect) return;

      const deltaX = x - dragStartPos.x;
      const deltaY = y - dragStartPos.y;

      const newXPixels = canvasMargin + cmToPixels(rect.xCm, true) + deltaX;
      const newYPixels = canvasMargin + cmToPixels(rect.yCm, false) + deltaY;

      // Hold Ctrl or Alt to disable snapping for precise positioning
      const shouldSnap = snapEnabled && !event.ctrlKey && !event.altKey;
      let newXCm = snapToGrid(pixelsToCm(newXPixels - canvasMargin, true), shouldSnap);
      let newYCm = snapToGrid(pixelsToCm(newYPixels - canvasMargin, false), shouldSnap);

      // Simple bounds: just keep within overall canvas (no per-sheet locking)
      const bounds = PAPER_BOUNDS[paperSize];
      if (bounds) {
        // Calculate rotated bounding box dimensions
        const rotation = rect.rotation || 0;
        const radians = (rotation * Math.PI) / 180;
        const cosA = Math.abs(Math.cos(radians));
        const sinA = Math.abs(Math.sin(radians));
        const rotatedWidth = rect.widthCm * cosA + rect.heightCm * sinA;
        const rotatedHeight = rect.widthCm * sinA + rect.heightCm * cosA;
        
        const halfWidth = rotatedWidth / 2;
        const halfHeight = rotatedHeight / 2;
        const minX = bounds.safeMarginCm + halfWidth;
        const maxX = bounds.widthCm - bounds.safeMarginCm - halfWidth;
        const minY = bounds.safeMarginCm + halfHeight;
        const maxY = bounds.heightCm - bounds.safeMarginCm - halfHeight;
        
        newXCm = Math.max(minX, Math.min(maxX, newXCm));
        newYCm = Math.max(minY, Math.min(maxY, newYCm));
      }

      // Update local state immediately for smooth dragging
      setTemplateRectangles(prev => prev.map(r => 
        r.id === draggingRectId ? { ...r, xCm: newXCm, yCm: newYCm } : r
      ));
      setDragStartPos({ x, y });
    }
  };

  const handleMouseUp = () => {
    if (draggingRectId) {
      // Save the new position to database
      const rect = templateRectangles.find(r => r.id === draggingRectId);
      if (rect) {
        updateTemplateRectMutation.mutate({
          id: rect.id,
          data: {
            categoryId: rect.categoryId,
            paperSize: paperSize,
            xCm: rect.xCm,
            yCm: rect.yCm,
            rotation: rect.rotation,
          }
        });
      }
      setDraggingRectId(null);
      setDragStartPos(null);
    }
    setIsPanning(false);
  };

  // Version save/load handlers
  const saveVersion = () => {
    if (!versionName.trim()) {
      toast({
        title: "Version Name Required",
        description: "Please enter a name for this version",
        variant: "destructive",
      });
      return;
    }

    const newVersion = {
      name: versionName,
      timestamp: new Date().toISOString(),
      regions: regions,
    };

    const updated = [...savedVersions, newVersion];
    setSavedVersions(updated);
    localStorage.setItem('slotConfigVersions', JSON.stringify(updated));
    
    toast({
      title: "Version Saved",
      description: `Configuration saved as "${versionName}"`,
    });
    
    setVersionName('');
  };

  const loadVersion = (version: typeof savedVersions[0]) => {
    setRegions(version.regions);
    setSelectedRegion(null);
    toast({
      title: "Version Loaded",
      description: `Loaded configuration "${version.name}"`,
    });
  };

  const deleteVersion = (timestamp: string) => {
    const updated = savedVersions.filter(v => v.timestamp !== timestamp);
    setSavedVersions(updated);
    localStorage.setItem('slotConfigVersions', JSON.stringify(updated));
    toast({
      title: "Version Deleted",
      description: "Configuration version removed",
    });
  };

  // Template version save/load handlers
  const saveTemplateVersion = async () => {
    if (!templateVersionName.trim()) {
      toast({
        title: "Design Name Required",
        description: "Please enter a name for this template design",
        variant: "destructive",
      });
      return;
    }

    if (templateRectangles.length === 0) {
      toast({
        title: "No Templates to Save",
        description: "Add some tool templates before saving",
        variant: "destructive",
      });
      return;
    }

    // Validate all categories exist (don't auto-create)
    const usedCategoryIds = new Set(templateRectangles.map(t => t.categoryId));
    const missingCategories = Array.from(usedCategoryIds).filter(id => 
      !toolCategories.find((c: any) => c.id === id)
    );
    
    if (missingCategories.length > 0) {
      toast({
        title: "Missing Categories",
        description: "Some tool categories are missing. Please create them first.",
        variant: "destructive",
      });
      return;
    }

    // Prepare rectangle data for atomic save
    const rectangles = templateRectangles.map(r => ({
      categoryId: r.categoryId,
      paperSize: paperSize, // Required field
      xCm: r.xCm,
      yCm: r.yCm,
      rotation: r.rotation,
      autoQrId: r.autoQrId,
    }));

    // Call atomic mutation to save design with rectangles
    saveTemplateDesignMutation.mutate({
      name: templateVersionName,
      paperSize: paperSize,
      rectangles: rectangles,
    }, {
      onSuccess: () => {
        // Update snapshot to mark as saved
        const snapshot = JSON.stringify(templateRectangles.map(r => ({
          id: r.id,
          categoryId: r.categoryId,
          xCm: r.xCm,
          yCm: r.yCm,
          rotation: r.rotation,
          autoQrId: r.autoQrId,
        })).sort((a, b) => a.id.localeCompare(b.id)));
        setLastLoadedSnapshot(snapshot);
        
        console.log(`[SlotDrawing] Saved template design "${templateVersionName}" with ${rectangles.length} tools`);
      },
    });
  };

  const loadTemplateVersion = async (version: typeof savedTemplateVersions[0]) => {
    try {
      console.log(`[LOAD] Loading template version: ${version.paperSize} - ${version.name}`);
      
      // First, ensure all categories exist in the database
      for (const category of version.categories) {
        // Check if category exists, if not create it
        const existingCategory = toolCategories.find((c: any) => c.name === category.name);
        if (!existingCategory) {
          console.log(`[LOAD] Creating missing category: ${category.name}`);
          await apiRequest('POST', '/api/tool-categories', {
            name: category.name,
            label: category.label,
            widthCm: category.widthCm,
            heightCm: category.heightCm,
          });
        } else {
          console.log(`[LOAD] Category already exists: ${category.name} (ID: ${existingCategory.id})`);
        }
      }

      // CRITICAL: Re-fetch categories from database to get current IDs
      // (some may have just been created with new IDs)
      console.log('[LOAD] Re-fetching categories from database...');
      const categoriesResponse = await fetch('/api/tool-categories');
      if (!categoriesResponse.ok) {
        throw new Error('Failed to re-fetch categories');
      }
      const latestCategories = await categoriesResponse.json();
      console.log(`[LOAD] Fetched ${latestCategories.length} categories from database`);
      
      // Create a mapping from category NAME to current DATABASE ID
      const categoryNameToId = new Map<string, string>();
      for (const savedCategory of version.categories) {
        const dbCategory = latestCategories.find((c: any) => c.name === savedCategory.name);
        if (dbCategory) {
          categoryNameToId.set(savedCategory.name, dbCategory.id);
          console.log(`[LOAD] Mapped category "${savedCategory.name}": saved ID ${savedCategory.id} → DB ID ${dbCategory.id}`);
        } else {
          console.warn(`[LOAD] WARNING: Category "${savedCategory.name}" not found in database!`);
        }
      }
      
      // Invalidate React Query cache to stay in sync
      await queryClient.invalidateQueries({ queryKey: ['/api/tool-categories'] });

      // Fetch existing template rectangles for the TARGET paper size
      const response = await fetch(`/api/template-rectangles?paperSize=${version.paperSize}`);
      if (!response.ok) {
        throw new Error('Failed to fetch existing template rectangles');
      }
      const existingRects = await response.json();

      // Delete existing template rectangles for the target paper size
      for (const rect of existingRects) {
        await apiRequest('DELETE', `/api/template-rectangles/${rect.id}`);
      }

      // Set paper size AFTER deletion so state is consistent
      setPaperSize(version.paperSize);

      // Create new template rectangles with remapped category IDs
      const newRects = [];
      for (const rect of version.templateRectangles) {
        // Find the category in the original saved data by its ID
        const savedCategory = version.categories.find((c: any) => c.id === rect.categoryId);
        
        if (!savedCategory) {
          console.warn(`Skipping rectangle: saved category not found for ID ${rect.categoryId}`);
          continue;
        }
        
        // Get the current DB category ID using the category name as the key
        const currentCategoryId = categoryNameToId.get(savedCategory.name);
        
        if (!currentCategoryId) {
          console.warn(`Skipping rectangle: current category ID not found for name ${savedCategory.name}`);
          continue;
        }
        
        // POST with the remapped category ID
        const created = await apiRequest('POST', '/api/template-rectangles', {
          categoryId: currentCategoryId, // This is the NEW ID from the database
          paperSize: version.paperSize,
          xCm: rect.xCm,
          yCm: rect.yCm,
          rotation: rect.rotation,
          autoQrId: rect.autoQrId,
        });
        const createdRect = await created.json();
        newRects.push(createdRect);
      }

      // Refresh template rectangles and load them onto canvas
      await queryClient.invalidateQueries({ queryKey: ['/api/template-rectangles'] });
      
      // Load the templates onto the canvas using the NEW IDs from the database
      const loadedRects: TemplateRectangle[] = newRects.map((newRect: any) => {
        const dbCategory = latestCategories.find((c: any) => c.id === newRect.categoryId);
        
        return {
          id: newRect.id, // Use the NEW ID from the database, not the old one!
          categoryId: newRect.categoryId,
          xCm: newRect.xCm,
          yCm: newRect.yCm,
          rotation: newRect.rotation,
          widthCm: dbCategory?.widthCm || 0,
          heightCm: dbCategory?.heightCm || 0,
          categoryName: dbCategory?.name || '',
          label: dbCategory?.label || '',
          autoQrId: newRect.autoQrId,
        };
      });
      
      // Validate and auto-correct any out-of-bounds rectangles
      const validatedRects = loadedRects.map(rect => {
        const violations = checkBoundaryViolations(
          { xCm: rect.xCm, yCm: rect.yCm, widthCm: rect.widthCm, heightCm: rect.heightCm, rotation: rect.rotation || 0 },
          version.paperSize
        );
        
        if (violations.length > 0) {
          const clamped = clampToBounds(
            { xCm: rect.xCm, yCm: rect.yCm, widthCm: rect.widthCm, heightCm: rect.heightCm, rotation: rect.rotation || 0 },
            version.paperSize
          );
          
          toast({
            title: "Template Auto-Corrected",
            description: `"${rect.autoQrId}" was outside printable area and has been adjusted.`,
            variant: "default",
          });
          
          // Save corrected position to database
          updateTemplateRectMutation.mutate({
            id: rect.id,
            data: {
              categoryId: rect.categoryId,
              paperSize: version.paperSize,
              xCm: clamped.xCm,
              yCm: clamped.yCm,
              rotation: rect.rotation,
            }
          });
          
          return { ...rect, xCm: clamped.xCm, yCm: clamped.yCm };
        }
        return rect;
      });
      
      setTemplateRectangles(validatedRects);
      
      // Update snapshot to mark as saved
      const snapshot = JSON.stringify(loadedRects.map(r => ({
        id: r.id,
        categoryId: r.categoryId,
        xCm: r.xCm,
        yCm: r.yCm,
        rotation: r.rotation,
        autoQrId: r.autoQrId,
      })).sort((a, b) => a.id.localeCompare(b.id)));
      setLastLoadedSnapshot(snapshot);
      
      setSelectedTemplateRect(null);

      toast({
        title: "Template Design Loaded",
        description: `Loaded "${version.paperSize} - ${version.name}" with ${version.templateRectangles.length} tools`,
      });
    } catch (error) {
      toast({
        title: "Load Failed",
        description: "Failed to load template design",
        variant: "destructive",
      });
    }
  };

  const confirmDeleteTemplateVersion = () => {
    if (!templateToDelete) return;
    
    const versionToDelete = savedTemplateVersions.find(v => v.timestamp === templateToDelete);
    if (!versionToDelete || !versionToDelete.id) {
      toast({
        title: "Delete Failed",
        description: "Template design ID not found",
        variant: "destructive",
      });
      setDeleteConfirmOpen(false);
      setTemplateToDelete(null);
      return;
    }
    
    // Call delete mutation with database ID
    deleteTemplateDesignMutation.mutate(versionToDelete.id, {
      onSuccess: () => {
        console.log(`[SlotDrawing] Deleted template design: ${versionToDelete.name}`);
        setDeleteConfirmOpen(false);
        setTemplateToDelete(null);
      },
    });
  };
  
  const deleteTemplateVersion = (timestamp: string) => {
    setTemplateToDelete(timestamp);
    setDeleteConfirmOpen(true);
  };
  
  const previewTemplateVersion = async (version: any) => {
    // Check for unsaved changes before loading
    if (hasUnsavedChanges) {
      setTemplateToLoad(version);
      setUnsavedWarningOpen(true);
      return;
    }
    
    // Just load it onto the canvas - same as the load button
    await loadTemplateVersion(version);
    toast({
      title: "Template Loaded for Preview",
      description: `"${version.paperSize} - ${version.name}" is now shown on canvas`,
    });
  };
  
  const confirmLoadTemplate = async () => {
    if (!templateToLoad) return;
    
    await loadTemplateVersion(templateToLoad);
    toast({
      title: "Template Loaded",
      description: `"${templateToLoad.paperSize} - ${templateToLoad.name}" is now shown on canvas`,
    });
    
    setUnsavedWarningOpen(false);
    setTemplateToLoad(null);
  };

  const exportTemplateVersion = (version: typeof savedTemplateVersions[0]) => {
    const dataStr = JSON.stringify(version, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${version.paperSize}-${version.name.replace(/\s+/g, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: "Template Exported",
      description: `"${version.paperSize} - ${version.name}" downloaded as JSON file`,
    });
  };

  const importTemplateVersion = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const importedVersion = JSON.parse(text);
        
        // Validate the imported data
        if (!importedVersion.name || !importedVersion.paperSize || !importedVersion.templateRectangles || !importedVersion.categories) {
          toast({
            title: "Invalid Template File",
            description: "The file doesn't contain valid template data",
            variant: "destructive",
          });
          return;
        }
        
        // Prepare rectangles for database save
        const rectangles = (importedVersion.templateRectangles || []).map((r: any) => ({
          categoryId: r.categoryId,
          paperSize: importedVersion.paperSize, // Required field
          xCm: r.xCm,
          yCm: r.yCm,
          rotation: r.rotation,
          autoQrId: r.autoQrId,
        }));
        
        // Save imported design to database using atomic mutation
        saveTemplateDesignMutation.mutate({
          name: importedVersion.name,
          paperSize: importedVersion.paperSize,
          rectangles: rectangles,
        }, {
          onSuccess: () => {
            console.log(`[SlotDrawing] Imported template design: ${importedVersion.name}`);
            toast({
              title: "Template Imported",
              description: `"${importedVersion.paperSize} - ${importedVersion.name}" has been imported and saved to database`,
            });
          },
          onError: (error) => {
            toast({
              title: "Import Failed",
              description: `Failed to save imported design: ${error.message}`,
              variant: "destructive",
            });
          },
        });
      } catch (error) {
        toast({
          title: "Import Failed",
          description: error instanceof Error ? error.message : "Failed to read template file",
          variant: "destructive",
        });
      }
    };
    input.click();
  };

  const addTemplateRectangle = async (categoryId: string) => {
    const category = toolCategories.find((c: any) => c.id === categoryId);
    if (!category) return;

    // Generate unique ArUco marker ID (per-saved-template-design sequential numbering)
    // Count slots in the CURRENT template design only
    const nextSlotNumber = templateRectangles.length + 1;
    
    // ArUco marker IDs: 1-50 for slots (96-99 reserved for corners)
    if (nextSlotNumber > 50) {
      toast({
        title: "Slot Limit Reached",
        description: "Maximum 50 slots per template design. ArUco marker IDs 1-50 are used for slots, 96-99 are reserved for corners.",
        variant: "destructive",
      });
      return;
    }
    
    const autoQrId = `slot-${nextSlotNumber}`;

    try {
      // Show loading toast
      toast({
        title: "Adding Slot",
        description: `Creating slot ${nextSlotNumber} (ArUco marker ID ${nextSlotNumber})...`,
      });

      // No QR code generation needed - ArUco markers are generated during print
      // Place at center of canvas
      const canvasMargin = 40;
      const paperWidth = canvasDimensions.width - (canvasMargin * 2);
      const paperHeight = canvasDimensions.height - (canvasMargin * 2);
      
      const centerXPixels = paperWidth / 2;
      const centerYPixels = paperHeight / 2;
      
      const centerXCm = snapToGrid(pixelsToCm(centerXPixels, true));
      const centerYCm = snapToGrid(pixelsToCm(centerYPixels, false));

      createTemplateRectMutation.mutate({
        categoryId: categoryId,
        // cameraId removed - templates are now camera-independent
        paperSize: paperSize,
        xCm: centerXCm,
        yCm: centerYCm,
        rotation: 0,
        autoQrId: autoQrId,
      });

      // Show success toast
      toast({
        title: "Slot Added",
        description: `Successfully created slot ${nextSlotNumber} for ${category.name}`,
      });
    } catch (error) {
      toast({
        title: "Failed to Add Slot",
        description: error instanceof Error ? error.message : "Failed to add slot to template",
        variant: "destructive",
      });
    }
  };

  const deleteSelectedTemplateRect = () => {
    if (selectedTemplateRect) {
      deleteTemplateRectMutation.mutate(selectedTemplateRect.id);
    }
  };

  const rotateTemplateLeft = () => {
    if (!selectedTemplateRect) return;
    
    const currentRotation = selectedTemplateRect.rotation || 0;
    const newRotation = currentRotation - 45 < 0 ? 315 : currentRotation - 45;
    
    setTemplateRectangles(prev => prev.map(r => 
      r.id === selectedTemplateRect.id ? { ...r, rotation: newRotation } : r
    ));
    setSelectedTemplateRect({ ...selectedTemplateRect, rotation: newRotation });
    
    updateTemplateRectMutation.mutate({
      id: selectedTemplateRect.id,
      data: {
        categoryId: selectedTemplateRect.categoryId,
        paperSize: paperSize,
        xCm: selectedTemplateRect.xCm,
        yCm: selectedTemplateRect.yCm,
        rotation: newRotation,
      }
    });
  };

  const rotateTemplateRight = () => {
    if (!selectedTemplateRect) return;
    
    const currentRotation = selectedTemplateRect.rotation || 0;
    const newRotation = currentRotation + 45 >= 360 ? 0 : currentRotation + 45;
    
    setTemplateRectangles(prev => prev.map(r => 
      r.id === selectedTemplateRect.id ? { ...r, rotation: newRotation } : r
    ));
    setSelectedTemplateRect({ ...selectedTemplateRect, rotation: newRotation });
    
    updateTemplateRectMutation.mutate({
      id: selectedTemplateRect.id,
      data: {
        categoryId: selectedTemplateRect.categoryId,
        paperSize: paperSize,
        xCm: selectedTemplateRect.xCm,
        yCm: selectedTemplateRect.yCm,
        rotation: newRotation,
      }
    });
  };

  const configuredSlotIds = slots?.map((s: any) => s.slotId) || [];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground" data-testid="slot-drawing-title">
                Template Design
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Design your tool layout - ArUco markers, templates, and QR codes on one sheet</p>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" data-testid="button-close-slot-drawing">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-2">
          <div className="w-full space-y-2">
            
            {/* Drawing Canvas */}
            <div className="w-full">
              {/* Paper Size Selector */}
              <div className="mb-3 flex items-center gap-3 justify-between">
                <div className="flex items-center gap-3">
                  <Label htmlFor="paper-size" className="text-sm font-medium">Paper Size:</Label>
                  <Select value={paperSize} onValueChange={setPaperSize}>
                    <SelectTrigger className="w-48" id="paper-size" data-testid="select-paper-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A5-landscape">A5 Landscape</SelectItem>
                      <SelectItem value="A4-landscape">A4 Landscape</SelectItem>
                      <SelectItem value="A3-landscape">A3 Landscape</SelectItem>
                      <SelectItem value="2xA5-landscape">2× A5 Landscape</SelectItem>
                      <SelectItem value="3xA5-landscape">3× A5 Landscape</SelectItem>
                      <SelectItem value="6-page-3x2">6-Page (3×2 A4)</SelectItem>
                      <SelectItem value="8-page-4x2">8-Page (4×2 A4)</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-xs text-muted-foreground">
                      Match your ArUco grid paper size (templates can be used with any camera)
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      💡 Drag to pan • Scroll to zoom • Drag rectangles to move • Hold Ctrl/Alt for precise positioning
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowCategoryManager(true)}
                    data-testid="button-category-manager"
                  >
                    <Layers className="w-4 h-4 mr-2" />
                    Tool Categories
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowSlotImportExport(true)}
                    data-testid="button-slot-import-export"
                  >
                    <FileJson className="w-4 h-4 mr-2" />
                    Import/Export Slots
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setLocation('/template-print')}
                    data-testid="button-print-preview"
                    disabled={templateRectangles.length === 0}
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print Preview
                  </Button>
                </div>
              </div>

              <div ref={containerRef} className="w-full bg-muted rounded overflow-hidden" style={{ height: '70vh' }}>
                <canvas 
                  ref={canvasRef}
                  width={canvasDimensions.width}
                  height={canvasDimensions.height}
                  className="drawing-canvas"
                  style={{ 
                    cursor: isPanning ? 'grabbing' : (draggingRectId ? 'move' : 'grab'),
                    display: 'block'
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  data-testid="slot-canvas"
                />
              </div>
              
              <div className="flex items-center justify-between gap-3 mt-3">
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline"
                    onClick={handleZoomIn}
                    data-testid="button-zoom-in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  
                  <Button 
                    variant="outline"
                    onClick={handleZoomOut}
                    data-testid="button-zoom-out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  
                  <div className="px-3 py-1 bg-muted rounded text-sm font-mono">
                    {Math.round(zoom * 100)}%
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="snap-enabled" 
                      checked={snapEnabled}
                      onCheckedChange={(checked) => setSnapEnabled(checked === true)}
                      data-testid="checkbox-snap-enabled"
                    />
                    <Label htmlFor="snap-enabled" className="text-sm cursor-pointer">
                      Snap to Grid ({gridSize}cm)
                    </Label>
                  </div>
                  
                  <Select value={gridSize.toString()} onValueChange={(v) => setGridSize(parseFloat(v))}>
                    <SelectTrigger className="w-28" data-testid="select-grid-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.25">0.25cm</SelectItem>
                      <SelectItem value="0.5">0.5cm</SelectItem>
                      <SelectItem value="1">1cm</SelectItem>
                      <SelectItem value="2">2cm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

                {/* Template Rectangles */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Layers className="w-4 h-4" />
                      Template Tool Outlines
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {toolCategories && toolCategories.length > 0 ? (
                      <div className="grid grid-cols-1 gap-2">
                        {toolCategories.map((category: any) => (
                          <div
                            key={category.id}
                            className="flex items-center justify-between p-3 bg-muted rounded-lg"
                          >
                            <div className="flex-1">
                              <p className="font-medium text-sm">{category.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {category.label} • {category.widthCm}×{category.heightCm} cm
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => addTemplateRectangle(category.id)}
                              disabled={createTemplateRectMutation.isPending}
                              data-testid={`button-add-template-${category.id}`}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-muted-foreground">
                          No tool categories defined. Create categories to add template rectangles.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => setShowCategoryManager(true)}
                          data-testid="button-manage-categories"
                        >
                          Manage Categories
                        </Button>
                      </div>
                    )}

                    {/* Selected Template Rectangle Info */}
                    {selectedTemplateRect && (
                      <div className="border-t pt-3 mt-3">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-blue-500">Selected Template</h4>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={deleteSelectedTemplateRect}
                              disabled={deleteTemplateRectMutation.isPending}
                              data-testid="button-delete-template"
                            >
                              <Trash className="w-4 h-4" />
                            </Button>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p><span className="font-medium">Category:</span> {selectedTemplateRect.categoryName}</p>
                            <p><span className="font-medium">Size:</span> {selectedTemplateRect.widthCm}×{selectedTemplateRect.heightCm} cm</p>
                            <p><span className="font-medium">Position:</span> ({selectedTemplateRect.xCm.toFixed(1)}, {selectedTemplateRect.yCm.toFixed(1)}) cm</p>
                            <p><span className="font-medium">Rotation:</span> {selectedTemplateRect.rotation || 0}°</p>
                          </div>
                          
                          <div className="mt-3 pt-3 border-t border-blue-500/20">
                            <label className="text-xs font-medium text-blue-500 block mb-1">
                              Expected QR ID
                            </label>
                            <Input
                              placeholder="e.g., pen-004, tool-001"
                              value={selectedTemplateRect.autoQrId || ''}
                              onChange={(e) => {
                                const newQrId = e.target.value;
                                setTemplateRectangles(prev => prev.map(r => 
                                  r.id === selectedTemplateRect.id ? { ...r, autoQrId: newQrId } : r
                                ));
                                setSelectedTemplateRect({ ...selectedTemplateRect, autoQrId: newQrId });
                              }}
                              onBlur={() => {
                                // Save to database when user leaves the field
                                updateTemplateRectMutation.mutate({
                                  id: selectedTemplateRect.id,
                                  data: {
                                    categoryId: selectedTemplateRect.categoryId,
                                    paperSize: paperSize,
                                    xCm: selectedTemplateRect.xCm,
                                    yCm: selectedTemplateRect.yCm,
                                    rotation: selectedTemplateRect.rotation || 0,
                                    autoQrId: selectedTemplateRect.autoQrId,
                                  }
                                });
                              }}
                              className="text-sm"
                              data-testid="input-expected-qr-id"
                            />
                            <p className="text-xs text-muted-foreground mt-1 italic">
                              QR code ID that should be detected in this slot
                            </p>
                          </div>
                          
                          <div className="mt-3 pt-3 border-t border-blue-500/20">
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={rotateTemplateLeft}
                                disabled={updateTemplateRectMutation.isPending}
                                data-testid="button-rotate-left"
                                className="flex-1"
                              >
                                <RotateCcw className="w-4 h-4 mr-1" />
                                Rotate Left
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={rotateTemplateRight}
                                disabled={updateTemplateRectMutation.isPending}
                                data-testid="button-rotate-right"
                                className="flex-1"
                              >
                                <RotateCw className="w-4 h-4 mr-1" />
                                Rotate Right
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground text-center mt-2">
                              Rotate by 45° increments
                            </p>
                          </div>
                          
                          <p className="text-xs text-muted-foreground mt-2 italic">
                            Drag to reposition{snapEnabled ? ` (snaps to ${gridSize}cm grid, hold Ctrl/Alt to disable)` : ' (snapping disabled)'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Template Rectangles Count */}
                    {templateRectangles.length > 0 && (
                      <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                        {templateRectangles.length} template{templateRectangles.length !== 1 ? 's' : ''} placed
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Template Version Management */}
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Template Designs
                      </div>
                      {hasUnsavedChanges && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                          Unsaved Changes
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Save Template Design */}
                      <div className="flex gap-2">
                        <Input
                          placeholder="Design name (e.g., Workshop Layout)"
                          value={templateVersionName}
                          onChange={(e) => setTemplateVersionName(e.target.value)}
                          data-testid="input-template-version-name"
                        />
                        <Button onClick={saveTemplateVersion} data-testid="button-save-template-version">
                          <Save className="w-4 h-4 mr-2" />
                          Save
                        </Button>
                      </div>
                      
                      {/* Import Option */}
                      <Button 
                        onClick={importTemplateVersion} 
                        variant="outline"
                        className="w-full"
                        data-testid="button-import-template"
                        title="Import template from file"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Import File
                      </Button>
                      
                      {/* Validate & Fix Button */}
                      <Button 
                        onClick={() => validateAndFixMutation.mutate(paperSize)} 
                        variant="outline"
                        className="w-full"
                        disabled={validateAndFixMutation.isPending}
                        data-testid="button-validate-fix"
                        title="Check and fix rectangles outside safe zones"
                      >
                        {validateAndFixMutation.isPending ? (
                          <>Validating...</>
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Validate & Fix Safe Zones
                          </>
                        )}
                      </Button>

                      {/* Saved Template Designs List */}
                      {savedTemplateVersions.length > 0 && (
                        <div className="border rounded-lg p-3 space-y-2">
                          <p className="text-sm font-medium">Saved Designs ({savedTemplateVersions.length})</p>
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {savedTemplateVersions.map((version) => (
                              <div
                                key={version.timestamp}
                                className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                              >
                                <div className="flex-1">
                                  <p className="font-medium">{version.paperSize} - {version.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {new Date(version.timestamp).toLocaleString()} • {version.templateRectangles.length} tools
                                  </p>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => previewTemplateVersion(version)}
                                    data-testid={`button-preview-template-version-${version.timestamp}`}
                                    title="Preview template overlay"
                                  >
                                    <Eye className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      if (hasUnsavedChanges) {
                                        setTemplateToLoad(version);
                                        setUnsavedWarningOpen(true);
                                      } else {
                                        loadTemplateVersion(version);
                                      }
                                    }}
                                    data-testid={`button-load-template-version-${version.timestamp}`}
                                    title="Load template to canvas"
                                  >
                                    <Upload className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => exportTemplateVersion(version)}
                                    data-testid={`button-export-template-version-${version.timestamp}`}
                                    title="Export template as file"
                                  >
                                    <Download className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => deleteTemplateVersion(version.timestamp)}
                                    data-testid={`button-delete-template-version-${version.timestamp}`}
                                    title="Delete template"
                                  >
                                    <Trash className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

            </div>
          </div>
        </div>
      </main>
      
      <CategoryManager
        open={showCategoryManager}
        onOpenChange={setShowCategoryManager}
      />
      
      <SlotImportExportModal
        open={showSlotImportExport}
        onOpenChange={setShowSlotImportExport}
        cameraId={selectedCameraId}
        cameraName={cameras?.find(c => c.id === selectedCameraId)?.name}
      />
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template Design?</AlertDialogTitle>
            <AlertDialogDescription>
              {templateToDelete && (() => {
                const version = savedTemplateVersions.find(v => v.timestamp === templateToDelete);
                return version ? (
                  <>
                    Are you sure you want to delete <strong>"{version.paperSize} - {version.name}"</strong>? 
                    This action cannot be undone.
                  </>
                ) : "Are you sure you want to delete this template design? This action cannot be undone.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteConfirmOpen(false);
              setTemplateToDelete(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteTemplateVersion}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Unsaved Changes Warning Dialog */}
      <AlertDialog open={unsavedWarningOpen} onOpenChange={setUnsavedWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes on the current canvas. Loading a new template will discard these changes. 
              Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setUnsavedWarningOpen(false);
              setTemplateToLoad(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmLoadTemplate}>
              Load Template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
