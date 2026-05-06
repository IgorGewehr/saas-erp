/**
 * Outbound Message Sender
 *
 * Sends messages to contacts via Meta APIs:
 *  - WhatsApp Business Cloud API
 *  - Facebook Messenger Platform
 *  - Instagram Messaging API
 *
 * POST /api/conversations/send
 * Body: { businessId, conversationId, messageId, channel, recipientId, content }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, checkBusinessRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ensureBaileysSessionConnected } from '@/app/api/whatsapp/baileys-manager';
import { uploadServerMedia } from '@/lib/services/storage/adminUpload';
import type {
  ConversationChannel,
  ChannelCredentials,
} from '@/lib/types';



// ─── Types ───────────────────────────────────────────────────────────────────

interface SendRequestBody {
  businessId: string;
  conversationId: string;
  messageId?: string; // local message ID to update status after send
  messageDocId?: string; // Firestore document ID for retry
  channel: ConversationChannel;
  recipientId: string;
  content: string;
  type?: 'text' | 'template' | 'media'; // message type (default: text)
  templateName?: string; // WhatsApp template name (e.g. 'hello_world')
  templateLanguage?: string; // template language code (e.g. 'pt_BR')
  templateParams?: unknown[]; // template component parameters
  mediaUrl?: string; // URL of the media file (Firebase Storage)
  mediaType?: 'image' | 'video' | 'audio' | 'document'; // type of media
  /** Nome do arquivo original para documentos. Cloud API usa em
   *  document.filename; Baileys em fileName. Sem isso, o filename viraria
   *  caption duplicada na bolha — bug conhecido pré-fix. */
  fileName?: string;
  clientMessageId?: string; // idempotency key — retries with same key are deduped
}

interface MetaApiResponse {
  messages?: Array<{ id: string }>;
  message_id?: string;
  recipient_id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;   // e.g. 2018109 = 24h window, 2018141 = insufficient permission
    error_data?: unknown;
    fbtrace_id?: string;
  };
}

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── Meta Error Handling ─────────────────────────────────────────────────────

