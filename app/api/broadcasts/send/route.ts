import { NextRequest, NextResponse } from 'next/server';

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
 *   accessToken: string; // encrypted
 *   phoneNumberId?: string; // for WhatsApp
 * }
 */

const META_GRAPH = 'https://graph.facebook.com/v21.0';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
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
      accessToken,
      phoneNumberId,
    } = body;

    if (!businessId || !broadcastId || !recipients?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Decode token
    const token = Buffer.from(accessToken, 'base64').toString();
    const delayMs = Math.max(1000 / sendRate, 50); // minimum 50ms between messages

    const results: { contactId: string; status: string; externalMessageId?: string; error?: string }[] = [];

    for (const recipient of recipients) {
      try {
        let response;

        if (channel === 'whatsapp') {
          if (templateName) {
            // Send template message
            response = await fetch(`${META_GRAPH}/${phoneNumberId}/messages`, {
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
            response = await fetch(`${META_GRAPH}/${phoneNumberId}/messages`, {
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
              messaging_type: 'MESSAGE_TAG',
              tag: 'CONFIRMED_EVENT_UPDATE',
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
