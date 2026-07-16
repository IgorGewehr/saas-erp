/**
 * lib/contracts/api/integrations/mercadopago.ts
 *
 * Contratos das rotas de INTEGRAÇÃO Mercado Pago (OAuth + webhook).
 * Fundação — nenhuma rota implementada ainda.
 *
 * Fluxo OAuth (Marketplace):
 *   connect  → server gera authUrl (com `state` HMAC) e o painel redireciona.
 *   callback → MP volta com (code, state); server troca code por tokens e
 *              persiste em businesses/{id}/private/mpAuth (Admin SDK).
 *   status   → painel lê PaymentAccountPublic (sem tokens).
 *   disconnect → revoga/limpa credenciais.
 *   webhook  → MP notifica payment.updated etc. (deduplicar por data.id).
 */

import { z } from 'zod';
import { ErrorEnvelopeSchema, successEnvelope } from '../_envelope';
import { PaymentAccountPublicSchema } from '../../domain/paymentAccount';

// ─── state HMAC do OAuth ────────────────────────────────────────────────────
//
// `state` carrega o tenant através do redirect do MP e protege contra CSRF.
// Vai assinado (HMAC) e codificado; este é o PAYLOAD antes de assinar.
export const MpOAuthStateSchema = z.object({
  businessId: z.string().min(1),
  /** Nonce aleatório (anti-replay/CSRF). */
  nonce: z.string().min(8),
  /** issued-at em epoch seconds — server rejeita state expirado. */
  iat: z.number().int().nonnegative(),
});
export type MpOAuthState = z.infer<typeof MpOAuthStateSchema>;

// ─── POST /api/integrations/mercadopago/connect ─────────────────────────────
export const MpConnectBodySchema = z.object({
  /** opcional: pra onde o painel quer voltar após o OAuth. */
  returnTo: z.string().optional(),
});
export const MpConnectResponseSchema = z.union([
  successEnvelope(z.object({
    authUrl: z.string().url(),
  })),
  ErrorEnvelopeSchema,
]);
export type MpConnectBody = z.infer<typeof MpConnectBodySchema>;

// ─── GET /api/integrations/mercadopago/callback ─────────────────────────────
export const MpCallbackQuerySchema = z.object({
  code: z.string().min(1),
  /** state assinado (HMAC) — server verifica e decodifica em MpOAuthState. */
  state: z.string().min(1),
});
export const MpCallbackResponseSchema = z.union([
  successEnvelope(PaymentAccountPublicSchema),
  ErrorEnvelopeSchema,
]);
export type MpCallbackQuery = z.infer<typeof MpCallbackQuerySchema>;

// ─── GET /api/integrations/mercadopago/status ───────────────────────────────
export const MpStatusResponseSchema = z.union([
  successEnvelope(PaymentAccountPublicSchema),
  ErrorEnvelopeSchema,
]);

// ─── POST /api/integrations/mercadopago/disconnect ──────────────────────────
export const MpDisconnectResponseSchema = z.union([
  successEnvelope(z.object({ disconnected: z.literal(true) })),
  ErrorEnvelopeSchema,
]);

// ─── POST /api/webhooks/mercadopago ─────────────────────────────────────────
//
// Payload do MP (IPN/Webhooks v2). `type` (ou `topic`) + `data.id` apontam o
// recurso a buscar via API. Deduplicar por `data.id` (idempotência R3).
export const MpWebhookPayloadSchema = z.object({
  /** 'payment' | 'plan' | 'subscription' | 'invoice' | 'point_integration_wh' ... */
  type: z.string().min(1).optional(),
  /** Formato legado IPN. */
  topic: z.string().min(1).optional(),
  action: z.string().optional(),
  /** id do recurso afetado (ex: payment id). */
  data: z.object({ id: z.string().min(1) }),
  id: z.union([z.string(), z.number()]).optional(),
  live_mode: z.boolean().optional(),
  date_created: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
}).superRefine((p, ctx) => {
  if (!p.type && !p.topic) {
    ctx.addIssue({ code: 'custom', message: 'type ou topic é obrigatório', path: ['type'] });
  }
});
export type MpWebhookPayload = z.infer<typeof MpWebhookPayloadSchema>;

/** MP espera 200/201 rápido; corpo é irrelevante mas mantemos envelope. */
export const MpWebhookResponseSchema = z.union([
  successEnvelope(z.object({ received: z.literal(true) })),
  ErrorEnvelopeSchema,
]);
