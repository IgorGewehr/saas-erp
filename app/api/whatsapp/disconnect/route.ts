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
    const { businessId } = await req.json();
    if (!businessId) {
      return NextResponse.json({ error: 'businessId required' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    // Clear session files
    const sessionDir = path.join(SESSIONS_DIR, businessId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
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

      await updateDoc(doc(db, 'businesses', businessId), {
        'channels.whatsapp.isConnected': false,
        'channels.whatsapp.disconnectedAt': new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[WA Baileys] Firestore disconnect error:', err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[WA Baileys] Disconnect error:', err);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 400 });
  }
}