function handleMetaApiError(
  response: Response,
  data: MetaApiResponse,
  channelLabel: string,
): never {
  const errorCode = data.error?.code;
  const errorSubcode = data.error?.error_subcode;
  const errorMsg = data.error?.message ?? `API retornou status ${response.status}`;
  const fbtrace = data.error?.fbtrace_id ?? '';

  // Always log the full error detail so Netlify logs show subcode
  console.error(`[Send] Meta API error [${channelLabel}] code=${errorCode} subcode=${errorSubcode} trace=${fbtrace} msg="${errorMsg}"`);

  // Map known Meta error codes + subcodes to actionable messages
  // Subcodes take priority — same code can mean very different things
  let userMessage: string;
  let shouldRetry = false;

  // ── Messenger Platform subcodes (Facebook / Instagram DM) ──────────────────
  // 2018109 = Cannot message users who are not connected to your page (outside 24h window)
  // 2018141 = Insufficient permission for this action (wrong scope)
  // 2018108 = Cannot send to a user who has blocked messages from your page
  // 2018065 = This message is outside of the allowed window
  if (errorSubcode === 2018109 || errorSubcode === 2018065) {
    userMessage = 'Janela de 24h encerrada. Aguarde uma mensagem do contato para reabrir a janela.';
  } else if (errorSubcode === 2018141) {
    userMessage = 'Permissao insuficiente. Reconecte o canal em Configuracoes para gerar um token com as permissoes aprovadas.';
  } else if (errorSubcode === 2018108) {
    userMessage = 'O contato bloqueou mensagens da sua pagina.';
  } else {
    switch (errorCode) {
      case 130429:
        userMessage = 'Limite de envio atingido. Tente novamente em alguns segundos.';
        shouldRetry = true;
        break;
      case 131047:
        userMessage = 'Fora da janela de 24h. Use uma mensagem de template.';
        break;
      case 131051:
        userMessage = 'Tipo de mensagem nao suportado para este canal.';
        break;
      case 131026:
        userMessage = 'Numero invalido ou destinatario nao esta no WhatsApp.';
        break;
      case 131030:
        userMessage = 'Numero nao esta na lista permitida. O app Meta ainda esta em modo de desenvolvimento — adicione o numero no Meta Developer Dashboard ou publique o app em modo Live.';
        break;
      case 190:
        userMessage = 'Token de acesso expirado. Reconecte o canal em Configuracoes.';
        break;
      case 368:
        userMessage = 'Conta temporariamente bloqueada por violacao de politicas.';
        break;
      case 3:
        userMessage = 'O aplicativo nao tem permissao para esta chamada de API. Reconecte o canal para gerar um token com as permissoes aprovadas.';
        break;
      case 10:
        userMessage = 'Permissao negada. Reconecte o canal em Configuracoes para renovar o token.';
        break;
      case 200:
      case 230:
        userMessage = 'Permissao de escrita ausente no token. Reconecte o canal em Configuracoes.';
        break;
      default:
        userMessage = `Falha ao enviar via ${channelLabel}: ${errorMsg}`;
    }
  }

  throw new Error(JSON.stringify({
    message: userMessage,
    code: errorCode,
    subcode: errorSubcode,
    shouldRetry,
    originalError: errorMsg,
    fbtrace,
  }));
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`send:${clientIp}`, 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded. Tente novamente em breve.' }, { status: 429 });
  }

  try {
    // Read the body as text first so we can (a) verify HMAC when agent-signed and (b) reuse it as JSON.
    const rawBody = await req.text();
    const body: SendRequestBody = JSON.parse(rawBody);
    const { businessId, conversationId, messageId, messageDocId, channel, recipientId, content, type, templateName, templateLanguage, templateParams, mediaUrl, mediaType, fileName, clientMessageId } = body;

    // Authentication: accept either a Firebase session (UI) or an HMAC-signed agent call.
    const agentSignature = req.headers.get('x-agent-signature');
    if (agentSignature) {
      const timestampStr = req.headers.get('x-agent-timestamp');
      const headerBusinessId = req.headers.get('x-business-id');
      const secret = process.env.AGENT_SHARED_SECRET;
      if (!secret) {
        return NextResponse.json({ error: 'Agent auth not configured' }, { status: 500 });
      }
      if (!timestampStr || !headerBusinessId || headerBusinessId !== businessId) {
        return NextResponse.json({ error: 'Invalid agent headers' }, { status: 401 });
      }
      const ts = Number(timestampStr);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        return NextResponse.json({ error: 'Stale agent timestamp' }, { status: 401 });
      }
      const message = `${ts}.${headerBusinessId}.${rawBody}`;
      const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
      const ok = agentSignature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(agentSignature, 'hex'), Buffer.from(expected, 'hex'));
      if (!ok) {
        return NextResponse.json({ error: 'Invalid agent signature' }, { status: 401 });
      }
    } else {
      const authResult = await verifyAuth(req, businessId);
      if (isAuthError(authResult)) return authResult;
    }

    // Rate limit por business (5.13): 300 msgs/hora — generoso para atendimento
    // humano sustentado (~5 msgs/min) mas freia abuso por IP rotation.
    if (businessId) {
      const bizLimit = checkBusinessRateLimit('conversation-send', businessId, 300, 3_600_000);
      if (!bizLimit.allowed) {
        return NextResponse.json(
          { error: 'Limite de mensagens atingido para este negócio. Aguarde antes de enviar mais.' },
          { status: 429 },
        );
      }
    }

    // Validate required fields
    const isMedia = type === 'media';
    if (!businessId || !channel || !recipientId || (!content && !isMedia)) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: businessId, channel, recipientId, content' },
        { status: 400 },
      );
    }

    if (isMedia && !mediaUrl) {
      return NextResponse.json(
        { error: 'mediaUrl obrigatório para mensagens de mídia' },
        { status: 400 },
      );
    }

    if (!['whatsapp', 'facebook', 'instagram'].includes(channel)) {
      return NextResponse.json(
        { error: `Canal inválido: ${channel}. Use whatsapp, facebook ou instagram.` },
        { status: 400 },
      );
    }

    // Fix S4: Template params validation
    if (type === 'template') {
      if (!templateName) {
        return NextResponse.json({ error: 'templateName e obrigatorio para mensagens de template' }, { status: 400 });
      }
      // Validate templateParams is an array if provided
      if (templateParams && !Array.isArray(templateParams)) {
        return NextResponse.json({ error: 'templateParams deve ser um array' }, { status: 400 });
      }
    }

    // Fetch business document to get channel credentials
    const businessRef = adminDb.collection('businesses').doc(businessId);
    const businessSnap = await businessRef.get();

    if (!businessSnap.exists) {
      return NextResponse.json(
        { error: 'Empresa não encontrada' },
        { status: 404 },
      );
    }

    const businessData = businessSnap.data();
    let channels: ChannelCredentials | undefined = businessData?.channels;
    // ID da connection usada (preferido) ou null (fallback legacy). Carregado
    // logo abaixo a partir de conversation.channelConnectionId.
    let resolvedConnectionId: string | null = null;

    // Refactor multi-canal Fase 1: prefere ler config da channelConnections quando
    // a conversation tem channelConnectionId. Cai para businesses.channels apenas
    // quando a conversa é pré-refactor (campo undefined).
    if (conversationId) {
      try {
        const convSnap = await adminDb.doc(`conversations/${conversationId}`).get();
        const convChannelConnId = convSnap.data()?.channelConnectionId as string | undefined;
        if (convChannelConnId) {
          const { adminDb: _adminDb } = await import('@/lib/config/firebaseAdmin');
          const connSnap = await _adminDb.collection('channelConnections').doc(convChannelConnId).get();
          if (connSnap.exists) {
            const { buildLegacyChannelsFromConnection } = await import('@/lib/services/channels/channelConnections');
            const conn = { ...(connSnap.data() as import('@/lib/types').ChannelConnection), id: connSnap.id };
            // Sobrescreve apenas o tipo correspondente; preserva outros canais
            // do businesses.channels caso existam (ex: enviar via WA mantendo
            // FB/IG no objeto se o caller precisasse).
            const fromConn = buildLegacyChannelsFromConnection(conn);
            channels = { ...(channels || {}), ...fromConn };
            resolvedConnectionId = conn.id;
          } else {
            // Conexão referenciada foi deletada (doc órfão por unlink que falhou).
            // Tenta fallback automático para a primary Baileys connection do business
            // antes de falhar — evita que o operador fique sem canal quando a conn
            // específica foi removida mas o businessId ainda tem uma conexão ativa.
            console.warn(
              `[Send] channelConnection ${convChannelConnId} not found (deleted?), ` +
              `attempting fallback to primary Baileys connection for business ${businessId}`
            );
            try {
              const { ensurePrimaryBaileysBusinessConnection } = await import('@/lib/services/channels/channelConnections');
              const primaryConn = await ensurePrimaryBaileysBusinessConnection(businessId);
              const primarySnap = await _adminDb.collection('channelConnections').doc(primaryConn.id).get();
              if (primarySnap.exists) {
                const { buildLegacyChannelsFromConnection } = await import('@/lib/services/channels/channelConnections');
                const conn = { ...(primarySnap.data() as import('@/lib/types').ChannelConnection), id: primarySnap.id };
                const fromConn = buildLegacyChannelsFromConnection(conn);
                channels = { ...(channels || {}), ...fromConn };
                resolvedConnectionId = conn.id;
                console.warn(`[Send] Fallback succeeded — using primary connection ${conn.id}`);
              } else {
                // Primary connection also missing — fail gracefully
                return NextResponse.json({
                  error: 'O canal usado por esta conversa foi removido e não há canal primário disponível. Reconecte um canal em Configurações.',
                  code: 'connection_not_found',
                }, { status: 410 });
              }
            } catch (fallbackErr) {
              console.error('[Send] Fallback to primary connection failed:', fallbackErr);
              return NextResponse.json({
                error: 'O canal usado por esta conversa foi removido. Recarregue a página ou atribua a conversa a outro canal.',
                code: 'connection_not_found',
              }, { status: 410 });
            }
          }
        }
      } catch (err) {
        console.warn('[Send] Failed to resolve channels via channelConnections, using legacy:', err);
      }
    }

    if (!channels) {
      return NextResponse.json(
        { error: 'Nenhum canal de comunicação configurado para esta empresa', code: 'disconnected' },
        { status: 400 },
      );
    }
    // Log defensivo da origem dos credentials — útil pra depurar quando há ambos
    if (resolvedConnectionId) {
      console.log(`[Send] Using channelConnection: ${resolvedConnectionId} (channel: ${channel})`);
    }

    // ── Channel connectivity pre-check ──────────────────────────────────────
    const channelLabel: Record<string, string> = {
      whatsapp: 'WhatsApp',
      facebook: 'Facebook Messenger',
      instagram: 'Instagram',
    };

    const channelConfig = channels[channel as keyof ChannelCredentials];
    if (!channelConfig || typeof channelConfig !== 'object') {
      return NextResponse.json({
        error: `${channelLabel[channel] || channel} não está configurado. Conecte o canal em Configurações.`,
        code: 'disconnected',
      }, { status: 400 });
    }

    // Pré-check de conectividade. Para channel='whatsapp', NÃO bloqueia só com
    // base em channels.whatsapp (legacy) — porque esse campo pode estar
    // desatualizado/refletindo Baileys desconectado mesmo com Cloud ativo.
    // Aceita se Cloud OU Baileys estiver conectado; o routing decision abaixo
    // (linha ~422) escolhe o transporte correto e o send em si falha com
    // mensagem específica se aquele transporte específico estiver offline.
    if (channel === 'whatsapp') {
      const cloudOk = !!channels.whatsappCloud?.isConnected;
      const baileysOk = !!channels.whatsappBaileys?.isConnected;
      const legacyOk = !!(channels.whatsapp as { isConnected?: boolean } | undefined)?.isConnected;
      if (!cloudOk && !baileysOk && !legacyOk) {
        return NextResponse.json({
          error: 'Nenhum canal WhatsApp está conectado. Reconecte nas Configurações.',
          code: 'disconnected',
        }, { status: 400 });
      }
    } else if ('isConnected' in channelConfig && !channelConfig.isConnected) {
      // Outros canais (Facebook/Instagram) — usa o config singular como antes
      return NextResponse.json({
        error: `${channelLabel[channel] || channel} está desconectado. Reconecte nas Configurações.`,
        code: 'disconnected',
      }, { status: 400 });
    }

    // Skip token checks for Baileys connections (no token needed)
    const isBaileysChannel = channel === 'whatsapp' &&
      'connectedVia' in channelConfig &&
      channelConfig.connectedVia === 'baileys';

    if (!isBaileysChannel) {
      // Token presence check.
      // Para WhatsApp: aceita se Cloud OU legacy tem accessToken — não força
      // checar só channels.whatsapp (que pode estar desatualizado por Baileys).
      // O routing decision abaixo escolhe a config correta no envio.
      if (channel === 'whatsapp') {
        const cloudToken = (channels.whatsappCloud as { accessToken?: string } | undefined)?.accessToken;
        const legacyToken = (channels.whatsapp as { accessToken?: string } | undefined)?.accessToken;
        const baileysOk = !!channels.whatsappBaileys?.isConnected;
        // Tem que ter ALGUM caminho de envio: Cloud com token, ou Baileys conectado
        if (!cloudToken && !legacyToken && !baileysOk) {
          return NextResponse.json({
            error: 'Token do WhatsApp Cloud ausente e Baileys desconectado. Reconecte o canal em Configurações.',
            code: 'disconnected',
          }, { status: 400 });
        }
      } else {
        const tokenField = channel === 'facebook' ? 'pageAccessToken' : 'accessToken';
        if (tokenField in channelConfig && !channelConfig[tokenField as keyof typeof channelConfig]) {
          return NextResponse.json({
            error: `Token do ${channelLabel[channel] || channel} ausente. Reconecte o canal em Configurações.`,
            code: 'disconnected',
          }, { status: 400 });
        }
      }
    }

    // Token expiry pre-check
    if ('tokenExpiresAt' in channelConfig && channelConfig.tokenExpiresAt) {
      const expiresAt = new Date(channelConfig.tokenExpiresAt as string).getTime();
      if (Date.now() > expiresAt) {
        return NextResponse.json({
          error: `Token do ${channelLabel[channel] || channel} expirado. Reconecte o canal em Configurações.`,
          code: 'token_expired',
        }, { status: 400 });
      }
      if (Date.now() > expiresAt - 7 * 24 * 60 * 60 * 1000) {
        console.warn('[Send Message] Token expiring soon for', channel, 'business:', businessId);
      }
    }

    // Idempotency — if this clientMessageId was already delivered for this
    // business, return the stored result instead of re-hitting the Meta API.
    if (clientMessageId && typeof clientMessageId === 'string') {
      const existingSnap = await adminDb
        .collection('conversationMessages')
        .where('businessId', '==', businessId)
        .where('clientMessageId', '==', clientMessageId)
        .limit(1)
        .get();
      if (!existingSnap.empty) {
        const existing = existingSnap.docs[0].data();
        return NextResponse.json({
          ok: true,
          success: true,
          externalMessageId: existing.externalMessageId ?? null,
          messageId: existingSnap.docs[0].id,
          idempotent: true,
        });
      }
    }

    // Send via the appropriate Meta API
    let result: { externalMessageId: string };

    const mediaOpts = isMedia ? { mediaUrl: mediaUrl!, mediaType: mediaType || 'document' as const, fileName } : undefined;

    // Captura o transporte usado (cloud vs baileys) pra denormalizar na mensagem.
    // Setado dentro do case 'whatsapp'; outros canais (FB/IG) ficam undefined.
    let resolvedConnectedVia: 'embedded_signup' | 'baileys' | undefined;

    switch (channel) {
      case 'whatsapp': {
        // CRITICAL: routing decision deve vir da conversation, NÃO do business config.
        // Antes lia channels.whatsapp.connectedVia (config global, podia estar errado quando dois canais coexistem).
        // Agora lê conversation.connectedVia — fonte da verdade per-conversation.
        let convVia: string | undefined;
        if (conversationId) {
          try {
            const convSnap = await adminDb.doc(`conversations/${conversationId}`).get();
            convVia = convSnap.data()?.connectedVia as string | undefined;
          } catch (err) {
            console.error('[Send] Failed to read conversation.connectedVia:', err);
          }
        }

        let isBaileys: boolean;
        // Templates são feature exclusiva do Cloud API. Mesmo se a conversa
        // está em connectedVia='baileys', forçamos Cloud — Baileys não suporta.
        // Sem este override, dava "WhatsApp desconectado" quando user tentava
        // template numa conv tagged Baileys (que ficou offline).
        if (type === 'template') {
          isBaileys = false;
          console.log('[Send] Template send — forçando Cloud (templates são Cloud-only)');
        } else if (convVia === 'baileys') {
          isBaileys = true;
        } else if (convVia === 'embedded_signup') {
          isBaileys = false;
        } else {
          // Conversa sem connectedVia explícito — chega aqui só pra conversas
          // pré-refactor que nunca receberam backfill, ou requests sem conversationId.
          // Logamos pra observabilidade: se aparecer com frequência em prod, é
          // sinal de que precisamos rodar o backfill script (lib/scripts/backfill-conversation-connectedVia.ts).
          console.warn('[Send] Routing fallback acionado — conversa sem connectedVia.', {
            conversationId: conversationId || '(none)',
            businessId,
            hasBaileys: !!channels.whatsappBaileys?.isConnected,
            hasCloud: !!channels.whatsappCloud?.isConnected,
            hasResolvedConnectionId: !!resolvedConnectionId,
          });

          // Fallback 1: Baileys está conectado E (temos a connection explícita OU Cloud não está ativo).
          // O segundo critério cobre requests sem conversationId (ex: agent sem conv_id)
          // onde só Baileys está configurado no business — evita cair no Cloud incorretamente.
          if (channels.whatsappBaileys?.isConnected &&
              (resolvedConnectionId || !channels.whatsappCloud?.isConnected)) {
            isBaileys = true;
          } else {
            // Fallback 2: conversa antiga sem connectedVia — lê campo legado
            const waLegacy = channels.whatsapp as (typeof channels.whatsapp & { connectedVia?: string }) | undefined;
            isBaileys = waLegacy?.connectedVia === 'baileys' && !channels.whatsappCloud;
          }
        }

        resolvedConnectedVia = isBaileys ? 'baileys' : 'embedded_signup';

        if (isBaileys) {
          // resolvedConnectionId vem do bloco anterior que carregou a connection
          // a partir de conversation.channelConnectionId. Quando presente, usa
          // a sessão Baileys daquela conexão específica (essencial pra canais
          // pessoais de operador na Phase 2). Se ausente, sendWhatsAppBaileys
          // resolve pra primary business automaticamente.
          result = await sendWhatsAppBaileys(
            businessId, recipientId, content, conversationId, mediaOpts,
            resolvedConnectionId || undefined,
          );
        } else {
          // Resolve config Cloud: novo campo whatsappCloud > legado whatsapp
          const cloudConfig = channels.whatsappCloud ?? channels.whatsapp;
          if (!cloudConfig?.isConnected || !cloudConfig.accessToken || !cloudConfig.phoneNumberId) {
            throw new Error('WhatsApp Cloud não está conectado neste business');
          }
          // Compat: sendWhatsApp lê channels.whatsapp — substituímos pelo config resolvido
          const resolvedChannels = { ...channels, whatsapp: cloudConfig as typeof channels.whatsapp };
          result = await sendWhatsApp(resolvedChannels, recipientId, content, {
            type: type || 'text',
            templateName,
            templateLanguage,
            templateParams,
            media: mediaOpts,
          });
        }
        break;
      }
      case 'facebook':
        result = await sendFacebookMessenger(channels, recipientId, content, mediaOpts);
        break;
      case 'instagram': {
        const igMediaOpts = await prepareMediaForInstagram(mediaOpts, businessId);
        result = await sendInstagram(channels, recipientId, content, igMediaOpts);
        break;
      }
      default:
        return NextResponse.json(
          { error: `Canal não suportado: ${channel}` },
          { status: 400 },
        );
    }

    // Update or create the message record in Firestore
    // NOTE: this route intentionally does NOT call dispatchInboundToAgent.
    // It handles OUTBOUND messages only (operator → contact, or agent → contact).
    // Agent dispatch is exclusively the responsibility of the inbound webhook handlers
    // (meta/route.ts and baileys-manager.ts) after they persist a contact-originated message.
    const docIdToUpdate = messageDocId || messageId;
    if (docIdToUpdate) {
      await updateMessageAfterSend(docIdToUpdate, result.externalMessageId, businessId, resolvedConnectedVia);
    } else if (conversationId) {
      // Agent-originated send: no pre-existing doc — create one so it appears in the UI
      await saveAgentMessage(businessId, conversationId, channel, content, result.externalMessageId, clientMessageId, resolvedConnectedVia);
    }

    return NextResponse.json({
      ok: true,
      success: true,
      externalMessageId: result.externalMessageId,
    });

  } catch (error: unknown) {
    let message = 'Erro ao enviar mensagem';
    let statusCode = 400;
    let errorDetails: Record<string, unknown> = {};

    if (error instanceof Error) {
      const rawMsg = error.message;

      // Check for disconnected/missing channel errors
      if (rawMsg.includes('não está conectado') || rawMsg.includes('incompletas') || rawMsg.includes('ausente')) {
        return NextResponse.json({ error: rawMsg, code: 'disconnected' }, { status: 400 });
      }

      try {
        errorDetails = JSON.parse(rawMsg);
        message = errorDetails.message as string;
        if (errorDetails.code === 190) statusCode = 401;
      } catch {
        message = rawMsg;
      }
    }

    console.error('[Send Message] Error:', message, errorDetails);
    return NextResponse.json({ error: message, code: 'send_failed', ...errorDetails }, { status: statusCode });
  }
}

