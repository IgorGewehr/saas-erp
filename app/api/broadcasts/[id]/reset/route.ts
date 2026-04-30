/**
 * POST /api/broadcasts/[id]/reset
 *
 * Reseta um broadcast preso (geralmente em status='sending' por queda do
 * backend entre o CAS de status e a pré-criação dos broadcastMessages, ou
 * timeout do tunnel/proxy durante envio com throttle longo).
 *
 * Comportamento (destrutivo):
 *  1. Valida ownership do business e role admin+
 *  2. Permite reset apenas se status ∈ {sending, paused, scheduled}
 *     - sending → caso típico (preso após CAS)
 *     - paused  → operador escolheu resetar em vez de retomar
 *     - scheduled → cancela agendamento via reset
 *  3. Deleta TODAS as broadcastMessages do broadcast (perde histórico parcial)
 *  4. Reseta broadcast.status='draft', limpa startedAt/completedAt,
 *     zera stats.{sent,delivered,read,failed} mantendo stats.total=recipients.length
 *  5. Mantém broadcast.recipients intacto — operador pode redisparar
 *
 * Segurança:
 *  - Requer role admin (founder/admin) — destrutivo demais pra operator
 *  - Rate limit por IP (3/min) e por business (5/hora)
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, checkBusinessRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Broadcast, UserRole } from '@/lib/types';

const FIRESTORE_BATCH_LIMIT = 400;
const MAX_MESSAGES_TO_DELETE = 20_000;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`reset:${clientIp}`, 3, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de resetar outra campanha.' }, { status: 429 });
  }

  try {
    const { id: broadcastId } = await ctx.params;
    if (!broadcastId) {
      return NextResponse.json({ error: 'broadcastId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const businessId = body.businessId as string | undefined;
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required in body' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    const role = authResult.role as UserRole;
    if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['admin']) {
      return NextResponse.json({ error: 'Forbidden — admin role required to reset campaigns' }, { status: 403 });
    }

    const bizLimit = checkBusinessRateLimit('broadcast-reset', businessId, 5, 3_600_000);
    if (!bizLimit.allowed) {
      return NextResponse.json(
        { error: 'Limite de resets atingido para este negócio. Aguarde antes de resetar outra campanha.' },
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

    const RESETTABLE = ['sending', 'paused', 'scheduled'];
    if (!RESETTABLE.includes(original.status)) {
      return NextResponse.json({
        error: `Reset só é permitido para campanhas em ${RESETTABLE.join(', ')}. Status atual: ${original.status}`,
      }, { status: 400 });
    }

    // Deleta TODAS as broadcastMessages deste broadcast em batches
    const messagesSnap = await adminDb.collection('broadcastMessages')
      .where('broadcastId', '==', broadcastId)
      .limit(MAX_MESSAGES_TO_DELETE)
      .get();

    let deletedCount = 0;
    if (!messagesSnap.empty) {
      for (let i = 0; i < messagesSnap.docs.length; i += FIRESTORE_BATCH_LIMIT) {
        const batch = adminDb.batch();
        const slice = messagesSnap.docs.slice(i, i + FIRESTORE_BATCH_LIMIT);
        for (const d of slice) batch.delete(d.ref);
        try {
          await batch.commit();
          deletedCount += slice.length;
        } catch (delErr) {
          console.error('[Broadcast reset] Failed to delete batch:', delErr);
          return NextResponse.json({
            error: `Falha ao deletar mensagens (${deletedCount}/${messagesSnap.size} apagadas). Tente novamente.`,
          }, { status: 500 });
        }
      }
    }

    const now = new Date().toISOString();
    const { FieldValue } = await import('firebase-admin/firestore');
    const totalRecipients = original.recipients?.length ?? 0;

    await broadcastRef.update({
      status: 'draft',
      'stats.total': totalRecipients,
      'stats.sent': 0,
      'stats.delivered': 0,
      'stats.read': 0,
      'stats.failed': 0,
      'stats.replied': 0,
      startedAt: FieldValue.delete(),
      completedAt: FieldValue.delete(),
      // scheduledAt limpo apenas se status era 'scheduled'
      ...(original.status === 'scheduled' ? { scheduledAt: FieldValue.delete() } : {}),
      errorMessage: FieldValue.delete(),
      updatedAt: now,
      // Auditoria mínima do reset (não exposto na UI, só pra debug)
      lastResetAt: now,
      lastResetBy: authResult.uid,
    });

    return NextResponse.json({
      success: true,
      previousStatus: original.status,
      deletedMessages: deletedCount,
      recipientsKept: totalRecipients,
      message: `Campanha resetada — ${deletedCount} mensagens apagadas. Status voltou para rascunho.`,
    });
  } catch (err) {
    console.error('[Broadcast reset] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
