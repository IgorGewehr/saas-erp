/**
 * Inbound → agent dispatcher.
 *
 * Called by webhook handlers (Meta Cloud API, Baileys) after an inbound
 * message has been persisted. Checks whether the AI agent is enabled for the
 * business AND the conversation, then fires a signed HTTP POST to the
 * Python agent service. Fire-and-forget — webhook response shouldn't block.
 */

import crypto from 'crypto';
import fs from 'fs';
import type { Firestore } from 'firebase-admin/firestore';
import type { Business, Conversation, ConversationChannel } from '@/lib/types';
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

    // Gates
    const agentEnabledOnBusiness = !!business.settings?.aiAgent?.enabled;
    dlog(`${tag} gate check — aiAgent.enabled=${agentEnabledOnBusiness} conv.aiEnabled=${(conv as any).aiEnabled}`);
    if (!agentEnabledOnBusiness) {
      dlog(`${tag} SKIP: aiAgent.enabled=false on business`);
      return;
    }
    if (conv.aiEnabled === false) {
      dlog(`${tag} SKIP: aiEnabled=false on conversation`);
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
      .map(d => d.data())
      .reverse() // chronological asc
      .filter(m => m.id !== input.messageId) // skip the triggering message (passed separately)
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

    // Pre-load services for agenda mode — avoids an extra tool call for "what services do you have?"
    type ServiceSnapshot = { id: string; name: string; price: number; duration: number; category?: string; description?: string };
    let servicesList: ServiceSnapshot[] = [];
    if (useCase === 'servicos') {
      try {
        const servicesSnap = await db.collection('services')
          .where('businessId', '==', input.businessId)
          .where('isActive', '==', true)
          .get();
        servicesList = servicesSnap.docs.map(d => {
          const s = d.data();
          return {
            id: d.id,
            name: s.name as string,
            price: (s.price as number) || 0,
            duration: (s.duration as number) || 60,
            ...(s.category ? { category: s.category as string } : {}),
            ...(s.description ? { description: s.description as string } : {}),
          };
        });
      } catch { /* non-fatal — agent falls back to agenda_list_services tool */ }
    }

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
      business_name: business.nomeFantasia || business.razaoSocial,
      business_description: business.settings?.aiAgent?.businessDescription,
      tone: business.settings?.aiAgent?.tone || 'friendly',
      // Configurações específicas por modo — vão para o prompt do agente
      pedidos_settings: business.settings?.aiAgent?.pedidos || null,
      agenda_settings: business.settings?.aiAgent?.agenda || null,
      // Long-term memory carried over from previous conversations
      client_memory: clientMemory || null,
      // Business operational context (profile / settings)
      opening_hours: business.settings?.openingHours || null,
      address: business.endereco || null,
      services_list: servicesList.length > 0 ? servicesList : null,
      // Current date so the agent doesn't have to guess from training data
      current_date: new Date().toISOString().slice(0, 10),
    };

    const raw = JSON.stringify(payload);
    const ts = Date.now();
    const message = `${ts}.${input.businessId}.${raw}`;
    const signature = crypto.createHmac('sha256', SECRET).update(message).digest('hex');

    // Fire and don't await — webhook response should stay fast.
    // We await the *dispatch* but abort if it takes >3s; the agent itself will
    // keep processing in the background. Next.js will get tool calls shortly.
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
          'x-business-id': input.businessId,
        },
        body: raw,
        signal: controller.signal,
      }).catch((err) => {
        const latency = Date.now() - t0;
        if ((err as Error).name !== 'AbortError') {
          dlog(`${tag} fetch failed (${latency}ms): ${String(err)}`);
        } else {
          dlog(`${tag} 3s timeout — agent continues async (${latency}ms)`);
        }
        return null;
      });
      if (res && !res.ok) {
        const body = await res.text().catch(() => '');
        dlog(`${tag} ✗ agent HTTP ${res.status} (${Date.now()-t0}ms): ${body}`);
        void recordFailure(input.businessId, `agent HTTP ${res.status}`).catch(() => {});
      } else if (res?.ok) {
        const data = await res.json().catch(() => ({}));
        dlog(`${tag} ✓ agent responded (${Date.now()-t0}ms) — intent=${data.intent} status=${data.status} response="${String(data.final_response || '').slice(0,80)}"`);
        if (data.status === 'success') {
          void recordSuccess(input.businessId).catch(() => {});
        } else if (data.status === 'error') {
          void recordFailure(input.businessId, data.error || 'agent reported error').catch(() => {});
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    dlog(`${tag} ✗ fatal: ${String(err)}`);
    void recordFailure(input.businessId, String(err).slice(0, 200)).catch(() => {});
  }
}
