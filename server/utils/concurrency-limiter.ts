/**
 * Concurrency limiter for camera operations on 2GB Raspberry Pi
 * 
 * Ensures only one camera operation (calibration, capture, preview, validation)
 * runs at a time to prevent memory exhaustion from concurrent OpenCV processes.
 */

class CameraOperationLimiter {
  private activeOperations = 0;
  private readonly maxConcurrent = 1;
  private waitQueue: Array<() => void> = [];
  private currentOperation: string | null = null;

  async acquire(operationName: string): Promise<void> {
    if (this.activeOperations >= this.maxConcurrent) {
      console.log(`[CameraLimiter] Operation "${operationName}" waiting - "${this.currentOperation}" in progress`);
      
      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }
    
    this.activeOperations++;
    this.currentOperation = operationName;
    console.log(`[CameraLimiter] Acquired lock for "${operationName}"`);
  }

  release(operationName: string): void {
    this.activeOperations--;
    console.log(`[CameraLimiter] Released lock for "${operationName}"`);
    
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) {
        next();
      }
    } else {
      this.currentOperation = null;
    }
  }

  isLocked(): boolean {
    return this.activeOperations >= this.maxConcurrent;
  }

  getCurrentOperation(): string | null {
    return this.currentOperation;
  }

  getQueueLength(): number {
    return this.waitQueue.length;
  }
}

export const cameraLimiter = new CameraOperationLimiter();
