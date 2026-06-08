/**
 * GET/POST /api/membership-billing/run
 *
 * Cron handler (P2.9) — varre `clientMemberships` ativas e cobra os ciclos
 * vencidos (nextBillingDate <= hoje), avançando a janela do ciclo.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Recomendação: rodar 1x/dia (`0 6 * * *`, manhã). Execuções extras no mesmo
 * dia são no-op pelas assinaturas já cobradas.
 *
 * Idempotência: garantida no runner via transação no log
 * `membershipBillingLogs/{clientMembershipId}_{cycle}` — chamadas múltiplas no
 * mesmo ciclo NÃO geram cobrança duplicada.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runMembershipBilling } from '@/lib/services/membershipBillingRunner';

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
    const summary = await runMembershipBilling(new Date());
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[MembershipBilling /run] failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
