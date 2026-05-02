/**
 * WhatsApp Web (Baileys) — Disconnect
 *
 * POST /api/whatsapp/disconnect
 * Body: { businessId }
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { destroySession } from '../baileys-manager';

const SESSIONS_DIR = path.join(process.cwd(), 'whatsapp-sessions');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { businessId, connectionId } = body as { businessId?: string; connectionId?: string };
    if (!businessId) {
      return NextResponse.json({ error: 'businessId required' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    // Resolve qual sessão alvo. Phase 2: se connectionId fornecido, usa
    // diretamente (canal pessoal). Senão, primary business.
    let sessionKey: string;
    if (connectionId) {
      // Valida que a connection pertence ao business — caller pode passar
      // qualquer ID, então não confiamos cegamente.
      const { adminDb } = await import('@/lib/config/firebaseAdmin');
      const connSnap = await adminDb.collection('channelConnections').doc(connectionId).get();
      if (!connSnap.exists || connSnap.data()?.businessId !== businessId) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
      }
      // Operator+ pode desconectar canal próprio; admin desconecta qualquer
      const role = (authResult as { role?: string }).role;
      const ownerType = connSnap.data()?.ownerType;
      const ownerId = connSnap.data()?.ownerId;
      const isAdmin = role === 'admin' || role === 'founder';
      const isOwnUser = ownerType === 'user' && ownerId === (authResult as { uid?: string }).uid;
      if (!isAdmin && !isOwnUser) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      sessionKey = connectionId;
    } else {
      const { ensurePrimaryBaileysBusinessConnection } = await import('@/lib/services/channels/channelConnections');
      sessionKey = (await ensurePrimaryBaileysBusinessConnection(businessId)).id;
    }

    // Kill in-memory socket FIRST — sets isDestroyed=true antes do sock.end(),
    // garantindo que o handler async de connection.close pule auto-restart e
    // não abra socket novo enquanto os arquivos estão sendo apagados.
    await destroySession(businessId, sessionKey);

    // Clear session files (no diretório novo). Diretório legado é tratado
    // como já-migrado (a sessão é a do connectionId).
    const sessionDir = path.join(SESSIONS_DIR, sessionKey);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    // Limpa também o legacy dir se ainda existir (idempotente)
    const legacyDir = path.join(SESSIONS_DIR, businessId);
    if (legacyDir !== sessionDir && fs.existsSync(legacyDir)) {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }

    // Update Firestore via Admin SDK — usar cliente Firebase aqui falhava silenciosamente
    // contra as security rules (sem auth context no server), deixando a UI presa em
    // "Conectado" mesmo após o disconnect. Admin SDK bypassa rules.
    const { adminDb } = await import('@/lib/config/firebaseAdmin');
    const now = new Date().toISOString();

    let firestoreError: unknown = null;
    try {
      // Determina se é canal-empresa ou pessoal — só business atualiza businesses.channels
      const connSnap = await adminDb.collection('channelConnections').doc(sessionKey).get();
      const isBusiness = !connSnap.exists || connSnap.data()?.ownerType !== 'user';

      if (isBusiness) {
        // Atualiza o novo campo isolado (whatsappBaileys) e o legado (apenas se ainda for Baileys)
        const bizSnap = await adminDb.doc(`businesses/${businessId}`).get();
        const legacy = bizSnap.data()?.channels?.whatsapp as { connectedVia?: string } | undefined;
        const updates: Record<string, unknown> = {
          'channels.whatsappBaileys.isConnected': false,
          'channels.whatsappBaileys.disconnectedAt': now,
          updatedAt: now,
        };
        if (legacy?.connectedVia === 'baileys') {
          updates['channels.whatsapp.isConnected'] = false;
          updates['channels.whatsapp.disconnectedAt'] = now;
        }
        await adminDb.doc(`businesses/${businessId}`).update(updates);
      }

      // Sync channelConnections — marca a connection Baileys (a do sessionKey)
      // como desconectada. Funciona pra business E user channels.
      if (connSnap.exists) {
        await connSnap.ref.update({
          isConnected: false,
          disconnectedAt: now,
          updatedAt: now,
        });
      }
    } catch (err) {
      console.error('[WA Baileys] Firestore disconnect error:', err);
      firestoreError = err;
    }

    if (firestoreError) {
      return NextResponse.json(
        { error: 'Sessão encerrada, mas falha ao atualizar Firestore. Recarregue a página.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[WA Baileys] Disconnect error:', err);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 400 });
  }
}
