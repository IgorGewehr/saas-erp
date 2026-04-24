/**
 * Per-tenant circuit breaker for the AI agent.
 *
 * When the agent fails repeatedly for a tenant (LLM errors, tool errors,
 * budget-exceeded cascade), we trip the breaker and skip invocations for a
 * cool-down period. Prevents:
 *   - Burning tokens on known-broken flows (e.g. expired OpenAI key).
 *   - Cascading bad messages to the customer during a Firestore outage.
 *   - Alert fatigue from the same error 500 times.
 *
 * State document: `agentCircuits/{businessId}` with:
 *   {
 *     consecutiveFailures: number,
 *     openUntil?: string (ISO),
 *     lastError?: string,
 *     lastStatusChangeAt: string,
 *   }
 *
 * Policy (conservative):
 *   closed → open after 5 consecutive failures
 *   open for 5 minutes
 *   then half-open (next call is a probe); success → closed, failure → back to open
 */

import { adminDb } from '@/lib/config/firebaseAdmin';

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 5 * 60 * 1000;

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitDoc {
  consecutiveFailures: number;
  openUntil?: string;
  lastError?: string;
  lastStatusChangeAt: string;
}

export interface CircuitStatus {
  state: CircuitState;
  consecutiveFailures: number;
  openUntil?: string;
  lastError?: string;
}

function _ref(businessId: string) {
  return adminDb.collection('agentCircuits').doc(businessId);
}

/**
 * Snapshot the current breaker state for a tenant. Does not modify anything.
 */
export async function getCircuitStatus(businessId: string): Promise<CircuitStatus> {
  const snap = await _ref(businessId).get();
  if (!snap.exists) {
    return { state: 'closed', consecutiveFailures: 0 };
  }
  const data = snap.data() as CircuitDoc;
  const now = Date.now();
  const openUntilMs = data.openUntil ? new Date(data.openUntil).getTime() : 0;

  if (openUntilMs > now) {
    return {
      state: 'open',
      consecutiveFailures: data.consecutiveFailures || 0,
      openUntil: data.openUntil,
      lastError: data.lastError,
    };
  }

  // Past the open window — the next call is the probe
  if (data.openUntil) {
    return {
      state: 'half-open',
      consecutiveFailures: data.consecutiveFailures || 0,
      lastError: data.lastError,
    };
  }

  return {
    state: 'closed',
    consecutiveFailures: data.consecutiveFailures || 0,
  };
}

/**
 * Gate check — returns true if the call should proceed. False = circuit open.
 */
export async function isCircuitAllowed(businessId: string): Promise<boolean> {
  const status = await getCircuitStatus(businessId);
  return status.state !== 'open';
}

/**
 * Record a successful call. Closes the breaker + resets the counter.
 */
export async function recordSuccess(businessId: string): Promise<void> {
  const ref = _ref(businessId);
  const snap = await ref.get();
  if (!snap.exists) return;  // nothing to reset
  const data = snap.data() as CircuitDoc;
  if (data.consecutiveFailures === 0 && !data.openUntil) return;

  await ref.set(
    {
      consecutiveFailures: 0,
      openUntil: null,
      lastError: null,
      lastStatusChangeAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Record a failure. Trips the breaker after FAILURE_THRESHOLD consecutive hits.
 */
export async function recordFailure(businessId: string, errorMsg: string): Promise<CircuitStatus> {
  const ref = _ref(businessId);
  const now = new Date();
  return await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as CircuitDoc) : ({ consecutiveFailures: 0, lastStatusChangeAt: now.toISOString() } as CircuitDoc);

    const failures = (data.consecutiveFailures || 0) + 1;
    const shouldTrip = failures >= FAILURE_THRESHOLD;

    const next: CircuitDoc = {
      consecutiveFailures: failures,
      lastError: errorMsg.slice(0, 400),
      lastStatusChangeAt: now.toISOString(),
      ...(shouldTrip
        ? { openUntil: new Date(now.getTime() + OPEN_DURATION_MS).toISOString() }
        : data.openUntil ? { openUntil: data.openUntil } : {}),
    };
    tx.set(ref, next, { merge: true });

    return {
      state: shouldTrip || (next.openUntil && new Date(next.openUntil).getTime() > now.getTime()) ? 'open' : 'closed',
      consecutiveFailures: failures,
      openUntil: next.openUntil,
      lastError: next.lastError,
    } as CircuitStatus;
  });
}

/**
 * Admin reset — clears the breaker manually. Used after an incident is fixed.
 */
export async function resetCircuit(businessId: string): Promise<void> {
  await _ref(businessId).set(
    {
      consecutiveFailures: 0,
      openUntil: null,
      lastError: null,
      lastStatusChangeAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
