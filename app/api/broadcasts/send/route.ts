import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, checkBusinessRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { sendBaileysBroadcastMessage } from '@/app/api/whatsapp/baileys-manager';
import { generateUnsubscribeToken } from '@/lib/utils/unsubscribeToken';
import { getAlternativeBrazilianPhone } from '@/lib/utils/phoneAlternatives';
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
  /** 5.8: colunas extras do CSV — preservadas para template params kind='csvColumn'. */
  customColumns?: Record<string, string>;
}

interface NormalizedRecipient {
  contactId?: string;
  name?: string;
  recipientId: string;  // phone digits ou email — chave do envio
  email?: string;
  customColumns?: Record<string, string>;
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
/**
 * Resolve cada BroadcastTemplateParam em string (sem wrapping de Meta).
 * Espelha resolveTemplateComponents mas retorna só os valores em ordem
 * pra que possamos substituir {{N}} no templateBody.
 */
function resolveTemplateValues(
  params: unknown,
  recipient: { name?: string; recipientId: string; email?: string; customColumns?: Record<string, string> },
): string[] {
  if (!Array.isArray(params) || params.length === 0) return [];
  // Formato legado (componentes Meta crus): tenta extrair parameters[].text
  const looksLikeLegacy = params.every(p =>
    typeof p === 'object' && p !== null && 'type' in p && 'parameters' in p && !('kind' in p)
  );
  if (looksLikeLegacy) {
    const body = (params as Array<{ type: string; parameters: Array<{ text?: string }> }>)
      .find(c => c.type === 'body');
    return (body?.parameters || []).map(p => p.text || '');
  }
  return (params as BroadcastTemplateParam[]).map(p => {
    if (p.kind === 'literal') return p.value;
    if (p.kind === 'field') {
      if (p.field === 'name') return recipient.name || '';
      if (p.field === 'phoneNumber') return recipient.recipientId;
      if (p.field === 'email') return recipient.email || '';
    }
    if (p.kind === 'csvColumn') return recipient.customColumns?.[p.column] || '';
    return '';
  });
}

/**
 * Substitui `{{1}}`, `{{2}}`, ... no body do template pelos valores resolvidos.
 * Indice é 1-based (Meta padrão). Placeholder não-resolvido permanece como
 * `{{N}}` (raro: param ausente do form de criação).
 */
function renderTemplateBody(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, idxStr) => {
    const idx = parseInt(idxStr, 10) - 1;
    return idx >= 0 && idx < values.length ? values[idx] : match;
  });
}

function resolveTemplateComponents(
  params: unknown,
  recipient: { name?: string; recipientId: string; email?: string; customColumns?: Record<string, string> },
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
    if (p.kind === 'csvColumn') {
      // 5.8: lê coluna extra do recipient. Vai vazio se ausente — template
      // será renderizado com placeholder, mas Meta API não vai falhar.
      return recipient.customColumns?.[p.column] || '';
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
  // Dedup por recipientId (telefone/email): evita enviar a mesma campanha 2x
  // pra um contato quando a lista vem com duplicatas (paste manual de CSV
  // duplicado, segment com bug, lista mesclada de fontes diferentes).
  const seen = new Set<string>();
  for (const r of raw) {
    const recipientId = (
      // Para WhatsApp/FB/IG usa phoneNumber/recipientId
      // Para email usa email
      channel === 'email' ? r.email : (r.phoneNumber || r.recipientId)
    ) ?? '';
    if (!recipientId) continue;
    // Normaliza pra dedup: trim + lowercase pra email; só dígitos pra telefone.
    const dedupKey = channel === 'email'
      ? recipientId.trim().toLowerCase()
      : recipientId.replace(/\D/g, '');
    if (!dedupKey || seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({
      contactId: r.contactId,
      name: r.name || r.contactName,
      recipientId,
      email: r.email,
      ...(r.customColumns && Object.keys(r.customColumns).length > 0
        ? { customColumns: r.customColumns }
        : {}),
    });
  }
  return out;
}

/** Cria N documentos broadcastMessages em batches respeitando o limite do Firestore. */
async function preCreateBroadcastMessages(
  businessId: string,
  broadcastId: string,
  recipients: NormalizedRecipient[],
  consentBasis?: string,
  sessionIndex?: number,
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
      // 5.12 LGPD: snapshot da base legal por mensagem para auditoria.
      if (consentBasis) payload.consentBasis = consentBasis;
      // 5.8: persiste customColumns para que resume/retry consigam reconstruir
      // recipients com as variáveis de template intactas (sem isso, pause+resume
      // de campanha com csvColumn dispara mensagens com placeholders vazios).
      if (r.customColumns && Object.keys(r.customColumns).length > 0) {
        payload.customColumns = r.customColumns;
      }
      // Tag de sessão: tracking por dispatch parcial. Operador que envia em
      // 3 batches (25/50/25) consegue ver stats individuais filtrando por
      // sessionIndex. Vazio em broadcasts pré-feature.
      if (typeof sessionIndex === 'number') payload.sessionIndex = sessionIndex;
      batch.set(docRef, payload);
      ids.push(docRef.id);
    }
    await batch.commit();
  }
  return ids;
}

