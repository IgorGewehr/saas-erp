/**
 * GET/POST /api/fiscal/cron/transmit-contingencia
 *
 * Cron handler — varre fiscalDocuments com status='contingencia' e transmite
 * o XML pré-assinado pra SEFAZ. Detalhes de seleção e idempotência em
 * `lib/services/contingenciaRunner.ts`.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Recomendação de agendamento: a cada 30 minutos. Intervalo menor não
 * agrega valor (SEFAZ aceita até 24h após dhCont) e gera carga no
 * sefaz-api + risco de bater no circuit breaker do gateway. Maior que
 * 1h aumenta risco de não conseguir reenviar a tempo se SEFAZ ficar
 * fora por muitas horas e voltar perto do limite.
 *
 * Resposta: ContingenciaRunSummary com contadores e details[] pra
 * observabilidade — Vercel/Docker logs também guardam a linha de log
 * estruturada emitida pelo runner.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runTransmitContingencia } from '@/lib/services/contingenciaRunner';

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
    const summary = await runTransmitContingencia(new Date());
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[Fiscal Cron /transmit-contingencia] failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
