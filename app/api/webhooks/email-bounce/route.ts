/**
 * POST /api/webhooks/email-bounce
 *
 * Webhook chamado pelo notification-server quando um email faz bounce
 * (rejeitado pelo servidor do destinatário, hard bounce, caixa cheia, etc.).
 *
 * Body esperado:
 * {
 *   businessId: string;          // qual tenant
 *   externalMessageId: string;   // jobId retornado pelo /api/send-email
 *   recipientEmail: string;      // email que falhou
 *   errorReason: string;         // descrição do erro (ex: "550 Invalid address")
 *   bouncedAt?: string;          // ISO timestamp; default: agora
 *   bounceType?: 'hard' | 'soft' | 'block' | 'unsubscribe';
 * }
 *
 * Headers:
 *   x-signature: HMAC-SHA256(payload, apiKey)  — apiKey é a do notification-server
 *
 * Resposta:
 *   200 — bounce processado (BroadcastMessage atualizado para 'failed')
 *   401 — assinatura inválida
 *   404 — BroadcastMessage não encontrado (já apagado ou outro businessId)
 *   422 — body inválido
 *
 * Segurança: validação HMAC com a apiKey do notification-server salvo em
 * business.settings.notificationServer.apiKey. Idempotente — múltiplos webhooks
 * para o mesmo externalMessageId não causam duplicação (status regression
 * guard).
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';

interface BouncePayload {
  businessId: string;
  externalMessageId: string;
  recipientEmail: string;
  errorReason: string;
  bouncedAt?: string;
  bounceType?: 'hard' | 'soft' | 'block' | 'unsubscribe';
}

/** Status order — tracking guard contra regressão (idêntico ao webhook Meta). */
const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4, // bounce conta como failed terminal
};

export async function POST(req: NextRequest) {
  let rawBody: string;
  let payload: BouncePayload;

  try {
    rawBody = await req.text();
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 422 });
  }

  if (!payload.businessId || !payload.externalMessageId || !payload.recipientEmail || !payload.errorReason) {
    return NextResponse.json({
      error: 'Required fields: businessId, externalMessageId, recipientEmail, errorReason',
    }, { status: 422 });
  }

  // ── Verifica assinatura HMAC com a apiKey do notification-server ────────────
  const signature = req.headers.get('x-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing x-signature header' }, { status: 401 });
  }

  try {
    const bizSnap = await adminDb.collection('businesses').doc(payload.businessId).get();
    const nsConfig = bizSnap.data()?.settings?.notificationServer;
    if (!nsConfig?.apiKey) {
      return NextResponse.json({ error: 'Notification server not configured' }, { status: 404 });
    }
    const apiKey = await decryptToken(nsConfig.apiKey);
    const expectedSig = crypto.createHmac('sha256', apiKey).update(rawBody).digest('hex');

    // timing-safe compare
    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      console.warn('[email-bounce] Invalid signature for business', payload.businessId);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } catch (err) {
    console.error('[email-bounce] Auth verification error:', err);
    return NextResponse.json({ error: 'Auth verification failed' }, { status: 500 });
  }

  // ── Busca o BroadcastMessage por externalMessageId ──────────────────────────
  try {
    const msgSnap = await adminDb.collection('broadcastMessages')
      .where('businessId', '==', payload.businessId)
      .where('externalMessageId', '==', payload.externalMessageId)
      .limit(1)
      .get();

    if (msgSnap.empty) {
      // Não é erro fatal — pode ser que o broadcastMessage foi deletado
      // (resume retomada, retry, etc.). Notification-server deve aceitar 404.
      console.log('[email-bounce] No matching BroadcastMessage for', payload.externalMessageId);
      return NextResponse.json({ ok: false, reason: 'message-not-found' }, { status: 404 });
    }

    const msgDoc = msgSnap.docs[0];
    const current = msgDoc.data();

    // Guard de regressão: bounce sempre vence (status=failed terminal)
    // exceto se já estava em failed (idempotência — não reprocessa)
    if (current.status === 'failed') {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    const previousStatus = current.status;
    const now = payload.bouncedAt || new Date().toISOString();

    await msgDoc.ref.update({
      status: 'failed',
      errorMessage: `Bounce (${payload.bounceType || 'hard'}): ${payload.errorReason}`,
      bouncedAt: now,
    });

    // Atualiza stats agregadas no Broadcast pai
    if (current.broadcastId) {
      const { FieldValue } = await import('firebase-admin/firestore');
      const updates: Record<string, unknown> = {
        'stats.failed': FieldValue.increment(1),
        updatedAt: new Date().toISOString(),
      };
      // Se a mensagem estava 'sent' antes, decrementa sent (passa para failed)
      const prevOrder = STATUS_ORDER[previousStatus] ?? -1;
      if (prevOrder >= 1) updates['stats.sent'] = FieldValue.increment(-1);
      // Se estava em delivered, também decrementa delivered
      if (prevOrder >= 2) updates['stats.delivered'] = FieldValue.increment(-1);

      await adminDb.collection('broadcasts').doc(current.broadcastId).update(updates)
        .catch(err => console.error('[email-bounce] Stats update failed:', err));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[email-bounce] Update error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