// ─── WhatsApp via Baileys (WhatsApp Web) ─────────────────────────────────────

async function sendWhatsAppBaileys(
  businessId: string,
  recipientId: string,
  content: string,
  conversationId: string,
  mediaOpts?: MediaOptions,
  connectionId?: string,
): Promise<{ externalMessageId: string }> {
  // Resolve qual sessão usar. Se connectionId fornecido (canal específico
  // da conversa via Phase 2), alvo direto. Senão, usa a primary business.
  const { ensurePrimaryBaileysBusinessConnection } = await import('@/lib/services/channels/channelConnections');
  const sessionKey = connectionId || (await ensurePrimaryBaileysBusinessConnection(businessId)).id;

  // Lazy restore + wait até 30s. Antes este branch falhava imediato com
  // "WhatsApp Web não está conectado" se o session estava restaurando após
  // o operador ter clicado "Reconectar" — o broadcast já tinha esse
  // tratamento, agora 1:1 também.
  const session = await ensureBaileysSessionConnected(businessId, sessionKey, 'Baileys 1:1');

  // ── Resolve the REAL phone number from the conversation document ──
  // The frontend sends contactExternalId as recipientId, but for Facebook
  // conversations that's a PSID (not a phone number). We MUST read the
  // conversation doc and extract the actual phone.
  let phoneNumber: string | null = null;

  if (conversationId) {
    try {
      const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
      if (convSnap.exists) {
        const convData = convSnap.data()!;

        // Priority 1: contactPhone is always a real phone (formatted by our listener)
        // e.g. "+55 21 99999-9999" → strip to "5521999999999"
        if (convData.contactPhone) {
          const stripped = convData.contactPhone.replace(/[^0-9]/g, '');
          if (stripped.length >= 10 && stripped.length <= 13) {
            phoneNumber = stripped;
          }
        }

        // Priority 2: contactExternalId — but ONLY if it looks like a BR phone
        // (starts with country code 55 and has 12-13 digits).
        // PSIDs and Facebook IDs are 15-17 digits and never start with 55.
        if (!phoneNumber && convData.contactExternalId) {
          const ext = convData.contactExternalId.replace(/[^0-9]/g, '');
          if (/^55\d{10,11}$/.test(ext)) {
            phoneNumber = ext;
          }
        }

        console.log('[Baileys Send] Resolved phone from conversation:', {
          contactPhone: convData.contactPhone,
          contactExternalId: convData.contactExternalId,
          resolved: phoneNumber,
        });
      }
    } catch (err) {
      console.warn('[Baileys Send] Erro ao buscar conversa:', err);
    }
  }

  // Fallback: try recipientId itself if it looks like a phone number
  if (!phoneNumber) {
    const fallback = recipientId.replace(/[^0-9]/g, '');
    if (/^55\d{10,11}$/.test(fallback)) {
      phoneNumber = fallback;
    }
  }

  if (!phoneNumber) {
    throw new Error(
      `Nao foi possivel identificar o numero de telefone do destinatario. ` +
      `recipientId recebido: ${recipientId}. Verifique os dados da conversa.`
    );
  }

  // ── Validate number and resolve correct JID ──
  const candidateJid = `${phoneNumber}@s.whatsapp.net`;

  let targetJid = candidateJid;

  try {
    // onWhatsApp validates the number and returns the canonical JID
    // (handles Brazil's 9th digit ambiguity automatically)
    const [result] = await session.sock.onWhatsApp(candidateJid);
    if (result?.exists && result.jid) {
      targetJid = result.jid;
    } else {
      console.warn(`[Baileys Send] Numero ${phoneNumber} nao foi encontrado no onWhatsApp. Tentando enviar mesmo assim.`);
    }
  } catch (err) {
    console.warn('[Baileys Send] onWhatsApp falhou, tentando envio direto:', (err as Error).message);
  }

  // ── Build message content ──
  let messageContent: Record<string, unknown>;

  if (mediaOpts) {
    // Download the file from Firebase Storage so Baileys can stream it directly
    const mediaRes = await fetch(mediaOpts.mediaUrl, { signal: AbortSignal.timeout(30_000) });
    if (!mediaRes.ok) throw new Error(`[Baileys] Falha ao baixar mídia: HTTP ${mediaRes.status}`);
    const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
    const mimeType = mediaRes.headers.get('content-type') || 'application/octet-stream';

    switch (mediaOpts.mediaType) {
      case 'audio':
        // ptt=false → regular audio file (not voice note)
        messageContent = { audio: mediaBuffer, mimetype: mimeType || 'audio/mp4', ptt: false };
        break;
      case 'image':
        messageContent = { image: mediaBuffer, caption: content || undefined };
        break;
      case 'video':
        messageContent = { video: mediaBuffer, caption: content || undefined };
        break;
      case 'document': {
        // Dois call paths convivem:
        //   (a) Novo (UI/CRM):   mediaOpts.fileName = nome real, content = ''
        //                        → fileName=nome, sem caption.
        //   (b) Novo c/ legenda: mediaOpts.fileName = nome, content = "legenda"
        //                        → fileName=nome, caption=legenda.
        //   (c) Legado (REST v1, agent):  mediaOpts.fileName = undefined,
        //                        content = "nome ou legenda"
        //                        → preserva comportamento antigo:
        //                        fileName=content, sem caption (evita duplicar
        //                        o mesmo string nos dois campos).
        const hasExplicitFileName = !!mediaOpts.fileName;
        const docFileName = mediaOpts.fileName || content || 'document';
        const docCaption = hasExplicitFileName && content && content !== mediaOpts.fileName
          ? content
          : undefined;
        messageContent = {
          document: mediaBuffer,
          mimetype: mimeType,
          fileName: docFileName,
          ...(docCaption ? { caption: docCaption } : {}),
        };
        break;
      }
      default:
        messageContent = { text: content };
    }
  } else {
    messageContent = { text: content };
  }

  // ── Send message ──
  try {
    const sent = await session.sock.sendMessage(targetJid, messageContent);
    const externalMessageId = sent?.key?.id || `baileys_${Date.now()}`;

    return { externalMessageId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : '';
    console.error('[Baileys Send] Erro ao enviar mensagem:', {
      jid: targetJid,
      mediaType: mediaOpts?.mediaType,
      error: errorMsg,
      stack: errorStack,
    });
    throw new Error('Falha ao enviar mensagem via WhatsApp Web. Verifique a conexão.');
  }
}

// ─── WhatsApp Cloud API ──────────────────────────────────────────────────────

interface MediaOptions {
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
  /** Nome de arquivo original — só relevante para documentos. */
  fileName?: string;
}

interface WhatsAppTemplateOptions {
  type?: 'text' | 'template' | 'media';
  templateName?: string;
  templateLanguage?: string;
  templateParams?: unknown[];
  media?: MediaOptions;
}

async function sendWhatsApp(
  channels: ChannelCredentials,
  recipientId: string,
  content: string,
  templateOptions?: WhatsAppTemplateOptions,
): Promise<{ externalMessageId: string }> {
  const whatsapp = channels.whatsapp;

  if (!whatsapp || !whatsapp.isConnected) {
    throw new Error('Canal WhatsApp não está conectado');
  }

  if (!whatsapp.phoneNumberId || !whatsapp.accessToken) {
    throw new Error('Credenciais do WhatsApp incompletas (phoneNumberId ou accessToken ausente)');
  }

  const accessToken = await decryptToken(whatsapp.accessToken);

  // Build message body based on type (text, template, or media)
  let messageBody: Record<string, unknown>;

  if (templateOptions?.type === 'template') {
    messageBody = {
      messaging_product: 'whatsapp',
      to: recipientId,
      type: 'template',
      template: {
        name: templateOptions.templateName || 'hello_world',
        language: { code: templateOptions.templateLanguage || 'pt_BR' },
        ...(templateOptions.templateParams ? { components: templateOptions.templateParams } : {}),
      },
    };
  } else if (templateOptions?.type === 'media' && templateOptions.media) {
    const { mediaUrl, mediaType, fileName } = templateOptions.media;
    // WhatsApp media message format.
    // - audio: nem caption nem filename são suportados pela Cloud API.
    // - document: usa `filename` (não caption) pra preservar nome real do
    //   arquivo no card do contato. Caption só vai se operador digitou texto.
    // - image/video: caption só se houver texto explícito.
    const mediaPayload: Record<string, unknown> = { link: mediaUrl };
    if (mediaType === 'document') {
      if (fileName) mediaPayload.filename = fileName;
      if (content) mediaPayload.caption = content;
    } else if (mediaType !== 'audio' && content) {
      mediaPayload.caption = content;
    }
    messageBody = {
      messaging_product: 'whatsapp',
      to: recipientId,
      type: mediaType,
      [mediaType]: mediaPayload,
    };
  } else {
    messageBody = {
      messaging_product: 'whatsapp',
      to: recipientId,
      type: 'text',
      text: { body: content, preview_url: true },
    };
  }

  const response = await fetch(
    `${META_BASE_URL}/${whatsapp.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageBody),
    },
  );

  const data: MetaApiResponse = await response.json();

  if (!response.ok || data.error) {
    handleMetaApiError(response, data, 'WhatsApp');
  }

  const externalMessageId = data.messages?.[0]?.id;
  if (!externalMessageId) {
    throw new Error('WhatsApp API não retornou ID da mensagem');
  }

  return { externalMessageId };
}

// ─── Facebook Messenger ──────────────────────────────────────────────────────

async function sendFacebookMessenger(
  channels: ChannelCredentials,
  recipientId: string,
  content: string,
  media?: MediaOptions,
): Promise<{ externalMessageId: string }> {
  const facebook = channels.facebook;

  if (!facebook || !facebook.isConnected) {
    throw new Error('Canal Facebook Messenger não está conectado');
  }

  if (!facebook.pageAccessToken) {
    throw new Error('Credenciais do Facebook incompletas (pageAccessToken ausente)');
  }

  const pageAccessToken = await decryptToken(facebook.pageAccessToken);

  // Build message payload - media or text
  const messagePayload = media
    ? {
        attachment: {
          type: media.mediaType === 'document' ? 'file' : media.mediaType,
          payload: { url: media.mediaUrl, is_reusable: true },
        },
      }
    : { text: content };

  const response = await fetch(
    `${META_BASE_URL}/me/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: messagePayload,
      }),
    },
  );

  const data: MetaApiResponse = await response.json();

  if (!response.ok || data.error) {
    handleMetaApiError(response, data, 'Facebook');
  }

  const externalMessageId = data.message_id;
  if (!externalMessageId) {
    throw new Error('Facebook API não retornou ID da mensagem');
  }

  return { externalMessageId };
}

