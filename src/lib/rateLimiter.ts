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

  // Refill whole intervals only; the leftover carries into the next call.
  const elapsed = now - bucket.lastRefill;
  const intervals = Math.floor(elapsed / REFILL_INTERVAL);
  if (intervals > 0) {
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + intervals * REFILL_RATE);
    bucket.lastRefill += intervals * REFILL_INTERVAL;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  const retryAfterMs = REFILL_INTERVAL - ((now - bucket.lastRefill) % REFILL_INTERVAL);
  return { allowed: false, retryAfterMs };
}

export function resetRateLimits(): void {
  buckets.clear();
}
