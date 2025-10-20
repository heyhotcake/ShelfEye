import { db } from '../server/db.js';
import { cameras, templateRectangles, toolCategories, slots } from '../shared/schema.js';
import { eq } from 'drizzle-orm';

interface Point {
  x: number;
  y: number;
}

interface TemplateRect {
  xCm: number;
  yCm: number;
  widthCm: number;
  heightCm: number;
  rotation: number;
}

function transformTemplateToPixels(
  template: TemplateRect,
  homographyMatrix: number[]
): number[][] {
  if (!homographyMatrix || homographyMatrix.length !== 9) {
    throw new Error('Invalid homography matrix');
  }

  const corners = getRectangleCorners(template);
  
  const transformedCorners = corners.map(corner => {
    return applyHomography(corner, homographyMatrix);
  });

  return transformedCorners.map(p => [p.x, p.y]);
}

function getRectangleCorners(rect: TemplateRect): Point[] {
  const { xCm, yCm, widthCm, heightCm, rotation } = rect;
  
  const centerX = xCm;
  const centerY = yCm;
  
  const halfW = widthCm / 2;
  const halfH = heightCm / 2;
  
  const angleRad = (rotation * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  
  const corners: Point[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  
  return corners.map(corner => ({
    x: centerX + corner.x * cos - corner.y * sin,
    y: centerY + corner.x * sin + corner.y * cos,
  }));
}

function applyHomography(point: Point, H: number[]): Point {
  const x = point.x;
  const y = point.y;
  
  const xPrime = H[0] * x + H[1] * y + H[2];
  const yPrime = H[3] * x + H[4] * y + H[5];
  const w = H[6] * x + H[7] * y + H[8];
  
  return {
    x: xPrime / w,
    y: yPrime / w,
  };
}

async function createMissingSlots() {
  try {
    const cameraId = '77fa17c2-5109-43ed-8f43-b0b1aec5703f';
    
    // Get camera with homography matrix
    const cameraResult = await db.select().from(cameras).where(eq(cameras.id, cameraId));
    const camera = cameraResult[0];
    
    if (!camera || !camera.homographyMatrix) {
      console.error('Camera not found or not calibrated');
      process.exit(1);
    }
    
    console.log('Camera found with homography matrix');
    
    // Get all template rectangles for this camera
    const templates = await db.select().from(templateRectangles).where(eq(templateRectangles.cameraId, cameraId));
    console.log(`Found ${templates.length} template rectangles`);
    
    // Get all existing slots
    const existingSlots = await db.select().from(slots).where(eq(slots.cameraId, cameraId));
    const existingSlotIds = new Set(existingSlots.map(s => s.slotId));
    console.log(`Found ${existingSlots.length} existing slots: ${Array.from(existingSlotIds).join(', ')}`);
    
    // Get all tool categories
    const categories = await db.select().from(toolCategories);
    const categoryMap = new Map(categories.map(c => [c.id, c]));
    
    // Create slots for template rectangles that don't have slots yet
    const missingTemplates = templates.filter(t => t.autoQrId && !existingSlotIds.has(t.autoQrId));
    console.log(`Found ${missingTemplates.length} templates without slots: ${missingTemplates.map(t => t.autoQrId).join(', ')}`);
    
    for (const template of missingTemplates) {
      const category = categoryMap.get(template.categoryId);
      if (!category) {
        console.warn(`Category not found for template ${template.id}`);
        continue;
      }
      
      console.log(`\nCreating slot for ${template.autoQrId}...`);
      console.log(`  Position: (${template.xCm}, ${template.yCm}) cm`);
      console.log(`  Dimensions: ${category.widthCm} x ${category.heightCm} cm`);
      console.log(`  Rotation: ${template.rotation}°`);
      
      const pixelCoords = transformTemplateToPixels({
        xCm: template.xCm,
        yCm: template.yCm,
        widthCm: category.widthCm,
        heightCm: category.heightCm,
        rotation: template.rotation,
      }, camera.homographyMatrix);
      
      console.log(`  Pixel coords: ${JSON.stringify(pixelCoords)}`);
      
      const result = await db.insert(slots).values({
        slotId: template.autoQrId!,
        cameraId: cameraId,
        toolName: category.name,
        expectedQrId: template.autoQrId!,
        priority: 'high',
        regionCoords: pixelCoords,
        allowCheckout: true,
        graceWindow: '08:00-17:00',
      }).returning();
      
      console.log(`  ✓ Created slot: ${result[0].id}`);
      
      // Update template rectangle with slot ID
      await db.update(templateRectangles).set({
        slotId: result[0].id,
      }).where(eq(templateRectangles.id, template.id));
      
      console.log(`  ✓ Linked template to slot`);
    }
    
    console.log(`\n✅ Done! Created ${missingTemplates.length} new slots.`);
    
  } catch (error) {
    console.error('Error creating slots:', error);
    process.exit(1);
  }
}

createMissingSlots();
