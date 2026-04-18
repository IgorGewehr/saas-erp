/**
 * Agent run persistence — called by the Python agent to log each execution.
 * Writes to `agentRuns` collection; scoped by businessId.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { AgentRun } from '@/lib/types';

type Action = 'log';

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const body = parseAgentBody<{ action: Action; params: Partial<AgentRun> }>(ctx.rawBody);
  const { businessId } = ctx;

  if (body.action !== 'log') {
    return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  const run = body.params;
  // Force businessId from auth; agent can't impersonate another tenant
  const payload: Partial<AgentRun> = {
    ...run,
    businessId,
    createdAt: run.createdAt || new Date().toISOString(),
  };

  try {
    if (run.id) {
      await adminDb.collection('agentRuns').doc(run.id).set(payload, { merge: true });
      return NextResponse.json({ ok: true, data: { id: run.id } });
    }
    const ref = await adminDb.collection('agentRuns').add(payload);
    return NextResponse.json({ ok: true, data: { id: ref.id } });
  } catch (err) {
    console.error('[agent/runs]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
