/**
 * Daily budget check for the agent.
 *
 * POST /api/agent/budget with action='check'
 *   → { ok: true, data: { usdToday: 0.42, cap: 5.0, allowed: true } }
 *
 * The cap is pulled from business.settings.aiAgent.dailyBudgetUsd (default: $5/day).
 * Usage is summed from agentRuns of the current business+day.
 *
 * Called by the Python agent at the start of each run. If `allowed=false`,
 * the run is short-circuited and the customer gets a human-handoff message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { AgentRun, Business } from '@/lib/types';

const DEFAULT_DAILY_CAP_USD = 5.0;

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const body = parseAgentBody<{ action: 'check' }>(ctx.rawBody);
  if (body.action !== 'check') {
    return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  try {
    // Read business cap
    const bizSnap = await adminDb.collection('businesses').doc(ctx.businessId).get();
    const biz = bizSnap.data() as Business | undefined;
    const cap = (biz?.settings?.aiAgent as { dailyBudgetUsd?: number } | undefined)?.dailyBudgetUsd ?? DEFAULT_DAILY_CAP_USD;

    // Sum today's spend from agentRuns
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const iso = todayStart.toISOString();

    const runsSnap = await adminDb.collection('agentRuns')
      .where('businessId', '==', ctx.businessId)
      .where('createdAt', '>=', iso)
      .get();

    const usdToday = runsSnap.docs.reduce((sum, d) => sum + ((d.data() as AgentRun).costUsd || 0), 0);
    const allowed = usdToday < cap;

    return NextResponse.json({
      ok: true,
      data: {
        usdToday: Math.round(usdToday * 10000) / 10000,
        cap,
        allowed,
        runsToday: runsSnap.size,
      },
    });
  } catch (err) {
    console.error('[agent/budget]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
