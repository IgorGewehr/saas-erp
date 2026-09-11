/**
 * lib/contracts/domain/platformSubscription.ts
 *
 * Assinatura do PRÓPRIO SaaS (o dono do tenant pagando esta plataforma, via
 * Mercado Pago) — não confundir com `paymentAccount.ts` (a conta MP que CADA
 * tenant conecta pra cobrar OS PRÓPRIOS clientes dele). São duas integrações
 * Mercado Pago completamente distintas, com credenciais e propósito
 * diferentes — ver lib/services/platformBilling/.
 *
 * LOCAL DO DOC: `platformSubscriptions/{businessId}` — 1:1 com Business,
 * Admin-SDK-only (firestore.rules: `allow read, write: if false`). Nenhum
 * tenant, mesmo founder, lê ou escreve isto direto — só o operador da
 * plataforma via rotas gated por lib/utils/verifyPlatformOperator.ts.
 *
 * M12 v1 (decisão do usuário): plano único (sem tiers), sem enforcement
 * (overdue é só status visível no painel, não bloqueia nada).
 */

import { z } from 'zod';
import { PlatformSubscriptionStatusSchema } from '@/lib/contracts/fsm/platformSubscription';

export const PlatformSubscriptionSchema = z.object({
  /** = id do doc = businessId (relação 1:1, sem necessidade de campo próprio
   *  de id — mantido explícito no shape pra ficar óbvio em quem consome). */
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  status: PlatformSubscriptionStatusSchema,

  /** ID do preapproval no Mercado Pago (conta da PLATAFORMA, não do tenant). */
  mpPreapprovalId: z.string().min(1).optional(),
  /** E-mail do pagador (dono do tenant) — vem de business.email no momento
   *  da criação do checkout. */
  payerEmail: z.string().email(),

  /** Plano único hoje — ver lib/constants/platformBilling.ts pro valor
   *  atual. Gravado no documento (não só lido da constante em runtime) pra
   *  preservar histórico caso o preço mude no futuro sem afetar assinaturas
   *  já criadas. */
  amount: z.number().positive(),
  currency: z.literal('BRL'),
  frequency: z.number().int().positive(),
  frequencyType: z.literal('months'),

  /** Link de checkout (init_point) — só relevante enquanto pending_payment;
   *  mantido após ativar só pra referência/histórico. */
  checkoutUrl: z.string().url().optional(),

  /** ISO — quando a próxima cobrança deveria acontecer. Ausente até o
   *  primeiro pagamento confirmar (pending_payment). */
  nextBillingDate: z.string().datetime().optional(),
  lastPaymentAt: z.string().datetime().optional(),
  /** Status do último pagamento individual reportado pelo MP (não confundir
   *  com `status`, que é da ASSINATURA como um todo). */
  lastPaymentStatus: z.string().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((sub, ctx) => {
  // INVARIANTE: só pending_payment pode existir sem preapproval — qualquer
  // outro status implica que o preapproval já foi criado no MP.
  if (sub.status !== 'pending_payment' && !sub.mpPreapprovalId) {
    ctx.addIssue({
      code: 'custom',
      message: `status '${sub.status}' exige mpPreapprovalId (só pending_payment pode estar sem)`,
      path: ['mpPreapprovalId'],
    });
  }
  // INVARIANTE: active/overdue precisam saber quando cobrar de novo.
  if ((sub.status === 'active' || sub.status === 'overdue') && !sub.nextBillingDate) {
    ctx.addIssue({
      code: 'custom',
      message: `status '${sub.status}' exige nextBillingDate`,
      path: ['nextBillingDate'],
    });
  }
});
export type PlatformSubscription = z.infer<typeof PlatformSubscriptionSchema>;
