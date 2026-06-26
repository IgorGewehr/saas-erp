/**
 * Birthday Campaign Runner — executor recorrente de campanhas de aniversário.
 *
 * Chamado por cron horário (ver /api/birthday-campaigns/run). Cada execução:
 *
 *   1. Carrega todas as campanhas com `enabled === true`.
 *   2. Pra cada campanha cujo `sendAtHour` casa com a hora corrente no fuso
 *      do business → encontra clientes elegíveis.
 *   3. "Cliente elegível" = `birthDate` (MM-DD) === (hoje + daysBeforeBirthday)
 *      MM-DD AND filtros (tipo/status/tags) batem.
 *   4. Idempotência por (campaignId, clientId, ano) via runTransaction —
 *      cron rodando 2x no mesmo dia NÃO manda duplicado.
 *   5. Envia via Cloud (fetch Meta Graph) ou Baileys (sessão local).
 *   6. Persiste log em `birthdayCampaignLogs/{id}` + incrementa stats da
 *      campanha pai atomicamente.
 *
 * Webhook do Meta atualiza `delivered`/`read` posteriormente — ver
 * `app/api/webhooks/meta/route.ts` (updateBirthdayCampaignLogStatus).
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { decryptToken } from '@/lib/utils/encryption';
import { sendBaileysBroadcastMessage } from '@/app/api/whatsapp/baileys-manager';
import {
  detectAndNotifyMissedRun,
  markSuccessfulRun,
} from '@/lib/services/scheduledFallback';
import { upsertConversationFromCampaign } from '@/lib/services/conversationFromCampaign';
import {
  buildTemplateComponents,
  type HeaderMediaPayload,
} from '@/lib/services/channels/whatsappTemplateComponents';
import type {
  BirthdayCampaign,
  BroadcastTemplateParam,
  Client,
  ChannelConnection,
} from '@/lib/types';

const META_GRAPH = 'https://graph.facebook.com/v21.0';
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Janela de tolerância pra catch-up: se o cron não rodou a campanha no
 * slot exato (sendAtHour), permite disparar nas N horas seguintes desde
 * que `lastSuccessfulRunDate !== today`. Cobre falhas comuns:
 *   - Vercel cron delays/throttle no início da hora cheia
 *   - Deploy em andamento na hora exata do slot
 *   - Falha transient no Firestore/Meta no slot
 *
 * 6h é conservador: um cliente que pediu 09:00 ainda recebe até 14:59 no
 * mesmo dia se a janela for usada. Beyond that, fallback notifica o owner.
 */
const CATCHUP_WINDOW_HOURS = 6;

interface RunResult {
  campaignId: string;
  campaignName: string;
  matched: number;
  sent: number;
  failed: number;
  skippedIdempotent: number;
  errors?: string[];
}

interface RunSummary {
  ranAt: string;
  campaignsConsidered: number;
  campaignsExecuted: number;
  results: RunResult[];
}

/**
 * Hora corrente (0-23) no fuso do business. Usa Intl.DateTimeFormat com
 * `hour12: false` — confiável e sem DST surprise (Brasil sem horário de
 * verão desde 2019).
 */
function currentHourInTz(now: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const hour = parts.find(p => p.type === 'hour')?.value ?? '0';
    return Number(hour) % 24;
  } catch {
    // TZ inválido — fallback pra UTC pra não quebrar a campanha inteira
    return now.getUTCHours();
  }
}

/** Data atual YYYY-MM-DD no fuso do business. Usado pra comparar com
 *  `lastSuccessfulRunDate`/`missedRunNotifiedDate` da campanha (idempotência
 *  do fallback de disparo perdido). */
