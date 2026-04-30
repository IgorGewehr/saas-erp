import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, checkBusinessRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { sendBaileysBroadcastMessage } from '@/app/api/whatsapp/baileys-manager';
import { generateUnsubscribeToken } from '@/lib/utils/unsubscribeToken';
import type { BroadcastTemplateParam, OptOutChannel } from '@/lib/types';

/** Compara strings em tempo constante — evita timing attack na CRON_SECRET. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

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

/**
 * Resolve um BroadcastTemplateParam[] em valores concretos por recipiente
 * e converte para o formato `components[]` que a Meta Graph API espera.
 *
 * Aceita também o formato legado (componentes Meta crus) para compatibilidade.
 */
function resolveTemplateComponents(
  params: unknown,
  recipient: { name?: string; recipientId: string; email?: string },
): unknown[] {
  if (!Array.isArray(params) || params.length === 0) return [];

  // Detecta formato legado: array de componentes Meta (cada item tem 'type' e 'parameters'
  // E NÃO tem 'kind' — campo discriminante do BroadcastTemplateParam novo)
  const looksLikeLegacy = params.every(p =>
    typeof p === 'object' && p !== null && 'type' in p && 'parameters' in p && !('kind' in p)
  );
  if (looksLikeLegacy) return params;

  // Formato novo: array de BroadcastTemplateParam — resolve por recipiente
  const resolved = (params as BroadcastTemplateParam[]).map(p => {
    if (p.kind === 'literal') return p.value;
    if (p.kind === 'field') {
      if (p.field === 'name') return recipient.name || '';
      if (p.field === 'phoneNumber') return recipient.recipientId;
      if (p.field === 'email') return recipient.email || '';
    }
    return '';
  });

  // Converte para o shape Meta: components: [{ type: 'body', parameters: [{ type: 'text', text: '...' }, ...] }]
  return [{
    type: 'body',
    parameters: resolved.map(text => ({ type: 'text', text })),
  }];
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
  // Detecta cron call ANTES do rate limit pra que o cron não bata no limite
  const cronSecret = req.headers.get('x-cron-secret');
  const isCronCall = !!cronSecret
    && !!process.env.CRON_SECRET
    && safeEqual(cronSecret, process.env.CRON_SECRET);

  if (!isCronCall) {
    // Rate limit: 5 broadcast sends per minute per IP (não aplica em cron interno)
    const clientIp = getClientIp(req);
    const { allowed } = checkRateLimit(`broadcast:${clientIp}`, 5, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Aguarde antes de enviar outra campanha.' },
        { status: 429 }
      );
    }
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
      emailSubject,
      recipients: rawRecipients,
      sendRate = 10,
      phoneNumberId,
      /** Quando true, envia via Baileys (WhatsApp Web) em vez de Cloud API. Só vale para channel === 'whatsapp'. */
      viaBaileys = false,
    } = body;

    if (!businessId || !broadcastId || !rawRecipients?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isCronCall) {
      const authResult = await verifyAuth(req, businessId);
      if (isAuthError(authResult)) return authResult;

      // Rate limit por business (5.13): 30 broadcasts/hora — anti-abuse
      // independente do IP (atacante pode rotacionar IPs mas não tokens).
      // Cron interno bypassa (pode ter pile-up de scheduled broadcasts).
      const bizLimit = checkBusinessRateLimit('broadcast-send', businessId, 30, 3_600_000);
      if (!bizLimit.allowed) {
        return NextResponse.json(
          { error: 'Limite de envios atingido para este negócio. Aguarde antes de disparar outra campanha.' },
          { status: 429 }
        );
      }
    }

    // Defesa em profundidade: valida que broadcast.businessId === body.businessId
    // Mesmo com CRON_SECRET vazado, atacante não consegue cross-tenant.
    const broadcastSnap = await adminDb.collection('broadcasts').doc(broadcastId).get();
    if (!broadcastSnap.exists) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
    }
    if (broadcastSnap.data()?.businessId !== businessId) {
      return NextResponse.json({ error: 'Broadcast does not belong to this business' }, { status: 403 });
    }

    const allRecipients = normalizeRecipients(rawRecipients as InboundRecipient[], channel);
    if (!allRecipients.length) {
      return NextResponse.json({ error: 'No valid recipients (missing phoneNumber/email)' }, { status: 400 });
    }

    // Filtra recipientes que fizeram opt-out de marketing (5.11).
    // Lookup O(1) por Set — a coleção marketingOptOuts é compartilhada por tenant.
    // 'all' channel bloqueia em qualquer canal (preferência forte).
    const optOutChannel: OptOutChannel = channel === 'email' ? 'email' : 'whatsapp';
    const OPT_OUT_HARD_LIMIT = 50_000;
    let optOutSet: Set<string> = new Set();
    let optOutLookupOk = true;
    try {
      const optOutSnap = await adminDb.collection('marketingOptOuts')
        .where('businessId', '==', businessId)
        .where('channel', 'in', [optOutChannel, 'all'])
        .limit(OPT_OUT_HARD_LIMIT)
        .get();
      optOutSet = new Set(optOutSnap.docs.map(d => (d.data().identifier as string).toLowerCase()));
      // Alerta se atingimos o cap — admin precisa migrar para solução com paginação/Redis.
      if (optOutSnap.size >= OPT_OUT_HARD_LIMIT * 0.9) {
        console.warn(`[Broadcast] opt-out set near cap (${optOutSnap.size}/${OPT_OUT_HARD_LIMIT}) — alguns opt-outs podem ser ignorados.`);
      }
    } catch (err) {
      // Composite index ausente ou Firestore down. Compliance LGPD: fail-CLOSED em
      // erro de index (sinal de admin não configurou) — bloqueia o envio para forçar
      // o fix. Para outros erros (timeout, transitório), fail-open com warning.
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.toLowerCase().includes('index')) {
        console.error('[Broadcast] opt-out lookup failed — composite index missing:', errMsg);
        return NextResponse.json({
          error: 'Composite index ausente para marketingOptOuts(businessId, channel). Configure no Firebase Console — link na mensagem original. Envio bloqueado por compliance.',
          firestoreError: errMsg,
        }, { status: 500 });
      }
      console.warn('[Broadcast] opt-out lookup failed (transient), sending to all recipients:', err);
      optOutLookupOk = false;
    }
    void optOutLookupOk; // evita unused — mantido pra observabilidade futura
    const recipients = optOutSet.size === 0
      ? allRecipients
      : allRecipients.filter(r => !optOutSet.has(r.recipientId.toLowerCase()));
    const optedOutCount = allRecipients.length - recipients.length;
    if (!recipients.length) {
      return NextResponse.json({
        error: `Todos os ${allRecipients.length} recipientes optaram por não receber (opt-out).`,
        optedOutCount,
      }, { status: 400 });
    }

    // Fetch access token server-side from the business document
    const businessDoc = await adminDb.collection('businesses').doc(businessId).get();
    if (!businessDoc.exists) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const businessData = businessDoc.data()!;
    const channels = businessData.channels;
    // Email não usa channels da Meta — só o branch email tem checagem própria
    if (channel !== 'email' && !channels) {
      return NextResponse.json({ error: 'No channels configured' }, { status: 400 });
    }

    let token: string;
    let resolvedPhoneNumberId = phoneNumberId;

    if (channel === 'whatsapp' && viaBaileys) {
      // Branch Baileys: valida que a sessão está ativa
      const baileysCfg = channels?.whatsappBaileys;
      const legacy = channels?.whatsapp;
      const legacyIsBaileys = legacy?.connectedVia === 'baileys';
      const isReady = baileysCfg?.isConnected || (!baileysCfg && legacyIsBaileys && legacy?.isConnected);
      if (!isReady) {
        return NextResponse.json({ error: 'WhatsApp Web (Baileys) não está conectado' }, { status: 400 });
      }
      // Baileys broadcast suporta apenas texto (sem template, sem mídia neste endpoint)
      if (templateName || (body.messageType && body.messageType !== 'text')) {
        return NextResponse.json({
          error: 'Baileys broadcasts suportam apenas texto livre. Templates e mídia não são compatíveis.',
        }, { status: 400 });
      }
      if (!messageContent?.trim()) {
        return NextResponse.json({ error: 'messageContent obrigatório para envio Baileys' }, { status: 400 });
      }
      token = ''; // Baileys não usa token
    } else if (channel === 'whatsapp') {
      // Branch Cloud: lê whatsappCloud (novo); fallback para legado se Cloud
      const cloudCfg = channels?.whatsappCloud;
      const legacy = channels?.whatsapp;
      const legacyIsCloud = legacy?.connectedVia !== 'baileys';
      const waConfig = cloudCfg ?? (legacyIsCloud ? legacy : undefined);
      if (!waConfig?.isConnected || !waConfig?.accessToken) {
        return NextResponse.json({ error: 'WhatsApp Cloud channel not connected' }, { status: 400 });
      }
      token = await decryptToken(waConfig.accessToken);
      resolvedPhoneNumberId = resolvedPhoneNumberId || waConfig.phoneNumberId;
    } else if (channel === 'facebook') {
      if (!channels?.facebook?.isConnected || !channels.facebook?.pageAccessToken) {
        return NextResponse.json({ error: 'Facebook channel not connected' }, { status: 400 });
      }
      token = await decryptToken(channels.facebook.pageAccessToken);
    } else if (channel === 'instagram') {
      if (!channels?.facebook?.pageAccessToken) {
        return NextResponse.json({ error: 'Instagram channel not connected (requires Facebook)' }, { status: 400 });
      }
      token = await decryptToken(channels.facebook.pageAccessToken);
    } else if (channel === 'email') {
      // Email broadcasts são delegados ao notification-server externo
      const nsConfig = businessData.settings?.notificationServer;
      if (!nsConfig?.isConfigured || !nsConfig?.url || !nsConfig?.apiKey) {
        return NextResponse.json({ error: 'Notification server não configurado' }, { status: 400 });
      }
      token = await decryptToken(nsConfig.apiKey);
      // Para o branch email, "phoneNumberId" carrega a URL base — reuso do parâmetro
      resolvedPhoneNumberId = nsConfig.url.replace(/\/$/, '');
    } else {
      return NextResponse.json({ error: `Invalid channel: ${channel}` }, { status: 400 });
    }

    const delayMs = Math.max(1000 / sendRate, 50); // minimum 50ms between messages

    // Idempotência: CAS draft/sent/failed → sending. Bloqueia duplo-clique e re-trigger.
    const broadcastRef = adminDb.collection('broadcasts').doc(broadcastId);
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(broadcastRef);
        if (!snap.exists) {
          // Doc pode não existir em testes — tolera
          return;
        }
        const status = snap.data()?.status;
        // Cron: process-scheduled já fez CAS scheduled→sending e nos chamou.
        // Status='sending' é ESPERADO nesse caso.
        if (status === 'sending' && !isCronCall) {
          throw new Error('CONCURRENT_SEND');
        }
        tx.update(broadcastRef, {
          status: 'sending',
          'stats.total': recipients.length,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'CONCURRENT_SEND') {
        return NextResponse.json(
          { error: 'Esta campanha já está sendo enviada. Aguarde a conclusão.' },
          { status: 409 },
        );
      }
      throw err;
    }

    // Pré-cria 1 doc broadcastMessages por recipiente (status 'pending').
    // Os IDs ficam alinhados ao array para update direto no loop.
    const messageDocIds = await preCreateBroadcastMessages(businessId, broadcastId, recipients);

    const results: { contactId?: string; recipientId: string; status: string; externalMessageId?: string; error?: string }[] = [];
    const updatePromises: Promise<unknown>[] = [];

    // ── Pause check com cache TTL ──────────────────────────────────────────
    // Lê o status do broadcast com cache local de 3s — combina dois objetivos:
    //  (a) [5.9] check a cada iteração (depois do sleep) em vez de 1-em-10,
    //      fechando a janela onde mensagens escapam após pause.
    //  (b) [5.10] reduzir reads do Firestore: para Cloud (delayMs ~100ms)
    //      são ~30 iterações por janela TTL → 1 read/30 msgs (antes era 1/10).
    //      Para Baileys (delayMs ~2s) ainda detecta pause em <3s.
    const STATUS_CACHE_TTL_MS = 3_000;
    let cachedStatus: string | undefined;
    let lastFetchAt = 0;

    async function isPausedFresh(): Promise<boolean> {
      const now = Date.now();
      // Cache válido enquanto TTL não expirou — mesmo se cachedStatus ainda é
      // undefined (Firestore nunca respondeu): a TTL impede retry agressivo.
      // Comportamento "fail open" intencional: outage Firestore não trava o envio.
      if (lastFetchAt > 0 && now - lastFetchAt < STATUS_CACHE_TTL_MS) {
        return cachedStatus === 'paused';
      }
      try {
        const snap = await broadcastRef.get();
        const fetched = snap.data()?.status as string | undefined;
        if (fetched !== undefined) cachedStatus = fetched;
      } catch (err) {
        // Falha de rede/Firestore — mantém último valor cacheado.
        // Loga 1x por TTL (graças ao update incondicional de lastFetchAt abaixo)
        // em vez de 1x/msg, evitando spam em outage prolongada.
        console.warn('[Broadcast] pause-check read failed (using cached value):', err);
      }
      // Atualiza SEMPRE (sucesso ou erro) para respeitar a TTL e evitar retry
      // agressivo (10k reads falhos em campanha de 10k com Firestore offline).
      lastFetchAt = Date.now();
      return cachedStatus === 'paused';
    }

    let wasPaused = false;
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const messageDocId = messageDocIds[i];
      let response;

      // Check a cada iteração — depois do sleep da anterior. Cache TTL evita
      // virar 1 read/msg em volume alto (5.10).
      if (await isPausedFresh()) {
        console.log('[Broadcast] paused mid-loop at index', i);
        wasPaused = true;
        break;
      }

      // ── Branch Baileys (chamada direta na sessão local, não via fetch) ─────
      if (channel === 'whatsapp' && viaBaileys) {
        try {
          const { externalMessageId } = await sendBaileysBroadcastMessage(
            businessId,
            recipient.recipientId,
            messageContent || '',
          );
          results.push({
            contactId: recipient.contactId,
            recipientId: recipient.recipientId,
            status: 'sent',
            externalMessageId,
          });
          updatePromises.push(
            adminDb.collection('broadcastMessages').doc(messageDocId).update({
              status: 'sent',
              externalMessageId,
              sentAt: new Date().toISOString(),
            })
          );
        } catch (err) {
          const errMessage = err instanceof Error ? err.message : 'Baileys send error';
          results.push({
            contactId: recipient.contactId,
            recipientId: recipient.recipientId,
            status: 'failed',
            error: errMessage,
          });
          updatePromises.push(
            adminDb.collection('broadcastMessages').doc(messageDocId).update({
              status: 'failed',
              errorMessage: errMessage,
            })
          );
        }
        // Throttle mais agressivo para Baileys (recomenda-se 2-5s)
        await sleep(Math.max(delayMs, 2000));
        continue;
      }

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
                  components: resolveTemplateComponents(templateParams, recipient),
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
        } else if (channel === 'email') {
          // Footer obrigatório de descadastro (5.11 / compliance LGPD).
          // Best-effort: se UNSUBSCRIBE_SECRET não estiver configurado, manda
          // sem footer (loga warning fora do loop pra evitar spam).
          let messageWithFooter = messageContent || '';
          try {
            const unsubToken = generateUnsubscribeToken(businessId, 'email', recipient.recipientId);
            const rawBase = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
            // Anti-XSS: rejeita protocolos não-HTTP(S) (javascript:, data:, etc.)
            // que poderiam virar payload no <a href>. Também limpa trailing slash.
            const baseUrl = /^https?:\/\//i.test(rawBase) ? rawBase.replace(/\/+$/, '') : '';
            if (!baseUrl) throw new Error('NEXT_PUBLIC_APP_URL must start with http(s)://');
            const unsubUrl = `${baseUrl}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
            messageWithFooter = `${messageWithFooter}\n<hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>` +
              `<p style="font-size:11px;color:#888;font-family:Arial,sans-serif;line-height:1.5">` +
              `Você está recebendo este email porque foi adicionado à lista de comunicações. ` +
              `<a href="${unsubUrl}" style="color:#888;text-decoration:underline">Cancelar inscrição</a>` +
              `</p>`;
          } catch {
            // UNSUBSCRIBE_SECRET ausente — manda sem footer (degradação graciosa)
          }
          // resolvedPhoneNumberId carrega a URL do notification-server, token é a API key
          response = await fetch(`${resolvedPhoneNumberId}/api/send-email`, {
            method: 'POST',
            headers: {
              'x-api-key': token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              appId: businessData.settings?.notificationServer?.appId || businessId,
              email: recipient.recipientId,
              subject: emailSubject || 'Mensagem',
              message: messageWithFooter,
            }),
          });
        }

        if (response?.ok) {
          const data = await response.json();
          // Notification-server retorna { success, jobId } — Meta retorna messages[0].id
          const messageId = data?.messages?.[0]?.id || data?.message_id || data?.jobId || '';
          results.push({
            contactId: recipient.contactId,
            recipientId: recipient.recipientId,
            status: 'sent',
            externalMessageId: messageId,
          });
          // Coleta promise — flush ao final garante consistência
          updatePromises.push(
            adminDb.collection('broadcastMessages').doc(messageDocId).update({
              status: 'sent',
              externalMessageId: messageId,
              sentAt: new Date().toISOString(),
            })
          );
        } else {
          const errData = await response?.json().catch(() => ({}));
          // Aceita múltiplos shapes: Meta usa { error: { message } }, notification-server
          // tipicamente retorna { error: 'msg' } ou { message: 'msg' }
          const errMessage = errData?.error?.message
            || (typeof errData?.error === 'string' ? errData.error : null)
            || errData?.message
            || `HTTP ${response?.status || '?'}`;
          results.push({
            contactId: recipient.contactId,
            recipientId: recipient.recipientId,
            status: 'failed',
            error: errMessage,
          });
          updatePromises.push(
            adminDb.collection('broadcastMessages').doc(messageDocId).update({
              status: 'failed',
              errorMessage: errMessage,
            })
          );
        }
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : 'Send error';
        results.push({
          contactId: recipient.contactId,
          recipientId: recipient.recipientId,
          status: 'failed',
          error: errMessage,
        });
        updatePromises.push(
          adminDb.collection('broadcastMessages').doc(messageDocId).update({
            status: 'failed',
            errorMessage: errMessage,
          })
        );
      }

      // Throttle
      await sleep(delayMs);
    }

    // Garante que todos os updates do loop completaram antes de gravar stats agregadas.
    // Promise.allSettled — não aborta em update individual falho, só registra.
    const settled = await Promise.allSettled(updatePromises);
    const updateFailures = settled.filter(s => s.status === 'rejected').length;
    if (updateFailures > 0) {
      console.error(`[Broadcast] ${updateFailures} broadcastMessage updates failed`,
        settled.filter(s => s.status === 'rejected').slice(0, 5));
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const pendingCount = recipients.length - sent - failed;

    try {
      // Quando pausado, mantém status='paused' (não overwrite para 'sent'/'failed').
      // Mensagens não-processadas continuam como 'pending' em broadcastMessages —
      // permite retomada futura ou retry-failed só nas que falharam.
      const finalStatus = wasPaused
        ? 'paused'
        : (failed === recipients.length ? 'failed' : 'sent');
      const finalUpdate: Record<string, unknown> = {
        'stats.sent': sent,
        'stats.failed': failed,
        'stats.total': recipients.length,
        status: finalStatus,
        updatedAt: new Date().toISOString(),
      };
      // Só seta completedAt quando realmente concluiu (não pausou)
      if (!wasPaused) finalUpdate.completedAt = new Date().toISOString();
      await adminDb.collection('broadcasts').doc(broadcastId).update(finalUpdate);
    } catch (statsErr) {
      console.error('[Broadcast] Failed to update stats:', statsErr);
    }

    return NextResponse.json({
      success: true,
      broadcastId,
      paused: wasPaused,
      stats: {
        total: recipients.length,
        sent,
        failed,
        pending: pendingCount,
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
