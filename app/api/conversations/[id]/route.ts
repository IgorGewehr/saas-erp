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
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getDb() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}

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

  const db = getDb();

  // 1. Verify conversation exists and belongs to this business
  const convRef = doc(db, 'conversations', conversationId);
  const convSnap = await getDoc(convRef);

  if (!convSnap.exists()) {
    return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 });
  }

  if (convSnap.data().businessId !== businessId) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }

  try {
    // 2. Soft delete — mark as deleted instead of removing from Firestore
    //    This prevents the sync engine from recreating the conversation
    const now = new Date().toISOString();
    await updateDoc(convRef, {
      isDeleted: true,
      deletedAt: now,
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
