/**
 * lib/contracts/domain/paymentAccount.ts
 *
 * Conta de pagamento Mercado Pago de um tenant (OAuth Marketplace / split).
 * O business conecta sua própria conta MP via OAuth; recebemos access/refresh
 * tokens que cifram em repouso (AES-256-GCM, vide lib/utils/encryption).
 *
 * LOCAL DO DOC (sensível): `businesses/{businessId}/private/mpAuth`.
 *   - Subcoleção `private/*` é gravada/lida APENAS pelo Admin SDK (server).
 *     Firestore rules negam acesso de cliente — tokens nunca chegam ao browser.
 *   - A UI consome PaymentAccountPublicSchema (sem tokens), exposto por route.
 *
 * Aqui declaramos só o SHAPE — o ciphertext fica como string nos campos *Encrypted.
 */

import { z } from 'zod';

export const PAYMENT_PROVIDERS = ['mercadopago'] as const;
export const PaymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

/**
 * Doc completo persistido em businesses/{id}/private/mpAuth.
 * NUNCA serializar para o cliente — contém tokens cifrados.
 */
export const PaymentAccountSchema = z.object({
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  provider: PaymentProviderSchema,

  /** ID da conta MP do vendedor (collector_id / user_id retornado no OAuth). */
  mpUserId: z.string().min(1),
  /** Public key da conta — pode ir pro browser (usada pelo Bricks/SDK JS). */
  mpPublicKey: z.string().min(1),
  /** false = credenciais de teste (sandbox); true = produção. */
  mpLiveMode: z.boolean(),

  /** Token cifrado (base64 de iv+ct+tag — vide encryptToken). */
  accessTokenEncrypted: z.string().min(1),
  /** Refresh token cifrado — usado pra renovar antes de tokenExpiresAt. */
  refreshTokenEncrypted: z.string().min(1),
  /** Expiração do access token (ISO 8601). Renovar antes disso. */
  tokenExpiresAt: z.string().datetime(),

  /** Flag de conveniência pra UI/gates: conta utilizável agora. */
  mpConnected: z.boolean(),
  /** true ⇒ refresh falhou / escopo revogado; UI deve pedir reconexão. */
  mpNeedsReauth: z.boolean(),

  connectedAt: z.string().datetime().optional(),
  lastRefreshAt: z.string().datetime().optional(),
}).superRefine((a, ctx) => {
  // INVARIANTE: conta conectada não pode estar marcada como needs-reauth.
  if (a.mpConnected && a.mpNeedsReauth) {
    ctx.addIssue({
      code: 'custom',
      message: 'mpConnected=true é incompatível com mpNeedsReauth=true',
      path: ['mpNeedsReauth'],
    });
  }
});
export type PaymentAccount = z.infer<typeof PaymentAccountSchema>;

/**
 * Projeção SEGURA pra UI — sem tokens nem mpUserId.
 * É o que a route GET de status retorna ao painel de Integrações.
 */
export const PaymentAccountPublicSchema = z.object({
  mpConnected: z.boolean(),
  mpPublicKey: z.string().min(1),
  mpNeedsReauth: z.boolean(),
  mpLiveMode: z.boolean(),
});
export type PaymentAccountPublic = z.infer<typeof PaymentAccountPublicSchema>;
