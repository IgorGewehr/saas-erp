/**
 * WhatsApp Session Restore
 *
 * POST /api/whatsapp/restore
 *   Body: { businessId: string, connectionId?: string }
 *
 * Called once on frontend login to restore Baileys sessions
 * that were connected before the server restarted.
 *
 * Only restores if:
 *   1. Há credenciais persistidas no Firestore (baileysAuthStates/{connectionId})
 *   2. The session is NOT already in the in-memory Map
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import {
  sessions,
  createBaileysSession,
} from '../baileys-manager';
import { hasFirestoreAuthState } from '@/lib/services/baileys/firestore-auth-state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Verify auth
  const authResult = await verifyAuth(req);
  if (isAuthError(authResult)) return authResult;

  let businessId: string;
  let connectionId: string | undefined;
  try {
    const body = await req.json();
    businessId = body.businessId;
    connectionId = body.connectionId;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  }

  // Resolve qual connection restaurar. Phase 2: connectionId pode ser fornecido
  // pra restaurar canal específico (ex: pessoal do operador).
  let sessionKey: string;
  if (connectionId) {
    sessionKey = connectionId;
  } else {
    const { ensurePrimaryBaileysBusinessConnection } = await import('@/lib/services/channels/channelConnections');
    sessionKey = (await ensurePrimaryBaileysBusinessConnection(businessId)).id;
  }

  // Already running — nothing to do
  if (sessions.has(sessionKey)) {
    const session = sessions.get(sessionKey)!;
    return NextResponse.json({
      status: 'already_active',
      isConnected: session.isConnected,
    });
  }

  // Verifica se há credenciais persistidas no Firestore. Se não, não há o que
  // restaurar — usuário precisa parear via QR Code.
  const hasAuthState = await hasFirestoreAuthState(sessionKey);
  if (!hasAuthState) {
    return NextResponse.json({
      status: 'no_session',
      message: 'No persisted auth state — pareamento via QR Code necessário.',
    });
  }

  // Restore session silently (reuse existing auth files, no QR needed)
  try {
    console.log(`[Baileys Restore] Restaurando sessao: business=${businessId} connection=${sessionKey}`);
    await createBaileysSession(businessId, 'restore', sessionKey);

    return NextResponse.json({
      status: 'restored',
      message: 'Session restored successfully',
    });
  } catch (err) {
    console.error('[Baileys Restore] Falha ao restaurar sessao:', err);
    return NextResponse.json({
      status: 'error',
      message: 'Failed to restore session',
    }, { status: 500 });
  }
}
