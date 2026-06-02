/**
 * HMAC authentication for agent↔Next.js server-to-server calls.
 *
 * Scheme:
 *   message    = `${timestamp}.${businessId}.${rawBody}`
 *   signature  = hex(HMAC-SHA256(AGENT_SHARED_SECRET, message))
 *
 * Headers expected on every agent request:
 *   x-agent-signature: hex digest
 *   x-agent-timestamp: unix millis as string
 *   x-business-id:     tenant scope for the request
 *
 * Timestamp must be within ±5 minutes. Signature is compared in constant time.
 *
 * Replay protection: after a signature verifies, its hash is stored in the
 * Firestore `agentNonces` collection (TTL = skew window + buffer). A second
 * request carrying the same signature is rejected as a replay. This catches
 * network retries and captured-and-replayed requests within the ±5min window.
 */

import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';

const MAX_SKEW_MS = 5 * 60 * 1000;
// How long to remember a signature. Slightly longer than MAX_SKEW_MS so
// requests right at the edge of the window still get caught.
const NONCE_TTL_MS = MAX_SKEW_MS + 60 * 1000;

export interface AgentAuthContext {
  businessId: string;
  rawBody: string;
}

export class AgentAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function getSecret(): string {
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!secret) {
    throw new AgentAuthError('AGENT_SHARED_SECRET not configured', 500);
  }
  return secret;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verifies the incoming agent request. Call at the top of every `/api/agent/**` route.
 * Returns the parsed context on success, throws AgentAuthError on failure.
 */
export async function verifyAgentRequest(req: NextRequest): Promise<AgentAuthContext> {
  const signature = req.headers.get('x-agent-signature');
  const timestampStr = req.headers.get('x-agent-timestamp');
  const businessId = req.headers.get('x-business-id');

  if (!signature || !timestampStr || !businessId) {
    throw new AgentAuthError('Missing agent auth headers');
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) {
    throw new AgentAuthError('Invalid timestamp header');
  }
  const skew = Math.abs(Date.now() - timestamp);
  if (skew > MAX_SKEW_MS) {
    throw new AgentAuthError(`Timestamp skew ${Math.round(skew / 1000)}s exceeds window`);
  }

  // Read body once — downstream handlers reuse this rawBody string
  const rawBody = await req.text();
  const message = `${timestamp}.${businessId}.${rawBody}`;
  const expected = crypto.createHmac('sha256', getSecret()).update(message).digest('hex');

  if (!timingSafeEqualHex(expected, signature)) {
    throw new AgentAuthError('Invalid signature');
  }

  await claimNonce(signature, businessId);

  return { businessId, rawBody };
}

/**
 * Atomically records the signature in Firestore. Throws if the signature has
 * already been seen in the window. Document IDs use the first 32 bytes of a
 * SHA-256 of the signature so we never store the raw HMAC value.
 *
 * Expired docs are left in place — a scheduled TTL policy on `expiresAt` or
 * a periodic sweep should clean them up. For correctness we check timestamp
 * on read, so stale docs outside the window don't cause false rejections.
 */
async function claimNonce(signatureHex: string, businessId: string): Promise<void> {
  const id = crypto.createHash('sha256').update(signatureHex).digest('hex').slice(0, 48);
  const ref = adminDb.collection('agentNonces').doc(id);
  const now = Date.now();

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const data = snap.data();
        const expiresAt = (data?.expiresAt as number | undefined) ?? 0;
        if (expiresAt > now) {
          throw new AgentAuthError('Replay detected (nonce reuse)', 409);
        }
        // Expired — overwrite with fresh claim
      }
      tx.set(ref, {
        businessId,
        createdAt: now,
        expiresAt: now + NONCE_TTL_MS,
      });
    });
  } catch (err) {
    if (err instanceof AgentAuthError) throw err;
    // Firestore infra failures should not silently allow replays. Surface as
    // a server error so the caller can retry against a healthy instance.
    throw new AgentAuthError('Nonce store unavailable', 503);
  }
}

/**
 * Convenience wrapper — returns a JSON error response for AgentAuthError,
 * or null if the error isn't auth-related (caller should rethrow/handle).
 */
export function agentAuthErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AgentAuthError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  return null;
}

/**
 * Convenience: parse the pre-read rawBody as JSON (after verifyAgentRequest).
 */
export function parseAgentBody<T = unknown>(rawBody: string): T {
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new AgentAuthError('Invalid JSON body', 400);
  }
}

/**
 * Normaliza a FK do cliente no BOUNDARY do agent (P2.10).
 *
 * Historicamente a mesma entidade Client é referenciada por 3 nomes
 * (`clientId` / `contactId` / `crmContactId`). O LLM pode mandar qualquer um
 * deles. Esta função resolve os três para um único `clientId` canônico, sem
 * renomear os campos persistidos em massa (migração ampla = arriscada).
 *
 * Precedência: `clientId` > `contactId` > `crmContactId`. Retorna `undefined`
 * quando nenhum está presente (mantém comportamento opcional do chamador).
 *
 * TODO(auditoria P2.10): migração ampla — padronizar `clientId` em todas as
 * coleções/escritas (Transaction grava clientId+contactId hoje) e remover os
 * aliases. Por ora só normalizamos a ENTRADA do agent.
 */
export function resolveClientId(params: {
  clientId?: unknown;
  contactId?: unknown;
  crmContactId?: unknown;
}): string | undefined {
  const pick = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  return pick(params.clientId) ?? pick(params.contactId) ?? pick(params.crmContactId);
}
