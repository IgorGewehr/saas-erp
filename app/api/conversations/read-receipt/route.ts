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
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { ConversationChannel, ChannelCredentials } from '@/lib/types';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

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
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`read-receipt:${clientIp}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ success: true, warning: 'Rate limited' });
  }

  try {
    const body: ReadReceiptBody = await req.json();
    const { businessId, channel, messageId, recipientId } = body;

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    if (!businessId || !channel || !messageId) {
      return NextResponse.json(
        { error: 'Campos obrigatorios: businessId, channel, messageId' },
        { status: 400 },
      );
    }

    // Fetch business credentials
    const businessSnap = await adminDb.collection('businesses').doc(businessId).get();

    if (!businessSnap.exists) {
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

        const accessToken = await decryptToken(whatsapp.accessToken);
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

        const pageAccessToken = await decryptToken(facebook.pageAccessToken);
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

        const pageAccessToken = await decryptToken(facebook.pageAccessToken);
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
