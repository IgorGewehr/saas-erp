/**
 * GET/POST /api/cron/platform-billing/check-overdue
 *
 * Cron diário (M12) — varre platformSubscriptions ativas e marca como
 * `overdue` as que passaram de nextBillingDate. SEM enforcement (decisão do
 * usuário) — só atualiza o status pro painel do operador refletir.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} — mesmo padrão de todo cron
 * deste repo (ver app/api/membership-billing/run/route.ts).
 *
 * Recomendação: rodar 1x/dia. Idempotente por natureza — reaplicar overdue
 * numa assinatura já overdue é no-op na FSM (transitionPlatformSubscription).
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runOverdueCheck } from '@/lib/services/platformBilling/overdueRunner';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  if (token.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runOverdueCheck(new Date());
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[PlatformBilling check-overdue] failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }
