/**
 * GET/POST /api/birthday-campaigns/run
 *
 * Cron handler — varre `birthdayCampaigns` ativas e dispara mensagens pra
 * clientes cujo aniversário (com offset `daysBeforeBirthday`) cai hoje.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Recomendação: rodar a cada hora cheia (`0 * * * *`). Cada execução
 * filtra apenas campanhas cujo `sendAtHour` bate com a hora corrente
 * no fuso do business — chamadas extras (a cada 5min, por ex) viram
 * no-op pra horas não-alvo, mas geram leituras desnecessárias.
 *
 * Idempotência: garantida no runner via transação no log
 * `birthdayCampaignLogs/{campaignId}_{clientId}_{year}` — chamadas
 * múltiplas no mesmo dia/hora não disparam mensagem duplicada.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runBirthdayCampaigns } from '@/lib/services/birthdayCampaignRunner';

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
    const summary = await runBirthdayCampaigns(new Date());
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[BirthdayCampaigns /run] failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
