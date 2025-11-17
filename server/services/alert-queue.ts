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

export class AlertRetryQueue {
  private storage: IStorage;
  private sheetsLogger: SheetsLogger;
  private queue: Map<string, QueuedAlert> = new Map();
  private retryIntervalMs = 60000; // Check every 1 minute
  private maxRetryDurationMs = 24 * 60 * 60 * 1000; // 24 hours
  private retryTimer?: NodeJS.Timeout;
  
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
      maxRetries: 10, // Max 10 retries with exponential backoff
      data: { emailType, subject, details }
    };
    
    this.queue.set(id, alert);
    await this.saveQueueToStorage();
    console.log(`[AlertQueue] Queued email alert: ${id} (${emailType})`);
  }
  
  async queueSheetsAlert(alertData: any) {
    const id = `sheets-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const alert: QueuedAlert = {
      id,
      type: 'sheets',
      createdAt: Date.now(),
      retryCount: 0,
      nextRetryAt: Date.now() + 60000, // Retry in 1 minute
      maxRetries: 10,
      data: alertData
    };
    
    this.queue.set(id, alert);
    await this.saveQueueToStorage();
    console.log(`[AlertQueue] Queued sheets alert: ${id}`);
  }
  
  private startRetryProcessor() {
    this.retryTimer = setInterval(async () => {
      await this.processRetries();
    }, this.retryIntervalMs);
    console.log('[AlertQueue] Retry processor interval started (60s)');
  }
  
  private async processRetries() {
    const now = Date.now();
    const alertsToRetry = Array.from(this.queue.values()).filter(
      alert => alert.nextRetryAt <= now
    );
    
    if (alertsToRetry.length === 0) {
      // Queue is empty or no alerts ready for retry - processor is idle but running
      console.log(`[AlertQueue] Retry processor tick (${this.queue.size} queued, 0 ready for retry)`);
      return;
    }
    
    console.log(`[AlertQueue] Processing ${alertsToRetry.length} queued alerts...`);
    
    for (const alert of alertsToRetry) {
      const age = now - alert.createdAt;
      
      // Check if alert has exceeded max duration
      if (age > this.maxRetryDurationMs) {
        console.error(`[AlertQueue] Alert ${alert.id} exceeded 24hr timeout - removing from queue`);
        this.queue.delete(alert.id);
        await this.saveQueueToStorage();
        continue;
      }
      
      // Check if exceeded max retries
      if (alert.retryCount >= alert.maxRetries) {
        console.error(`[AlertQueue] Alert ${alert.id} exceeded max retries (${alert.maxRetries}) - removing from queue`);
        this.queue.delete(alert.id);
        await this.saveQueueToStorage();
        continue;
      }
      
      // Attempt retry
      const success = await this.retryAlert(alert);
      
      if (success) {
        // Remove from queue on success
        this.queue.delete(alert.id);
        console.log(`[AlertQueue] Alert ${alert.id} delivered successfully - removed from queue`);
      } else {
        // Update retry count and schedule next retry with exponential backoff
        alert.retryCount++;
        const backoffMs = Math.min(
          60000 * Math.pow(2, alert.retryCount), // Exponential: 1min, 2min, 4min, 8min, 16min, etc.
          60 * 60 * 1000 // Cap at 1 hour
        );
        alert.nextRetryAt = now + backoffMs;
        
        console.log(
          `[AlertQueue] Alert ${alert.id} retry ${alert.retryCount}/${alert.maxRetries} failed - ` +
          `next retry in ${Math.round(backoffMs / 60000)} minutes`
        );
      }
      
      await this.saveQueueToStorage();
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
    
    for (const alert of this.queue.values()) {
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
