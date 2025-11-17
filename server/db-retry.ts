type AsyncFunction<T> = () => Promise<T>;

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

const RETRYABLE_ERROR_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'CONNECTION_RESET',
  'CONNECTION_CLOSED',
];

function isRetryableError(error: any): boolean {
  if (!error) return false;

  const errorCode = error.code || error.errno;
  if (errorCode && RETRYABLE_ERROR_CODES.includes(errorCode)) {
    return true;
  }

  const errorMessage = error.message?.toLowerCase() || '';
  const retryableMessages = [
    'connection',
    'timeout',
    'network',
    'econnrefused',
    'socket',
    'closed',
  ];

  return retryableMessages.some(msg => errorMessage.includes(msg));
}

export async function withRetry<T>(
  fn: AsyncFunction<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt === opts.maxAttempts) {
        console.error(`[DB Retry] Failed after ${attempt} attempts:`, error);
        throw error;
      }

      if (!isRetryableError(error)) {
        console.error('[DB Retry] Non-retryable error:', error);
        throw error;
      }

      console.warn(
        `[DB Retry] Attempt ${attempt}/${opts.maxAttempts} failed (${error.code || error.message}). Retrying in ${delay}ms...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));

      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

export function createRetryableQuery<T extends any[], R>(
  queryFn: (...args: T) => Promise<R>,
  options?: RetryOptions
): (...args: T) => Promise<R> {
  return (...args: T) => withRetry(() => queryFn(...args), options);
}
