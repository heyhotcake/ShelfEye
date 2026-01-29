import CircuitBreaker from 'opossum';

/**
 * Circuit breakers for external services (Gmail, Sheets)
 * Prevents cascading failures when external services are down
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests fail immediately
 * - HALF_OPEN: Testing if service recovered
 * 
 * Benefits:
 * - Fail fast when service is down (no request pileup)
 * - Automatic recovery detection
 * - Prevents memory exhaustion from queued requests
 */

interface CircuitBreakerOptions {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  volumeThreshold: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  timeout: 10000, // 10 second timeout per request
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 30000, // Try again after 30 seconds
  volumeThreshold: 5, // Minimum requests before circuit can open
};

// Store for fallback queued items when circuit is open
interface FallbackQueueItem {
  service: 'gmail' | 'sheets';
  fn: () => Promise<any>;
  timestamp: number;
}

const fallbackQueue: FallbackQueueItem[] = [];

/**
 * Create a circuit breaker for an async function
 */
export function createCircuitBreaker<T>(
  fn: (...args: any[]) => Promise<T>,
  name: string,
  options: Partial<CircuitBreakerOptions> = {}
): CircuitBreaker<any[], T> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  
  const breaker = new CircuitBreaker(fn, {
    timeout: mergedOptions.timeout,
    errorThresholdPercentage: mergedOptions.errorThresholdPercentage,
    resetTimeout: mergedOptions.resetTimeout,
    volumeThreshold: mergedOptions.volumeThreshold,
    name,
  });
  
  // Event logging
  breaker.on('success', () => {
    console.log(`[CircuitBreaker] ${name}: Request succeeded`);
  });
  
  breaker.on('timeout', () => {
    console.warn(`[CircuitBreaker] ${name}: Request timed out`);
  });
  
  breaker.on('reject', () => {
    console.warn(`[CircuitBreaker] ${name}: Request rejected (circuit open)`);
  });
  
  breaker.on('open', () => {
    console.error(`[CircuitBreaker] ${name}: Circuit OPENED - requests will fail fast for ${mergedOptions.resetTimeout}ms`);
  });
  
  breaker.on('halfOpen', () => {
    console.log(`[CircuitBreaker] ${name}: Circuit HALF-OPEN - testing recovery...`);
  });
  
  breaker.on('close', () => {
    console.log(`[CircuitBreaker] ${name}: Circuit CLOSED - service recovered`);
  });
  
  breaker.on('fallback', (result: any) => {
    console.log(`[CircuitBreaker] ${name}: Using fallback, queued for retry`);
  });
  
  return breaker;
}

/**
 * Get circuit breaker statistics for monitoring
 */
export function getCircuitStats(breaker: CircuitBreaker<any[], any>) {
  const stats = breaker.stats;
  return {
    state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
    successes: stats.successes,
    failures: stats.failures,
    timeouts: stats.timeouts,
    rejects: stats.rejects,
    fallbacks: stats.fallbacks,
    latencyMean: stats.latencyMean,
    percentiles: stats.percentiles,
  };
}

/**
 * Queue an item for later retry when circuit is open
 */
export function queueForFallback(
  service: 'gmail' | 'sheets',
  fn: () => Promise<any>
) {
  fallbackQueue.push({
    service,
    fn,
    timestamp: Date.now(),
  });
  
  // Limit queue size to prevent memory issues
  if (fallbackQueue.length > 100) {
    const removed = fallbackQueue.shift();
    console.warn(`[CircuitBreaker] Fallback queue full, dropping oldest item from ${removed?.service}`);
  }
}

/**
 * Get fallback queue statistics
 */
export function getFallbackQueueStats() {
  const gmailCount = fallbackQueue.filter(i => i.service === 'gmail').length;
  const sheetsCount = fallbackQueue.filter(i => i.service === 'sheets').length;
  
  return {
    total: fallbackQueue.length,
    gmail: gmailCount,
    sheets: sheetsCount,
    oldestAge: fallbackQueue.length > 0 
      ? Date.now() - fallbackQueue[0].timestamp 
      : null,
  };
}

/**
 * Process fallback queue items (call when circuit closes)
 */
export async function processFallbackQueue(service: 'gmail' | 'sheets'): Promise<number> {
  const items = fallbackQueue.filter(i => i.service === service);
  let processed = 0;
  
  for (const item of items) {
    try {
      await item.fn();
      processed++;
      // Remove from queue
      const index = fallbackQueue.indexOf(item);
      if (index > -1) {
        fallbackQueue.splice(index, 1);
      }
    } catch (error) {
      console.warn(`[CircuitBreaker] Failed to process fallback item:`, error);
      break; // Stop processing if we hit an error
    }
  }
  
  return processed;
}

/**
 * Set up auto-processing of fallback queue when circuit closes
 */
export function setupCircuitBreakerQueueDrain(
  breaker: CircuitBreaker<any[], any>,
  service: 'gmail' | 'sheets'
) {
  breaker.on('close', async () => {
    console.log(`[CircuitBreaker] ${service} circuit closed - draining fallback queue`);
    const processed = await processFallbackQueue(service);
    if (processed > 0) {
      console.log(`[CircuitBreaker] Processed ${processed} ${service} fallback items`);
    }
  });
  
  breaker.on('halfOpen', async () => {
    console.log(`[CircuitBreaker] ${service} circuit half-open - testing recovery`);
  });
}

console.log('[CircuitBreaker] Circuit breaker service initialized');
