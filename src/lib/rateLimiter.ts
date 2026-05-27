// ─── Rate Limiter ───
// Simple in-memory token bucket per tool ID

interface BucketState {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, BucketState>();

const MAX_TOKENS = 10;     // max burst
const REFILL_RATE = 2;     // tokens per second
const REFILL_INTERVAL = 1000; // ms

export function checkRateLimit(toolId: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let bucket = buckets.get(toolId);

  if (!bucket) {
    bucket = { tokens: MAX_TOKENS, lastRefill: now };
    buckets.set(toolId, bucket);
  }

  // Refill tokens
  const elapsed = now - bucket.lastRefill;
  const refill = Math.floor(elapsed / REFILL_INTERVAL) * REFILL_RATE;
  if (refill > 0) {
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  const retryAfterMs = Math.ceil((1 / REFILL_RATE) * REFILL_INTERVAL);
  return { allowed: false, retryAfterMs };
}

export function resetRateLimits(): void {
  buckets.clear();
}
