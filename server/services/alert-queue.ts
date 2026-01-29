import { IStorage } from '../storage';
import { sendAlertEmail } from './email-alerts';
import { SheetsLogger } from './sheets-logger';
import * as crypto from 'crypto';

interface QueuedAlert {
  id: string;
  idempotencyKey: string; // Hash of type + timestamp + message to prevent duplicates
  type: 'email' | 'sheets';
  createdAt: number;
  retryCount: number;
  nextRetryAt: number;
  maxRetries: number;
  data: any;
}

/**
 * Generate idempotency key from alert data to prevent duplicate sends
 * Uses a 5-minute time bucket to prevent both:
 * - Duplicate sends of the same alert within a short window
 * - Accidental deduplication of legitimately different alerts
 */
function generateIdempotencyKey(type: 'email' | 'sheets', data: any): string {
  // Create 5-minute time bucket (300000ms) to handle timestamp variations
  const timestamp = data.details?.timestamp || data.timestamp || '';
  let timeBucket = '';
  
  if (timestamp) {
    // Try to parse the timestamp and bucket it
    try {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        // Round to 5-minute bucket
        timeBucket = String(Math.floor(date.getTime() / 300000));
      } else {
        // If unparseable, use the raw timestamp with some normalization
        timeBucket = timestamp.replace(/:\d{2}$/, ''); // Remove seconds
      }
    } catch {
      timeBucket = timestamp.replace(/:\d{2}$/, '');
    }
  }
  
  const content = JSON.stringify({
    type,
    alertType: data.emailType || data.alertType || 'unknown',
    timeBucket, // Use bucketed time instead of raw timestamp
    cameraId: data.details?.cameraId || data.cameraId || '',
    slotId: data.details?.slotId || data.slotId || '',
    toolName: data.details?.toolName || '', // Include tool name for missing tool alerts
    // Hash the error message to catch same-error duplicates without exact match issues
    errorHash: crypto.createHash('md5')
      .update(data.details?.errorMessage || data.errorMessage || '')
      .digest('hex')
      .substring(0, 8),
  });
  
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
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
    const idempotencyKey = generateIdempotencyKey('email', { emailType, details });
    
    // Check for existing alert with same idempotency key (prevent duplicates)
    const existingAlerts = Array.from(this.queue.values());
    for (const existingAlert of existingAlerts) {
      if (existingAlert.idempotencyKey === idempotencyKey) {
        console.log(`[AlertQueue] Duplicate alert detected (idempotency key: ${idempotencyKey.substring(0, 8)}...), skipping`);
        return; // Already queued, don't duplicate
      }
    }
    
    const alert: QueuedAlert = {
      id,
      idempotencyKey,
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
      // Double-check for duplicates inside lock
      const alertsInLock = Array.from(this.queue.values());
      for (const existingAlert of alertsInLock) {
        if (existingAlert.idempotencyKey === idempotencyKey) {
          console.log(`[AlertQueue] Duplicate alert detected in lock (idempotency key: ${idempotencyKey.substring(0, 8)}...), skipping`);
          return;
        }
      }
      
      // Add to queue and persist atomically
      this.queue.set(id, alert);
      const items = Array.from(this.queue.entries());
      await this.storage.setConfig('ALERT_RETRY_QUEUE', items);
      console.log(`[AlertQueue] Queued email alert: ${id} (${emailType}) [idempotency: ${idempotencyKey.substring(0, 8)}...]`);
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
    const idempotencyKey = generateIdempotencyKey('sheets', alertData);
    
    // Check for existing alert with same idempotency key (prevent duplicates)
    const existingSheetsAlerts = Array.from(this.queue.values());
    for (const existingAlert of existingSheetsAlerts) {
      if (existingAlert.idempotencyKey === idempotencyKey) {
        console.log(`[AlertQueue] Duplicate sheets alert detected (idempotency key: ${idempotencyKey.substring(0, 8)}...), skipping`);
        return; // Already queued, don't duplicate
      }
    }
    
    const alert: QueuedAlert = {
      id,
      idempotencyKey,
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
      // Double-check for duplicates inside lock
      const sheetsAlertsInLock = Array.from(this.queue.values());
      for (const existingAlert of sheetsAlertsInLock) {
        if (existingAlert.idempotencyKey === idempotencyKey) {
          console.log(`[AlertQueue] Duplicate sheets alert detected in lock (idempotency key: ${idempotencyKey.substring(0, 8)}...), skipping`);
          return;
        }
      }
      
      // Add to queue and persist atomically
      this.queue.set(id, alert);
      const items = Array.from(this.queue.entries());
      await this.storage.setConfig('ALERT_RETRY_QUEUE', items);
      console.log(`[AlertQueue] Queued sheets alert: ${id} [idempotency: ${idempotencyKey.substring(0, 8)}...]`);
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
        const resultEntries = Array.from(results.entries());
        for (const [id, result] of resultEntries) {
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
