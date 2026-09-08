/**
 * GET/POST /api/webhooks/cron/purge-seen
 *
 * M10.7: purga documentos de `webhookSeen` (dedup de webhooks Meta/Baileys,
 * ver lib/contracts/_runtime/webhookIdempotency.ts) vencidos há muito.
 *
 * `markWebhookSeen` já grava `expiresAt` (24h por padrão) em cada doc, mas
 * nada nunca apagava os documentos vencidos — a coleção crescia pra sempre
 * sem custo de query (dedup é sempre por doc ID direto, nunca por scan),
 * só custo de storage/contagem de documentos.
 *
 * Recomendação: rodar 1x/dia (ex: `0 4 * * *`).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (mesmo padrão de todos os
 * outros crons deste repo).
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';

export const maxDuration = 60;

/** Teto de documentos apagados por execução — evita pile-up se algo travar. */
const MAX_DELETES_PER_RUN = 2000;
/** Tamanho de cada batch de delete (limite real do Firestore é 500 por batch). */
const BATCH_SIZE = 500;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // se não configurado, endpoint fica fechado
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
    const nowIso = new Date().toISOString();
    let deleted = 0;

    // Loop de batches até o teto por execução — cada iteração busca até
    // BATCH_SIZE docs vencidos e apaga num único batch atômico. Refaz a
    // query a cada iteração (não usa cursor) porque os docs deletados saem
    // do resultado do `where` naturalmente na próxima chamada.
    while (deleted < MAX_DELETES_PER_RUN) {
      const remaining = MAX_DELETES_PER_RUN - deleted;
      const limit = Math.min(BATCH_SIZE, remaining);
      const snap = await adminDb
        .collection('webhookSeen')
        .where('expiresAt', '<=', nowIso)
        .limit(limit)
        .get();

      if (snap.empty) break;

      const batch = adminDb.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
      deleted += snap.size;

      if (snap.size < limit) break; // menos que o pedido — coleção esgotada
    }

    console.log('[webhooks-cron/purge-seen] resumo:', JSON.stringify({ deleted }));
    return NextResponse.json({ deleted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[webhooks-cron/purge-seen] falha:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
