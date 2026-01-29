import Bottleneck from 'bottleneck';

/**
 * Rate limiters for external API calls to prevent quota exhaustion
 * 
 * Gmail API quotas:
 * - 250 quota units per user per second
 * - messages.send costs 100 units
 * - Effective: ~2-3 sends/second, we limit to 1/sec for safety
 * 
 * Google Sheets API quotas:
 * - 100 requests per 100 seconds per user
 * - We limit to 10 req/sec with some buffer
 */

export const gmailLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000, // 1 request per second (safe margin for 250 units/sec)
  reservoir: 50, // Max 50 emails per minute
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000, // Refresh every minute
});

export const sheetsLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 200, // 5 requests per second (conservative for 100/100s quota)
  reservoir: 80, // Max 80 requests per 100 seconds
  reservoirRefreshAmount: 80,
  reservoirRefreshInterval: 100 * 1000, // Refresh every 100 seconds
});

// Log rate limiter events for monitoring
gmailLimiter.on('failed', (error, jobInfo) => {
  console.warn(`[RateLimiter] Gmail job ${jobInfo.options.id} failed:`, error);
});

gmailLimiter.on('retry', (error, jobInfo) => {
  console.log(`[RateLimiter] Gmail job ${jobInfo.options.id} retrying...`);
});

gmailLimiter.on('depleted', () => {
  console.warn('[RateLimiter] Gmail rate limit reservoir depleted - requests will be queued');
});

sheetsLimiter.on('failed', (error, jobInfo) => {
  console.warn(`[RateLimiter] Sheets job ${jobInfo.options.id} failed:`, error);
});

sheetsLimiter.on('depleted', () => {
  console.warn('[RateLimiter] Sheets rate limit reservoir depleted - requests will be queued');
});

/**
 * Wrap a Gmail API call with rate limiting
 */
export async function rateLimitedGmail<T>(
  fn: () => Promise<T>,
  jobId?: string
): Promise<T> {
  return gmailLimiter.schedule({ id: jobId }, fn);
}

/**
 * Wrap a Google Sheets API call with rate limiting
 */
export async function rateLimitedSheets<T>(
  fn: () => Promise<T>,
  jobId?: string
): Promise<T> {
  return sheetsLimiter.schedule({ id: jobId }, fn);
}

/**
 * Get current rate limiter statistics
 */
export function getRateLimiterStats() {
  return {
    gmail: {
      running: gmailLimiter.running(),
      queued: gmailLimiter.queued(),
    },
    sheets: {
      running: sheetsLimiter.running(),
      queued: sheetsLimiter.queued(),
    },
  };
}

console.log('[RateLimiter] Gmail and Sheets rate limiters initialized');
