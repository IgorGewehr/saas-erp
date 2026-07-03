/**
 * Status-change → conversation notifier.
 *
 * Called by the UI after a DeliveryOrder or Appointment transitions state.
 * Sends a canned, localized message via the conversation's original channel
 * using the same dispatch pipeline as /api/conversations/send.
 *
 * Gating:
 *  1. business.settings.aiAgent.pedidos.notifyOnStatusChange must be true
 *     (orders); appointments gate only on aiAgent.enabled
 *  2. the entity must have an associated conversationId
 *  3. caller must be authenticated for the target business
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type {
  Business, Conversation, DeliveryOrder, Appointment,
  DeliveryOrderStatus, AppointmentStatus,
} from '@/lib/types';

interface NotifyBody {
  businessId: string;
  kind: 'order' | 'appointment';
  id: string;
  newStatus: DeliveryOrderStatus | AppointmentStatus;
}

const ORDER_TEMPLATES: Partial<Record<DeliveryOrderStatus, (o: DeliveryOrder) => string>> = {
  preparando: (o) => `Olá ${firstName(o.clientName)}! Seu pedido #${o.number} já está sendo preparado 👨‍🍳`,
  pronto: (o) => o.deliveryType === 'retirada'
    ? `${firstName(o.clientName)}, seu pedido #${o.number} está pronto para retirada! 🎉`
    : `Pedido #${o.number} pronto e aguardando o entregador.`,
  saiu_entrega: (o) => `${firstName(o.clientName)}, seu pedido #${o.number} saiu para entrega 🏍️ Chegando em breve!`,
  entregue: (o) => `Pedido #${o.number} entregue ✅ Muito obrigado pela preferência!`,
  cancelado: (o) => `Olá ${firstName(o.clientName)}, seu pedido #${o.number} foi cancelado. Se foi um engano, é só nos chamar.`,
};

const APPOINTMENT_TEMPLATES: Partial<Record<AppointmentStatus, (a: Appointment) => string>> = {
  confirmado: (a) => `Olá ${firstName(a.clientName)}! Seu horário de ${a.serviceName} dia ${fmtDate(a.date)} às ${a.startTime} está confirmado ✅`,
  cancelado: (a) => `${firstName(a.clientName)}, seu horário de ${a.serviceName} em ${fmtDate(a.date)} às ${a.startTime} foi cancelado. Quer remarcar?`,
  concluido: (a) => `Obrigado por escolher a gente, ${firstName(a.clientName)}! Esperamos você em breve 🙌`,
  nao_compareceu: (a) => `${firstName(a.clientName)}, sentimos sua falta hoje! Quer remarcar seu ${a.serviceName}?`,
};

function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || '';
}
function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export async function POST(req: NextRequest) {
  let body: NotifyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, body.businessId);
  if (isAuthError(authResult)) return authResult;

  // Check setting — granular: orders use pedidos.notifyOnStatusChange
  const bizSnap = await adminDb.collection('businesses').doc(body.businessId).get();
  if (!bizSnap.exists) return NextResponse.json({ ok: false, error: 'Business not found' }, { status: 404 });
  const business = bizSnap.data() as Business;
  const aiAgent = business.settings?.aiAgent;
  if (!aiAgent?.enabled) {
    return NextResponse.json({ ok: true, data: { skipped: 'agent disabled' } });
  }
  const wantsOrderNotify = body.kind === 'order' && aiAgent.pedidos?.notifyOnStatusChange;
  const wantsAppointmentNotify = body.kind === 'appointment'; // appointment notifications always on when agent enabled
  if (!wantsOrderNotify && !wantsAppointmentNotify) {
    return NextResponse.json({ ok: true, data: { skipped: 'notifications disabled for this kind' } });
  }

  // Fetch entity + build message
  let message: string | null = null;
  let conversationId: string | undefined;
  let channel: Conversation['channel'] | undefined;
  let recipientId: string | undefined;
  // Telefone do pedido — usado no fallback Baileys quando não há conversa achada.
  let orderClientPhone: string | undefined;

  if (body.kind === 'order') {
    const snap = await adminDb.collection('deliveryOrders').doc(body.id).get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 });
    const o = snap.data() as DeliveryOrder;
    if (o.businessId !== body.businessId) {
      return NextResponse.json({ ok: false, error: 'Cross-tenant access denied' }, { status: 403 });
    }
    const tpl = ORDER_TEMPLATES[body.newStatus as DeliveryOrderStatus];
    if (!tpl) return NextResponse.json({ ok: true, data: { skipped: 'no template for status' } });
    message = tpl(o);
    // Anexa link público de acompanhamento (capability URL) só para pedidos, quando
    // o negócio tem slug e o pedido tem trackingToken. Appointment nunca leva link.
    if (business.slug && o.trackingToken) {
      message += `\n\nAcompanhe: ${req.nextUrl.origin}/p/${business.slug}/pedido/${body.id}?t=${o.trackingToken}`;
    }
    conversationId = o.conversationId;
    recipientId = o.contactExternalId || o.clientPhone;
    orderClientPhone = o.clientPhone;
  } else {
    const snap = await adminDb.collection('appointments').doc(body.id).get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Appointment not found' }, { status: 404 });
    const a = snap.data() as Appointment;
    if (a.businessId !== body.businessId) {
      return NextResponse.json({ ok: false, error: 'Cross-tenant access denied' }, { status: 403 });
    }
    const tpl = APPOINTMENT_TEMPLATES[body.newStatus as AppointmentStatus];
    if (!tpl) return NextResponse.json({ ok: true, data: { skipped: 'no template for status' } });
    message = tpl(a);
    // appointments don't have a conversationId on their own — look up by client phone
    recipientId = a.clientPhone;
  }

  if (!message) return NextResponse.json({ ok: true, data: { skipped: 'no message' } });

  // Resolve conversation — for appointments or orders without convId, find one by phone.
  // Filtra explicitamente channel=whatsapp pra não pegar conv FB/IG do mesmo contato.
  // Como o lembrete automático não sabe se cliente prefere Meta ou Baileys, pega a
  // conversa com atividade mais recente (lastMessageAt desc) — assume que o canal
  // ativo é o que o cliente espera receber a próxima mensagem.
  if (!conversationId && recipientId) {
    const convSnap = await adminDb.collection('conversations')
      .where('businessId', '==', body.businessId)
      .where('channel', '==', 'whatsapp')
      .where('contactExternalId', '==', recipientId.replace(/\D/g, ''))
      .orderBy('lastMessageAt', 'desc')
      .limit(1)
      .get();
    if (!convSnap.empty) {
      conversationId = convSnap.docs[0].id;
      channel = (convSnap.docs[0].data() as Conversation).channel;
    }
  } else if (conversationId) {
    const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
    if (convSnap.exists) channel = (convSnap.data() as Conversation).channel;
  }

  // Dispatch via /api/conversations/send com chamada interna ASSINADA por HMAC
  // (essa rota exige x-agent-signature OU Bearer; não temos o ID token aqui).
  // Reusado pelo caminho principal (com conversationId) e pelo fallback Baileys.
  async function dispatchSend(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const { default: crypto } = await import('crypto');
    const secret = process.env.AGENT_SHARED_SECRET;
    if (!secret) return { ok: false, error: 'Notifier not configured' };
    const sendBody = JSON.stringify(payload);
    const ts = Date.now();
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body.businessId}.${sendBody}`).digest('hex');
    try {
      const resp = await fetch(`${req.nextUrl.origin}/api/conversations/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-signature': sig,
          'x-agent-timestamp': String(ts),
          'x-business-id': body.businessId,
        },
        body: sendBody,
      });
      if (!resp.ok) return { ok: false, error: `send failed: ${await resp.text()}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  if (!conversationId || !channel || !recipientId) {
    // Fallback Baileys: cobre o cliente do cardápio web que nunca teve conversa
    // registrada. Se for pedido com telefone e o negócio tem Baileys conectado,
    // envia direto pelo telefone (recipientId) — a MESMA rota assinada resolve o
    // transporte whatsapp por businesses.channels e cria/resolve a conversa. O
    // campo legado channels.baileys.phoneNumber fica fora de ChannelCredentials,
    // lido via cast estreito (sem `any`). Reporta o resultado REAL (não mascara).
    if (body.kind === 'order' && orderClientPhone && message) {
      const baileysPhone = (business.channels as { baileys?: { phoneNumber?: string } } | undefined)
        ?.baileys?.phoneNumber;
      if (baileysPhone) {
        const r = await dispatchSend({
          businessId: body.businessId,
          channel: 'whatsapp',
          recipientId: orderClientPhone.replace(/\D/g, ''),
          content: message,
          type: 'text',
        });
        return NextResponse.json(
          r.ok
            ? { ok: true, data: { sent: true, via: 'baileys-fallback' } }
            : { ok: false, error: r.error },
          { status: r.ok ? 200 : 502 },
        );
      }
    }
    return NextResponse.json({ ok: true, data: { skipped: 'no conversation to notify' } });
  }

  const sent = await dispatchSend({
    businessId: body.businessId,
    conversationId,
    channel,
    recipientId,
    content: message,
    type: 'text',
  });
  return NextResponse.json(
    sent.ok ? { ok: true, data: { sent: true, message } } : { ok: false, error: sent.error },
    { status: sent.ok ? 200 : 502 },
  );
}
