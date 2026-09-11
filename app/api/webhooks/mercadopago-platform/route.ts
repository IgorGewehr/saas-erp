/**
 * Mercado Pago Webhook Handler (PLATAFORMA) — POST /api/webhooks/mercadopago-platform
 *
 * Recebe notificações da conta Mercado Pago DA PLATAFORMA (M12 — dono do
 * tenant pagando este SaaS), não confundir com /api/webhooks/mercadopago
 * (recebe notificações das contas MP que cada TENANT conecta via OAuth pra
 * cobrar os PRÓPRIOS clientes). Contexto de app/conta MP diferente — secret
 * diferente (MP_PLATFORM_WEBHOOK_SECRET), endpoint diferente.
 *
 * Mesmo esqueleto de verificação do endpoint per-tenant (assinatura
 * x-signature fail-closed + anti-replay + nunca confiar no payload, sempre
 * re-buscar o recurso) — ver lib/services/mercadopago/webhookSignature.ts,
 * extraído justamente pra ser compartilhado entre os dois endpoints.
 *
 * Setup no painel do MP (conta da plataforma, não a do marketplace app):
 *   - URL: https://seu-dominio.com/api/webhooks/mercadopago-platform
 *   - Segredo de assinatura → MP_PLATFORM_WEBHOOK_SECRET no ambiente.
 *   - Tópicos: subscription_preapproval + payment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { MpWebhookPayloadSchema } from '@/contracts/api/integrations/mercadopago';
import { settlePlatformWebhookEvent } from '@/lib/services/platformBilling/subscriptionAdmin';
import { parseMpXSignature, verifyMpSignature, isWithinMpReplayWindow } from '@/lib/services/mercadopago/webhookSignature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // ── 1. Assinatura: FAIL-CLOSED ─────────────────────────────────────────────
  const secret = process.env.MP_PLATFORM_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[MP Platform Webhook] MP_PLATFORM_WEBHOOK_SECRET ausente — rejeitando (fail-closed)');
    return NextResponse.json({ error: 'Webhook não configurado' }, { status: 401 });
  }

  const sig = parseMpXSignature(req.headers.get('x-signature'));
  if (!sig) {
    console.warn('[MP Platform Webhook] x-signature ausente ou malformado');
    return NextResponse.json({ error: 'Assinatura ausente' }, { status: 401 });
  }

  const url = new URL(req.url);
  const queryDataId = url.searchParams.get('data.id') ?? url.searchParams.get('id');
  const requestId = req.headers.get('x-request-id');

  if (!verifyMpSignature({ secret, sig, dataId: queryDataId, requestId })) {
    console.warn('[MP Platform Webhook] assinatura inválida — confira MP_PLATFORM_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
  }

  // ── 2. Anti-replay ─────────────────────────────────────────────────────────
  if (!isWithinMpReplayWindow(sig.ts)) {
    console.warn('[MP Platform Webhook] ts fora da janela anti-replay');
    return NextResponse.json({ error: 'Timestamp fora da janela' }, { status: 401 });
  }

  // ── 3. Corpo (R6 — valida no boundary) ─────────────────────────────────────
  let payload: ReturnType<typeof MpWebhookPayloadSchema.parse>;
  try {
    const json = await req.json();
    payload = MpWebhookPayloadSchema.parse(json);
  } catch (err) {
    console.warn('[MP Platform Webhook] corpo inválido:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
  }

  const type = payload.type ?? payload.topic ?? '';

  if (!queryDataId) {
    console.warn('[MP Platform Webhook] data.id ausente na query (fora do escopo assinado)');
    return NextResponse.json({ error: 'data.id ausente na query' }, { status: 400 });
  }
  if (payload.data.id !== queryDataId) {
    console.warn('[MP Platform Webhook] data.id do corpo diverge do id assinado — rejeitando');
    return NextResponse.json({ error: 'data.id divergente da assinatura' }, { status: 400 });
  }
  const dataId = queryDataId;

  // ── 4. Liquidação ───────────────────────────────────────────────────────────
  try {
    await settlePlatformWebhookEvent({ type, dataId });
    // ignorado (tipo desconhecido, status sem transição mapeada) ou
    // liquidado: sempre 200 — não há caso "transitório" aqui como no
    // per-tenant (não dependemos de um pedido persistir antes do webhook).
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error('[MP Platform Webhook] falha ao liquidar notificação:', err);
    return NextResponse.json({ error: 'Erro ao processar — retry' }, { status: 503 });
  }
}
