/**
 * Inbound → agent dispatcher.
 *
 * Called by webhook handlers (Meta Cloud API, Baileys) after an inbound
 * message has been persisted. Checks whether the AI agent is enabled for the
 * business AND the conversation, then fires a signed HTTP POST to the
 * Python agent service. Fire-and-forget — webhook response shouldn't block.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Firestore } from 'firebase-admin/firestore';
import type { Business, Conversation, ConversationChannel, BusinessSegment, WeeklySession } from '@/lib/types';
import { SEGMENT_VOCAB } from '@/lib/types';
import { sendTypingIndicator } from '@/lib/channels/typing';
import { checkRateLimit } from '@/lib/agent/rate-limit';
import { isCircuitAllowed, recordSuccess, recordFailure } from '@/lib/agent/circuit-breaker';

function dlog(msg: string) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync('/tmp/dispatch.log', line); } catch { /* ignore */ }
}

const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8080';
const SECRET = process.env.AGENT_SHARED_SECRET;

/**
 * Static business-level fields shared by every /process payload (inbound and
 * re-engagement). Keeps the two dispatch paths from drifting — notably the
 * agent_instructions (tenant "system prompt") must always ride along.
 */
function businessContextPayload(business: Business): Record<string, unknown> {
  const ai = business.settings?.aiAgent;
  return {
    business_name: business.nomeFantasia || business.razaoSocial,
    business_description: ai?.businessDescription,
    agent_instructions: ai?.instructions || null,
    tone: ai?.tone || 'friendly',
    pedidos_settings: ai?.pedidos || null,
    agenda_settings: ai?.agenda || null,
    address: business.endereco || null,
    policies: ai?.policies || null,
    sla: ai?.sla || null,
    delivery_zones: ai?.deliveryZones || null,
    accepted_payment_methods: ai?.acceptedPaymentMethods || null,
    upsell_rules: (ai?.upsellRules || []).filter((r) => r.isActive),
  };
}

/**
 * HMAC-signs and POSTs a payload to the Python agent /process endpoint.
 * Fire-and-forget: aborts the await after 3s (the agent keeps processing async
 * and delivers the reply via /api/conversations/send), while recording
 * success/failure for the tenant circuit breaker. Shared by inbound + re-engage.
 */
