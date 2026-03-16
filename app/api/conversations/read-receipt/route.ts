/**
 * Read Receipt Sender
 *
 * Sends read receipts back to the platform when users read messages in-app.
 *
 * POST /api/conversations/read-receipt
 * Body: { businessId, channel, messageId, recipientId }
 *
 * WhatsApp: POST graph.facebook.com/v21.0/{phoneNumberId}/messages
 *   Body: { messaging_product: "whatsapp", status: "read", message_id: externalMessageId }
 *
 * Facebook: POST graph.facebook.com/v21.0/me/messages
 *   Body: { recipient: { id: recipientId }, sender_action: "mark_seen" }
 *
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

interface ReadReceiptBody {
  businessId: string;
  channel: ConversationChannel;
  messageId: string;      // External message ID from Meta
  recipientId?: string;   // Required for Facebook/Instagram mark_seen
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: ReadReceiptBody = await req.json();
    const { businessId, channel, messageId, recipientId } = body;

    if (!businessId || !channel || !messageId) {
      return NextResponse.json(
        { error: 'Campos obrigatorios: businessId, channel, messageId' },
        { status: 400 },
      );
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
      case 'whatsapp': {
        const whatsapp = channels.whatsapp;
        if (!whatsapp?.isConnected || !whatsapp.phoneNumberId || !whatsapp.accessToken) {
          return NextResponse.json({ error: 'Canal WhatsApp nao conectado' }, { status: 400 });
        }

        const accessToken = atob(whatsapp.accessToken);
        await fetch(`${META_BASE_URL}/${whatsapp.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
          }),
        });
        break;
      }

      case 'facebook': {
        const facebook = channels.facebook;
        if (!facebook?.isConnected || !facebook.pageAccessToken) {
          return NextResponse.json({ error: 'Canal Facebook nao conectado' }, { status: 400 });
        }
        if (!recipientId) {
          return NextResponse.json({ error: 'recipientId obrigatorio para Facebook' }, { status: 400 });
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
            sender_action: 'mark_seen',
          }),
        });
        break;
      }

      case 'instagram': {
        const facebook = channels.facebook;
        if (!channels.instagram?.isConnected || !facebook?.pageAccessToken) {
          return NextResponse.json({ error: 'Canal Instagram nao conectado' }, { status: 400 });
        }
        if (!recipientId) {
          return NextResponse.json({ error: 'recipientId obrigatorio para Instagram' }, { status: 400 });
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
            sender_action: 'mark_seen',
          }),
        });
        break;
      }

      default:
        return NextResponse.json({ error: `Canal nao suportado: ${channel}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao enviar read receipt';
    console.error('[Read Receipt] Error:', message);
    // Non-critical - return success even on error to avoid retries
    return NextResponse.json({ success: true, warning: message });
  }
}
