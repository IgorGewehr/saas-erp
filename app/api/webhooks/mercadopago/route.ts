/**
 * Mercado Pago Webhook Handler — POST /api/webhooks/mercadopago
 *
 * Recebe notificações do MP (Webhooks v2). O MP só entrega `type`/`topic` +
 * `data.id`; NUNCA confiamos no payload. A rota é FINA:
 *   1. Valida a assinatura `x-signature` FAIL-CLOSED (sem secret → 401).
 *   2. Anti-replay por `ts` (|now-ts| < 5min).
 *   3. Valida o corpo com Zod (R6 — boundary externo).
 *   4. Delega a liquidação a settlePaymentNotification (re-consulta o MP,
 *      valida businessId via external_reference, settle transacional). A
 *      idempotência (R3) é o CAS de status na FSM do pagamento — reaplicar o
 *      mesmo status é no-op; NÃO há dedup por payment.id (colapsaria o ciclo
 *      pending→paid→refunded do pedido).
 *
 * Códigos HTTP (o MP reentrega quando a resposta NÃO é 2xx, com timeout curto):
 *   - 401 → assinatura ausente/ inválida ou fora da janela anti-replay.
 *   - 400 → corpo malformado (Zod). O MP não deveria mandar isso; não reenvia útil.
 *   - 404 → pedido ainda não encontrado por externalPaymentId. TRANSITÓRIO
 *           (corrida: webhook chega antes da criação da cobrança persistir).
 *           Retornamos não-2xx PROPOSITALMENTE pra o MP reenviar até resolver.
 *   - 503 → erro nosso (token do tenant, MP API, exceção). MP reenvia.
 *   - 200 → processado, no-op idempotente, conflito/divergência registrados,
 *           ou notificação de tipo conhecido-porém-ignorado (ex: merchant_order).
 *
 * Setup no painel do MP:
 *   - URL: https://seu-dominio.com/api/webhooks/mercadopago
 *   - Segredo de assinatura → MP_WEBHOOK_SECRET no ambiente.
 */

import { NextRequest, NextResponse } from 'next/server';
import { MpWebhookPayloadSchema } from '@/contracts/api/integrations/mercadopago';
import { settlePaymentNotification } from '@/lib/services/mercadopago/webhook-settle';
import { parseMpXSignature, verifyMpSignature, isWithinMpReplayWindow } from '@/lib/services/mercadopago/webhookSignature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // ── 1. Assinatura: FAIL-CLOSED ─────────────────────────────────────────────
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[MP Webhook] MP_WEBHOOK_SECRET ausente — rejeitando (fail-closed)');
    return NextResponse.json({ error: 'Webhook não configurado' }, { status: 401 });
  }

  const sig = parseMpXSignature(req.headers.get('x-signature'));
  if (!sig) {
    console.warn('[MP Webhook] x-signature ausente ou malformado');
    return NextResponse.json({ error: 'Assinatura ausente' }, { status: 401 });
  }

  // `data.id` da query é o valor canônico que o MP usa no manifest assinado.
  const url = new URL(req.url);
  const queryDataId = url.searchParams.get('data.id') ?? url.searchParams.get('id');
  const requestId = req.headers.get('x-request-id');

  if (!verifyMpSignature({ secret, sig, dataId: queryDataId, requestId })) {
    console.warn('[MP Webhook] assinatura inválida — confira MP_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
  }

  // ── 2. Anti-replay ─────────────────────────────────────────────────────────
  if (!isWithinMpReplayWindow(sig.ts)) {
    console.warn('[MP Webhook] ts fora da janela anti-replay');
    return NextResponse.json({ error: 'Timestamp fora da janela' }, { status: 401 });
  }

  // ── 3. Corpo (R6 — valida no boundary) ─────────────────────────────────────
  let payload: ReturnType<typeof MpWebhookPayloadSchema.parse>;
  try {
    const json = await req.json();
    payload = MpWebhookPayloadSchema.parse(json);
  } catch (err) {
    console.warn('[MP Webhook] corpo inválido:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
  }

  // `type` (Webhooks v2) ou `topic` (IPN legado).
  const type = payload.type ?? payload.topic ?? '';

  // O id do recurso a liquidar DEVE vir da QUERY: é o ÚNICO campo no escopo da
  // assinatura (entra no manifest HMAC). O corpo NÃO é assinado — usá-lo abriria
  // replay trocando o data.id. Sem id assinado → 400. Se o corpo divergir do
  // assinado → 400 (adulteração). Liquidamos SEMPRE pelo id assinado.
  if (!queryDataId) {
    console.warn('[MP Webhook] data.id ausente na query (fora do escopo assinado)');
    return NextResponse.json({ error: 'data.id ausente na query' }, { status: 400 });
  }
  if (payload.data.id !== queryDataId) {
    console.warn('[MP Webhook] data.id do corpo diverge do id assinado — rejeitando');
    return NextResponse.json({ error: 'data.id divergente da assinatura' }, { status: 400 });
  }
  const dataId = queryDataId;

  // ── 4. Liquidação (dedup + re-consulta + settle vivem no service) ───────────
  try {
    const result = await settlePaymentNotification({ type, dataId });

    if (result.unmatched) {
      // Transitório: pedido ainda não persistiu o externalPaymentId. Não-2xx
      // PROPOSITAL pra o MP reentregar — não engolimos em 200 cego.
      return NextResponse.json(
        { error: 'Pagamento ainda não vinculado a um pedido', externalPaymentId: result.externalPaymentId },
        { status: 404 },
      );
    }

    // ignored | noop | alert | mismatch | settled → conhecido/processado: 200.
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    // Erro nosso (token do tenant, MP API, exceção). 503 pra o MP reentregar.
    console.error('[MP Webhook] falha ao liquidar notificação:', err);
    return NextResponse.json({ error: 'Erro ao processar — retry' }, { status: 503 });
  }
}