async function postToAgentProcess(businessId: string, payload: Record<string, unknown>, tag: string): Promise<void> {
  const raw = JSON.stringify(payload);
  const ts = Date.now();
  const signature = crypto.createHmac('sha256', SECRET as string).update(`${ts}.${businessId}.${raw}`).digest('hex');
  dlog(`${tag} POST → ${AGENT_URL}/process (payload ${raw.length} bytes, timeout 3s)`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const t0 = Date.now();
  try {
    const res = await fetch(`${AGENT_URL.replace(/\/$/, '')}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-signature': signature,
        'x-agent-timestamp': String(ts),
        'x-business-id': businessId,
      },
      body: raw,
      signal: controller.signal,
    }).catch((err) => {
      const latency = Date.now() - t0;
      if ((err as Error).name !== 'AbortError') dlog(`${tag} fetch failed (${latency}ms): ${String(err)}`);
      else dlog(`${tag} 3s timeout — agent continues async (${latency}ms)`);
      return null;
    });
    if (res && !res.ok) {
      const body = await res.text().catch(() => '');
      dlog(`${tag} ✗ agent HTTP ${res.status} (${Date.now() - t0}ms): ${body}`);
      void recordFailure(businessId, `agent HTTP ${res.status}`).catch(() => {});
    } else if (res?.ok) {
      const data = await res.json().catch(() => ({}));
      dlog(`${tag} ✓ agent responded (${Date.now() - t0}ms) — intent=${data.intent} status=${data.status} response="${String(data.final_response || '').slice(0, 80)}"`);
      if (data.status === 'success') void recordSuccess(businessId).catch(() => {});
      else if (data.status === 'error') void recordFailure(businessId, data.error || 'agent reported error').catch(() => {});
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface InboundDispatchInput {
  businessId: string;
  conversationId: string;
  messageId: string;
  channel: ConversationChannel;
  message: string;
  contactName: string;
  contactPhone?: string;
  /** Meta user id / phone for outbound send */
  recipientId: string;
  /**
   * External id of the inbound message (Meta wamid/mid). Required for the
   * WhatsApp combined read-receipt + typing indicator call. If absent, the
   * indicator is skipped on WhatsApp (FB/IG fall back to standalone typing_on).
   */
  externalMessageId?: string;
  /**
   * Set to true when the message is an internal operator note (not from the
   * contact). Internal notes must NEVER be dispatched to the AI agent —
   * they are operator-only annotations not visible to the contact.
   */
  isInternal?: boolean;
}

/**
 * Main entry — call right after saving the inbound ConversationMessage.
 * Silently skips when disabled or misconfigured. Any HTTP failure is logged
 * but doesn't throw.
 */
export async function dispatchInboundToAgent(
  db: Firestore,
  input: InboundDispatchInput,
): Promise<void> {
  if (!SECRET) {
    dlog('[agent/dispatch] AGENT_SHARED_SECRET not set, skipping');
    return;
  }

  // Hard gate: internal operator notes must never reach the AI agent.
  // They are not visible to the contact and should not influence agent replies.
  if (input.isInternal) {
    dlog(`[agent/dispatch] SKIP: isInternal=true — operator note, not a contact message`);
    return;
  }

  // Also guard against accidentally dispatching empty messages (e.g. media-only
  // messages whose text could not be extracted). The agent cannot do anything
  // useful with an empty message string.
  if (!input.message || input.message.trim() === '') {
    dlog(`[agent/dispatch] SKIP: empty message body — nothing to dispatch`);
    return;
  }

  const DEBOUNCE_MS = parseInt(process.env.AGENT_DEBOUNCE_MS || '5000', 10);

  const tag = `[agent/dispatch] conv=${input.conversationId.slice(-6)} msg=${input.messageId.slice(-6)}`;

  dlog(`${tag} ▶ dispatch started — msg="${input.message.slice(0, 60)}"`);
  try {
    // Fast pre-check: read business + conversation to gate immediately
    const [bizSnap, convSnap] = await Promise.all([
      db.collection('businesses').doc(input.businessId).get(),
      db.collection('conversations').doc(input.conversationId).get(),
    ]);

    if (!bizSnap.exists || !convSnap.exists) {
      dlog(`${tag} SKIP: business(${bizSnap.exists}) or conversation(${convSnap.exists}) not found`);
      return;
    }
    const business = bizSnap.data() as Business;
    const conv = convSnap.data() as Conversation;

    // Gates — semântica de override per-conversa:
    //   - global ON  + conv.aiEnabled !== false  → responde (default herda global)
    //   - global ON  + conv.aiEnabled === false  → SKIP (operador desligou nessa conv)
    //   - global OFF + conv.aiEnabled === true   → responde (override explícito do operador)
    //   - global OFF + conv.aiEnabled !== true   → SKIP (default seguro)
    //
    // Segurança: só `=== true` libera override (strict equality). Convs novas e
    // legadas vêm com aiEnabled=undefined → nunca vazam IA quando global está off.
    // Único caminho pra true é o toggle manual em handleToggleAi (UI).
    const agentEnabledOnBusiness = !!business.settings?.aiAgent?.enabled;
    const convOverrideOn = conv.aiEnabled === true;
    dlog(`${tag} gate check — aiAgent.enabled=${agentEnabledOnBusiness} conv.aiEnabled=${(conv as any).aiEnabled} override=${convOverrideOn}`);
    if (!agentEnabledOnBusiness && !convOverrideOn) {
      dlog(`${tag} SKIP: global off and no per-conv override`);
      return;
    }
    if (agentEnabledOnBusiness && conv.aiEnabled === false) {
      dlog(`${tag} SKIP: aiEnabled=false on conversation (opted out of global)`);
      return;
    }

    // Circuit breaker — skip if open (tenant is in cool-down after consecutive failures)
    const circuitAllowed = await isCircuitAllowed(input.businessId);
    if (!circuitAllowed) {
      dlog(`${tag} SKIP: circuit breaker open for tenant`);
      return;
    }

    // Rate limit per tenant (cross-conversation guard). Fail-open on infra errors.
    const rl = await checkRateLimit(input.businessId, 'inbound');
    if (!rl.allowed) {
      dlog(`${tag} SKIP: rate limit ${rl.current}/${rl.max}, retry in ${rl.retryAfterSec}s`);
      return;
    }

    dlog(`${tag} gates OK — useCase=${business.settings?.useCase || 'servicos'} debounce=${DEBOUNCE_MS}ms`);

    // ─── Humanization: fire typing indicator immediately ──────────────────
    // Masks the LLM latency (2-6s) behind a natural "typing..." animation on
    // the user's device. Runs in parallel with debounce wait — doesn't block.
    // Meta auto-dismisses after ~25s or when our response arrives.
    if (business.channels) {
      void sendTypingIndicator({
        channel: input.channel,
        channels: business.channels,
        recipientId: input.recipientId,
        inboundMessageId: input.externalMessageId,
      }).catch(() => { /* typing is UX sugar */ });
      dlog(`${tag} typing indicator fired (${input.channel})`);
    }

    // Debounce: mark this message as the current pending dispatch token.
    const convRef = db.collection('conversations').doc(input.conversationId);
    await convRef.update({ _agentPendingDispatch: input.messageId });
    dlog(`${tag} debounce set — waiting ${DEBOUNCE_MS}ms`);
    await new Promise(r => setTimeout(r, DEBOUNCE_MS));

    // Re-read conversation — if the token changed, a newer message took over
    const freshConvSnap = await convRef.get();
    if (!freshConvSnap.exists) return;
    const freshData = freshConvSnap.data() as Conversation & { _agentPendingDispatch?: string | null };
    dlog(`${tag} debounce check — pendingToken=${freshData._agentPendingDispatch?.slice(-6)} myToken=${input.messageId.slice(-6)}`);
    if (freshData._agentPendingDispatch !== input.messageId) {
      dlog(`${tag} SKIP: debounce — newer message took over`);
      return;
    }
    if (freshData.aiEnabled === false) {
      dlog(`${tag} SKIP: aiEnabled turned off during debounce`);
      return;
    }

    // Clear the token only if it still belongs to this message (prevents overwriting
    // a newer message's token that arrived between our debounce check and the clear).
    db.runTransaction(async (tx) => {
      const snap = await tx.get(convRef);
      if (snap.data()?._agentPendingDispatch === input.messageId) {
        tx.update(convRef, { _agentPendingDispatch: null });
      }
    }).catch(() => {});

    // Build last-10-turns history — re-fetch AFTER the debounce window so
    // any burst messages (saved during the 5s wait) are included.
    const historySnap = await db.collection('conversationMessages')
      .where('conversationId', '==', input.conversationId)
      .where('businessId', '==', input.businessId)
      .orderBy('sentAt', 'desc')
      .limit(10)
      .get();
    const history = historySnap.docs
      .filter(d => d.id !== input.messageId) // skip the triggering message (passed separately)
      .map(d => d.data())
      .reverse() // chronological asc
      .map(m => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
      }));

    // Pull persistent memory for the contact (tier-2 semantic facts).
    // Merges structured facts (preferences, allergies) with legacy aiSummary
    // one-line history. Both are capped at 800 chars to bound prompt tokens.
    let clientMemory: string | undefined;
    if (conv.crmContactId) {
      try {
        const { getMemorySummary } = await import('@/lib/rag/memory');
        const factsBlock = await getMemorySummary(input.businessId, conv.crmContactId, { maxChars: 500, maxFacts: 12 });

        const clientSnap = await db.collection('clients').doc(conv.crmContactId).get();
        const aiSummary = clientSnap.exists
          ? ((clientSnap.data() as { aiSummary?: string }).aiSummary || '').trim()
          : '';

        const parts: string[] = [];
        if (factsBlock) parts.push(`Fatos lembrados:\n${factsBlock}`);
        if (aiSummary) parts.push(`Histórico recente:\n${aiSummary.slice(0, 300)}`);
        if (parts.length > 0) clientMemory = parts.join('\n\n').slice(0, 800);
      } catch { /* non-fatal */ }
    }

    const useCase = business.settings?.useCase || 'servicos';

    // Ramo/vertical — humaniza o agente sem viés salão. Ausente → 'generico'.
    const segment: BusinessSegment = business.settings?.aiAgent?.segment || 'generico';
    const segmentVocab = SEGMENT_VOCAB[segment];

    // Pre-load services for agenda mode — avoids an extra tool call for "what services do you have?"
    // capacity/sessions são aditivos: presentes só quando o serviço é turma (capacity>1),
    // permitindo ao agente contar vagas sem nova tool call. Serviços exclusivos não os enviam.
    type ServiceSnapshot = {
      id: string; name: string; price: number; duration: number;
      category?: string; description?: string;
      capacity?: number; sessions?: WeeklySession[];
    };
    let servicesList: ServiceSnapshot[] = [];
    if (useCase === 'servicos') {
      try {
        const servicesSnap = await db.collection('services')
          .where('businessId', '==', input.businessId)
          .where('isActive', '==', true)
          .get();
        servicesList = servicesSnap.docs.map(d => {
          const s = d.data();
          const capacity = typeof s.capacity === 'number' ? (s.capacity as number) : undefined;
          const sessions = Array.isArray(s.sessions) ? (s.sessions as WeeklySession[]) : undefined;
          return {
            id: d.id,
            name: s.name as string,
            price: (s.price as number) || 0,
            duration: (s.duration as number) || 60,
            ...(s.category ? { category: s.category as string } : {}),
            ...(s.description ? { description: s.description as string } : {}),
            ...(capacity !== undefined ? { capacity } : {}),
            ...(sessions && sessions.length > 0 ? { sessions } : {}),
          };
        });
      } catch { /* non-fatal — agent falls back to agenda_list_services tool */ }
    }

    // Compute today's effective opening hours (applies holidays + seasonal overrides)
    const todayIso = new Date().toISOString().slice(0, 10);
    const holidays = business.settings?.aiAgent?.calendar?.holidays || [];
    const isClosedToday = holidays.includes(todayIso);
    const seasonalHours = business.settings?.aiAgent?.calendar?.seasonalHours || [];
    const activeSeason = seasonalHours.find((s) => todayIso >= s.fromDate && todayIso <= s.toDate);
    const effectiveHours = activeSeason?.hours || business.settings?.openingHours || null;

    const payload = {
      message_id: input.messageId,
      conversation_id: input.conversationId,
      message: input.message,
      contact_name: input.contactName,
      contact_phone: input.contactPhone,
      channel: input.channel,
      recipient_id: input.recipientId,
      history,
      use_case: useCase,
      trigger: 'inbound',
      // Ramo/vertical (snake_case no fio) — ajusta vocabulário/persona do /agent.
      segment,
      segment_vocab: segmentVocab,
      // Static business context (name, description, instructions, tone, policies…)
      ...businessContextPayload(business),
      // Long-term memory carried over from previous conversations
      client_memory: clientMemory || null,
      // Business operational context (profile / settings)
      opening_hours: effectiveHours,
      services_list: servicesList.length > 0 ? servicesList : null,
      // Current date so the agent doesn't have to guess from training data
      current_date: todayIso,
      is_closed_today: isClosedToday,
      seasonal_label: activeSeason?.label || null,
    };

    // Fire and don't await for long — webhook response should stay fast. The
    // agent keeps processing in the background and delivers via conversations/send.
    await postToAgentProcess(input.businessId, payload, tag);
  } catch (err) {
    dlog(`${tag} ✗ fatal: ${String(err)}`);
    void recordFailure(input.businessId, String(err).slice(0, 200)).catch(() => {});
  }
}

export interface ReengagementDispatchInput {
  businessId: string;
  conversationId: string;
  /** Aproximadamente quantas horas o cliente está sem responder (vai pro prompt). */
  hoursSilent?: number;
  /** Número desta tentativa (1-based) — só para telemetria. */
  attempt?: number;
}

/**
 * Reingajamento proativo: o scheduler detectou que o cliente sumiu no meio da
 * conversa e quer que o agente retome o contato. Reusa o mesmo pipeline /process
 * do inbound, mas com trigger='reengagement' (sem uma mensagem nova do cliente —
 * o agente gera a retomada a partir do histórico).
 *
 * O CHAMADOR (sweep do cron) é responsável por elegibilidade: estado 'waiting',
 * janela de 24h da Meta, teto de tentativas, horário silencioso e idempotência.
 * Aqui só revalidamos o gate de IA ligada e disparamos. Retorna true se o run
 * foi disparado (para o cron marcar a tentativa).
 */
export async function dispatchReengagementToAgent(
  db: Firestore,
  input: ReengagementDispatchInput,
): Promise<boolean> {
  if (!SECRET) {
    dlog('[agent/reengage] AGENT_SHARED_SECRET not set, skipping');
    return false;
  }
  const tag = `[agent/reengage] conv=${input.conversationId.slice(-6)}`;
  try {
    const [bizSnap, convSnap] = await Promise.all([
      db.collection('businesses').doc(input.businessId).get(),
      db.collection('conversations').doc(input.conversationId).get(),
    ]);
    if (!bizSnap.exists || !convSnap.exists) {
      dlog(`${tag} SKIP: business(${bizSnap.exists}) or conversation(${convSnap.exists}) not found`);
      return false;
    }
    const business = bizSnap.data() as Business;
    const conv = { ...(convSnap.data() as Conversation), id: convSnap.id };

    // Mesmo gate de IA ligada do inbound (global + override por conversa).
    const agentEnabledOnBusiness = !!business.settings?.aiAgent?.enabled;
    const convOverrideOn = conv.aiEnabled === true;
    if (!agentEnabledOnBusiness && !convOverrideOn) { dlog(`${tag} SKIP: agent off`); return false; }
    if (agentEnabledOnBusiness && conv.aiEnabled === false) { dlog(`${tag} SKIP: aiEnabled=false on conv`); return false; }

    const recipientId = conv.contactExternalId;
    if (!recipientId) { dlog(`${tag} SKIP: sem contactExternalId (destino)`); return false; }

    // Respeita o cool-down do circuit breaker do tenant.
    if (!(await isCircuitAllowed(input.businessId))) { dlog(`${tag} SKIP: circuit open`); return false; }

    // Histórico — últimas 10 trocas em ordem cronológica (sem mensagem gatilho).
    const historySnap = await db.collection('conversationMessages')
      .where('conversationId', '==', input.conversationId)
      .where('businessId', '==', input.businessId)
      .orderBy('sentAt', 'desc')
      .limit(10)
      .get();
    const history = historySnap.docs
      .map(d => d.data())
      .reverse()
      .map(m => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
      }))
      .filter(m => m.content);
    if (history.length === 0) { dlog(`${tag} SKIP: sem histórico para retomar`); return false; }

    // Memória persistente do contato (tier-2 + aiSummary) — igual ao inbound.
    let clientMemory: string | undefined;
    if (conv.crmContactId) {
      try {
        const { getMemorySummary } = await import('@/lib/rag/memory');
        const factsBlock = await getMemorySummary(input.businessId, conv.crmContactId, { maxChars: 500, maxFacts: 12 });
        const clientSnap = await db.collection('clients').doc(conv.crmContactId).get();
        const aiSummary = clientSnap.exists ? ((clientSnap.data() as { aiSummary?: string }).aiSummary || '').trim() : '';
        const parts: string[] = [];
        if (factsBlock) parts.push(`Fatos lembrados:\n${factsBlock}`);
        if (aiSummary) parts.push(`Histórico recente:\n${aiSummary.slice(0, 300)}`);
        if (parts.length > 0) clientMemory = parts.join('\n\n').slice(0, 800);
      } catch { /* non-fatal */ }
    }

    const useCase = business.settings?.useCase || 'servicos';
    const segment: BusinessSegment = business.settings?.aiAgent?.segment || 'generico';
    const segmentVocab = SEGMENT_VOCAB[segment];

    // Pré-carrega serviços (mode agenda) — mesma forma do inbound.
    type ServiceSnapshot = {
      id: string; name: string; price: number; duration: number;
      category?: string; description?: string; capacity?: number; sessions?: WeeklySession[];
    };
    let servicesList: ServiceSnapshot[] = [];
    if (useCase === 'servicos') {
      try {
        const servicesSnap = await db.collection('services')
          .where('businessId', '==', input.businessId)
          .where('isActive', '==', true)
          .get();
        servicesList = servicesSnap.docs.map(d => {
          const s = d.data();
          const capacity = typeof s.capacity === 'number' ? (s.capacity as number) : undefined;
          const sessions = Array.isArray(s.sessions) ? (s.sessions as WeeklySession[]) : undefined;
          return {
            id: d.id,
            name: s.name as string,
            price: (s.price as number) || 0,
            duration: (s.duration as number) || 60,
            ...(s.category ? { category: s.category as string } : {}),
            ...(s.description ? { description: s.description as string } : {}),
            ...(capacity !== undefined ? { capacity } : {}),
            ...(sessions && sessions.length > 0 ? { sessions } : {}),
          };
        });
      } catch { /* non-fatal */ }
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const holidays = business.settings?.aiAgent?.calendar?.holidays || [];
    const isClosedToday = holidays.includes(todayIso);
    const seasonalHours = business.settings?.aiAgent?.calendar?.seasonalHours || [];
    const activeSeason = seasonalHours.find((s) => todayIso >= s.fromDate && todayIso <= s.toDate);
    const effectiveHours = activeSeason?.hours || business.settings?.openingHours || null;

    const payload = {
      message_id: `reengage_${input.conversationId}_${todayIso}_${input.attempt ?? 0}`,
      conversation_id: input.conversationId,
      message: '[reingajamento]',
      contact_name: conv.contactName || '',
      contact_phone: conv.contactPhone,
      channel: conv.channel,
      recipient_id: recipientId,
      history,
      use_case: useCase,
      trigger: 'reengagement',
      reengagement_context: { hours_silent: input.hoursSilent ?? null, attempt: input.attempt ?? null },
      segment,
      segment_vocab: segmentVocab,
      ...businessContextPayload(business),
      client_memory: clientMemory || null,
      opening_hours: effectiveHours,
      services_list: servicesList.length > 0 ? servicesList : null,
      current_date: todayIso,
      is_closed_today: isClosedToday,
      seasonal_label: activeSeason?.label || null,
    };

    await postToAgentProcess(input.businessId, payload, tag);
    return true;
  } catch (err) {
    dlog(`${tag} ✗ fatal: ${String(err)}`);
    return false;
  }
}
