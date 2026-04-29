/**
 * GET/POST /api/broadcasts/process-scheduled
 *
 * Endpoint pra ser chamado por cron externo (Docker cron, GitHub Actions,
 * cron-job.org, etc.) periodicamente — recomendação: a cada 1 minuto.
 *
 * Auth via Authorization: Bearer ${CRON_SECRET} (variável de ambiente).
 *
 * Comportamento:
 *  1. Lê broadcasts onde status='scheduled' AND scheduledAt <= now
 *  2. Para cada, monta o body do envio e chama internamente /api/broadcasts/send
 *     passando x-cron-secret como bypass de auth
 *  3. Não bloqueia em campanhas grandes — chamadas são iniciadas em paralelo
 *     mas com cap de concorrência (CONCURRENCY) para não sobrecarregar
 *
 * Resposta:
 *   { processed: N, results: [{ broadcastId, ok, error? }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Broadcast } from '@/lib/types';

const CONCURRENCY = 3;       // máximo de broadcasts processados em paralelo
const MAX_PER_RUN = 50;      // limite por execução do cron — evita pile-up se algo trava

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // se não configurado, endpoint fica fechado
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === secret;
}

async function processBroadcast(b: Broadcast): Promise<{ ok: boolean; error?: string }> {
  // Monta body do envio idêntico ao que a UI envia em handleDispatch
  const body: Record<string, unknown> = {
    businessId: b.businessId,
    broadcastId: b.id,
    channel: b.channel,
    recipients: b.recipients ?? [],
    sendRate: b.sendRate ?? 10,
  };
  if (b.templateName) body.templateName = b.templateName;
  if (b.templateLanguage) body.templateLanguage = b.templateLanguage;
  if (b.templateParams) body.templateParams = b.templateParams;
  if (b.messageContent) body.messageContent = b.messageContent;
  if (b.emailSubject) body.emailSubject = b.emailSubject;
  if (b.viaBaileys) body.viaBaileys = true;

  // Chama o endpoint interno via fetch — passa secret como bypass de user auth
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  try {
    const res = await fetch(`${baseUrl}/api/broadcasts/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET!,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

async function handleProcess(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date().toISOString();
    // Lê scheduled broadcasts cujo scheduledAt já passou
    const snap = await adminDb.collection('broadcasts')
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '<=', now)
      .limit(MAX_PER_RUN)
      .get();

    if (snap.empty) {
      return NextResponse.json({ processed: 0, results: [] });
    }

    const broadcasts: Broadcast[] = snap.docs.map(d => ({ ...(d.data() as Broadcast), id: d.id }));
    const results: Array<{ broadcastId: string; ok: boolean; error?: string }> = [];

    // Processa em chunks com concorrência limitada
    for (let i = 0; i < broadcasts.length; i += CONCURRENCY) {
      const chunk = broadcasts.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async b => {
          const r = await processBroadcast(b);
          return { broadcastId: b.id, ...r };
        })
      );
      results.push(...chunkResults);
    }

    return NextResponse.json({
      processed: results.length,
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
    });
  } catch (err) {
    console.error('[process-scheduled] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Aceita GET pra simplificar caller (curl/cron sem body) ou POST
export async function GET(req: NextRequest) { return handleProcess(req); }
export async function POST(req: NextRequest) { return handleProcess(req); }
