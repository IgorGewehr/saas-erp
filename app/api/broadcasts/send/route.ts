import { NextRequest, NextResponse } from 'next/server';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { adminDb } from '@/lib/config/firebaseAdmin';

/**
 * Broadcast Send API
 *
 * Processes a broadcast campaign: itera contatos e dispara via Meta API.
 *
 * Tracking granular (Fase 1):
 *  - Antes do envio: cria 1 doc broadcastMessages por recipiente (status 'pending')
 *  - Após cada envio: atualiza o doc com 'sent' + externalMessageId OU 'failed' + errorMessage
 *  - Webhook Meta atualiza posteriormente para 'delivered' / 'read'
 *  - Stats agregadas no documento Broadcast atualizadas ao final
 *
 * Aceita recipients em dois formatos (compat):
 *  - Novo: { contactId?, name?, phoneNumber?, email? }
 *  - Legado: { contactId, contactName, recipientId }
 */

const META_GRAPH = 'https://graph.facebook.com/v21.0';
// Firestore aceita até 500 ops por batch; 400 deixa margem segura
const FIRESTORE_BATCH_LIMIT = 400;

interface InboundRecipient {
  contactId?: string;
  name?: string;
  contactName?: string;
  phoneNumber?: string;
  email?: string;
  recipientId?: string;
}

interface NormalizedRecipient {
  contactId?: string;
  name?: string;
  recipientId: string;  // phone digits ou email — chave do envio
  email?: string;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Aceita ambos os shapes de recipiente, retorna formato normalizado. */
function normalizeRecipients(
  raw: InboundRecipient[],
  channel: string,
): NormalizedRecipient[] {
  const out: NormalizedRecipient[] = [];
  for (const r of raw) {
    const recipientId = (
      // Para WhatsApp/FB/IG usa phoneNumber/recipientId
      // Para email usa email
      channel === 'email' ? r.email : (r.phoneNumber || r.recipientId)
    ) ?? '';
    if (!recipientId) continue;
    out.push({
      contactId: r.contactId,
      name: r.name || r.contactName,
      recipientId,
      email: r.email,
    });
  }
  return out;
}

/** Cria N documentos broadcastMessages em batches respeitando o limite do Firestore. */
async function preCreateBroadcastMessages(
  businessId: string,
  broadcastId: string,
  recipients: NormalizedRecipient[],
): Promise<string[]> {
  const ids: string[] = [];
  const now = new Date().toISOString();
  const collection = adminDb.collection('broadcastMessages');

  for (let i = 0; i < recipients.length; i += FIRESTORE_BATCH_LIMIT) {
    const slice = recipients.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = adminDb.batch();
    for (const r of slice) {
      const docRef = collection.doc();
      const payload: Record<string, unknown> = {
        broadcastId,
        businessId,
        recipientId: r.recipientId,
        status: 'pending',
        createdAt: now,
      };
      if (r.contactId) payload.contactId = r.contactId;
      if (r.name) payload.contactName = r.name;
      if (r.email) payload.email = r.email;
      batch.set(docRef, payload);
      ids.push(docRef.id);
    }
    await batch.commit();
  }
  return ids;
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
      recipients: rawRecipients,
      sendRate = 10,
      phoneNumberId,
    } = body;

    if (!businessId || !broadcastId || !rawRecipients?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify authentication and business ownership
    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    const recipients = normalizeRecipients(rawRecipients as InboundRecipient[], channel);
    if (!recipients.length) {
      return NextResponse.json({ error: 'No valid recipients (missing phoneNumber/email)' }, { status: 400 });
    }

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
      // Broadcasts via Cloud API: lê whatsappCloud (novo); fallback para legado se Cloud
      const cloudCfg = channels.whatsappCloud;
      const legacy = channels.whatsapp;
      const legacyIsCloud = legacy?.connectedVia !== 'baileys';
      const waConfig = cloudCfg ?? (legacyIsCloud ? legacy : undefined);
      if (!waConfig?.isConnected || !waConfig?.accessToken) {
        return NextResponse.json({ error: 'WhatsApp Cloud channel not connected' }, { status: 400 });
      }
      token = await decryptToken(waConfig.accessToken);
      resolvedPhoneNumberId = resolvedPhoneNumberId || waConfig.phoneNumberId;
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

    // Marca broadcast como sending no início
    await adminDb.collection('broadcasts').doc(broadcastId).update({
      status: 'sending',
      'stats.total': recipients.length,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).catch(() => {/* documento pode não existir em testes */});

    // Pré-cria 1 doc broadcastMessages por recipiente (status 'pending')
    // Os IDs ficam alinhados ao array para update direto no loop
    const messageDocIds = await preCreateBroadcastMessages(businessId, broadcastId, recipients);

    const results: { contactId?: string; recipientId: string; status: string; externalMessageId?: string; error?: string }[] = [];

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const messageDocId = messageDocIds[i];
      let response;

      try {
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
            recipientId: recipient.recipientId,
            status: 'sent',
            externalMessageId: messageId,
          });
          // Atualiza o BroadcastMessage com sucesso
          adminDb.collection('broadcastMessages').doc(messageDocId).update({
            status: 'sent',
            externalMessageId: messageId,
            sentAt: new Date().toISOString(),
          }).catch(err => console.error('[Broadcast] Failed to update sent message doc:', err));
        } else {
          const errData = await response?.json().catch(() => ({}));
          const errMessage = errData?.error?.message || `HTTP ${response?.status || '?'}`;
          results.push({
            contactId: recipient.contactId,
            recipientId: recipient.recipientId,
            status: 'failed',
            error: errMessage,
          });
          adminDb.collection('broadcastMessages').doc(messageDocId).update({
            status: 'failed',
            errorMessage: errMessage,
          }).catch(err => console.error('[Broadcast] Failed to update failed message doc:', err));
        }
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : 'Send error';
        results.push({
          contactId: recipient.contactId,
          recipientId: recipient.recipientId,
          status: 'failed',
          error: errMessage,
        });
        adminDb.collection('broadcastMessages').doc(messageDocId).update({
          status: 'failed',
          errorMessage: errMessage,
        }).catch(updateErr => console.error('[Broadcast] Failed to update message doc on catch:', updateErr));
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