/**
 * Find-or-create conversation pra um envio de campanha + append da mensagem
 * outbound em conversationMessages. Sem isso, broadcasts saíam direto via
 * Meta/Baileys mas não apareciam na aba "Conversas" — operador só via a
 * conversa quando o cliente respondia (e a mensagem original da campanha
 * ficava perdida).
 *
 * Match logic espelha o webhook (meta/route.ts): exact contactExternalId
 * primeiro, depois variante BR com/sem 9, depois fallback last-8 + DDD.
 *
 * Por que melhor esforço (try/catch silencioso): falha aqui não deve
 * abortar o envio em si — a mensagem já foi entregue ao destinatário.
 */
async function upsertConversationFromBroadcast(params: {
  businessId: string;
  channel: 'whatsapp' | 'facebook' | 'instagram';
  recipientId: string;          // phone digits (sem +) ou IGSID/PSID
  contactName?: string;
  contactId?: string;            // crmContactId, se vinculado
  content: string;               // texto que vai aparecer na conversa
  externalMessageId?: string;    // wamid / mid
  broadcastId: string;
  broadcastMessageId: string;    // doc id do broadcastMessages
  connectedVia?: 'embedded_signup' | 'baileys';
  channelConnectionId?: string;
  channelOwnerType?: 'business' | 'user';
  channelOwnerId?: string;
}): Promise<void> {
  try {
    const now = new Date().toISOString();

    // 1. Find — exact match
    const safeQuery = async (externalId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> => {
      try {
        return (await adminDb.collection('conversations')
          .where('businessId', '==', params.businessId)
          .where('channel', '==', params.channel)
          .where('contactExternalId', '==', externalId)
          .orderBy('lastMessageAt', 'desc')
          .limit(5)
          .get()).docs;
      } catch {
        return (await adminDb.collection('conversations')
          .where('businessId', '==', params.businessId)
          .where('channel', '==', params.channel)
          .where('contactExternalId', '==', externalId)
          .limit(5)
          .get()).docs;
      }
    };

    let candidates = await safeQuery(params.recipientId);

    // 2. Fuzzy: variação BR com/sem 9 — SEMPRE roda (não só quando exact=0)
    // pra consolidar duplicatas. Quando recipient pasted tem 9 mas existe
    // conv duplicada sem 9 (ou vice-versa), mergea ambos os sets e o sort
    // por lastMessageAt escolhe a conv com atividade mais recente — assim
    // o template não cria thread paralela.
    if (params.channel === 'whatsapp') {
      const alt = getAlternativeBrazilianPhone(params.recipientId);
      if (alt) {
        const altDocs = await safeQuery(alt);
        if (altDocs.length > 0) {
          const seen = new Set(candidates.map(d => d.id));
          for (const d of altDocs) if (!seen.has(d.id)) candidates.push(d);
        }
      }
    }

    // 3. Fuzzy: últimos 8 dígitos + DDD (cobre formatações esquisitas)
    if (candidates.length === 0 && params.channel === 'whatsapp') {
      const digits = params.recipientId.replace(/\D/g, '');
      if (digits.length >= 10) {
        const last8 = digits.slice(-8);
        const ddd = digits.length >= 11 ? digits.slice(-11, -9) : digits.slice(-10, -8);
        const all = (await adminDb.collection('conversations')
          .where('businessId', '==', params.businessId)
          .where('channel', '==', params.channel)
          .limit(100)
          .get()).docs;
        candidates = all.filter(d => {
          const ext = (d.data().contactExternalId as string | undefined)?.replace(/\D/g, '') || '';
          if (ext.length < 10) return false;
          const docLast8 = ext.slice(-8);
          const docDdd = ext.length >= 11 ? ext.slice(-11, -9) : ext.slice(-10, -8);
          return docLast8 === last8 && docDdd === ddd;
        });
      }
    }

    // Pick most recent (ou cria nova)
    const matched = candidates.sort((a, b) => {
      const ta = (a.data().lastMessageAt as string | undefined) ?? '';
      const tb = (b.data().lastMessageAt as string | undefined) ?? '';
      return tb.localeCompare(ta);
    })[0];

    let conversationId: string;
    if (matched) {
      conversationId = matched.id;
      // Atualiza preview da conversa com a msg outbound
      await matched.ref.update({
        lastMessage: params.content.slice(0, 200),
        lastMessageAt: now,
        lastMessageDirection: 'outbound',
        updatedAt: now,
      });
    } else {
      // Cria conversa nova. Para WhatsApp, popula contactPhone com formatação
      // BR. Outros canais (FB/IG) usam externalId direto.
      const isWhatsApp = params.channel === 'whatsapp';
      const phoneFormatted = isWhatsApp ? formatBrPhoneForBroadcast(params.recipientId) : undefined;
      const newConvData: Record<string, unknown> = {
        businessId: params.businessId,
        channel: params.channel,
        ...(params.connectedVia ? { connectedVia: params.connectedVia } : {}),
        ...(params.channelConnectionId ? { channelConnectionId: params.channelConnectionId } : {}),
        channelOwnerType: params.channelOwnerType ?? 'business',
        ...(params.channelOwnerId ? { channelOwnerId: params.channelOwnerId } : {}),
        contactName: params.contactName || params.recipientId,
        contactExternalId: params.recipientId,
        ...(phoneFormatted ? { contactPhone: phoneFormatted } : {}),
        ...(params.contactId ? { crmContactId: params.contactId } : {}),
        status: 'open',
        lastMessage: params.content.slice(0, 200),
        lastMessageAt: now,
        lastMessageDirection: 'outbound',
        unreadCount: 0,         // outbound não conta como não-lida
        firstResponseAt: now,
        createdAt: now,
        updatedAt: now,
      };
      const convRef = await adminDb.collection('conversations').add(newConvData);
      conversationId = convRef.id;
    }

    // Append da mensagem outbound
    const msgData: Record<string, unknown> = {
      conversationId,
      businessId: params.businessId,
      channel: params.channel,
      direction: 'outbound',
      content: params.content,
      status: 'sent',
      senderName: 'Campanha',
      isFromCampaign: true,
      broadcastId: params.broadcastId,
      broadcastMessageId: params.broadcastMessageId,
      sentAt: now,
      createdAt: now,
    };
    if (params.externalMessageId) msgData.externalMessageId = params.externalMessageId;
    if (params.connectedVia) msgData.connectedVia = params.connectedVia;
    await adminDb.collection('conversationMessages').add(msgData);
  } catch (err) {
    // Não-crítico: a mensagem já foi entregue. Loga pra debug.
    console.warn('[Broadcast] upsertConversationFromBroadcast failed:', err);
  }
}

/** Formata número BR pra display em contactPhone (espelha lógica do webhook). */
function formatBrPhoneForBroadcast(externalId: string): string | undefined {
  const digits = externalId.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    // 55 + DDD(2) + 9 + 8 → +55 (DD) 9XXXX-XXXX
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return undefined;
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
      // body cru do template (com {{N}} placeholders) — frontend persiste do
      // TemplateSelector. Usado pra renderizar conteúdo da conversa.
      templateBody,
      messageContent,
      emailSubject,
      recipients: rawRecipients,
      sendRate = 10,
      phoneNumberId,
      /** Quando true, envia via Baileys (WhatsApp Web) em vez de Cloud API. Só vale para channel === 'whatsapp'. */
      viaBaileys = false,
      /**
       * Throttle anti-spam: delay aleatório entre msgs + batches com pausa
       * longa. Quando presente, sobrepõe sendRate. Compatível com {sendRate}
       * antigo — ausência cai no comportamento legado.
       */
      throttle,
      /**
       * Quando definido, dispara apenas os primeiros N recipientes desta
       * vez. Pré-cria broadcastMessages para TODOS (assim resume funciona
       * naturalmente), mas só processa os primeiros N no loop. Status
       * final fica 'paused' — operador retoma com os restantes via botão
       * "Retomar".
       */
      maxRecipients,
      /**
       * Sessão de envio. Quando ausente, é calculado server-side como
       * `(broadcast.sessions?.length ?? 0) + 1` no momento do dispatch.
       * Frontend pode passar pra controlar (ex: retry de uma sessão), mas
       * em geral deixa server resolver pra evitar race entre múltiplos
       * dispatches concorrentes.
       */
      sessionIndex: sessionIndexFromBody,
      dispatchedByName,
    } = body;

    if (!businessId || !broadcastId || !rawRecipients?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // dispatcher* hoisted aqui pra que o append da sessão lá no fim consiga
    // gravar quem disparou (auditoria). Cron call deixa undefined.
    let dispatcherUid: string | undefined;

    if (!isCronCall) {
      const authResult = await verifyAuth(req, businessId);
      if (isAuthError(authResult)) return authResult;
      dispatcherUid = authResult.uid;

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
    const broadcastData = broadcastSnap.data();
    if (broadcastData?.businessId !== businessId) {
      return NextResponse.json({ error: 'Broadcast does not belong to this business' }, { status: 403 });
    }

    // 5.12 LGPD: bloqueia envio se broadcast não tem base legal registrada.
    // Validação é no SERVER (não confia só no client) — campanhas legadas
    // (criadas antes de 5.12) precisam ser deletadas/recriadas para enviar.
    const consentBasis = broadcastData?.consentBasis as string | undefined;
    const VALID_CONSENT_BASES = ['explicit', 'legitimate-interest', 'transactional'];
    if (!consentBasis || !VALID_CONSENT_BASES.includes(consentBasis)) {
      return NextResponse.json({
        error: 'Broadcast sem base legal LGPD registrada (consentBasis ausente ou inválida). Recrie a campanha após o update do sistema.',
      }, { status: 400 });
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
    let channels = businessData.channels;
    // Email não usa channels da Meta — só o branch email tem checagem própria
    if (channel !== 'email' && !channels) {
      // Pode ser que o business não tenha o legado `channels` populado ainda mas
      // tenha uma channelConnections — não falha aqui, deixa o resolver abaixo
      // construir o credentials a partir da connection escolhida.
      channels = {};
    }

    // Resolve channelConnection específica do broadcast, quando setada. Permite
    // ao operador escolher canal pessoal (ownerType='user') ou um Baileys
    // não-primary. Quando ausente, mantém o fallback legado em `channels`.
    const broadcastConnectionId = broadcastData?.channelConnectionId as string | undefined;
    let resolvedConnectionId: string | undefined;
    // Captura ownerType/ownerId pra denormalizar nas conversas criadas a partir
    // do broadcast (rules de privacidade dependem desses campos).
    let resolvedOwnerType: 'business' | 'user' = 'business';
    let resolvedOwnerId: string | undefined;
    if (channel !== 'email' && broadcastConnectionId) {
      const connSnap = await adminDb.collection('channelConnections').doc(broadcastConnectionId).get();
      if (!connSnap.exists) {
        return NextResponse.json({
          error: `Canal escolhido na campanha (${broadcastConnectionId}) não foi encontrado. Edite a campanha e selecione outro canal.`,
        }, { status: 400 });
      }
      const connData = connSnap.data() as import('@/lib/types').ChannelConnection;
      if (connData.businessId !== businessId) {
        return NextResponse.json({ error: 'Canal escolhido pertence a outro business' }, { status: 403 });
      }
      resolvedOwnerType = connData.ownerType === 'user' ? 'user' : 'business';
      if (connData.ownerType === 'user' && connData.ownerId) resolvedOwnerId = connData.ownerId;
      // Valida que o tipo da connection casa com o canal/modo do broadcast.
      const expectedType = channel === 'whatsapp'
        ? (viaBaileys ? 'whatsapp_baileys' : 'whatsapp_cloud')
        : channel;
      if (connData.type !== expectedType) {
        return NextResponse.json({
          error: `Canal escolhido (tipo ${connData.type}) não combina com canal/modo da campanha (${expectedType}).`,
        }, { status: 400 });
      }
      if (!connData.isConnected || !connData.isActive) {
        return NextResponse.json({
          error: `Canal escolhido na campanha está desconectado/inativo. Reconecte em Configurações → Canais.`,
        }, { status: 400 });
      }
      // Reescreve o slot correspondente em `channels` com as credentials da
      // connection escolhida — o resto do fluxo (Cloud/FB/IG) continua lendo
      // de `channels` sem precisar de outra branch.
      const { buildLegacyChannelsFromConnection } = await import('@/lib/services/channels/channelConnections');
      const fromConn = buildLegacyChannelsFromConnection({ ...connData, id: connSnap.id });
      channels = { ...(channels || {}), ...fromConn };
      resolvedConnectionId = connSnap.id;
    }

    let token: string;
    let resolvedPhoneNumberId = phoneNumberId;
    // Branch email: SMTP per-business é resolvido aqui e reusado no loop.
    // Decifra apenas 1 vez antes do loop (não 1 vez por recipient).
    let emailSmtpPass: string | undefined;
    let emailSmtpConfig: { host: string; port: number; secure: boolean; user: string; from: string } | undefined;

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
      // Email broadcasts são delegados ao notification-server externo.
      // URL e API key são GLOBAIS (env vars do saas-erp) — compartilhadas
      // entre todos os businesses. Apenas o SMTP é per-business (cada cliente
      // usa seu próprio remetente: Gmail/Outlook/SendGrid/etc.).
      const nsUrl = (process.env.NOTIFICATION_SERVER_URL || '').replace(/\/+$/, '');
      const nsApiKey = process.env.NOTIFICATION_SERVER_API_KEY || '';
      if (!nsUrl || !nsApiKey) {
        return NextResponse.json({
          error: 'Servidor não configurado: NOTIFICATION_SERVER_URL/API_KEY ausentes no .env',
        }, { status: 500 });
      }
      if (!/^https?:\/\//i.test(nsUrl)) {
        return NextResponse.json({
          error: 'NOTIFICATION_SERVER_URL deve começar com http:// ou https://',
        }, { status: 500 });
      }
      // SMTP per-business — obrigatório
      const nsConfig = businessData.settings?.notificationServer;
      if (!nsConfig?.isConfigured || !nsConfig?.smtp?.host || !nsConfig?.smtp?.user || !nsConfig?.smtp?.pass) {
        return NextResponse.json({
          error: 'SMTP do business não configurado. Acesse Configurações → Enterprise → SMTP de Email.',
        }, { status: 400 });
      }
      // Decifra a senha SMTP (encriptada com encryptToken)
      try {
        emailSmtpPass = await decryptToken(nsConfig.smtp.pass);
      } catch {
        return NextResponse.json({
          error: 'Erro ao descriptografar senha SMTP — refazer config do business',
        }, { status: 500 });
      }
      emailSmtpConfig = {
        host: nsConfig.smtp.host,
        port: nsConfig.smtp.port,
        secure: !!nsConfig.smtp.secure,
        user: nsConfig.smtp.user,
        from: nsConfig.smtp.from || nsConfig.smtp.user,
      };
      token = nsApiKey;
      resolvedPhoneNumberId = nsUrl; // reuso do parâmetro pra carregar URL do NS
    } else {
      return NextResponse.json({ error: `Invalid channel: ${channel}` }, { status: 400 });
    }

    /**
     * Resolução de throttle:
     *  1) Se body.throttle vier (UI nova): usa delays aleatórios + batches.
     *  2) Senão, fallback ao sendRate antigo (msgs/seg fixo).
     *
     * pickDelay: gera int aleatório uniforme em [min, max] ms.
     */
    const sanitizedThrottle: import('@/lib/types').SendThrottle | null =
      throttle && typeof throttle === 'object' &&
      Number.isFinite(throttle.delayMinMs) && Number.isFinite(throttle.delayMaxMs) &&
      throttle.delayMinMs >= 0 && throttle.delayMaxMs >= throttle.delayMinMs
        ? {
            delayMinMs: Math.min(throttle.delayMinMs, 600_000),
            delayMaxMs: Math.min(throttle.delayMaxMs, 600_000),
            ...(throttle.batchSize > 0 ? { batchSize: Math.min(throttle.batchSize, 1000) } : {}),
            ...(throttle.batchPauseMinMs > 0 ? { batchPauseMinMs: Math.min(throttle.batchPauseMinMs, 3_600_000) } : {}),
            ...(throttle.batchPauseMaxMs > 0 ? { batchPauseMaxMs: Math.min(throttle.batchPauseMaxMs, 3_600_000) } : {}),
          }
        : null;
    const fallbackDelayMs = Math.max(1000 / sendRate, 50);
    function pickDelay(min: number, max: number): number {
      if (max <= min) return min;
      return min + Math.floor(Math.random() * (max - min + 1));
    }
    function nextMessageDelay(): number {
      if (sanitizedThrottle) return pickDelay(sanitizedThrottle.delayMinMs, sanitizedThrottle.delayMaxMs);
      return fallbackDelayMs;
    }
    const delayMs = fallbackDelayMs; // mantido pra compat com pause-check (TTL cap)

    // Idempotência: CAS draft/sent/failed → sending. Bloqueia duplo-clique e re-trigger.
    // Também resolve sessionIndex dentro da transação pra evitar race entre
    // múltiplos dispatches concorrentes que tentariam usar o mesmo index.
    const broadcastRef = adminDb.collection('broadcasts').doc(broadcastId);
    let resolvedSessionIndex: number;
    try {
      resolvedSessionIndex = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(broadcastRef);
        if (!snap.exists) {
          // Doc pode não existir em testes — tolera, retorna 1 como default
          return 1;
        }
        const data = snap.data();
        const status = data?.status;
        // Cron: process-scheduled já fez CAS scheduled→sending e nos chamou.
        // Status='sending' é ESPERADO nesse caso.
        if (status === 'sending' && !isCronCall) {
          throw new Error('CONCURRENT_SEND');
        }
        // Sessão: index = (max existente) + 1. Se body forçou um valor, usa
        // ele (caso de retry ou manipulação manual).
        const existingSessions = (data?.sessions ?? []) as Array<{ index?: number }>;
        const nextIndex = typeof sessionIndexFromBody === 'number' && sessionIndexFromBody > 0
          ? sessionIndexFromBody
          : existingSessions.reduce((max, s) => Math.max(max, s.index ?? 0), 0) + 1;
        // stats.total preserva o tamanho ORIGINAL da campanha (set só na
        // primeira sessão). Sem isso, retomadas parciais sobrescreviam total
        // com a contagem de pendentes restantes — broadcast com 100 alvos
        // virava "25 recipientes" depois da última retomada (mentira).
        const isFirstSession = existingSessions.length === 0
          && (typeof data?.stats?.total !== 'number' || data.stats.total === 0);
        const update: Record<string, unknown> = {
          status: 'sending',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (isFirstSession) update['stats.total'] = recipients.length;
        tx.update(broadcastRef, update);
        return nextIndex;
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
    // IMPORTANTE: pré-criamos para TODOS os recipients, mesmo quando o operador
    // optou por dispatch parcial (maxRecipients < total). Os que não forem
    // processados nesta rodada ficam pending → resume retoma normalmente.
    // Cada msg leva sessionIndex pra tracking individual por dispatch.
    const messageDocIds = await preCreateBroadcastMessages(businessId, broadcastId, recipients, consentBasis, resolvedSessionIndex);

    // Dispatch parcial: trunca o iteration target. Total stats refletem o
    // recorte (truncado). Status final = 'paused' (mesmo fluxo do pause manual).
    const totalRecipients = recipients.length;
    const sanitizedMaxRecipients = Number.isFinite(maxRecipients) && maxRecipients > 0 && maxRecipients < totalRecipients
      ? Math.floor(maxRecipients)
      : null;
    const recipientsToProcess = sanitizedMaxRecipients !== null
      ? recipients.slice(0, sanitizedMaxRecipients)
      : recipients;
    const messageDocIdsToProcess = sanitizedMaxRecipients !== null
      ? messageDocIds.slice(0, sanitizedMaxRecipients)
      : messageDocIds;
    const isPartialDispatch = sanitizedMaxRecipients !== null;
    if (isPartialDispatch) {
      console.log(`[Broadcast] partial dispatch: processing ${recipientsToProcess.length}/${totalRecipients} recipients`);
    }

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
    for (let i = 0; i < recipientsToProcess.length; i++) {
      const recipient = recipientsToProcess[i];
      const messageDocId = messageDocIdsToProcess[i];
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
            resolvedConnectionId,
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
          // Upsert na aba Conversas (find-or-create + append outbound msg) —
          // sem isso a campanha sumia da timeline do contato no Aevo.
          await upsertConversationFromBroadcast({
            businessId,
            channel: 'whatsapp',
            recipientId: recipient.recipientId,
            contactName: recipient.name,
            contactId: recipient.contactId,
            content: messageContent || '',
            externalMessageId,
            broadcastId,
            broadcastMessageId: messageDocId,
            connectedVia: 'baileys',
            channelConnectionId: resolvedConnectionId,
            channelOwnerType: resolvedOwnerType,
            channelOwnerId: resolvedOwnerId,
          });
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
        // Throttle: usa o configurado (com aleatoriedade), mas força mínimo
        // de 2s pra Baileys mesmo se o operador configurou menor — protege
        // o número contra banimento por envio uniformemente rápido.
        const baileysDelay = Math.max(nextMessageDelay(), 2000);
        await sleep(baileysDelay);
        // Pausa de batch (se configurada) — Baileys também respeita
        if (sanitizedThrottle?.batchSize && sanitizedThrottle.batchSize > 0
            && (i + 1) % sanitizedThrottle.batchSize === 0
            && i + 1 < recipientsToProcess.length) {
          const batchPause = pickDelay(
            sanitizedThrottle.batchPauseMinMs ?? 60_000,
            sanitizedThrottle.batchPauseMaxMs ?? 180_000,
          );
          console.log(`[Broadcast] batch pause: ${Math.round(batchPause / 1000)}s after msg ${i + 1}`);
          await sleep(batchPause);
        }
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
          // 5.12: pula o footer para comunicações transacionais — esses não
          // são marketing (LGPD não exige opt-out) e o link confunde clientes.
          let messageWithFooter = messageContent || '';
          if (consentBasis !== 'transactional') {
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
          }
          // Fallback de texto puro para clientes que não renderizam HTML
          // (também é o body do multipart text/plain; nodemailer envia ambos
          // quando ambos estão presentes — best practice de email).
          const textFallback = messageWithFooter
            .replace(/<\/(p|div|h[1-6]|li)[^>]*>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          // resolvedPhoneNumberId = NS URL global; token = API key global do NS.
          // SMTP do business vai NO BODY — NS é stateless, não busca SMTP no Firebase.
          response = await fetch(`${resolvedPhoneNumberId}/api/send-email`, {
            method: 'POST',
            headers: {
              'x-api-key': token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              appId: businessId,
              email: recipient.recipientId,
              subject: emailSubject || 'Mensagem',
              // `message` = text fallback (multipart text/plain).
              // `html` = corpo rico com footer de descadastro (multipart text/html).
              // Notification-server passa ambos pro nodemailer — clientes modernos
              // renderizam o HTML, antigos veem o text.
              message: textFallback,
              html: messageWithFooter,
              // SMTP credentials do business — NS prioriza esse sobre Firestore/env globais.
              smtp: emailSmtpConfig && emailSmtpPass ? {
                host: emailSmtpConfig.host,
                port: emailSmtpConfig.port,
                secure: emailSmtpConfig.secure,
                user: emailSmtpConfig.user,
                pass: emailSmtpPass,
                from: emailSmtpConfig.from,
              } : undefined,
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
          // Upsert na aba Conversas (Cloud / FB / IG). Email é skipado por
          // não ter conversa correspondente no módulo de Conversas. Para
          // template: renderiza o body com placeholders {{N}} substituídos
          // pelos params resolvidos pra este recipiente — assim a aba mostra
          // o texto real recebido pelo destinatário, não "[Template: nome]".
          if (channel !== 'email') {
            let displayContent = messageContent || '';
            if (!displayContent && templateName) {
              if (templateBody) {
                const values = resolveTemplateValues(templateParams, recipient);
                displayContent = renderTemplateBody(templateBody, values);
              } else {
                // Fallback pra broadcasts antigos (criados antes da feature
                // de persistir templateBody) — usa o nome como referência.
                displayContent = `[Template: ${templateName}]`;
              }
            }
            await upsertConversationFromBroadcast({
              businessId,
              channel: channel as 'whatsapp' | 'facebook' | 'instagram',
              recipientId: recipient.recipientId,
              contactName: recipient.name,
              contactId: recipient.contactId,
              content: displayContent,
              externalMessageId: messageId,
              broadcastId,
              broadcastMessageId: messageDocId,
              connectedVia: channel === 'whatsapp' ? 'embedded_signup' : undefined,
              channelConnectionId: resolvedConnectionId,
              channelOwnerType: resolvedOwnerType,
              channelOwnerId: resolvedOwnerId,
            });
          }
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

      // Throttle entre msgs: delay aleatório se throttle configurado, senão
      // delayMs fixo (sendRate legado).
      await sleep(nextMessageDelay());
      // Pausa de batch — só dispara quando atingiu múltiplo do batchSize e
      // ainda há mais msgs pra enviar. Se for a última do batch+última do
      // envio total, pula a pausa (não tem motivo).
      if (sanitizedThrottle?.batchSize && sanitizedThrottle.batchSize > 0
          && (i + 1) % sanitizedThrottle.batchSize === 0
          && i + 1 < recipientsToProcess.length) {
        const batchPause = pickDelay(
          sanitizedThrottle.batchPauseMinMs ?? 60_000,
          sanitizedThrottle.batchPauseMaxMs ?? 180_000,
        );
        console.log(`[Broadcast] batch pause: ${Math.round(batchPause / 1000)}s after msg ${i + 1}`);
        await sleep(batchPause);
      }
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
      // Status final:
      //   - 'paused' se pause manual no meio do loop OU dispatch parcial
      //   - 'failed' só se TODAS as msgs processadas falharam
      //   - 'sent' caso contrário
      const isParcialOuPaused = wasPaused || isPartialDispatch;
      const computedStatus = isParcialOuPaused
        ? 'paused'
        : (failed === recipientsToProcess.length ? 'failed' : 'sent');

      // Race window: depois da última iteração (pause-check feita) e antes
      // deste update, o operador pode ter clicado Pausar via /pause endpoint.
      // Sem CAS, sobrescrevemos 'paused' com 'sent'. runTransaction garante
      // que só atualizamos status se ainda está 'sending'; caso contrário,
      // só atualiza stats sem mexer em status terminal já gravado.
      //
      // Stats agora são CUMULATIVOS via FieldValue.increment (antes overwrite).
      // Sem isso, dispatch parcial #2 zerava o stats.sent do parcial #1 — o
      // contador no broadcast list mostrava só o último run, e a soma das
      // sessões nunca batia com a realidade de broadcastMessages.
      const broadcastRef = adminDb.collection('broadcasts').doc(broadcastId);
      const { FieldValue } = await import('firebase-admin/firestore');
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(broadcastRef);
        if (!snap.exists) return;
        const currentData = snap.data();
        const currentStatus = currentData?.status as string | undefined;
        // stats.total ficou setado na primeira sessão (no CAS inicial). Não
        // sobrescreve aqui — manter o tamanho original da campanha mesmo
        // após retomadas parciais (que processam só os pendentes).
        const update: Record<string, unknown> = {
          'stats.sent': FieldValue.increment(sent),
          'stats.failed': FieldValue.increment(failed),
          // Append metadata da sessão recém-executada. dispatchedByName
          // tem fallback inteligente: nome do operador (UI), uid bruto, ou
          // "Sistema (agendado)" pra cron de scheduled broadcasts. Sem
          // isso, a auditoria de sessões disparadas por cron mostrava só
          // "—" / undefined.
          sessions: FieldValue.arrayUnion({
            index: resolvedSessionIndex,
            dispatchedAt: new Date().toISOString(),
            recipientCount: recipientsToProcess.length,
            dispatchedByName: (typeof dispatchedByName === 'string' && dispatchedByName)
              || dispatcherUid
              || (isCronCall ? 'Sistema (agendado)' : 'Desconhecido'),
            ...(dispatcherUid ? { dispatchedBy: dispatcherUid } : {}),
          }),
          updatedAt: new Date().toISOString(),
        };
        // Só sobrescreve status se ainda estamos no estado 'sending' que entramos.
        // Se virou 'paused' (operador clicou Pausar nos últimos ms), preserva.
        if (currentStatus === 'sending') {
          update.status = computedStatus;
          if (!isParcialOuPaused) update.completedAt = new Date().toISOString();
        }
        tx.update(broadcastRef, update);
      });
    } catch (statsErr) {
      console.error('[Broadcast] Failed to update stats:', statsErr);
    }

    return NextResponse.json({
      success: true,
      broadcastId,
      paused: wasPaused || isPartialDispatch,
      partial: isPartialDispatch,
      stats: {
        total: totalRecipients,
        processed: recipientsToProcess.length,
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
