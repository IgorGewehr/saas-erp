/**
 * Inbound → agent dispatcher.
 *
 * Called by webhook handlers (Meta Cloud API, Baileys) after an inbound
 * message has been persisted. Checks whether the AI agent is enabled for the
 * business AND the conversation, then fires a signed HTTP POST to the
 * Python agent service. Fire-and-forget — webhook response shouldn't block.
 */

import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Business, Conversation, ConversationChannel } from '@/lib/types';

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
    console.warn('[agent/dispatch] AGENT_SHARED_SECRET not set, skipping');
    return;
  }

  try {
    // Parallel reads: business settings + conversation doc
    const [bizSnap, convSnap] = await Promise.all([
      db.collection('businesses').doc(input.businessId).get(),
      db.collection('conversations').doc(input.conversationId).get(),
    ]);

    if (!bizSnap.exists || !convSnap.exists) return;
    const business = bizSnap.data() as Business;
    const conv = convSnap.data() as Conversation;

    // Gates
    const agentEnabledOnBusiness = !!business.settings?.aiAgent?.enabled;
    if (!agentEnabledOnBusiness) return;
    if (conv.aiEnabled === false) return; // default true when undefined

    // Build last-10-turns history for grounding
    const historySnap = await db.collection('conversationMessages')
      .where('conversationId', '==', input.conversationId)
      .where('businessId', '==', input.businessId)
      .orderBy('sentAt', 'desc')
      .limit(10)
      .get();
    const history = historySnap.docs
      .map(d => d.data())
      .reverse() // chronological asc
      .filter(m => m.id !== input.messageId) // skip the just-saved message
      .map(m => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
      }));

    // If the conversation is already linked to a Client, pull their aiSummary
    // for long-term memory across conversations. 5 lines max — enforced at write.
    let clientMemory: string | undefined;
    if (conv.crmContactId) {
      try {
        const clientSnap = await db.collection('clients').doc(conv.crmContactId).get();
        if (clientSnap.exists) {
          const summary = (clientSnap.data() as { aiSummary?: string }).aiSummary;
          if (summary && summary.trim()) clientMemory = summary.trim().slice(0, 800);
        }
      } catch { /* non-fatal */ }
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
      use_case: business.settings?.useCase || 'servicos',
      business_name: business.nomeFantasia || business.razaoSocial,
      business_description: business.settings?.aiAgent?.businessDescription,
      tone: business.settings?.aiAgent?.tone || 'friendly',
      // Configurações específicas por modo — vão para o prompt do agente
      pedidos_settings: business.settings?.aiAgent?.pedidos || null,
      agenda_settings: business.settings?.aiAgent?.agenda || null,
      // Long-term memory carried over from previous conversations
      client_memory: clientMemory || null,
    };

    const raw = JSON.stringify(payload);
    const ts = Date.now();
    const message = `${ts}.${input.businessId}.${raw}`;
    const signature = crypto.createHmac('sha256', SECRET).update(message).digest('hex');

    // Fire and don't await — webhook response should stay fast.
    // We await the *dispatch* but abort if it takes >3s; the agent itself will
    // keep processing in the background. Next.js will get tool calls shortly.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(`${AGENT_URL.replace(/\/$/, '')}/process`, {
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
        // AbortError expected when we cut off waiting — agent continues server-side
        if ((err as Error).name !== 'AbortError') {
          console.error('[agent/dispatch] fetch failed:', err);
        }
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('[agent/dispatch] fatal:', err);
  }
}