function todayInTz(now: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(now); // en-CA produz YYYY-MM-DD direto
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * "Hoje" no fuso do business como string MM-DD. Deslocada por daysBefore
 * pra calcular target date do aniversário (ex: hoje=04/05, daysBefore=7
 * → target=11/05; mandamos pra quem aniversaria em 11/05).
 */
function targetMmDdInTz(now: Date, tz: string, daysBefore: number): { mmDd: string; year: number } {
  // Calcula a data-alvo somando daysBefore dias. Important: preservar
  // wall-clock no TZ do business — usamos formatToParts.
  const future = new Date(now.getTime() + daysBefore * 86400000);
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    // en-CA produz YYYY-MM-DD direto
    const formatted = fmt.format(future);
    const [yStr, mStr, dStr] = formatted.split('-');
    return { mmDd: `${mStr}-${dStr}`, year: Number(yStr) };
  } catch {
    const m = String(future.getUTCMonth() + 1).padStart(2, '0');
    const d = String(future.getUTCDate()).padStart(2, '0');
    return { mmDd: `${m}-${d}`, year: future.getUTCFullYear() };
  }
}

/**
 * Aplica filtros de tipo/status/tags/sectorId — comuns aos 2 tipos de
 * recorrência (birthday e fixed_date). Extraído pra evitar duplicação
 * entre as branches do findEligibleClients.
 */
function matchesCampaignFilters(c: Client, campaign: BirthdayCampaign): boolean {
  if (c.mergedInto || (c as { deletedAt?: string }).deletedAt) return false;
  const f = campaign.filters;
  if (f?.tipo && f.tipo !== 'all' && c.tipo !== f.tipo) return false;
  if (f?.status?.length && !f.status.includes(c.status)) return false;
  if (f?.tags?.length) {
    const cTags = (c.tags || []).map(t => t.toLowerCase());
    const wanted = f.tags.map(t => t.toLowerCase());
    if (!wanted.every(t => cTags.includes(t))) return false;
  }
  if (f?.sectorId && c.sectorId !== f.sectorId) return false;
  return true;
}

/**
 * Filtra clients eligible pra uma campanha. Branches por recurrenceType:
 *
 *  - 'birthday' (default): match MM-DD do birthDate de CADA contato contra
 *    targetMmDd. Cada cliente é avaliado individualmente — só dispara pros
 *    aniversariantes do dia.
 *
 *  - 'fixed_date': compara campaign.festiveDate (MM-DD da data festiva)
 *    contra targetMmDd. Se bate, TODOS os clientes filtrados disparam (não
 *    é por-contato — é dia X do calendário pra todo mundo). Se não bate, [].
 *
 * Filtros comuns (tipo/status/tags/sectorId) aplicados via matchesCampaignFilters.
 * Docs antigos sem recurrenceType caem na branch 'birthday' (default).
 */
async function findEligibleClients(
  clients: Client[],
  campaign: BirthdayCampaign,
  targetMmDd: string,
): Promise<Client[]> {
  const type = campaign.recurrenceType ?? 'birthday';

  if (type === 'fixed_date') {
    // Dispara só se HOJE (após offset de daysBeforeBirthday) === data resolvida.
    //
    // Data resolvida:
    //  - Se festivePreset setado (ex: 'mothers_day', 'easter'): calcula via
    //    festive-dates util pro ANO do disparo (targetMmDd já carrega o mês/dia
    //    do alvo, então usamos o ano corrente do servidor).
    //  - Senão, usa festiveDate (MM-DD fixo).
    //
    // Sem isso, datas móveis (Páscoa, Carnaval, Mães…) exigiriam ajuste manual
    // MM-DD todo ano — operador esqueceria e a campanha falharia silenciosa.
    let expectedMmDd: string | null = null;
    if (campaign.festivePreset) {
      // Importação lazy pra evitar custo no import-time de quem não usa preset.
      // Util é puro, sem side effects.
      const { resolvePresetMmDd } = await import('@/lib/utils/festive-dates');
      const currentYear = new Date().getFullYear();
      expectedMmDd = resolvePresetMmDd(
        campaign.festivePreset as Parameters<typeof resolvePresetMmDd>[0],
        currentYear,
      );
    } else {
      expectedMmDd = campaign.festiveDate ?? null;
    }
    if (!expectedMmDd || expectedMmDd !== targetMmDd) return [];
    return clients.filter(c => matchesCampaignFilters(c, campaign));
  }

  // type === 'birthday' (default)
  return clients.filter(c => {
    if (!c.birthDate || c.birthDate.length < 10) return false;
    if (c.birthDate.slice(5, 10) !== targetMmDd) return false;
    return matchesCampaignFilters(c, campaign);
  });
}

