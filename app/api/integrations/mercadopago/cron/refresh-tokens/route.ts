/**
 * GET/POST /api/integrations/mercadopago/cron/refresh-tokens
 *
 * Cron de resiliência — renova PROATIVAMENTE os access tokens do Mercado Pago
 * dos tenants cuja expiração está a menos de 15 dias. Sem isto, um tenant
 * inativo por semanas teria o refresh_token expirado e cairia em reconexão
 * manual; a rotação antecipada mantém a cadeia de refresh viva.
 *
 * Recomendação: rodar 1x/dia (ex: `0 4 * * *`).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Resiliência:
 *   - Varre apenas businesses com mpConnected=true (flag pública, auto-indexada);
 *     nunca full-scan.
 *   - try/catch POR TENANT — falha/expiração de um não derruba os demais.
 *   - refreshMpTokenProactively roda sob o lock distribuído de auth.ts (a
 *     rotação do refresh_token do MP exige serialização).
 *   - Idempotente: tokens ainda frescos viram no-op ('still-fresh').
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  refreshMpTokenProactively,
  PROACTIVE_REFRESH_THRESHOLD_MS,
} from '@/lib/services/mercadopago/auth';
import { isCronAuthorized, unauthorized, listConnectedBusinessIds } from '../_shared';

export const maxDuration = 60; // segundos (Vercel) — varredura sequencial por tenant

interface TenantResult {
  businessId: string;
  refreshed?: boolean;
  skipped?: string;
  error?: string;
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return unauthorized();

  try {
    const businessIds = await listConnectedBusinessIds();
    const results: TenantResult[] = [];

    for (const businessId of businessIds) {
      try {
        const outcome = await refreshMpTokenProactively(
          businessId,
          PROACTIVE_REFRESH_THRESHOLD_MS,
        );
        results.push({ businessId, refreshed: outcome.refreshed, skipped: outcome.skipped });
      } catch (err) {
        // doRefresh já marcou mpNeedsReauth quando falhou; aqui só contabiliza.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mp-cron/refresh-tokens] tenant ${businessId} falhou:`, msg);
        results.push({ businessId, error: msg });
      }
    }

    const summary = {
      scanned: results.length,
      refreshed: results.filter((r) => r.refreshed).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => r.error).length,
      results,
    };
    console.log('[mp-cron/refresh-tokens] resumo:', JSON.stringify({ ...summary, results: undefined }));
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[mp-cron/refresh-tokens] falha geral:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
