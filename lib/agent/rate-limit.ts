/**
 * Per-tenant rate limiter for agent-facing endpoints.
 *
 * Firestore-backed (cross-worker coherent). Uses a sliding-window counter
 * stored at `agentRateLimits/{businessId}_{window}` where window is an ISO
 * timestamp rounded to the bucket size (default 60s).
 *
 * Why Firestore and not Redis:
 *   - Zero new infra for a greenfield deployment.
 *   - Firestore transactions are ~10-30ms; acceptable overhead for the
 *     agent dispatch path (which already does multiple Firestore reads).
 *   - For hot tenants we can later swap to Upstash/Redis with the same
 *     interface. This module is the single enforcement point.
 *
 * Limits are per-tenant (cross-conversation) to prevent a runaway agent
 * from DoS-ing the tenant's Firestore quota. Per-conversation debounce
 * already lives in dispatch.ts.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export interface RateLimitConfig {
  /** Max calls allowed in the window. */
  max: number;
  /** Window size in seconds. Default 60s. */
  windowSec: number;
  /** Label used in the bucket id — keeps separate counters per surface. */
  scope: 'inbound' | 'operator' | 'reindex';
}

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  max: number;
  resetAt: string;  // ISO — when the current window ends
  retryAfterSec?: number;
}

const DEFAULTS: Record<RateLimitConfig['scope'], RateLimitConfig> = {
  inbound: { scope: 'inbound', max: 120, windowSec: 60 },         // 2 msgs/sec per tenant
  operator: { scope: 'operator', max: 30, windowSec: 60 },        // human operator — more generous per-user limit lives upstream
  reindex: { scope: 'reindex', max: 4, windowSec: 3600 },         // 4 reindex runs per hour — heavy op
};

/**
 * Attempts to consume 1 token from the tenant's bucket for `scope`.
 * Returns `allowed=false` and a retry hint when exceeded. Never throws.
 */
export async function checkRateLimit(
  businessId: string,
  scope: RateLimitConfig['scope'],
  override?: Partial<RateLimitConfig>,
): Promise<RateLimitResult> {
  const cfg = { ...DEFAULTS[scope], ...override };
  const now = Date.now();
  const windowMs = cfg.windowSec * 1000;
  const bucketTs = Math.floor(now / windowMs) * windowMs;
  const resetAt = new Date(bucketTs + windowMs).toISOString();
  const id = `${businessId}_${cfg.scope}_${bucketTs}`;
  const ref = adminDb.collection('agentRateLimits').doc(id);

  try {
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? ((snap.data() as { count?: number }).count || 0) : 0;
      if (current >= cfg.max) {
        return { allowed: false, current } as const;
      }
      tx.set(
        ref,
        {
          businessId,
          scope: cfg.scope,
          bucketTs,
          count: FieldValue.increment(1),
          // TTL hint — a scheduled cleanup can sweep docs older than window+1h
          expiresAt: bucketTs + windowMs + 60 * 60 * 1000,
        },
        { merge: true },
      );
      return { allowed: true, current: current + 1 } as const;
    });

    return {
      allowed: result.allowed,
      current: result.current,
      max: cfg.max,
      resetAt,
      retryAfterSec: result.allowed ? undefined : Math.ceil((bucketTs + windowMs - now) / 1000),
    };
  } catch (err) {
    // Firestore infra failure: fail-OPEN (allow) to avoid false rejections
    // during outages. The circuit breaker is a separate safety layer.
    console.warn('[rate-limit] firestore error, allowing:', (err as Error).message);
    return { allowed: true, current: -1, max: cfg.max, resetAt };
  }
}
