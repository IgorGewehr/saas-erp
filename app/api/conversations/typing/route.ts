/**
 * Typing Indicator Sender
 *
 * Sends typing indicators to the platform when a user is typing a response.
 *
 * POST /api/conversations/typing
 * Body: { businessId, channel, recipientId }
 *
 * WhatsApp: Cloud API does not support typing indicators.
 * Facebook: POST me/messages with sender_action: "typing_on"
 * Instagram: Same as Facebook
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import type { ConversationChannel, ChannelCredentials } from '@/lib/types';

// ─── Firebase init (server-side, client SDK) ─────────────────────────────────

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

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface TypingBody {
  businessId: string;
  channel: ConversationChannel;
  recipientId: string;
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: TypingBody = await req.json();
    const { businessId, channel, recipientId } = body;

    if (!businessId || !channel || !recipientId) {
      return NextResponse.json(
        { error: 'Campos obrigatorios: businessId, channel, recipientId' },
        { status: 400 },
      );
    }

    // WhatsApp Cloud API does not support typing indicators
    if (channel === 'whatsapp') {
      return NextResponse.json({ success: true, skipped: true, reason: 'WhatsApp nao suporta indicadores de digitacao' });
    }

    // Fetch business credentials
    const db = getDb();
    const businessRef = doc(db, 'businesses', businessId);
    const businessSnap = await getDoc(businessRef);

    if (!businessSnap.exists()) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 });
    }

    const businessData = businessSnap.data();
    const channels: ChannelCredentials | undefined = businessData?.channels;

    if (!channels) {
      return NextResponse.json({ error: 'Nenhum canal configurado' }, { status: 400 });
    }

    switch (channel) {
      case 'facebook': {
        const facebook = channels.facebook;
        if (!facebook?.isConnected || !facebook.pageAccessToken) {
          return NextResponse.json({ error: 'Canal Facebook nao conectado' }, { status: 400 });
        }

        const pageAccessToken = atob(facebook.pageAccessToken);
        await fetch(`${META_BASE_URL}/me/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${pageAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: { id: recipientId },
            sender_action: 'typing_on',
          }),
        });
        break;
      }

      case 'instagram': {
        const facebook = channels.facebook;
        if (!channels.instagram?.isConnected || !facebook?.pageAccessToken) {
          return NextResponse.json({ error: 'Canal Instagram nao conectado' }, { status: 400 });
        }

        const pageAccessToken = atob(facebook.pageAccessToken);
        await fetch(`${META_BASE_URL}/me/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${pageAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: { id: recipientId },
            sender_action: 'typing_on',
          }),
        });
        break;
      }

      default:
        return NextResponse.json({ error: `Canal nao suportado: ${channel}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao enviar typing indicator';
    console.error('[Typing Indicator] Error:', message);
    // Non-critical - return success even on error
    return NextResponse.json({ success: true, warning: message });
  }
}