/**
 * Resolve placeholders {{name}}, {{phone}}, {{email}} num texto livre
 * (Baileys). Cloud não usa esta função — usa templateParams em formato
 * Meta. Mantém parâmetros desconhecidos intactos pro operador detectar.
 */
function renderBaileysMessage(template: string, client: Client): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, client.name || '')
    .replace(/\{\{\s*phone\s*\}\}/gi, client.phone || client.whatsapp || '')
    .replace(/\{\{\s*email\s*\}\}/gi, client.email || '')
    .replace(/\{\{\s*company\s*\}\}/gi, client.company || '');
}

/**
 * Resolve cada `BroadcastTemplateParam` num valor literal pra renderizar
 * o body do template Cloud — espelha a função do broadcasts/send/route.ts
 * mas adaptada pra `Client` (em vez do shape `recipient` do broadcast).
 */
function resolveTemplateValuesForClient(
  params: BroadcastTemplateParam[] | undefined,
  client: Client,
): string[] {
  if (!params?.length) return [];
  return params.map(p => {
    if (p.kind === 'literal') return p.value;
    if (p.kind === 'field') {
      if (p.field === 'name') return client.name || '';
      if (p.field === 'phoneNumber') return client.phone || client.whatsapp || '';
      if (p.field === 'email') return client.email || '';
    }
    return '';
  });
}

/**
 * Substitui `{{1}}`, `{{2}}`, ... no body do template pelos valores
 * resolvidos. Index 1-based (padrão Meta). Sem match → mantém literal.
 */
function renderTemplateBody(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, idxStr) => {
    const idx = parseInt(idxStr, 10) - 1;
    return idx >= 0 && idx < values.length ? values[idx] : match;
  });
}

/**
 * Resolve `BroadcastTemplateParam[]` em `components[]` do Meta, opcionalmente
 * prepondo um componente 'header' quando a campanha tem media header.
 *
 * Antes desta versão, este runner duplicava a lógica de /api/broadcasts/send
 * conscientemente. Com o helper compartilhado `buildTemplateComponents`,
 * a duplicação é só na resolução de placeholder por client (que tem campos
 * diferentes do `recipient` de broadcasts genéricos).
 */
function resolveTemplateComponents(
  params: BroadcastTemplateParam[] | undefined,
  client: Client,
  headerMedia?: HeaderMediaPayload | null,
): unknown[] {
  const bodyParams: string[] = (params ?? []).map(p => {
    if (p.kind === 'literal') return p.value;
    if (p.kind === 'field') {
      if (p.field === 'name') return client.name || '';
      if (p.field === 'phoneNumber') return client.phone || client.whatsapp || '';
      if (p.field === 'email') return client.email || '';
    }
    return '';
  });
  return buildTemplateComponents({ headerMedia, bodyParams });
}

/**
 * Telefone do cliente em formato E.164 (apenas dígitos com DDI). Aceita
 * `whatsapp` ou `phone` — prioriza whatsapp.
 *
 * Heurística cuidadosa pra não corromper números internacionais:
 *   - 10 dígitos com DDD válido BR (11–99) → prepend 55 (ex: 1198765432)
 *   - 11 dígitos com DDD válido BR + 9 mobile (DDD11–99 + 9XXXXXXXX) → prepend 55
 *   - 12-13 dígitos começando com 55 → usa direto (já está em E.164 BR)
 *   - Qualquer outro formato → devolve cru, deixa Meta/Baileys validar
 *
 * Isso evita corromper números internacionais (ex: França +336XXX = 11
 * dígitos quando stripado, mas DDD '33' não é BR válido — mantém cru).
 */