// ─── Instagram Messaging ─────────────────────────────────────────────────────

// ─── Audio Conversion (OGG → M4A for Instagram) ─────────────────────────────

/**
 * Instagram Direct only accepts AAC audio (.m4a / .mp4).
 * When sending OGG/Opus (from WhatsApp or browser recordings),
 * we convert to M4A via ffmpeg before uploading.
 */
async function convertOggToM4a(oggUrl: string, businessId: string): Promise<string> {
  const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const { Readable, PassThrough } = await import('stream');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { writeFile, readFile, unlink } = await import('fs/promises');

  ffmpeg.setFfmpegPath(ffmpegInstaller.path);

  // 1. Download OGG from Firebase Storage
  const res = await fetch(oggUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to download OGG: ${res.status}`);
  const oggBuffer = Buffer.from(await res.arrayBuffer());

  // 2. Convert via temp files (ffmpeg needs seekable I/O for M4A)
  const inputPath = join(tmpdir(), `input_${Date.now()}.ogg`);
  const outputPath = join(tmpdir(), `output_${Date.now()}.m4a`);

  await writeFile(inputPath, oggBuffer);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioChannels(1)
      .format('ipod') // M4A container
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });

  const m4aBuffer = await readFile(outputPath);

  // 3. Cleanup temp files
  await unlink(inputPath).catch(() => {});
  await unlink(outputPath).catch(() => {});

  // 4. Upload converted file via admin SDK (server-side não tem auth do
  //    Firebase pra usar client SDK contra as Storage Rules).
  const storagePath = `conversations/${businessId}/converted/${Date.now()}_audio.m4a`;
  return await uploadServerMedia({
    storagePath,
    buffer: m4aBuffer,
    contentType: 'audio/mp4',
  });
}

/**
 * Pre-processes media options for Instagram.
 * Converts unsupported audio formats (OGG) to M4A (AAC).
 */
async function prepareMediaForInstagram(
  media: MediaOptions | undefined,
  businessId: string,
): Promise<MediaOptions | undefined> {
  if (!media) return media;
  if (media.mediaType !== 'audio') return media;

  // Check if the URL points to an OGG file
  const url = media.mediaUrl.toLowerCase();
  const isOgg = url.includes('.ogg') || url.includes('.opus') || url.includes('.webm');
  if (!isOgg) return media;

  console.warn('[Send] Converting OGG audio to M4A for Instagram compatibility');
  const convertedUrl = await convertOggToM4a(media.mediaUrl, businessId);
  return { ...media, mediaUrl: convertedUrl };
}

// ─── Instagram Messaging API ────────────────────────────────────────────────

async function sendInstagram(
  channels: ChannelCredentials,
  recipientId: string,
  content: string,
  media?: MediaOptions,
): Promise<{ externalMessageId: string }> {
  const instagram = channels.instagram;
  const facebook = channels.facebook;

  if (!instagram || !instagram.isConnected) {
    throw new Error('Canal Instagram não está conectado');
  }

  // We need the Facebook Page access token to send Instagram DMs.
  // Instagram DMs that arrive via page subscription (object:"page") must be
  // replied to using POST /{page-id}/messages with pages_messaging permission.
  // Using POST /{ig-account-id}/messages requires instagram_business_manage_messages
  // which needs separate Meta App Review — error 3 "does not have capability".
  if (!facebook?.pageAccessToken || !facebook?.pageId) {
    throw new Error(
      'Credenciais do Instagram incompletas: a Página do Facebook vinculada é necessária para enviar mensagens. ' +
      'Reconecte o canal em Configurações.',
    );
  }

  const pageAccessToken = await decryptToken(facebook.pageAccessToken);
  const pageId = facebook.pageId;

  // Build message payload - media or text
  const messagePayload = media
    ? {
        attachment: {
          type: media.mediaType === 'document' ? 'file' : media.mediaType,
          payload: { url: media.mediaUrl },
        },
      }
    : { text: content };

  // POST /{page-id}/messages with the IGSID (Instagram Scoped User ID) as recipient.
  // This uses pages_messaging permission (approved) and works for all Instagram DMs
  // that arrived via page-level webhook subscription — no separate App Review needed.
  const response = await fetch(
    `${META_BASE_URL}/${pageId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: messagePayload,
      }),
    },
  );

  const data: MetaApiResponse = await response.json();

  if (!response.ok || data.error) {
    // Error code 10 = 24h messaging window is closed (contact must message first).
    if (data.error?.code === 10) {
      throw new Error(JSON.stringify({
        message: 'Janela de 24h encerrada. Aguarde uma nova mensagem do contato para abrir a janela novamente.',
        code: 10,
        shouldRetry: false,
        originalError: data.error?.message,
      }));
    }
    handleMetaApiError(response, data, 'Instagram');
  }

  const externalMessageId = data.message_id;
  if (!externalMessageId) {
    throw new Error('Instagram API não retornou ID da mensagem');
  }

  return { externalMessageId };
}

