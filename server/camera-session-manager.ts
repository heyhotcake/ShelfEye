type LockType = 'preview' | 'exclusive';

interface CameraLock {
  cameraId: string;
  type: LockType;
  timestamp: number;
}

class CameraSessionManager {
  private locks: Map<string, CameraLock> = new Map();
  private readonly PREVIEW_TIMEOUT = 5000; // 5 seconds for preview locks

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
    // Clear any existing locks
    this.locks.delete(cameraId);
    
    // Wait 500ms to ensure any Python preview process has fully released the camera
    await new Promise(resolve => setTimeout(resolve, 500));
    
    this.locks.set(cameraId, {
      cameraId,
      type: 'exclusive',
      timestamp: Date.now()
    });
    console.log(`[CameraSessionManager] Exclusive lock acquired for camera ${cameraId}`);
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
}

// Singleton instance
export const cameraSessionManager = new CameraSessionManager();
