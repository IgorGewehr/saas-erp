/**
 * GET /api/broadcasts/[id]/messages
 *
 * Lista broadcastMessages de uma campanha via Admin SDK — bypassa Firestore
 * Rules e dispensa o composite index do client-side onSnapshot.
 *
 * Útil quando:
 *  - O usuário ainda não deployou o índice composto e a query client falha
 *  - Operador quer ver erros detalhados das mensagens que falharam
 *
 * Query params:
 *  - businessId (required): tenant
 *  - limit (default 500, max 2000): cap de resultados
 *  - status (opcional): filtra por status específico
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { BroadcastMessage, UserRole } from '@/lib/types';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: broadcastId } = await ctx.params;
    if (!broadcastId) {
      return NextResponse.json({ error: 'broadcastId is required' }, { status: 400 });
    }

    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required as query param' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    const role = authResult.role as UserRole;
    if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
      return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
    }

    const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;
    const statusFilter = req.nextUrl.searchParams.get('status') || undefined;

    // Valida ownership do broadcast antes de listar
    const broadcastRef = adminDb.collection('broadcasts').doc(broadcastId);
    const broadcastSnap = await broadcastRef.get();
    if (!broadcastSnap.exists) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
    }
    if (broadcastSnap.data()?.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Filtra só por broadcastId — ownership já validado acima. Evita exigir
    // composite index (businessId+broadcastId+createdAt) que pode não estar
    // deployado. Sort feito client-side abaixo.
    let q = adminDb.collection('broadcastMessages')
      .where('broadcastId', '==', broadcastId);
    if (statusFilter) q = q.where('status', '==', statusFilter);
    q = q.limit(limit);

    const snap = await q.get();
    const messages: BroadcastMessage[] = snap.docs
      .map(d => ({ ...(d.data() as BroadcastMessage), id: d.id }))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    return NextResponse.json({
      success: true,
      count: messages.length,
      truncated: messages.length === limit,
      messages,
    });
  } catch (err) {
    console.error('[Broadcast messages] Error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    // Se admin SDK reclamar de index, devolve mensagem útil
    if (errMsg.toLowerCase().includes('index')) {
      return NextResponse.json({
        error: 'Index Firestore ausente — execute: firebase deploy --only firestore:indexes',
        firestoreError: errMsg,
      }, { status: 500 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
