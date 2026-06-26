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
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { ConversationChannel, ChannelCredentials } from '@/lib/types';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

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
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`typing:${clientIp}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ success: true, skipped: true, reason: 'Rate limited' });
  }

  try {
    const body: TypingBody = await req.json();
    const { businessId, channel, recipientId } = body;

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

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
      case 'facebook': {
        const facebook = channels.facebook;
        if (!facebook?.isConnected || !facebook.pageAccessToken) {
          return NextResponse.json({ error: 'Canal Facebook nao conectado' }, { status: 400 });
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

        const pageAccessToken = await decryptToken(facebook.pageAccessToken);
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
