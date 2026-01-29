import { IStorage } from '../storage';
import { sendAlertEmail } from './email-alerts';
import { SheetsLogger } from './sheets-logger';

interface QueuedAlert {
  id: string;
  type: 'email' | 'sheets';
  createdAt: number;
  retryCount: number;
  nextRetryAt: number;
  maxRetries: number;
  data: any;
}

/**
 * Simple async mutex for serializing queue operations
 * Prevents concurrent modifications from creating race conditions in persistence
 */
class AsyncMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    // Wait for lock to be released
    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  unlock(): void {
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift()!;
      resolve();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Retry queue for failed email and Google Sheets alerts
 * Provides exponential backoff and automatic retry with persistence
 * Uses AsyncMutex to prevent concurrent queue modifications and race conditions
 * 
 * ## Production Considerations
 * 
 * ### Edge Case 1: Long Retry Handlers (>5 minutes)
 * - Alerts are marked "in-flight" with a 5-minute buffer during processing
 * - If a single retry takes longer than 5 minutes (e.g., slow email server),
 *   the next retry cycle may attempt to process the same alert again
 * - Mitigation: Monitor retry handler execution time; extend IN_FLIGHT_BUFFER_MS if needed
 * - Impact: Potential duplicate email/sheets logging (rare, requires >5min network delays)
 * 
 * ### Edge Case 2: setConfig Persistence Failures
 * - If storage.setConfig() fails during Phase 3 commit, in-memory queue advances
 *   but storage state remains outdated
 * - Mitigation: Logs "[AlertQueue] Failed to commit retry results" for monitoring
 * - Impact: Queue diverges from storage until next successful save; alerts may be
 *   reprocessed after server restart (duplicate delivery risk)
 * - Recovery: Next successful queue modification will resync storage state
 * 
 * ### Monitoring Recommendations
 * - Alert on repeated "Failed to commit retry results" errors
 * - Track retry handler execution times via logs
 * - Monitor queue size growth (indicates persistent delivery failures)
 */
export class AlertRetryQueue {
  private storage: IStorage;
  private sheetsLogger: SheetsLogger;
  private queue: Map<string, QueuedAlert> = new Map();
  private retryIntervalMs = 60000; // Check every 1 minute
  private maxRetryDurationMs = 7 * 24 * 60 * 60 * 1000; // 7 days - extended window for flaky networks
  private retryTimer?: NodeJS.Timeout;
  private queueMutex = new AsyncMutex(); // Serialize queue modifications
  
  constructor(storage: IStorage, sheetsLogger: SheetsLogger) {
    this.storage = storage;
    this.sheetsLogger = sheetsLogger;
  }
  
  async start() {
    console.log('[AlertQueue] Starting alert retry queue processor');
    await this.loadQueueFromStorage();
    this.startRetryProcessor();
  }
  
  stop() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
    }
    console.log('[AlertQueue] Stopped alert retry queue processor');
  }
  
  private async loadQueueFromStorage() {
    try {
      const queueData = await this.storage.getConfigByKey('ALERT_RETRY_QUEUE');
      if (queueData && queueData.value) {
        const items = queueData.value as Array<[string, QueuedAlert]>;
        this.queue = new Map(items);
        console.log(`[AlertQueue] Loaded ${this.queue.size} queued alerts from storage`);
      }
    } catch (error) {
      console.warn('[AlertQueue] Failed to load queue from storage:', error);
    }
  }
  
  private async saveQueueToStorage() {
    try {
      const items = Array.from(this.queue.entries());
      await this.storage.setConfig('ALERT_RETRY_QUEUE', items);
    } catch (error) {
      console.error('[AlertQueue] Failed to save queue to storage:', error);
      throw error; // Re-throw so callers know the save failed
    }
  }
  
  async queueEmailAlert(emailType: string, subject: string, details: any) {
    const id = `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const alert: QueuedAlert = {
      id,
      type: 'email',
      createdAt: Date.now(),
      retryCount: 0,
      nextRetryAt: Date.now() + 60000, // Retry in 1 minute
      maxRetries: 100, // Extended horizon for flaky networks
      data: { emailType, subject, details }
    };
    
    // Acquire lock to serialize queue modifications
    await this.queueMutex.lock();
    try {
      // Add to queue and persist atomically
      this.queue.set(id, alert);
      const items = Array.from(this.queue.entries());
      await this.storage.setConfig('ALERT_RETRY_QUEUE', items);
      console.log(`[AlertQueue] Queued email alert: ${id} (${emailType})`);
    } catch (error) {
      // Rollback in-memory change on save failure
      this.queue.delete(id);
      console.error(`[AlertQueue] Failed to queue email alert ${id} - save failed:`, error);
      throw error; // Propagate error so caller knows the alert wasn't queued
    } finally {
      this.queueMutex.unlock();
    }
  }
  
  async queueSheetsAlert(alertData: any) {
    const id = `sheets-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const alert: QueuedAlert = {
      id,
      type: 'sheets',
      createdAt: Date.now(),
      retryCount: 0,
      nextRetryAt: Date.now() + 60000, // Retry in 1 minute
      maxRetries: 100, // Extended horizon for flaky networks
      data: alertData
    };
    
    // Acquire lock to serialize queue modifications
    await this.queueMutex.lock();
    try {
      // Add to queue and persist atomically
      this.queue.set(id, alert);
      const items = Array.from(this.queue.entries());
      await this.storage.setConfig('ALERT_RETRY_QUEUE', items);
      console.log(`[AlertQueue] Queued sheets alert: ${id}`);
    } catch (error) {
      // Rollback in-memory change on save failure
      this.queue.delete(id);
      console.error(`[AlertQueue] Failed to queue sheets alert ${id} - save failed:`, error);
      throw error; // Propagate error so caller knows the alert wasn't queued
    } finally {
      this.queueMutex.unlock();
    }
  }
  
  private startRetryProcessor() {
    this.retryTimer = setInterval(async () => {
      await this.processRetries();
    }, this.retryIntervalMs);
    console.log('[AlertQueue] Retry processor interval started (60s)');
  }
  
  private async processRetries() {
    const now = Date.now();
    const IN_FLIGHT_BUFFER_MS = 5 * 60 * 1000; // 5 minutes - prevents overlapping cycles
    
    // Phase 1: Acquire lock, snapshot alerts to process, mark as in-flight, release lock
    await this.queueMutex.lock();
    const alertsToRetry = Array.from(this.queue.values()).filter(
      alert => alert.nextRetryAt <= now
    );
    
    // Mark alerts as in-flight to prevent overlapping retry cycles
    for (const alert of alertsToRetry) {
      alert.nextRetryAt = now + IN_FLIGHT_BUFFER_MS;
    }
    
    // Persist in-flight markers immediately (prevents concurrent processing)
    if (alertsToRetry.length > 0) {
      try {
        const items = Array.from(this.queue.entries());
        await this.storage.setConfig('ALERT_RETRY_QUEUE', items);
      } catch (error) {
        console.error('[AlertQueue] Failed to mark alerts as in-flight:', error);
        // Restore original nextRetryAt values since we couldn't persist
        for (const alert of alertsToRetry) {
          alert.nextRetryAt = now; // Will be retried next cycle
        }
        this.queueMutex.unlock();
        return;
      }
    }
    
    this.queueMutex.unlock();
    
    if (alertsToRetry.length === 0) {
      // Queue is empty or no alerts ready for retry - processor is idle but running
      console.log(`[AlertQueue] Retry processor tick (${this.queue.size} queued, 0 ready for retry)`);
      return;
    }
    
    console.log(`[AlertQueue] Processing ${alertsToRetry.length} queued alerts...`);
    
    // Phase 2: Process alerts without holding lock (network IO operations)
    // Store results for later commit
    const results = new Map<string, {action: 'delete' | 'update', retryCount?: number, nextRetryAt?: number}>();
    
    for (const alert of alertsToRetry) {
      const age = now - alert.createdAt;
      
      // Check if alert has exceeded max duration (7 days)
      if (age > this.maxRetryDurationMs) {
        console.error(`[AlertQueue] Alert ${alert.id} exceeded 7-day timeout - marking for deletion`);
        results.set(alert.id, { action: 'delete' });
        continue;
      }
      
      // Check if exceeded max retries
      if (alert.retryCount >= alert.maxRetries) {
        console.error(`[AlertQueue] Alert ${alert.id} exceeded max retries (${alert.maxRetries}) - marking for deletion`);
        results.set(alert.id, { action: 'delete' });
        continue;
      }
      
      // Attempt retry (network IO - done without lock)
      const success = await this.retryAlert(alert);
      
      if (success) {
        console.log(`[AlertQueue] Alert ${alert.id} delivered successfully - marking for deletion`);
        results.set(alert.id, { action: 'delete' });
      } else {
        // Schedule next retry with exponential backoff
        const newRetryCount = alert.retryCount + 1;
        const backoffMs = Math.min(
          60000 * Math.pow(2, newRetryCount), // Exponential: 1min, 2min, 4min, 8min, 16min, etc.
          60 * 60 * 1000 // Cap at 1 hour
        );
        const newNextRetryAt = now + backoffMs;
        
        console.log(
          `[AlertQueue] Alert ${alert.id} retry ${newRetryCount}/${alert.maxRetries} failed - ` +
          `next retry in ${Math.round(backoffMs / 60000)} minutes`
        );
        results.set(alert.id, { action: 'update', retryCount: newRetryCount, nextRetryAt: newNextRetryAt });
      }
    }
    
    // Phase 3: Acquire lock, apply all changes, persist, release lock
    if (results.size > 0) {
      await this.queueMutex.lock();
      try {
        // Apply all changes to in-memory queue
        for (const [id, result] of results.entries()) {
          if (result.action === 'delete') {
            this.queue.delete(id);
          } else if (result.action === 'update') {
            const alert = this.queue.get(id);
            if (alert && result.retryCount !== undefined && result.nextRetryAt !== undefined) {
              alert.retryCount = result.retryCount;
              alert.nextRetryAt = result.nextRetryAt;
            }
          }
        }
        
        // Persist updated queue to storage
        const items = Array.from(this.queue.entries());
        await this.storage.setConfig('ALERT_RETRY_QUEUE', items);
        console.log(`[AlertQueue] Committed ${results.size} alert updates to storage`);
      } catch (error) {
        console.error('[AlertQueue] Failed to commit retry results to storage:', error);
        // Changes already applied to in-memory queue, but persistence failed
        // Queue will be out of sync with storage until next successful save
      } finally {
        this.queueMutex.unlock();
      }
    }
  }
  
  private async retryAlert(alert: QueuedAlert): Promise<boolean> {
    try {
      if (alert.type === 'email') {
        await sendAlertEmail({
          type: alert.data.emailType,
          subject: alert.data.subject,
          details: alert.data.details
        });
        return true;
      } else if (alert.type === 'sheets') {
        await this.sheetsLogger.logAlert(alert.data);
        return true;
      }
      return false;
    } catch (error) {
      console.warn(`[AlertQueue] Retry failed for alert ${alert.id}:`, error);
      return false;
    }
  }
  
  getQueueStats() {
    const now = Date.now();
    const stats = {
      totalQueued: this.queue.size,
      emailQueued: 0,
      sheetsQueued: 0,
      oldestAlert: null as number | null,
      nextRetryIn: null as number | null
    };
    
    let nextRetryAt = Infinity;
    let oldestCreatedAt = Infinity;
    
    const alerts = Array.from(this.queue.values());
    for (const alert of alerts) {
      if (alert.type === 'email') stats.emailQueued++;
      if (alert.type === 'sheets') stats.sheetsQueued++;
      
      if (alert.createdAt < oldestCreatedAt) {
        oldestCreatedAt = alert.createdAt;
      }
      
      if (alert.nextRetryAt < nextRetryAt) {
        nextRetryAt = alert.nextRetryAt;
      }
    }
    
    if (oldestCreatedAt !== Infinity) {
      stats.oldestAlert = now - oldestCreatedAt;
    }
    
    if (nextRetryAt !== Infinity && nextRetryAt > now) {
      stats.nextRetryIn = nextRetryAt - now;
    }
    
    return stats;
  }
}
