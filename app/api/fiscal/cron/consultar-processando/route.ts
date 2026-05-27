/**
 * GET/POST /api/fiscal/cron/consultar-processando
 *
 * Cron handler — varre fiscalDocuments com status='processando' e consulta a
 * SEFAZ pela chave de acesso pra atualizar pra autorizada/rejeitada/cancelada.
 * Detalhes de seleção e mapping em `lib/services/consultaStatusRunner.ts`.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Recomendação de agendamento: a cada 1 hora. Cenário "nota processando" é
 * raro em produção (sefaz-api emite síncrono), então um ciclo de 1h é mais
 * que suficiente. Intervalos menores geram carga desnecessária no sefaz-api
 * e podem bater no rate limit da SEFAZ.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runConsultaProcessando } from '@/lib/services/consultaStatusRunner';

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
    const summary = await runConsultaProcessando(new Date());
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[Fiscal Cron /consultar-processando] failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
