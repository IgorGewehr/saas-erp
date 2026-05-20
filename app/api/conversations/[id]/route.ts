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
