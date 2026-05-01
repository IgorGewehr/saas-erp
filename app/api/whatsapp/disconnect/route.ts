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

    // Update Firestore
    try {
      const { initializeApp, getApps, getApp } = await import('firebase/app');
      const { getFirestore, doc, updateDoc } = await import('firebase/firestore');

      const firebaseConfig = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      };
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      const now = new Date().toISOString();

      // Determina se é canal-empresa ou pessoal — só busi atualiza businesses.channels
      const { adminDb } = await import('@/lib/config/firebaseAdmin');
      const connSnap = await adminDb.collection('channelConnections').doc(sessionKey).get();
      const isBusiness = !connSnap.exists || connSnap.data()?.ownerType !== 'user';

      if (isBusiness) {
        // Atualiza o novo campo isolado (whatsappBaileys) e o legado (apenas se ainda for Baileys)
        const bizSnap = await adminDb.doc(`businesses/${businessId}`).get();
        const legacy = bizSnap.data()?.channels?.whatsapp;
        const updates: Record<string, unknown> = {
          'channels.whatsappBaileys.isConnected': false,
          'channels.whatsappBaileys.disconnectedAt': now,
          updatedAt: now,
        };
        if (legacy?.connectedVia === 'baileys') {
          updates['channels.whatsapp.isConnected'] = false;
          updates['channels.whatsapp.disconnectedAt'] = now;
        }
        await updateDoc(doc(db, 'businesses', businessId), updates);
      }

      // Sync channelConnections — marca a connection Baileys (a do sessionKey)
      // como desconectada. Funciona pra business E user channels.
      try {
        if (connSnap.exists) {
          await connSnap.ref.update({
            isConnected: false,
            disconnectedAt: now,
            updatedAt: now,
          });
        }
      } catch (syncErr) {
        console.warn('[WA Baileys] channelConnections disconnect sync failed:', syncErr);
      }
    } catch (err) {
      console.error('[WA Baileys] Firestore disconnect error:', err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[WA Baileys] Disconnect error:', err);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 400 });
  }
}
