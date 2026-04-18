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
 */

import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';

const MAX_SKEW_MS = 5 * 60 * 1000;

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

  return { businessId, rawBody };
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
