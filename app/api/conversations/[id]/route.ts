/**
 * Conversation CRUD — DELETE
 *
 * DELETE /api/conversations/:id?businessId=xxx
 *
 * Deletes a conversation and all its messages from Firestore.
 * Requires authentication and business ownership.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  decrementUnreadCounterInTx,
  incrementUnreadCounterInTx,
} from '@/lib/services/unreadCounter';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const businessId = new URL(req.url).searchParams.get('businessId');

  if (!conversationId || !businessId) {
    return NextResponse.json(
      { error: 'conversationId e businessId são obrigatórios' },
      { status: 400 },
    );
  }

  // Verify auth + business ownership
  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  // 1. Verify conversation exists and belongs to this business
  const convSnap = await adminDb.doc(`conversations/${conversationId}`).get();

  if (!convSnap.exists) {
    return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 });
  }

  if (convSnap.data()!.businessId !== businessId) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }

  try {
    // 2. Soft delete — mark as deleted instead of removing from Firestore.
    //    Previne sync engine de recriar a conversa.
    //    Fase 2 do plano de soft-delete: usa contrato unificado (deletedAt +
    //    audit). Drop do `isDeleted: true` (reader isActiveRecord aceita o
    //    legado durante a janela de backfill). authResult tem uid mas nao
    //    name — usa uid como fallback (ideal: buscar nome do users/{uid},
    //    pendente).
    //    Zerar unreadCount: defesa em profundidade contra badge fantasma.
    const now = new Date().toISOString();
    await adminDb.doc(`conversations/${conversationId}`).update({
      deletedAt: now,
      deletedBy: authResult.uid,
      deletedByName: authResult.uid,
      unreadCount: 0,
      updatedAt: now,
    });

    return NextResponse.json({
      success: true,
      softDeleted: true,
    });
  } catch (err) {
    console.error('[Conversations] Erro ao excluir conversa:', err);
    return NextResponse.json(
      { error: 'Erro interno ao excluir conversa' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/conversations/:id  { businessId, action: 'markAsRead' | 'markUnread' }
 *
 * markAsRead canônico server-side. Em runTransaction: lê prevUnread + escopo
 * (channelOwnerType/channelOwnerId) da conversa, zera unreadCount, e aplica
 * delta = -prevUnread no contador denormalizado (escopo correto + total).
 *
 * markUnread (ação manual "marcar como não-lida"): mesma transação calcula o
 * MESMO alvo que o client fazia inline (Math.max(1, prevUnread) + 1) e aplica
 * delta = nextUnread - prevUnread tanto em conversations.unreadCount quanto no
 * contador denormalizado. Como ambos recebem o MESMO delta na MESMA tx, conversa
 * e contador sobem em lockstep — sem drift.
 *
 * Idempotente (R3): markAsRead 2ª execução é no-op (unreadCount já 0 ⇒ prevUnread
 * 0 ⇒ decremento pulado). Clamp Math.max(0,…) nos helpers impede negativo.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;

  let body: { businessId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const businessId = body.businessId;
  const action = body.action ?? 'markAsRead';

  if (!conversationId || !businessId) {
    return NextResponse.json(
      { error: 'conversationId e businessId são obrigatórios' },
      { status: 400 },
    );
  }
  if (action !== 'markAsRead' && action !== 'markUnread') {
    return NextResponse.json({ error: 'action não suportada' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  const convRef = adminDb.doc(`conversations/${conversationId}`);

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(convRef);
      if (!snap.exists) {
        throw new Error('NOT_FOUND');
      }
      const data = snap.data()!;
      if (data.businessId !== businessId) {
        throw new Error('FORBIDDEN');
      }

      const prevUnread = Number(data.unreadCount ?? 0);
      const now = new Date().toISOString();
      const scope = {
        channelOwnerType: data.channelOwnerType as string | undefined,
        channelOwnerId: data.channelOwnerId as string | undefined,
      };

      // Contador SEMPRE primeiro: o helper faz tx.get internamente, e o Admin
      // SDK exige todas as leituras antes das escritas na transação.
      if (action === 'markUnread') {
        // Mesmo alvo que o client fazia inline (Math.max(1, prev) + 1). O delta
        // aplicado à conversa é IDÊNTICO ao aplicado ao contador → sem drift.
        const nextUnread = Math.max(1, prevUnread) + 1;
        const delta = nextUnread - prevUnread;
        await incrementUnreadCounterInTx(tx, adminDb, businessId, scope, delta);
        tx.update(convRef, { unreadCount: nextUnread, updatedAt: now });
      } else {
        await decrementUnreadCounterInTx(tx, adminDb, businessId, scope, prevUnread);
        if (prevUnread !== 0) {
          tx.update(convRef, { unreadCount: 0, updatedAt: now });
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 });
    }
    if (msg === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }
    console.error('[Conversations] Erro ao atualizar unreadCount:', err);
    return NextResponse.json(
      { error: 'Erro interno ao atualizar conversa' },
      { status: 500 },
    );
  }
}
