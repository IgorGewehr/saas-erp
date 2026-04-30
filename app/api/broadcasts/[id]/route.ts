/**
 * DELETE /api/broadcasts/[id]
 *
 * Apaga permanentemente uma campanha e todas as suas broadcastMessages.
 * Operação destrutiva, admin-only.
 *
 * Bloqueios:
 *  - Não permite delete enquanto status='sending' (use /reset primeiro pra
 *    desencalhar). Evita race com worker em loop ainda ativo.
 *  - Permitido para draft/sent/failed/paused/scheduled/cancelled.
 *
 * Comportamento:
 *  1. Valida ownership + role admin
 *  2. Deleta broadcastMessages em batches (cap 20k)
 *  3. Deleta o broadcast doc
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, checkBusinessRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Broadcast, UserRole } from '@/lib/types';

const FIRESTORE_BATCH_LIMIT = 400;
const MAX_MESSAGES_TO_DELETE = 20_000;

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`broadcast-delete:${clientIp}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de apagar outra campanha.' }, { status: 429 });
  }

  try {
    const { id: broadcastId } = await ctx.params;
    if (!broadcastId) {
      return NextResponse.json({ error: 'broadcastId is required' }, { status: 400 });
    }

    // businessId vem da query string (DELETE não tem body padronizado)
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required as query param' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    const role = authResult.role as UserRole;
    if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['admin']) {
      return NextResponse.json({ error: 'Forbidden — admin role required to delete campaigns' }, { status: 403 });
    }

    const bizLimit = checkBusinessRateLimit('broadcast-delete', businessId, 20, 3_600_000);
    if (!bizLimit.allowed) {
      return NextResponse.json(
        { error: 'Limite de exclusões atingido para este negócio. Aguarde antes de apagar outra campanha.' },
        { status: 429 },
      );
    }

    const broadcastRef = adminDb.collection('broadcasts').doc(broadcastId);
    const broadcastSnap = await broadcastRef.get();
    if (!broadcastSnap.exists) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
    }
    const original = broadcastSnap.data() as Broadcast;
    if (original.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (original.status === 'sending') {
      return NextResponse.json({
        error: 'Campanha em envio — use "Resetar" antes de apagar para evitar inconsistência com o worker em execução.',
      }, { status: 409 });
    }

    // Apaga broadcastMessages em batches
    const messagesSnap = await adminDb.collection('broadcastMessages')
      .where('broadcastId', '==', broadcastId)
      .limit(MAX_MESSAGES_TO_DELETE)
      .get();

    let deletedMessages = 0;
    if (!messagesSnap.empty) {
      for (let i = 0; i < messagesSnap.docs.length; i += FIRESTORE_BATCH_LIMIT) {
        const batch = adminDb.batch();
        const slice = messagesSnap.docs.slice(i, i + FIRESTORE_BATCH_LIMIT);
        for (const d of slice) batch.delete(d.ref);
        try {
          await batch.commit();
          deletedMessages += slice.length;
        } catch (delErr) {
          console.error('[Broadcast delete] Failed to delete messages batch:', delErr);
          return NextResponse.json({
            error: `Falha ao deletar mensagens (${deletedMessages}/${messagesSnap.size} apagadas). Campanha não foi apagada — tente novamente.`,
          }, { status: 500 });
        }
      }
    }

    // Apaga o broadcast doc por último — se algo acima falhou, o doc fica e pode ser retry
    await broadcastRef.delete();

    return NextResponse.json({
      success: true,
      deletedMessages,
      broadcastId,
      message: `Campanha apagada — ${deletedMessages} mensagem(ns) removida(s).`,
    });
  } catch (err) {
    console.error('[Broadcast delete] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
