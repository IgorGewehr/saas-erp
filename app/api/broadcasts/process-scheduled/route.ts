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
import crypto from 'crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Broadcast } from '@/lib/types';

const CONCURRENCY = 3;       // máximo de broadcasts processados em paralelo
const MAX_PER_RUN = 50;      // limite por execução do cron — evita pile-up se algo trava

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // se não configurado, endpoint fica fechado
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  if (token.length !== secret.length) return false;
  // timing-safe — evita timing attack
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

async function processBroadcast(b: Broadcast): Promise<{ ok: boolean; error?: string }> {
  // 5.12 LGPD: bloqueia broadcasts legados (sem consentBasis) ANTES do CAS.
  // Sem isso, broadcast viraria status='sending' e o /api/broadcasts/send
  // depois rejeitaria — deixando o doc órfão em 'sending' permanente.
  const VALID_CONSENT_BASES = ['explicit', 'legitimate-interest', 'transactional'];
  if (!b.consentBasis || !VALID_CONSENT_BASES.includes(b.consentBasis)) {
    // Marca como failed para sair do loop do cron e dar visibilidade ao admin.
    try {
      await adminDb.collection('broadcasts').doc(b.id).update({
        status: 'failed',
        errorMessage: 'Broadcast legado sem base legal LGPD (consentBasis ausente). Recrie a campanha após o update do sistema.',
        updatedAt: new Date().toISOString(),
      });
    } catch (markErr) {
      console.error('[process-scheduled] Failed to mark legacy broadcast as failed:', markErr);
    }
    return { ok: false, error: 'missing-consent-basis (legacy broadcast)' };
  }

  // CAS atômica: só dispara se ainda está em 'scheduled'. Evita race quando
  // usuário clica "Cancelar agendamento" entre a query e o dispatch.
  const ref = adminDb.collection('broadcasts').doc(b.id);
  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('BROADCAST_GONE');
      const cur = snap.data()?.status;
      if (cur !== 'scheduled') throw new Error('NOT_SCHEDULED');
      tx.update(ref, {
        status: 'sending',
        'stats.total': (b.recipients?.length ?? 0),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'cas-failed';
    return { ok: false, error: `cas-skipped: ${msg}` };
  }

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
    // Lê scheduled broadcasts cujo scheduledAt já passou.
    // ATENÇÃO: Firestore exige composite index para esta query (status==='scheduled' + scheduledAt<=now).
    // Index: collection=broadcasts, fields=[(status, ASC), (scheduledAt, ASC)].
    // Configurar via firestore.indexes.json ou Firebase Console na primeira execução.
    let snap;
    try {
      snap = await adminDb.collection('broadcasts')
        .where('status', '==', 'scheduled')
        .where('scheduledAt', '<=', now)
        .limit(MAX_PER_RUN)
        .get();
    } catch (queryErr) {
      const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr);
      if (errMsg.toLowerCase().includes('index')) {
        return NextResponse.json({
          error: 'Composite index ausente para broadcasts(status, scheduledAt). Crie o index no Firebase Console — link na mensagem original do erro.',
          firestoreError: errMsg,
        }, { status: 500 });
      }
      throw queryErr;
    }

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
