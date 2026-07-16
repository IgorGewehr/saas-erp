/**
 * lib/contracts/domain/membership.ts
 *
 * Mensalidade/assinatura recorrente (academia, clube, salão com plano) — P2.9.
 *
 *  - `Membership`        → o PLANO (catálogo): preço, ciclo, serviços inclusos,
 *                          limite de usos por ciclo.
 *  - `ClientMembership`  → a ASSINATURA de um cliente a um plano: status (FSM),
 *                          janela do ciclo corrente, usos consumidos no ciclo,
 *                          próxima cobrança.
 *
 * O billing runner (lib/services/membershipBillingRunner.ts) avança a janela
 * do ciclo e gera a cobrança de forma idempotente por
 * `membershipBillingLogs/{clientMembershipId}_{cycle}`. `bookGroupAppointment`
 * (agenda) consulta `usesThisCycle`/`maxUsesPerCycle` pra recusar reserva acima
 * do limite do plano.
 *
 * R2: este é o contrato canônico. Os tipos vivem aqui via z.infer; as interfaces
 * antigas em lib/types/index.ts são mantidas como espelho (legado) até a
 * migração completa — manter sincronizadas. NÃO redeclarar shape paralelo novo.
 */

import { z } from 'zod';

const IsoSchema = z.string().min(1);
const DateYmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');

// ─── Plano (catálogo) ────────────────────────────────────────────────────────

export const MEMBERSHIP_BILLING_CYCLES = ['monthly', 'quarterly', 'yearly'] as const;
export const MembershipBillingCycleSchema = z.enum(MEMBERSHIP_BILLING_CYCLES);
export type MembershipBillingCycle = z.infer<typeof MembershipBillingCycleSchema>;

/** Dias de cada ciclo — usado pelo runner pra calcular nextBillingDate/cycleEnd. */
export const BILLING_CYCLE_DAYS: Record<MembershipBillingCycle, number> = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

export const MembershipSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  name: z.string().min(1),
  description: z.string().optional(),
  serviceIds: z.array(z.string()),
  price: z.number().nonnegative(),
  billingCycle: MembershipBillingCycleSchema,
  /** null/ausente = ilimitado. Quando definido, é o teto de usos por ciclo. */
  maxUsesPerCycle: z.number().int().positive().nullable().optional(),
  isActive: z.boolean(),
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
});
export type Membership = z.infer<typeof MembershipSchema>;

// ─── Assinatura do cliente ───────────────────────────────────────────────────

export const MEMBERSHIP_STATUSES = ['active', 'paused', 'cancelled', 'expired'] as const;
export const MembershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

export const ClientMembershipSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  membershipId: z.string().min(1),
  membershipName: z.string().min(1),
  status: MembershipStatusSchema,
  startDate: DateYmdSchema,
  /** Próxima cobrança (YYYY-MM-DD). O runner cobra quando hoje >= nextBillingDate. */
  nextBillingDate: DateYmdSchema.optional(),
  /** Usos consumidos no ciclo corrente. Resetado pra 0 a cada virada de ciclo
   *  pelo billing runner. bookGroupAppointment incrementa ao reservar. */
  usesThisCycle: z.number().int().nonnegative(),
  /** Contador monotônico do ciclo (1, 2, 3, ...). Compõe a chave de idempotência
   *  do billing `{clientMembershipId}_{cycle}`. Ausente em docs legados → 1. */
  cycle: z.number().int().positive().optional(),
  /** Data da última cobrança gerada com sucesso (auditoria/idempotência). */
  lastBilledDate: DateYmdSchema.optional(),
  /**
   * Quando o cancelamento aconteceu (financial-v2 gap g1 — Recorrentes/Assinaturas
   * precisa disto pro drill "Novos × Churn"). Campo novo, retrocompatível: docs
   * legados cancelados sem este campo existem hoje — read-models fazem fallback
   * pra `updatedAt` (backfill honesto, não é invariante dura ainda; ver
   * scratchpad/design/saas-erp-financeiro-plano.md §2.6-g1).
   */
  cancelledAt: DateYmdSchema.optional(),
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
}).superRefine((cm, ctx) => {
  // INVARIANTE: assinatura ativa precisa de nextBillingDate pra o runner agir.
  if (cm.status === 'active' && !cm.nextBillingDate) {
    ctx.addIssue({ code: 'custom', message: 'ClientMembership ativo exige nextBillingDate', path: ['nextBillingDate'] });
  }
});
export type ClientMembership = z.infer<typeof ClientMembershipSchema>;
