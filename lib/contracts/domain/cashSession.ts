/**
 * lib/contracts/domain/cashSession.ts
 *
 * CashSession — o ritual de sessão de caixa (gaveta física) da aba Fluxo de
 * Caixa do financeiro v2: abertura (troco inicial) → operação (sangrias) →
 * fechamento (contagem física × esperado → sobra/falta). Vinculada a um
 * `BankAccount` com `accountType === 'caixa'` (o "dinheiro em espécie" do
 * plano — nunca banco, nunca previsto).
 *
 * Este é o gap g5 do plano de transformação (`saas-erp-financeiro-plano.md`
 * §2.6): a entidade não existia; nasce aqui pra suportar abertura/fechamento/
 * sangria de verdade em vez do extrato-only do v1 original.
 *
 * ─── Invariantes (superRefine) ──────────────────────────────────────────────
 *   - status 'fechada' ⇒ `closedAt` + `closedByUid` + `countedAmount` +
 *     `expectedAmount` + `difference` todos presentes (o fechamento é atômico:
 *     não existe "meio fechado").
 *   - status 'aberta' ⇒ nenhum desses 5 campos presente (senão a sessão já
 *     teria fechado).
 *   - `difference === countedAmount - expectedAmount` quando fechada (sobra
 *     positiva, falta negativa) — checado no schema pra nunca gravar os 3
 *     números inconsistentes entre si.
 *
 * ─── O que NÃO vive aqui ─────────────────────────────────────────────────────
 *   - Transições de status → `lib/contracts/fsm/cashSession.ts`.
 *   - Cálculo do esperado a partir das Transactions em espécie → função pura
 *     `computeSessionLive` em `app/components/features/financial-v2/read-models/fluxo-caixa-especie.ts`.
 *   - Evento cross-módulo do fechamento (futuro PDV) → `caixa.fechado` em
 *     `lib/contracts/events/index.ts` (documentação, sem subscriber ainda).
 *   - Regra "só 1 sessão aberta por conta por vez" → aplicada no client
 *     (`AbrirCaixaDialog`) antes de criar; sem transação Firestore (gap
 *     conhecido de corrida, aceitável pro volume de um caixa físico).
 */

import { z } from 'zod';

export const CASH_SESSION_STATUSES = ['aberta', 'fechada'] as const;
export const CashSessionStatusSchema = z.enum(CASH_SESSION_STATUSES);
export type CashSessionStatus = z.infer<typeof CashSessionStatusSchema>;

/** Sangria — retirada de dinheiro do caixa durante a sessão (segurança/depósito). */
export const CashWithdrawalSchema = z.object({
  id: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().min(1).max(200),
  at: z.string().datetime().or(z.string().min(1)),
  byUid: z.string().min(1),
  byName: z.string().min(1),
});
export type CashWithdrawal = z.infer<typeof CashWithdrawalSchema>;

export const CashSessionSchema = z
  .object({
    id: z.string().optional(),
    businessId: z.string().min(1),
    /** FK para `BankAccount` com `accountType === 'caixa'`. */
    bankAccountId: z.string().min(1),
    status: CashSessionStatusSchema,

    openedAt: z.string().min(1),
    openedByUid: z.string().min(1),
    openedByName: z.string().min(1),
    /** Troco inicial (fundo de caixa) com que a gaveta abriu. */
    openingAmount: z.number().nonnegative(),

    /** Sangrias registradas durante a sessão — sempre via `arrayUnion`, nunca reescreve o array inteiro. */
    withdrawals: z.array(CashWithdrawalSchema).default([]),

    closedAt: z.string().min(1).optional(),
    closedByUid: z.string().min(1).optional(),
    closedByName: z.string().min(1).optional(),
    /** Contagem física da gaveta no fechamento. */
    countedAmount: z.number().nonnegative().optional(),
    /** openingAmount + entrou em espécie − saiu em espécie − sangrias, congelado no fechamento. */
    expectedAmount: z.number().optional(),
    /** countedAmount − expectedAmount. Positivo = sobra; negativo = falta. */
    difference: z.number().optional(),

    notes: z.string().max(500).optional(),

    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((s, ctx) => {
    const closingFields = [s.closedAt, s.closedByUid, s.countedAmount, s.expectedAmount, s.difference];
    if (s.status === 'fechada') {
      if (closingFields.some((f) => f === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Sessão fechada precisa de closedAt, closedByUid, countedAmount, expectedAmount e difference',
        });
      }
      if (
        s.countedAmount !== undefined &&
        s.expectedAmount !== undefined &&
        s.difference !== undefined &&
        Math.abs(s.difference - (s.countedAmount - s.expectedAmount)) > 0.01
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['difference'],
          message: 'difference deve ser countedAmount - expectedAmount',
        });
      }
    } else if (closingFields.some((f) => f !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Sessão aberta não pode ter campos de fechamento preenchidos',
      });
    }
  });

export type CashSession = z.infer<typeof CashSessionSchema>;
