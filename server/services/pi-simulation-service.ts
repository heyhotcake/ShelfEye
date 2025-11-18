import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * Pi Simulation Service
 * Adds artificial delays to simulate Raspberry Pi Model B (2GB RAM, 4-core ARM) performance
 * This allows testing in Replit without deploying to actual hardware
 */
export class PiSimulationService {
  private isSimulationEnabled: boolean = true;

  // Performance multipliers (Pi ARM vs x86 server)
  private readonly CPU_SLOWDOWN = 3.5; // Pi is ~3.5x slower for image processing
  private readonly DISK_READ_DELAY = 50; // SD card is slower than SSD (ms)
  private readonly DISK_WRITE_DELAY = 100; // Writes are even slower
  private readonly OPENCV_OVERHEAD = 1.5; // Additional OpenCV overhead on ARM

  /**
   * Enable or disable simulation mode
   */
  setSimulationEnabled(enabled: boolean): void {
    this.isSimulationEnabled = enabled;
    console.log(`[Pi Simulation] Mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Check if simulation is enabled
   */
  isEnabled(): boolean {
    return this.isSimulationEnabled;
  }

  /**
   * Add artificial delay to simulate slower Pi processing
   */
  private async addDelay(baseMs: number, multiplier: number = 1): Promise<void> {
    if (!this.isSimulationEnabled) return;
    
    const delayMs = baseMs * multiplier;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  /**
   * Simulate disk read with SD card latency
   */
  async simulateDiskRead<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isSimulationEnabled) {
      await this.addDelay(this.DISK_READ_DELAY);
    }
    return await operation();
  }

  /**
   * Simulate disk write with SD card latency
   */
  async simulateDiskWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isSimulationEnabled) {
      await this.addDelay(this.DISK_WRITE_DELAY);
    }
    return await operation();
  }

  /**
   * Run Python CV script with Pi performance simulation
   * SECURITY: Uses spawn with args array to prevent command injection
   */
  async runPythonWithSimulation(
    scriptPath: string,
    args: string[],
    baseProcessingTimeMs: number = 1000
  ): Promise<{ stdout: string; stderr: string; processingTimeMs: number }> {
    const startTime = Date.now();

    // Add pre-processing delay (Python startup on Pi)
    if (this.isSimulationEnabled) {
      await this.addDelay(200); // Python interpreter startup
    }

    // Run the actual Python script safely using spawn with args array
    // This prevents command injection attacks
    const { spawn: spawnProcess } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      const process = spawnProcess('python3', [scriptPath, ...args]);
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Python script exited with code ${code}: ${stderr}`));
          return;
        }
        
        // Add post-processing delay based on operation complexity
        if (this.isSimulationEnabled) {
          const processingDelay = baseProcessingTimeMs * this.CPU_SLOWDOWN * this.OPENCV_OVERHEAD;
          await this.addDelay(processingDelay);
        }
        
        const processingTimeMs = Date.now() - startTime;
        resolve({ stdout, stderr, processingTimeMs });
      });
      
      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Validate and sanitize image path
   * SECURITY: Only allows paths in safe directories to prevent path traversal
   */
  private validateImagePath(imagePath: string): string {
    const normalizedPath = path.normalize(imagePath);
    const resolvedPath = path.resolve(normalizedPath);
    const cwd = process.cwd();
    
    // Whitelist of allowed directories
    const allowedDirs = [
      path.join(cwd, 'data', 'test-uploads'),
      path.join(cwd, 'data'),
    ];
    
    // Check if path is within allowed directories
    const isAllowed = allowedDirs.some(dir => {
      const resolvedDir = path.resolve(dir);
      return resolvedPath.startsWith(resolvedDir);
    });
    
    if (!isAllowed) {
      throw new Error('Image path not in allowed directory');
    }
    
    return resolvedPath;
  }

  /**
   * Test slot QR detection on an uploaded image with Pi simulation
   * SECURITY: Validates image path and uses safe subprocess execution
   */
  async testSlotQRDetection(
    imagePath: string,
    slotConfigs: Array<{ id: string; polygon: number[][]; qr_data: string }>
  ): Promise<{
    results: Array<{
      slotId: string;
      qrData: string;
      detected: boolean;
      qrType: 'slot' | 'worker' | null;
      detectedQrData: string | null;
    }>;
    processingTimeMs: number;
    imageSize: { width: number; height: number };
  }> {
    // SECURITY: Validate and sanitize image path before use
    const safeImagePath = this.validateImagePath(imagePath);
    console.log(`[Pi Simulation] Testing QR detection on: ${safeImagePath}`);
    const startTime = Date.now();

    // Simulate reading the image file
    await this.simulateDiskRead(async () => {
      await fs.access(safeImagePath);
    });

    // Get image dimensions (simulate image processing)
    const getImageSize = async (): Promise<{ width: number; height: number }> => {
      const pythonScript = path.join(process.cwd(), 'python', 'get_image_size.py');
      const { stdout } = await this.runPythonWithSimulation(
        pythonScript,
        [safeImagePath],
        100 // Quick operation
      );
      const [width, height] = stdout.trim().split(',').map(Number);
      return { width, height };
    };

    let imageSize = { width: 0, height: 0 };
    try {
      imageSize = await getImageSize();
    } catch (error) {
      console.log('[Pi Simulation] Could not get image size, using defaults');
      imageSize = { width: 3000, height: 2000 };
    }

    // Process each slot
    const results = [];
    for (const slot of slotConfigs) {
      console.log(`[Pi Simulation] Testing slot: ${slot.id}`);
      
      // Run validation script with simulation
      const scriptPath = path.join(process.cwd(), 'python', 'validate_slot_qrs.py');
      
      // SECURITY: Pass args as array, not shell string
      const args = [
        safeImagePath,
        JSON.stringify(slot.polygon),
        slot.qr_data,
        'true' // use_saved_rectified
      ];

      try {
        const { stdout, processingTimeMs } = await this.runPythonWithSimulation(
          scriptPath,
          args,
          300 // Base 300ms per slot on Pi
        );

        const output = stdout.trim();
        let detected = false;
        let qrType: 'slot' | 'worker' | null = null;
        let detectedQrData: string | null = null;

        if (output === 'SLOT_QR_VISIBLE') {
          detected = true;
          qrType = 'slot';
          detectedQrData = slot.qr_data;
        } else if (output.startsWith('WORKER_QR:')) {
          detected = true;
          qrType = 'worker';
          detectedQrData = output.replace('WORKER_QR:', '');
        }

        results.push({
          slotId: slot.id,
          qrData: slot.qr_data,
          detected,
          qrType,
          detectedQrData,
        });

        console.log(`[Pi Simulation] Slot ${slot.id}: ${detected ? qrType?.toUpperCase() : 'NO_QR'} (${processingTimeMs}ms)`);
      } catch (error) {
        console.error(`[Pi Simulation] Error testing slot ${slot.id}:`, error);
        results.push({
          slotId: slot.id,
          qrData: slot.qr_data,
          detected: false,
          qrType: null,
          detectedQrData: null,
        });
      }
    }

    const totalProcessingTimeMs = Date.now() - startTime;
    console.log(`[Pi Simulation] Total processing time: ${totalProcessingTimeMs}ms`);

    return {
      results,
      processingTimeMs: totalProcessingTimeMs,
      imageSize,
    };
  }

  /**
   * Get simulated memory usage (limit to Pi's 1.5GB soft limit)
   */
  getMemoryUsage(): {
    used: number;
    limit: number;
    percentUsed: number;
    warning: boolean;
  } {
    const memUsage = process.memoryUsage();
    const usedMB = memUsage.heapUsed / 1024 / 1024;
    const limitMB = this.isSimulationEnabled ? 1536 : 0; // 1.5GB Pi limit
    const percentUsed = this.isSimulationEnabled ? (usedMB / limitMB) * 100 : 0;
    const warning = percentUsed > 80; // Warn at 80% memory usage

    return {
      used: usedMB,
      limit: limitMB,
      percentUsed,
      warning,
    };
  }
}

export const piSimulationService = new PiSimulationService();
