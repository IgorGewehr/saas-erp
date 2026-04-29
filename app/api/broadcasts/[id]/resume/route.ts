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
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Broadcast, BroadcastMessage, BroadcastRecipient, UserRole } from '@/lib/types';

const MAX_PENDING_TO_RESUME = 5000;
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

    if (pendingSnap.empty) {
      return NextResponse.json({
        error: 'Não há mensagens pendentes para retomar',
      }, { status: 400 });
    }

    // Reconstrói recipients dos pending docs
    const recipients: BroadcastRecipient[] = pendingSnap.docs.map(doc => {
      const m = doc.data() as BroadcastMessage;
      const r: BroadcastRecipient = {};
      if (m.contactId) r.contactId = m.contactId;
      if (m.contactName) r.name = m.contactName;
      if (m.email) r.email = m.email;
      else r.phoneNumber = m.recipientId;
      return r;
    });

    // Deleta pending docs em batches (serão recriados no próximo dispatch)
    for (let i = 0; i < pendingSnap.docs.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = adminDb.batch();
      const slice = pendingSnap.docs.slice(i, i + FIRESTORE_BATCH_LIMIT);
      for (const doc of slice) batch.delete(doc.ref);
      await batch.commit();
    }

    // Reseta broadcast para 'draft' com novo recipient set + limpa stats parciais
    // (sent/failed do envio anterior são preservados implicitamente nos broadcastMessages
    // que NÃO eram pending — esses docs ficam como histórico)
    const now = new Date().toISOString();
    const { FieldValue } = await import('firebase-admin/firestore');
    await broadcastRef.update({
      status: 'draft',
      recipients,
      'stats.total': recipients.length,
      // Reseta sent/failed do agregado — vai ser recontado no próximo dispatch
      'stats.sent': 0,
      'stats.failed': 0,
      startedAt: FieldValue.delete(),
      completedAt: FieldValue.delete(),
      updatedAt: now,
    });

    return NextResponse.json({
      success: true,
      pendingCount: recipients.length,
      recipients,
      message: `${recipients.length} contato(s) prontos para retomada.`,
    });
  } catch (err) {
    console.error('[Broadcast resume] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
