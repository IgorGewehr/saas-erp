import { NextRequest, NextResponse } from 'next/server';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { adminDb } from '@/lib/config/firebaseAdmin';

/**
 * Broadcast Send API
 *
 * Processes a broadcast campaign by iterating over contacts and sending
 * messages via the Meta API. Supports throttling via sendRate.
 *
 * Expects JSON body:
 * {
 *   businessId: string;
 *   broadcastId: string;
 *   channel: 'whatsapp' | 'facebook' | 'instagram';
 *   templateName?: string;
 *   templateLanguage?: string;
 *   templateParams?: unknown[];
 *   messageContent?: string;
 *   recipients: { contactId: string; contactName: string; recipientId: string }[];
 *   sendRate?: number; // msgs per second, default 10
 *   phoneNumberId?: string; // for WhatsApp
 * }
 */

const META_GRAPH = 'https://graph.facebook.com/v21.0';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 broadcast sends per minute per IP (broadcasts are heavy operations)
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`broadcast:${clientIp}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Aguarde antes de enviar outra campanha.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const {
      businessId,
      broadcastId,
      channel,
      templateName,
      templateLanguage,
      templateParams,
      messageContent,
      recipients,
      sendRate = 10,
      phoneNumberId,
    } = body;

    if (!businessId || !broadcastId || !recipients?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify authentication and business ownership
    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    // Fetch access token server-side from the business document
    const businessDoc = await adminDb.collection('businesses').doc(businessId).get();
    if (!businessDoc.exists) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const businessData = businessDoc.data()!;
    const channels = businessData.channels;
    if (!channels) {
      return NextResponse.json({ error: 'No channels configured' }, { status: 400 });
    }

    let token: string;
    let resolvedPhoneNumberId = phoneNumberId;

    if (channel === 'whatsapp') {
      if (!channels.whatsapp?.isConnected || !channels.whatsapp?.accessToken) {
        return NextResponse.json({ error: 'WhatsApp channel not connected' }, { status: 400 });
      }
      token = await decryptToken(channels.whatsapp.accessToken);
      resolvedPhoneNumberId = resolvedPhoneNumberId || channels.whatsapp.phoneNumberId;
    } else if (channel === 'facebook') {
      if (!channels.facebook?.isConnected || !channels.facebook?.pageAccessToken) {
        return NextResponse.json({ error: 'Facebook channel not connected' }, { status: 400 });
      }
      token = await decryptToken(channels.facebook.pageAccessToken);
    } else if (channel === 'instagram') {
      if (!channels.facebook?.pageAccessToken) {
        return NextResponse.json({ error: 'Instagram channel not connected (requires Facebook)' }, { status: 400 });
      }
      token = await decryptToken(channels.facebook.pageAccessToken);
    } else {
      return NextResponse.json({ error: `Invalid channel: ${channel}` }, { status: 400 });
    }

    const delayMs = Math.max(1000 / sendRate, 50); // minimum 50ms between messages

    const results: { contactId: string; status: string; externalMessageId?: string; error?: string }[] = [];

    for (const recipient of recipients) {
      try {
        let response;

        if (channel === 'whatsapp') {
          if (templateName) {
            // Send template message
            response = await fetch(`${META_GRAPH}/${resolvedPhoneNumberId}/messages`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: recipient.recipientId,
                type: 'template',
                template: {
                  name: templateName,
                  language: { code: templateLanguage || 'pt_BR' },
                  components: templateParams || [],
                },
              }),
            });
          } else {
            // Send text message (only within 24h window)
            response = await fetch(`${META_GRAPH}/${resolvedPhoneNumberId}/messages`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: recipient.recipientId,
                type: 'text',
                text: { body: messageContent },
              }),
            });
          }
        } else if (channel === 'facebook') {
          // Facebook Messenger
          response = await fetch(`${META_GRAPH}/me/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              recipient: { id: recipient.recipientId },
              message: { text: messageContent || templateName },
              messaging_type: 'UPDATE',
            }),
          });
        } else if (channel === 'instagram') {
          // Instagram DM
          response = await fetch(`${META_GRAPH}/me/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              recipient: { id: recipient.recipientId },
              message: { text: messageContent || templateName },
            }),
          });
        }

        if (response?.ok) {
          const data = await response.json();
          const messageId = data?.messages?.[0]?.id || data?.message_id || '';
          results.push({
            contactId: recipient.contactId,
            status: 'sent',
            externalMessageId: messageId,
          });
        } else {
          const errData = await response?.json().catch(() => ({}));
          results.push({
            contactId: recipient.contactId,
            status: 'failed',
            error: errData?.error?.message || 'Unknown error',
          });
        }
      } catch (err) {
        results.push({
          contactId: recipient.contactId,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Send error',
        });
      }

      // Throttle
      await sleep(delayMs);
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;

    try {
      await adminDb.collection('broadcasts').doc(broadcastId).update({
        'stats.sent': sent,
        'stats.failed': failed,
        'stats.total': recipients.length,
        status: failed === recipients.length ? 'failed' : 'sent',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (statsErr) {
      console.error('[Broadcast] Failed to update stats:', statsErr);
    }

    return NextResponse.json({
      success: true,
      broadcastId,
      stats: {
        total: recipients.length,
        sent,
        failed,
      },
      results,
    });
  } catch (err) {
    console.error('Broadcast send error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
