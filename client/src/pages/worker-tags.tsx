import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Download, Printer } from "lucide-react";
import jsPDF from "jspdf";

interface Worker {
  id: string;
  workerCode: string;
  arucoId: number;
  name: string;
  team: string | null;
  isActive: boolean;
}

export default function WorkerTags() {
  const [location, navigate] = useLocation();
  const printRef = useRef<HTMLDivElement>(null);
  const [arucoImages, setArucoImages] = useState<Record<number, string>>({});
  
  // Get worker IDs from URL query params
  const params = new URLSearchParams(window.location.search);
  const workerIds = params.get('workers')?.split(',') || [];
  
  console.log('[WorkerTags] URL search:', window.location.search);
  console.log('[WorkerTags] Worker IDs from URL:', workerIds);
  
  const { data: allWorkers, isLoading } = useQuery<Worker[]>({
    queryKey: ['/api/workers'],
  });
  
  const selectedWorkers = allWorkers?.filter(w => workerIds.includes(w.id)) || [];
  
  // Duplicate each worker 3 times for printing 3 tags per worker
  const workersWithDuplicates = selectedWorkers.flatMap(worker => [
    { ...worker, copyNumber: 1 },
    { ...worker, copyNumber: 2 },
    { ...worker, copyNumber: 3 }
  ]);

  // Generate ArUco markers for all selected workers
  useEffect(() => {
    const generateMarkers = async () => {
      console.log('[WorkerTags] Generating ArUco markers for', selectedWorkers.length, 'workers (parallel)');
      
      // Generate all markers in PARALLEL to speed up on slow devices (Raspberry Pi)
      const promises = selectedWorkers.map(async (worker) => {
        try {
          console.log(`[WorkerTags] Starting ArUco ID ${worker.arucoId} for ${worker.name}`);
          const response = await fetch('/api/aruco-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              mode: 'single',
              markerId: worker.arucoId,
              markerLengthCm: 3.0  // 3cm marker size
            }),
          });
          
          const data = await response.json();
          console.log(`[WorkerTags] Response for ArUco ${worker.arucoId}:`, { ok: data.ok, hasImage: !!data.image });
          if (data.ok && data.image) {
            return { arucoId: worker.arucoId, image: data.image };
          }
          return null;
        } catch (error) {
          console.error(`Failed to generate ArUco marker for worker ${worker.name}:`, error);
          return null;
        }
      });
      
      // Wait for all requests to complete
      const results = await Promise.all(promises);
      
      // Build images object from results
      const images: Record<number, string> = {};
      results.forEach(result => {
        if (result) {
          images[result.arucoId] = result.image;
        }
      });
      
      console.log('[WorkerTags] Setting ArUco images:', Object.keys(images));
      setArucoImages(images);
    };
    
    if (selectedWorkers.length > 0) {
      generateMarkers();
    }
  }, [selectedWorkers.length]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    const pdf = new jsPDF('portrait', 'mm', 'a4');
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10; // 1cm
    const tagWidth = 40; // 4cm
    const tagHeight = 67.5; // 6.75cm
    
    // Calculate tags per page (4x4 grid centered on page)
    const tagsPerRow = 4;
    const tagsPerCol = 4;
    const tagsPerPage = tagsPerRow * tagsPerCol; // 16 tags
    
    // Center the grid within the usable area
    const gridWidth = tagsPerRow * tagWidth; // 160mm
    const gridHeight = tagsPerCol * tagHeight; // 270mm
    const usableWidth = pageWidth - 2 * margin; // 190mm
    const usableHeight = pageHeight - 2 * margin; // 277mm
    const startX = margin + (usableWidth - gridWidth) / 2; // 10mm + 15mm = 25mm
    const startY = margin + (usableHeight - gridHeight) / 2; // 10mm + 3.5mm = 13.5mm
    
    workersWithDuplicates.forEach((worker, index) => {
      if (index > 0 && index % tagsPerPage === 0) {
        pdf.addPage();
      }
      
      const pageIndex = index % tagsPerPage;
      const row = Math.floor(pageIndex / tagsPerRow);
      const col = pageIndex % tagsPerRow;
      
      const x = startX + col * tagWidth;
      const y = startY + row * tagHeight;
      
      // Draw tag border (light gray)
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.1);
      pdf.rect(x, y, tagWidth, tagHeight);
      
      // Draw scissor-cut guides (corner marks)
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.3);
      const guideLength = 3; // 3mm guide lines
      
      // Top-left corner
      pdf.line(x - 1, y, x - 1 + guideLength, y); // Horizontal
      pdf.line(x, y - 1, x, y - 1 + guideLength); // Vertical
      
      // Top-right corner
      pdf.line(x + tagWidth + 1, y, x + tagWidth + 1 - guideLength, y);
      pdf.line(x + tagWidth, y - 1, x + tagWidth, y - 1 + guideLength);
      
      // Bottom-left corner
      pdf.line(x - 1, y + tagHeight, x - 1 + guideLength, y + tagHeight);
      pdf.line(x, y + tagHeight + 1, x, y + tagHeight + 1 - guideLength);
      
      // Bottom-right corner
      pdf.line(x + tagWidth + 1, y + tagHeight, x + tagWidth + 1 - guideLength, y + tagHeight);
      pdf.line(x + tagWidth, y + tagHeight + 1, x + tagWidth, y + tagHeight + 1 - guideLength);
      
      // Add ArUco marker (3cm x 3cm, centered)
      const markerSize = 30; // 3cm
      const arucoImage = arucoImages[worker.arucoId];
      if (arucoImage) {
        const markerX = x + (tagWidth - markerSize) / 2;
        const markerY = y + (tagHeight - markerSize) / 2;
        pdf.addImage(`data:image/png;base64,${arucoImage}`, 'PNG', markerX, markerY, markerSize, markerSize);
      }
      
      // Add worker name (below ArUco marker)
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      const nameY = y + (tagHeight - markerSize) / 2 + markerSize + 5; // 5mm below marker
      pdf.text(worker.name, x + tagWidth / 2, nameY, { align: 'center' });
      
      // Add team if available
      if (worker.team) {
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text(worker.team, x + tagWidth / 2, nameY + 5, { align: 'center' });
      }
      
      // Add ArUco ID (for reference, at bottom)
      pdf.setFontSize(6);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`ID: ${worker.arucoId}`, x + tagWidth / 2, y + tagHeight - 3, { align: 'center' });
    });
    
    pdf.save('worker-tags.pdf');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading workers...</p>
      </div>
    );
  }

  if (selectedWorkers.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>No workers selected</p>
        <Button onClick={() => navigate('/workers')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Workers
        </Button>
      </div>
    );
  }

  // Calculate layout (4x4 grid centered on page)
  const pageWidth = 210; // A4 width in mm
  const pageHeight = 297; // A4 height in mm
  const margin = 10; // 1cm in mm
  const tagWidth = 40; // 4cm in mm
  const tagHeight = 67.5; // 6.75cm in mm
  
  const tagsPerRow = 4; // 4 tags horizontally
  const tagsPerCol = 4; // 4 tags vertically
  const tagsPerPage = tagsPerRow * tagsPerCol; // 16 tags per page
  
  // Center the grid within the usable area
  const gridWidth = tagsPerRow * tagWidth; // 160mm
  const gridHeight = tagsPerCol * tagHeight; // 270mm
  const usableWidth = pageWidth - 2 * margin; // 190mm
  const usableHeight = pageHeight - 2 * margin; // 277mm
  const startX = margin + (usableWidth - gridWidth) / 2; // 25mm
  const startY = margin + (usableHeight - gridHeight) / 2; // 13.5mm
  
  const totalPages = Math.ceil(workersWithDuplicates.length / tagsPerPage);
  const pages: (Worker & { copyNumber: number })[][] = [];
  for (let i = 0; i < totalPages; i++) {
    pages.push(workersWithDuplicates.slice(i * tagsPerPage, (i + 1) * tagsPerPage));
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Print controls - hidden when printing */}
      <div className="print:hidden sticky top-0 z-50 bg-background border-b p-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate('/workers')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-bold">Worker Tags</h1>
              <p className="text-sm text-muted-foreground">
                {selectedWorkers.length} worker{selectedWorkers.length !== 1 ? 's' : ''} × 3 tags = {workersWithDuplicates.length} total • {totalPages} page{totalPages !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print (supports Japanese)
            </Button>
          </div>
        </div>
      </div>

      {/* Print content */}
      <div ref={printRef} className="print:block">
        {pages.map((pageWorkers, pageIndex) => (
          <div
            key={pageIndex}
            className="relative bg-white mx-auto"
            style={{
              width: `${pageWidth}mm`,
              height: `${pageHeight}mm`,
              pageBreakAfter: pageIndex < pages.length - 1 ? 'always' : 'auto',
            }}
          >
            {/* Page margins visualization (hidden in print) */}
            <div
              className="print:hidden absolute border-2 border-dashed border-gray-300"
              style={{
                left: `${margin}mm`,
                top: `${margin}mm`,
                width: `${usableWidth}mm`,
                height: `${usableHeight}mm`,
              }}
            />

            {/* Worker tags */}
            {pageWorkers.map((worker, indexOnPage) => {
              const row = Math.floor(indexOnPage / tagsPerRow);
              const col = indexOnPage % tagsPerRow;
              const x = startX + col * tagWidth;
              const y = startY + row * tagHeight;

              return (
                <div
                  key={`${worker.id}-${worker.copyNumber}`}
                  className="absolute border border-gray-300 flex flex-col items-center justify-start p-2 bg-white"
                  style={{
                    left: `${x}mm`,
                    top: `${y}mm`,
                    width: `${tagWidth}mm`,
                    height: `${tagHeight}mm`,
                  }}
                >
                  {/* ArUco Marker - centered vertically */}
                  {arucoImages[worker.arucoId] ? (
                    <div className="flex-1 flex items-center justify-center">
                      <img
                        src={`data:image/png;base64,${arucoImages[worker.arucoId]}`}
                        alt={`ArUco ${worker.arucoId}`}
                        style={{ width: '30mm', height: '30mm' }}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <div style={{ width: '30mm', height: '30mm', border: '1px dashed #ccc' }} className="flex items-center justify-center">
                        <p className="text-xs text-gray-400">Loading...</p>
                      </div>
                    </div>
                  )}

                  {/* Worker Name - below marker */}
                  <div className="text-center pb-1">
                    <p className="font-bold" style={{ fontSize: '10pt' }}>
                      {worker.name}
                    </p>
                    {worker.team && (
                      <p className="text-gray-600" style={{ fontSize: '8pt' }}>
                        {worker.team}
                      </p>
                    )}
                  </div>

                  {/* ArUco ID (small, at bottom) */}
                  <div className="absolute bottom-0.5 text-xs text-gray-400" style={{ fontSize: '6pt' }}>
                    ID: {worker.arucoId}
                  </div>

                  {/* Scissor-cut guides (corner marks) - visible on screen and print */}
                  {/* Top-left */}
                  <div className="absolute bg-black" style={{ 
                    width: '3mm', 
                    height: '1px', 
                    left: '-1mm', 
                    top: '0' 
                  }} />
                  <div className="absolute bg-black" style={{ 
                    width: '1px', 
                    height: '3mm', 
                    left: '0', 
                    top: '-1mm' 
                  }} />
                  
                  {/* Top-right */}
                  <div className="absolute bg-black" style={{ 
                    width: '3mm', 
                    height: '1px', 
                    right: '-1mm', 
                    top: '0' 
                  }} />
                  <div className="absolute bg-black" style={{ 
                    width: '1px', 
                    height: '3mm', 
                    right: '0', 
                    top: '-1mm' 
                  }} />
                  
                  {/* Bottom-left */}
                  <div className="absolute bg-black" style={{ 
                    width: '3mm', 
                    height: '1px', 
                    left: '-1mm', 
                    bottom: '0' 
                  }} />
                  <div className="absolute bg-black" style={{ 
                    width: '1px', 
                    height: '3mm', 
                    left: '0', 
                    bottom: '-1mm' 
                  }} />
                  
                  {/* Bottom-right */}
                  <div className="absolute bg-black" style={{ 
                    width: '3mm', 
                    height: '1px', 
                    right: '-1mm', 
                    bottom: '0' 
                  }} />
                  <div className="absolute bg-black" style={{ 
                    width: '1px', 
                    height: '3mm', 
                    right: '0', 
                    bottom: '-1mm' 
                  }} />
                </div>
              );
            })}

            {/* Page number (hidden in print) */}
            <div className="print:hidden absolute bottom-2 right-2 text-xs text-gray-400">
              Page {pageIndex + 1} of {totalPages}
            </div>
          </div>
        ))}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          
          body {
            margin: 0;
            padding: 0;
          }
          
          .print\\:hidden {
            display: none !important;
          }
          
          .print\\:block {
            display: block !important;
          }
        }
      `}</style>
    </div>
  );
}