function resolveRecipientPhone(client: Client): string | null {
  const raw = (client.whatsapp || client.phone || '').replace(/\D/g, '');
  if (!raw) return null;
  // BR DDDs vão de 11 a 99 (não há DDD começando com 0, 1 ou 2 sozinhos).
  // Validação simples: primeiros 2 dígitos numa faixa plausível BR.
  const looksLikeBrDdd = (digits: string): boolean => {
    const ddd = Number(digits.slice(0, 2));
    return ddd >= 11 && ddd <= 99;
  };
  // 10 dígitos: DDD + 8 (fixo BR)
  if (raw.length === 10 && looksLikeBrDdd(raw)) return `55${raw}`;
  // 11 dígitos: DDD + 9 + 8 (mobile BR pós-2012). Confirma que char 3 é '9'
  // (mobile prefix). Sem isso, número intl 11 dígitos vira BR errado.
  if (raw.length === 11 && looksLikeBrDdd(raw) && raw[2] === '9') return `55${raw}`;
  // 12-13 dígitos com 55 inicial — já está em E.164 BR
  if ((raw.length === 12 || raw.length === 13) && raw.startsWith('55')) return raw;
  // Outros formatos (intl, ou inválido) — devolve cru, Meta/Baileys validam
  return raw;
}

/**
 * Tenta criar log idempotente. Retorna `true` se OK pra enviar; `false`
 * se já foi enviado neste ano (skip). Usa transação pra evitar race entre
 * múltiplas execuções concorrentes do cron.
 */
async function tryClaimLog(params: {
  logId: string;
  campaignId: string;
  businessId: string;
  clientId: string;
  year: number;
  recipientPhone: string;
  contactName: string;
}): Promise<boolean> {
  const ref = adminDb.collection('birthdayCampaignLogs').doc(params.logId);
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) return false; // já enviado neste ano
    tx.set(ref, {
      campaignId: params.campaignId,
      businessId: params.businessId,
      clientId: params.clientId,
      year: params.year,
      recipientPhone: params.recipientPhone,
      contactName: params.contactName,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    return true;
  });
}

async function markLogSent(logId: string, externalMessageId: string): Promise<void> {
  await adminDb.collection('birthdayCampaignLogs').doc(logId).update({
    status: 'sent',
    externalMessageId,
    sentAt: new Date().toISOString(),
  });
}

async function markLogFailed(logId: string, error: string): Promise<void> {
  await adminDb.collection('birthdayCampaignLogs').doc(logId).update({
    status: 'failed',
    errorMessage: error.slice(0, 500),
    failedAt: new Date().toISOString(),
  });
}

