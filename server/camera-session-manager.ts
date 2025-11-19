type LockType = 'preview' | 'exclusive';

interface CameraLock {
  cameraId: string;
  type: LockType;
  timestamp: number;
}

class CameraSessionManager {
  private locks: Map<string, CameraLock> = new Map();
  private readonly PREVIEW_TIMEOUT = 5000; // 5 seconds for preview locks
  
  // Global calibration lock - ensures only one camera can calibrate at a time (2GB RAM constraint)
  private globalCalibrationLock: { cameraId: string; timestamp: number } | null = null;
  private readonly CALIBRATION_TIMEOUT = 300000; // 5 minutes max for calibration
  
  // Periodic cleanup interval
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60000; // 60 seconds

  constructor() {
    this.startPeriodicCleanup();
    this.setupShutdownHandlers();
  }

  /**
   * Start periodic cleanup of expired locks
   * Runs every 60 seconds to prevent lock leaks from crashed operations
   */
  private startPeriodicCleanup(): void {
    console.log(`[CameraSessionManager] Starting periodic lock cleanup (interval: ${this.CLEANUP_INTERVAL_MS}ms)`);
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredLocks();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Clean up expired locks that weren't explicitly released
   * Handles both camera-specific locks and the global calibration lock
   */
  private cleanupExpiredLocks(): void {
    const now = Date.now();
    const toRemove: string[] = [];
    
    // Check camera-specific locks
    for (const [cameraId, lock] of this.locks.entries()) {
      const elapsed = now - lock.timestamp;
      
      if (lock.type === 'preview' && elapsed > this.PREVIEW_TIMEOUT) {
        console.log(`[CameraSessionManager] Cleanup: Removing expired preview lock for camera ${cameraId} (age: ${Math.round(elapsed / 1000)}s)`);
        toRemove.push(cameraId);
      } else if (lock.type === 'exclusive' && elapsed > this.CALIBRATION_TIMEOUT) {
        console.log(`[CameraSessionManager] Cleanup: Removing expired exclusive lock for camera ${cameraId} (age: ${Math.round(elapsed / 1000)}s)`);
        toRemove.push(cameraId);
      }
    }
    
    // Remove expired locks
    for (const cameraId of toRemove) {
      this.locks.delete(cameraId);
    }
    
    // Check global calibration lock
    if (this.globalCalibrationLock) {
      const elapsed = now - this.globalCalibrationLock.timestamp;
      if (elapsed > this.CALIBRATION_TIMEOUT) {
        console.log(`[CameraSessionManager] Cleanup: Removing expired global calibration lock for camera ${this.globalCalibrationLock.cameraId} (age: ${Math.round(elapsed / 1000)}s)`);
        this.globalCalibrationLock = null;
      }
    }
    
    // Log status if cleanup actually happened
    if (toRemove.length > 0) {
      console.log(`[CameraSessionManager] Cleanup: Removed ${toRemove.length} expired camera locks`);
    }
  }

  /**
   * Setup graceful shutdown handlers
   * Ensures cleanup interval is cleared to prevent memory leaks
   */
  private setupShutdownHandlers(): void {
    const shutdown = () => {
      console.log('[CameraSessionManager] Shutting down...');
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
        console.log('[CameraSessionManager] Cleanup interval stopped');
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('beforeExit', shutdown);
  }

  /**
   * Attempt to acquire a lock for camera preview (shared, short-lived)
   * Returns true if lock acquired, false if camera is exclusively locked
   */
  acquirePreviewLock(cameraId: string): boolean {
    const existing = this.locks.get(cameraId);
    
    // If no lock or preview lock expired, grant it
    if (!existing || (existing.type === 'preview' && Date.now() - existing.timestamp > this.PREVIEW_TIMEOUT)) {
      this.locks.set(cameraId, {
        cameraId,
        type: 'preview',
        timestamp: Date.now()
      });
      return true;
    }

    // If exclusive lock exists, deny preview
    if (existing.type === 'exclusive') {
      return false;
    }

    // Update existing preview lock timestamp
    existing.timestamp = Date.now();
    return true;
  }

  /**
   * Acquire an exclusive lock for calibration/validation
   * This will block all preview requests until released
   * Returns a promise that resolves after a brief delay to ensure camera is released at OS level
   */
  async acquireExclusiveLock(cameraId: string): Promise<void> {
    // Set exclusive lock immediately to block NEW preview requests
    this.locks.set(cameraId, {
      cameraId,
      type: 'exclusive',
      timestamp: Date.now()
    });
    console.log(`[CameraSessionManager] Exclusive lock set for camera ${cameraId} - blocking new previews`);
    
    // Wait 10 seconds to ensure any IN-FLIGHT Python preview process has fully released the camera
    // Preview operations take 4-5 seconds, and we need to wait for camera to be fully released at OS level
    // Even after a subprocess exits, OpenCV may need time before it can reopen the device
    console.log(`[CameraSessionManager] Waiting for in-flight previews to complete...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log(`[CameraSessionManager] Camera ${cameraId} should now be available for exclusive use`);
  }

  /**
   * Release any lock for the specified camera
   */
  releaseLock(cameraId: string): void {
    const lock = this.locks.get(cameraId);
    if (lock) {
      console.log(`[CameraSessionManager] Released ${lock.type} lock for camera ${cameraId}`);
      this.locks.delete(cameraId);
    }
  }

  /**
   * Check if camera is exclusively locked
   */
  isExclusivelyLocked(cameraId: string): boolean {
    const lock = this.locks.get(cameraId);
    return lock?.type === 'exclusive' || false;
  }

  /**
   * Get current lock status for a camera
   */
  getLockStatus(cameraId: string): { locked: boolean; type?: LockType; reason?: string } {
    const lock = this.locks.get(cameraId);
    
    if (!lock) {
      return { locked: false };
    }

    if (lock.type === 'exclusive') {
      return { 
        locked: true, 
        type: 'exclusive', 
        reason: 'calibration_in_progress' 
      };
    }

    return { locked: true, type: 'preview' };
  }

  /**
   * Acquire global calibration lock - ensures only ONE camera can calibrate at a time (2GB RAM constraint)
   * Returns true if lock acquired, false if another camera is already calibrating
   */
  acquireGlobalCalibrationLock(cameraId: string): boolean {
    // Check if global lock exists and isn't expired
    if (this.globalCalibrationLock) {
      const elapsed = Date.now() - this.globalCalibrationLock.timestamp;
      
      // If lock is expired (calibration took too long), release it
      if (elapsed > this.CALIBRATION_TIMEOUT) {
        console.log(`[CameraSessionManager] Global calibration lock expired for camera ${this.globalCalibrationLock.cameraId}, releasing`);
        this.globalCalibrationLock = null;
      } else if (this.globalCalibrationLock.cameraId !== cameraId) {
        // Another camera is calibrating
        console.log(`[CameraSessionManager] Cannot acquire global calibration lock for camera ${cameraId} - camera ${this.globalCalibrationLock.cameraId} is already calibrating`);
        return false;
      }
    }
    
    // Acquire the global lock
    this.globalCalibrationLock = {
      cameraId,
      timestamp: Date.now()
    };
    console.log(`[CameraSessionManager] Global calibration lock acquired for camera ${cameraId}`);
    return true;
  }

  /**
   * Release the global calibration lock
   */
  releaseGlobalCalibrationLock(cameraId: string): void {
    if (this.globalCalibrationLock?.cameraId === cameraId) {
      console.log(`[CameraSessionManager] Global calibration lock released for camera ${cameraId}`);
      this.globalCalibrationLock = null;
    }
  }

  /**
   * Check if any camera is currently calibrating
   */
  isAnyCalibrationInProgress(): { inProgress: boolean; cameraId?: string } {
    if (this.globalCalibrationLock) {
      const elapsed = Date.now() - this.globalCalibrationLock.timestamp;
      if (elapsed <= this.CALIBRATION_TIMEOUT) {
        return { 
          inProgress: true, 
          cameraId: this.globalCalibrationLock.cameraId 
        };
      }
    }
    return { inProgress: false };
  }
}

// Singleton instance
export const cameraSessionManager = new CameraSessionManager();