// ─── Firestore Helpers ───────────────────────────────────────────────────────

async function saveAgentMessage(
  businessId: string,
  conversationId: string,
  channel: string,
  content: string,
  externalMessageId: string,
  clientMessageId?: string,
  connectedVia?: 'embedded_signup' | 'baileys',
) {
  try {
    const now = new Date().toISOString();
    const doc: Record<string, unknown> = {
      conversationId,
      businessId,
      channel,
      direction: 'outbound',
      content,
      status: 'sent',
      senderName: 'IA',
      externalMessageId,
      sentAt: now,
      createdAt: now,
    };
    // Marca o transporte (cloud vs baileys) — só aplicável a 'whatsapp'.
    if (connectedVia && channel === 'whatsapp') doc.connectedVia = connectedVia;
    if (clientMessageId) doc.clientMessageId = clientMessageId;
    await adminDb.collection('conversationMessages').add(doc);
    await adminDb.collection('conversations').doc(conversationId).update({
      lastMessage: content,
      lastMessageAt: now,
      lastMessageDirection: 'outbound',
      updatedAt: now,
    });
  } catch (err) {
    console.error('[Send Message] Failed to save agent message to Firestore:', err);
  }
}

async function updateMessageAfterSend(
  messageId: string,
  externalMessageId: string,
  businessId: string,
  connectedVia?: 'embedded_signup' | 'baileys',
) {
  // Backfill de connectedVia: o doc otimista criado pelo client pode não
  // ter o campo (ainda não atualizamos todos os call-sites do client).
  // Quando o backend resolver o transporte, escreve aqui pra garantir que
  // a mensagem reflita por qual canal saiu de fato.
  const baseUpdate: Record<string, unknown> = {
    status: 'sent',
    externalMessageId,
  };
  if (connectedVia) baseUpdate.connectedVia = connectedVia;

  try {
    // Try direct doc update first (if messageId is the Firestore document ID)
    const msgRef = adminDb.collection('conversationMessages').doc(messageId);
    const msgSnap = await msgRef.get();

    if (msgSnap.exists) {
      // Multi-tenant guard: messageDocId vem do client; sem essa checagem,
      // operador A poderia passar um docId do tenant B e marcar a mensagem
      // dele como sent/com externalMessageId controlado. adminDb ignora rules.
      if (msgSnap.data()?.businessId !== businessId) {
        console.warn(
          `[Send Message] Cross-tenant messageDocId rejected: ${messageId} (caller=${businessId}, owner=${msgSnap.data()?.businessId})`,
        );
        return;
      }
      await msgRef.update(baseUpdate);
      return;
    }

    // Fallback: query by a custom field if the ID is application-level
    const snap = await adminDb.collection('conversationMessages')
      .where('id', '==', messageId)
      .where('businessId', '==', businessId)
      .limit(1)
      .get();

    if (!snap.empty) {
      await snap.docs[0].ref.update(baseUpdate);
    }
  } catch (err) {
    // Non-critical — log but don't fail the request
    console.error('[Send Message] Failed to update message status:', err);
  }
}