async function incrementCampaignStats(
  campaignId: string,
  field: 'totalSent' | 'totalFailed',
  matched: number,
): Promise<void> {
  await adminDb.collection('birthdayCampaigns').doc(campaignId).update({
    [`stats.${field}`]: FieldValue.increment(1),
    'stats.lastRanAt': new Date().toISOString(),
    'stats.lastRunMatched': matched,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Resolve metadados de ownership do canal usado pela campanha. Necessário
 * pra denormalizar `channelOwnerType`/`channelOwnerId` na conversa criada
 * — rules de privacidade dependem desses campos pra controle de visibilidade
 * por usuário/setor. Sem isso, conversas geradas via cron ficam invisíveis
 * pra membros não-admin do business.
 */
async function resolveChannelMeta(connectionId?: string): Promise<{
  channelOwnerType: 'business' | 'user';
  channelOwnerId?: string;
}> {
  if (!connectionId) return { channelOwnerType: 'business' };
  try {
    const connSnap = await adminDb.collection('channelConnections').doc(connectionId).get();
    if (!connSnap.exists) return { channelOwnerType: 'business' };
    const conn = connSnap.data() as ChannelConnection;
    if (conn.ownerType === 'user' && conn.ownerId) {
      return { channelOwnerType: 'user', channelOwnerId: conn.ownerId };
    }
    return { channelOwnerType: 'business' };
  } catch {
    return { channelOwnerType: 'business' };
  }
}

/**
 * Resolve credenciais Cloud do business pra envio direto. Reusa a config
 * `channels.whatsappCloud` (com fallback legado a `channels.whatsapp`).
 */
async function resolveCloudCredentials(businessId: string, connectionId?: string): Promise<{
  accessToken: string;
  phoneNumberId: string;
} | null> {
  // Se conexão específica indicada, usa ela
  if (connectionId) {
    const connSnap = await adminDb.collection('channelConnections').doc(connectionId).get();
    if (!connSnap.exists) return null;
    const conn = connSnap.data() as { businessId: string; accessToken?: string; phoneNumberId?: string; isActive?: boolean; isConnected?: boolean };
    if (conn.businessId !== businessId) return null;
    if (!conn.isActive || !conn.isConnected || !conn.accessToken || !conn.phoneNumberId) return null;
    const accessToken = await decryptToken(conn.accessToken);
    return { accessToken, phoneNumberId: conn.phoneNumberId };
  }
  // Caso contrário usa a primary do business
  const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
  const data = bizSnap.data() as { channels?: { whatsappCloud?: { accessToken?: string; phoneNumberId?: string; isConnected?: boolean }; whatsapp?: { accessToken?: string; phoneNumberId?: string; isConnected?: boolean; connectedVia?: string } } };
  const cloudCfg = data?.channels?.whatsappCloud;
  const legacyCfg = data?.channels?.whatsapp;
  const useLegacy = !cloudCfg && legacyCfg?.connectedVia !== 'baileys';
  const cfg = cloudCfg ?? (useLegacy ? legacyCfg : undefined);
  if (!cfg?.isConnected || !cfg.accessToken || !cfg.phoneNumberId) return null;
  return { accessToken: await decryptToken(cfg.accessToken), phoneNumberId: cfg.phoneNumberId };
}

/**
 * Executa uma campanha individual: encontra clients eligible, dispara mensagem
 * com idempotência, atualiza logs e stats.
 */
async function executeCampaign(
  campaign: BirthdayCampaign,
  clients: Client[],
  now: Date,
  tz: string,
): Promise<RunResult> {
  const result: RunResult = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    matched: 0,
    sent: 0,
    failed: 0,
    skippedIdempotent: 0,
    errors: [],
  };

  const { mmDd, year } = targetMmDdInTz(now, tz, campaign.daysBeforeBirthday);
  const matches = await findEligibleClients(clients, campaign, mmDd);
  result.matched = matches.length;

  if (matches.length === 0) {
    // Atualiza lastRanAt mesmo sem match — operador vê que cron rodou
    await adminDb.collection('birthdayCampaigns').doc(campaign.id).update({
      'stats.lastRanAt': new Date().toISOString(),
      'stats.lastRunMatched': 0,
      updatedAt: new Date().toISOString(),
    }).catch(() => {/* doc pode ter sido deletado */});
    return result;
  }

  // Resolve credenciais Cloud uma vez (Baileys pega da sessão local
  // a cada chamada; Cloud é stateless e cara de decifrar token).
  let cloudCreds: { accessToken: string; phoneNumberId: string } | null = null;
  if (!campaign.viaBaileys) {
    cloudCreds = await resolveCloudCredentials(campaign.businessId, campaign.channelConnectionId);
    if (!cloudCreds) {
      const errMsg = 'Cloud credentials not configured for this campaign';
      result.errors!.push(errMsg);
      console.error(`[BirthdayRunner] ${campaign.id}: ${errMsg}`);
      return result;
    }
  }

  // Resolve owner metadata uma vez — usado pra denormalizar nas conversas
  // criadas a partir dos envios (rules de privacidade dependem disso).
  const channelMeta = await resolveChannelMeta(campaign.channelConnectionId);

  for (const client of matches) {
    const phone = resolveRecipientPhone(client);
    if (!phone) {
      result.failed++;
      result.errors!.push(`${client.name}: sem telefone`);
      continue;
    }

    const logId = `${campaign.id}_${client.id}_${year}`;
    let claimed = false;
    try {
      claimed = await tryClaimLog({
        logId,
        campaignId: campaign.id,
        businessId: campaign.businessId,
        clientId: client.id,
        year,
        recipientPhone: phone,
        contactName: client.name,
      });
    } catch (err) {
      console.error(`[BirthdayRunner] claim transaction failed for ${logId}:`, err);
      result.failed++;
      result.errors!.push(`${client.name}: erro de idempotência`);
      continue;
    }

    if (!claimed) {
      result.skippedIdempotent++;
      continue;
    }

    // Envia
    try {
      let externalMessageId = '';
      // Conteúdo renderizado pra exibir na aba Conversas. Calculado antes
      // do envio (Baileys: texto cru já com placeholders resolvidos; Cloud:
      // body do template renderizado com os params do cliente).
      let renderedContent = '';

      if (campaign.viaBaileys) {
        renderedContent = renderBaileysMessage(campaign.messageContent || '', client);
        const sent = await sendBaileysBroadcastMessage(
          campaign.businessId,
          phone,
          renderedContent,
          campaign.channelConnectionId,
        );
        externalMessageId = sent.externalMessageId;
      } else {
        // Cloud: template
        if (!campaign.templateName) throw new Error('Cloud campaign missing templateName');
        // Renderiza o body cru (com {{N}}) substituindo os params resolvidos
        // pro cliente. Fallback pro nome do template se body cru não foi
        // persistido (campanhas antigas criadas antes do campo templateBody).
        const values = resolveTemplateValuesForClient(campaign.templateParams, client);
        renderedContent = campaign.templateBody
          ? renderTemplateBody(campaign.templateBody, values)
          : `[Template: ${campaign.templateName}]`;
        const response = await fetch(`${META_GRAPH}/${cloudCreds!.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cloudCreds!.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
              name: campaign.templateName,
              language: { code: campaign.templateLanguage || 'pt_BR' },
              components: resolveTemplateComponents(campaign.templateParams, client, campaign.headerMedia),
            },
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const metaErr = data?.error?.message || `HTTP ${response.status}`;
          throw new Error(metaErr);
        }
        const data = await response.json();
        externalMessageId = data?.messages?.[0]?.id || '';
      }

      await markLogSent(logId, externalMessageId);
      await incrementCampaignStats(campaign.id, 'totalSent', matches.length);
      result.sent++;

      // Espelha a conversa pra que a mensagem apareça na aba Conversas do
      // operador — mesma correção aplicada em broadcasts pontuais (commit
      // 6f949d3). Best-effort: falha aqui não interrompe próximos envios.
      await upsertConversationFromCampaign({
        adminDb,
        businessId: campaign.businessId,
        channel: 'whatsapp',
        recipientId: phone,
        contactName: client.name,
        content: renderedContent,
        externalMessageId: externalMessageId || undefined,
        source: {
          kind: 'birthday',
          birthdayCampaignId: campaign.id,
          birthdayCampaignLogId: logId,
        },
        connectedVia: campaign.viaBaileys ? 'baileys' : 'embedded_signup',
        channelConnectionId: campaign.channelConnectionId,
        channelOwnerType: channelMeta.channelOwnerType,
        channelOwnerId: channelMeta.channelOwnerId,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[BirthdayRunner] send failed for ${client.name} (${campaign.id}):`, errMsg);
      await markLogFailed(logId, errMsg).catch(() => {/* já contabilizado em failed */});
      await incrementCampaignStats(campaign.id, 'totalFailed', matches.length).catch(() => {/* */});
      result.failed++;
      result.errors!.push(`${client.name}: ${errMsg}`);
    }
  }

  return result;
}

/**
 * Entry-point do cron. Orquestra a busca de campanhas, agrupa por business
 * (evita ler `clients` várias vezes pro mesmo tenant) e executa cada uma.
 */
export async function runBirthdayCampaigns(now: Date = new Date()): Promise<RunSummary> {
  const summary: RunSummary = {
    ranAt: now.toISOString(),
    campaignsConsidered: 0,
    campaignsExecuted: 0,
    results: [],
  };

  // 1. Carrega TODAS as campanhas habilitadas. Volume tipicamente baixo
  //    (1-5 por business; mesmo com 1000 businesses são 1000-5000 docs).
  const campaignsSnap = await adminDb.collection('birthdayCampaigns')
    .where('enabled', '==', true)
    .get();

  if (campaignsSnap.empty) return summary;

  // 2. Agrupa por businessId pra ler clients uma vez por tenant.
  const byBusiness = new Map<string, BirthdayCampaign[]>();
  for (const doc of campaignsSnap.docs) {
    const c = { ...(doc.data() as BirthdayCampaign), id: doc.id };
    summary.campaignsConsidered++;
    const list = byBusiness.get(c.businessId) ?? [];
    list.push(c);
    byBusiness.set(c.businessId, list);
  }

  // 3. Pra cada business: lê TZ + clients UMA vez, depois executa cada campanha.
  for (const [businessId, campaigns] of byBusiness.entries()) {
    // Resolve TZ
    let tz = DEFAULT_TIMEZONE;
    try {
      const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
      const bizData = bizSnap.data() as { settings?: { timezone?: string } } | undefined;
      if (bizData?.settings?.timezone) tz = bizData.settings.timezone;
    } catch (err) {
      console.warn(`[BirthdayRunner] TZ lookup failed for ${businessId}, using default:`, err);
    }

    const currentHour = currentHourInTz(now, tz);
    const today = todayInTz(now, tz);

    // Filtra campanhas devidas: hora exata OU dentro da janela de catch-up.
    // Catch-up: se o cron pulou o slot por algum motivo (deploy, throttle
    // da Vercel, deploy quebrado), tentamos disparar nas próximas 6h enquanto
    // a campanha NÃO tiver rodado com sucesso hoje. Idempotência por
    // (campaign, client, year) protege contra disparo duplicado mesmo se
    // strict-match e catch-up rodarem no mesmo dia.
    const dueCampaigns = campaigns.filter(c => {
      // Hora exata — caminho normal
      if (c.sendAtHour === currentHour) return true;
      // Já rodou com sucesso hoje — não re-fire (evita trabalho redundante)
      if (c.lastSuccessfulRunDate === today) return false;
      // Catch-up: até CATCHUP_WINDOW_HOURS após o slot
      const hoursLate = currentHour - c.sendAtHour;
      return hoursLate > 0 && hoursLate <= CATCHUP_WINDOW_HOURS;
    });

    // ─── Fallback: notifica campanhas que perderam o slot E também a
    //     janela de catch-up. Idempotente via missedRunNotifiedDate.
    //     Truque: passamos slotHour = sendAtHour + CATCHUP_WINDOW_HOURS,
    //     então o detector só dispara DEPOIS que o catch-up já desistiu.
    for (const c of campaigns) {
      if (!c.enabled) continue;
      const hourStr = String(c.sendAtHour).padStart(2, '0');
      await detectAndNotifyMissedRun(adminDb, {
        entity: {
          id: c.id,
          businessId: c.businessId,
          isActive: c.enabled,
          lastSuccessfulRunDate: c.lastSuccessfulRunDate,
          missedRunNotifiedDate: c.missedRunNotifiedDate,
        },
        collection: 'birthdayCampaigns',
        slotHour: c.sendAtHour + CATCHUP_WINDOW_HOURS,
        currentHour,
        today,
        ownerId: c.createdBy,
        title: 'Disparo de aniversário não realizado',
        body: `Campanha "${c.name}" estava agendada pra ${hourStr}:00 hoje mas não disparou (mesmo com janela de tolerância de ${CATCHUP_WINDOW_HOURS}h). Reagende manualmente se necessário.`,
        link: 'CRM',
      });
    }

    if (dueCampaigns.length === 0) continue;

    // Carrega clients do business uma única vez
    let clients: Client[];
    try {
      const clientsSnap = await adminDb.collection('clients')
        .where('businessId', '==', businessId)
        .get();
      clients = clientsSnap.docs.map(d => ({ ...(d.data() as Client), id: d.id }));
    } catch (err) {
      console.error(`[BirthdayRunner] Failed to load clients for ${businessId}:`, err);
      continue;
    }

    // Executa as campanhas em sequência (não paralelo) — evita estourar
    // rate-limit do Meta Graph e do Baileys quando há muitas campanhas
    // no mesmo horário.
    for (const campaign of dueCampaigns) {
      const result = await executeCampaign(campaign, clients, now, tz);
      summary.campaignsExecuted++;
      summary.results.push(result);
      // Marca como tendo rodado hoje — futuros ticks do cron NÃO vão
      // disparar fallback de "missed run" pra essa campanha. Conta como
      // sucesso mesmo se 0 clientes elegíveis (campanha rodou, só não
      // tinha aniversariante hoje — comportamento esperado).
      await markSuccessfulRun(adminDb, 'birthdayCampaigns', campaign.id, today);
    }
  }

  return summary;
}
