/**
 * Simple in-memory rate limiter for API routes.
 * Uses a sliding window per key (IP, businessId, etc.)
 *
 * NOTE: In-memory only — resets on cold starts in serverless.
 * For production at scale, replace with Redis-backed solution.
 *
 * Hardened for serverless:
 *  - Max entries cap prevents memory leaks across warm instances
 *  - Periodic cleanup of stale entries
 *  - Response headers helper for standard rate-limit headers
 */

const MAX_ENTRIES = 10_000;
const store = new Map<string, { count: number; resetAt: number }>();

// Cleanup stale entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) store.delete(key);
    }
  }, 5 * 60 * 1000);
}

/** Evict oldest entries when store exceeds capacity. */
function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  // Delete the oldest ~20% entries by resetAt
  const entries = [...store.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  const toDelete = Math.max(1, Math.floor(entries.length * 0.2));
  for (let i = 0; i < toDelete; i++) {
    store.delete(entries[i][0]);
  }
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check if a request is within rate limit.
 *
 * @param key - Unique identifier (e.g., IP address, businessId)
 * @param limit - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds (default: 60s)
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number = 60_000,
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    evictIfNeeded();
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Helper to extract client IP from Next.js request.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Returns standard rate-limit headers for the response.
 * Usage: `return NextResponse.json(body, { headers: rateLimitHeaders(result, limit) })`
 */
export function rateLimitHeaders(
  result: RateLimitResult,
  limit: number,
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.allowed ? {} : { 'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)) }),
  };
}
