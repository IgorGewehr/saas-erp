/**
 * POST /api/broadcasts/[id]/resume
 *
 * Prepara um broadcast pausado para retomada:
 *  1. Lê broadcastMessages com status='pending' do broadcast
 *  2. Reconstrói recipients[] no broadcast doc (substitui pelos pendentes)
 *  3. Deleta os broadcastMessages pendentes (serão recriados no novo dispatch)
 *  4. Reseta broadcast.status para 'draft' + limpa startedAt/completedAt
 *  5. Retorna sucesso
 *
 * Frontend deve chamar /api/broadcasts/send em seguida para disparar.
 *
 * Validações:
 *  - Auth + role operator+
 *  - Broadcast.status DEVE ser 'paused'
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, checkBusinessRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Broadcast, BroadcastMessage, BroadcastRecipient, UserRole } from '@/lib/types';

const MAX_PENDING_TO_RESUME = 10_000;
const FIRESTORE_BATCH_LIMIT = 400;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Rate limit: 3 resumes/min por IP
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`resume:${clientIp}`, 3, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de retomar outra campanha.' }, { status: 429 });
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
    if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
      return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
    }

    // Rate limit por business (5.13): 10 resumes/hora — anti-abuse
    const bizLimit = checkBusinessRateLimit('broadcast-resume', businessId, 10, 3_600_000);
    if (!bizLimit.allowed) {
      return NextResponse.json(
        { error: 'Limite de retomadas atingido para este negócio. Aguarde antes de retomar outra campanha.' },
        { status: 429 },
      );
    }

    // Carrega broadcast original
    const broadcastRef = adminDb.collection('broadcasts').doc(broadcastId);
    const broadcastSnap = await broadcastRef.get();
    if (!broadcastSnap.exists) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
    }
    const original = broadcastSnap.data() as Broadcast;
    if (original.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (original.status !== 'paused') {
      return NextResponse.json({
        error: `Só é possível retomar broadcasts pausados. Status atual: ${original.status}`,
      }, { status: 400 });
    }

    // Busca mensagens pendentes
    const pendingSnap = await adminDb.collection('broadcastMessages')
      .where('broadcastId', '==', broadcastId)
      .where('status', '==', 'pending')
      .limit(MAX_PENDING_TO_RESUME)
      .get();

    // Idempotência: se não há pendentes, é provável que o resume já rodou.
    // Em vez de erro, retorna sucesso vazio — UI lida graciosamente.
    if (pendingSnap.empty) {
      return NextResponse.json({
        success: true,
        pendingCount: 0,
        recipients: [],
        message: 'Sem mensagens pendentes — broadcast já foi totalmente processado.',
      });
    }

    const truncated = pendingSnap.size === MAX_PENDING_TO_RESUME;

    // Reconstrói recipients dos pending docs
    const recipients: BroadcastRecipient[] = pendingSnap.docs.map(d => {
      const m = d.data() as BroadcastMessage;
      const r: BroadcastRecipient = {};
      if (m.contactId) r.contactId = m.contactId;
      if (m.contactName) r.name = m.contactName;
      if (m.email) r.email = m.email;
      else r.phoneNumber = m.recipientId;
      // 5.8: preserva customColumns para template params kind='csvColumn'
      // resolverem corretamente no próximo dispatch.
      if (m.customColumns && Object.keys(m.customColumns).length > 0) {
        r.customColumns = m.customColumns;
      }
      return r;
    });

    // ORDEM: update do broadcast PRIMEIRO, deletes depois.
    // Se o update falhar, abortamos sem mexer nos pending docs (recoverable).
    // Se update succeed mas delete falhar parcialmente, os pendentes restantes
    // serão limpos no próximo resume (idempotente — encontrará pendentes restantes).
    const now = new Date().toISOString();
    const { FieldValue } = await import('firebase-admin/firestore');
    await broadcastRef.update({
      status: 'draft',
      recipients,
      'stats.total': recipients.length,
      // Stats agregadas resetam — broadcastMessages mantém histórico real
      'stats.sent': 0,
      'stats.failed': 0,
      startedAt: FieldValue.delete(),
      completedAt: FieldValue.delete(),
      updatedAt: now,
    });

    // Deleta pending docs em batches (serão recriados no próximo dispatch).
    // Best-effort: erros aqui não bloqueiam — orfãos serão cleanup no próximo resume.
    let deletedCount = 0;
    for (let i = 0; i < pendingSnap.docs.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = adminDb.batch();
      const slice = pendingSnap.docs.slice(i, i + FIRESTORE_BATCH_LIMIT);
      for (const d of slice) batch.delete(d.ref);
      try {
        await batch.commit();
        deletedCount += slice.length;
      } catch (delErr) {
        console.error('[Broadcast resume] Failed to delete pending batch:', delErr);
        break; // para evitar pilha de erros; restante limpa no próximo resume
      }
    }

    return NextResponse.json({
      success: true,
      pendingCount: recipients.length,
      deletedCount,
      truncated, // true se hit MAX_PENDING_TO_RESUME — UI deve avisar
      recipients,
      message: truncated
        ? `${recipients.length} contato(s) prontos. Há mais pendentes — execute "Retomar" novamente após este dispatch.`
        : `${recipients.length} contato(s) prontos para retomada.`,
    });
  } catch (err) {
    console.error('[Broadcast resume] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
