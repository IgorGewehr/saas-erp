/**
 * Channel-agnostic typing + read-receipt sender.
 *
 * Called by dispatch flow IMMEDIATELY when an inbound message is received,
 * before the LLM roundtrip begins. This masks LLM latency behind a natural
 * "typing..." animation on the user's device.
 *
 * Support matrix (Meta Graph API v21):
 *   WhatsApp Cloud API: combined read-receipt + typing indicator since Nov 2024.
 *     POST /{PHONE_NUMBER_ID}/messages
 *       { messaging_product, status: "read", message_id, typing_indicator: { type: "text" } }
 *     Indicator auto-dismisses when the agent sends its reply or after ~25s.
 *   Facebook Messenger: sender_action "typing_on" (auto-dismisses in 20s).
 *   Instagram: same as Facebook.
 *   Baileys (WhatsApp Web): session.sendPresenceUpdate('composing', jid) — best-effort.
 *
 * Failures are silent — typing is UX sugar, not functional.
 */

import type { ConversationChannel, ChannelCredentials } from '@/lib/types';
import { decryptToken } from '@/lib/utils/encryption';

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

export interface TypingRequest {
  channel: ConversationChannel;
  /** External id of the inbound message we're responding to (used to combine with read receipt). */
  inboundMessageId?: string;
  /** Meta user id or phone — needed for FB/IG sender_action. */
  recipientId?: string;
  channels: ChannelCredentials;
}

/**
 * Fire-and-forget typing indicator. Never throws.
 */
export async function sendTypingIndicator(req: TypingRequest): Promise<void> {
  try {
    switch (req.channel) {
      case 'whatsapp':
        await sendWhatsAppTyping(req);
        break;
      case 'facebook':
      case 'instagram':
        await sendMetaSenderAction(req, 'typing_on');
        break;
    }
  } catch (err) {
    // Typing is UX sugar — never block the critical path
    console.warn('[typing] failed to send typing indicator:', (err as Error).message);
  }
}

/**
 * WhatsApp Cloud API — combined read-receipt + typing indicator.
 *
 * Returns immediately after the HTTP request, indicator persists on the
 * user's device for up to ~25s or until our response message arrives.
 */
async function sendWhatsAppTyping(req: TypingRequest): Promise<void> {
  const wa = req.channels.whatsapp;
  if (!wa?.isConnected || !wa.phoneNumberId || !wa.accessToken) return;
  if (!req.inboundMessageId) return;  // WA requires the message id to anchor the indicator

  const token = await decryptToken(wa.accessToken);
  await fetch(`${META_BASE_URL}/${wa.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: req.inboundMessageId,
      typing_indicator: { type: 'text' },
    }),
  });
}

async function sendMetaSenderAction(req: TypingRequest, action: 'typing_on' | 'typing_off'): Promise<void> {
  const fb = req.channels.facebook;
  if (!fb?.pageAccessToken) return;
  if (!req.recipientId) return;
  if (req.channel === 'instagram' && !req.channels.instagram?.isConnected) return;
  if (req.channel === 'facebook' && !fb.isConnected) return;

  const token = await decryptToken(fb.pageAccessToken);
  await fetch(`${META_BASE_URL}/me/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: req.recipientId },
      sender_action: action,
    }),
  });
}
