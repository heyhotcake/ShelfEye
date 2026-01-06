type LockType = 'preview' | 'exclusive';
type ExclusiveReason = 'calibration' | 'capture' | 'diagnostic' | 'validation';

interface CameraLock {
  cameraId: string;
  type: LockType;
  timestamp: number;
  reason?: ExclusiveReason;
}

class CameraSessionManager {
  private locks: Map<string, CameraLock> = new Map();
  private readonly PREVIEW_TIMEOUT = 5000; // 5 seconds for preview locks
  
  // Global calibration lock - ensures only one camera can calibrate at a time (2GB RAM constraint)
  private globalCalibrationLock: { cameraId: string; timestamp: number } | null = null;
  private readonly CALIBRATION_TIMEOUT = 300000; // 5 minutes max for calibration
  
  // Global capture lock - ensures only one capture run at a time
  private globalCaptureLock: { timestamp: number; reason: string } | null = null;
  private readonly CAPTURE_TIMEOUT = 660000; // 11 minutes max for capture (slightly more than scheduler timeout)

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
   * Acquire an exclusive lock for calibration/validation/capture
   * This will block all preview requests until released
   * Returns a promise that resolves after a brief delay to ensure camera is released at OS level
   */
  async acquireExclusiveLock(cameraId: string, reason: ExclusiveReason = 'calibration'): Promise<void> {
    // Set exclusive lock immediately to block NEW preview requests
    this.locks.set(cameraId, {
      cameraId,
      type: 'exclusive',
      timestamp: Date.now(),
      reason
    });
    console.log(`[CameraSessionManager] Exclusive lock (${reason}) set for camera ${cameraId} - blocking new previews`);
    
    // Wait 10 seconds to ensure any IN-FLIGHT Python preview process has fully released the camera
    // Preview operations take 4-5 seconds, and we need to wait for camera to be fully released at OS level
    // Even after a subprocess exits, OpenCV may need time before it can reopen the device
    console.log(`[CameraSessionManager] Waiting for in-flight previews to complete...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log(`[CameraSessionManager] Camera ${cameraId} should now be available for exclusive use (${reason})`);
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
      // Map reason to user-friendly message
      const reasonMap: Record<ExclusiveReason, string> = {
        calibration: 'calibration_in_progress',
        capture: 'capture_in_progress',
        diagnostic: 'diagnostic_in_progress',
        validation: 'validation_in_progress'
      };
      return { 
        locked: true, 
        type: 'exclusive', 
        reason: lock.reason ? reasonMap[lock.reason] : 'calibration_in_progress'
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

  /**
   * Acquire global capture lock - ensures only ONE capture run at a time
   * Returns true if lock acquired, false if capture/calibration is already in progress
   */
  acquireGlobalCaptureLock(reason: string = 'scheduled'): boolean {
    // Check if calibration is in progress - don't interrupt calibration
    const calibrationStatus = this.isAnyCalibrationInProgress();
    if (calibrationStatus.inProgress) {
      console.log(`[CameraSessionManager] Cannot acquire capture lock - calibration in progress for camera ${calibrationStatus.cameraId}`);
      return false;
    }
    
    // Check if capture lock exists and isn't expired
    if (this.globalCaptureLock) {
      const elapsed = Date.now() - this.globalCaptureLock.timestamp;
      
      // If lock is expired (capture took too long), release it
      if (elapsed > this.CAPTURE_TIMEOUT) {
        console.log(`[CameraSessionManager] Global capture lock expired after ${elapsed}ms, releasing`);
        this.globalCaptureLock = null;
      } else {
        // Another capture is in progress
        console.log(`[CameraSessionManager] Cannot acquire capture lock - another capture is already in progress (${this.globalCaptureLock.reason})`);
        return false;
      }
    }
    
    // Acquire the global lock
    this.globalCaptureLock = {
      timestamp: Date.now(),
      reason
    };
    console.log(`[CameraSessionManager] Global capture lock acquired (${reason})`);
    return true;
  }

  /**
   * Release the global capture lock
   */
  releaseGlobalCaptureLock(): void {
    if (this.globalCaptureLock) {
      console.log(`[CameraSessionManager] Global capture lock released`);
      this.globalCaptureLock = null;
    }
  }

  /**
   * Check if scheduled capture is in progress
   */
  isScheduledCaptureInProgress(): { inProgress: boolean; reason?: string } {
    if (this.globalCaptureLock) {
      const elapsed = Date.now() - this.globalCaptureLock.timestamp;
      if (elapsed <= this.CAPTURE_TIMEOUT) {
        return { 
          inProgress: true, 
          reason: this.globalCaptureLock.reason
        };
      }
    }
    return { inProgress: false };
  }

  /**
   * Release all locks for a camera (cleanup on failure/timeout)
   */
  releaseAllLocksForCamera(cameraId: string): void {
    const lock = this.locks.get(cameraId);
    if (lock) {
      console.log(`[CameraSessionManager] Force-releasing all locks for camera ${cameraId}`);
      this.locks.delete(cameraId);
    }
  }
}

// Singleton instance
export const cameraSessionManager = new CameraSessionManager();
