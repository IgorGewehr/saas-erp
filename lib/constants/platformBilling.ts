/**
 * lib/constants/platformBilling.ts
 *
 * Plano único do SaaS (M12 v1 — decisão do usuário: sem tiers por enquanto).
 * Preço/frequência aqui, não hardcoded nas rotas — mudar o valor não exige
 * caçar por todo o código, mas ASSINATURAS JÁ CRIADAS gravam seu próprio
 * `amount`/`frequency` no documento (ver PlatformSubscriptionSchema), então
 * mudar esta constante só afeta assinaturas novas, nunca as existentes.
 */

export const PLATFORM_SUBSCRIPTION_PLAN = {
  amount: 199,
  currency: 'BRL' as const,
  frequency: 1,
  frequencyType: 'months' as const,
  reason: 'Assinatura do sistema',
} as const;
