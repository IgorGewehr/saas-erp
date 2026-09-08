/**
 * lib/contracts/domain/transaction.ts
 *
 * Promove `Transaction` de `lib/types/index.ts` pra um contrato de domínio Zod
 * completo (M03.1, pré-requisito SDD R2 — ver `docs/paridade/M03_PLANO_IMPLEMENTACAO.md`).
 * Antes desta fatia só o FSM (`lib/contracts/fsm/transaction.ts`) tinha
 * representação Zod; o resto do doc vivia só como interface TS solta, sem
 * validação em NENHUMA camada (nem rules, nem API, nem cliente).
 *
 * `TRANSACTION_STATUSES`/`TransactionStatusSchema` MORAVAM em
 * `lib/contracts/fsm/transaction.ts` — movidos pra cá (o domínio é a fonte,
 * o FSM importa de volta) pra seguir o MESMO sentido de dependência já usado
 * em Appointment (`fsm/appointment.ts` importa de `domain/appointment.ts`,
 * nunca o contrário). `lib/contracts/api/agent/_shared.ts` também tinha uma
 * 3ª declaração hardcoded e independente de `TransactionTypeSchema`/
 * `TransactionStatusSchema` — substituída por import daqui, fechando um
 * drift real encontrado durante esta fatia (3 fontes de verdade pro mesmo
 * enum, nenhuma delas a canônica).
 *
 * Escopo desta fase: espelhar fielmente o shape hoje aceito em produção
 * (`lib/types/index.ts:Transaction`) + invariantes estruturais SEGURAS de
 * verificar sem risco de rejeitar dado real — nenhum tenant real está em
 * produção neste sistema ainda (ver M03_PLANO_IMPLEMENTACAO.md), então dá
 * pra começar com `amount > 0` rígido em vez de afrouxar depois.
 *
 * DELIBERADAMENTE NÃO incluído nesta fase: discriminated union completa por
 * "tipo de lançamento" (à vista / parcelado / recorrente), que o plano
 * original do M03.1 cogitava. Decidir o shape mínimo por variante depende de
 * observar os 13 write paths reais sendo migrados em M03.2/M03.3 — fazer
 * isso agora, especulativamente, arriscaria um contrato que rejeita um
 * formato que algum caminho hoje já usa legitimamente. Fica pra quando a
 * migração revelar os padrões reais.
 *
 * Também NÃO incluído (fora do escopo desta fatia, achado de passagem):
 * `PaymentMethodSchema` em `lib/contracts/api/agent/_shared.ts` tem valores
 * DIFERENTES do `PaymentMethod` real de `lib/types/index.ts` (ex.:
 * `cartao_loja` vs `creditoLoja`, `transferencia` inexistente no tipo real,
 * `pontos`/`gift_card`/`semPagamento` ausentes no schema do agente) — drift
 * genuíno, mas investigar se isso já causou rejeição real em produção é
 * escopo próprio, não desta consolidação de status/type.
 */

import { z } from 'zod';

export const TRANSACTION_STATUSES = ['pendente', 'pago', 'atrasado', 'cancelado'] as const;
export const TransactionStatusSchema = z.enum(TRANSACTION_STATUSES);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const TRANSACTION_TYPES = ['receita', 'despesa'] as const;
export const TransactionTypeSchema = z.enum(TRANSACTION_TYPES);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

/** Espelha `lib/types/index.ts:PaymentMethod` — 10 valores reais usados em produção. */
export const TRANSACTION_PAYMENT_METHODS = [
  'dinheiro', 'pix', 'credito', 'debito', 'boleto',
  'creditoLoja', 'semPagamento', 'pontos', 'gift_card', 'outros',
] as const;
export const TransactionPaymentMethodSchema = z.enum(TRANSACTION_PAYMENT_METHODS);

/** Espelha `lib/types/index.ts:ConversationChannel` (3 valores) — não confundir
 *  com o `ChannelTypeSchema` mais amplo do boundary do agente. */
export const TransactionChannelTypeSchema = z.enum(['whatsapp', 'facebook', 'instagram']);

export const TRANSACTION_SOURCE_TYPES = [
  'purchase', 'manual', 'sale', 'order', 'service', 'agent', 'api',
] as const;
export const TransactionSourceTypeSchema = z.enum(TRANSACTION_SOURCE_TYPES);

export const RECURRENCE_FREQUENCIES = [
  'weekly', 'biweekly', 'biweekly_fixed', 'monthly', 'quarterly', 'semiannual', 'yearly',
] as const;
export const RecurrenceFrequencySchema = z.enum(RECURRENCE_FREQUENCIES);

const TransactionRecurrenceEntrySchema = z.object({
  dueDate: z.string().min(1),
  paidDate: z.string().min(1),
  amount: z.number(),
  attachments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    path: z.string(),
    uploadedAt: z.string(),
  })).optional(),
});

const TransactionRecurrenceSchema = z.object({
  frequency: RecurrenceFrequencySchema,
  nextDueDate: z.string().min(1),
  endDate: z.string().optional(),
  isActive: z.boolean(),
  parentTransactionId: z.string().optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  secondDayOfMonth: z.number().int().min(1).max(28).optional(),
  holidayAdjust: z.enum(['none', 'before', 'after']).optional(),
  lateFeePct: z.number().nonnegative().optional(),
  interestPctMonth: z.number().nonnegative().optional(),
  label: z.string().optional(),
  history: z.array(TransactionRecurrenceEntrySchema).optional(),
  reminderDismissedFor: z.string().optional(),
});

const TransactionAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  path: z.string(),
  size: z.number(),
  type: z.string(),
  createdAt: z.string(),
});

export const TransactionSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  type: TransactionTypeSchema,
  category: z.string().optional(),
  description: z.string().min(1),
  amount: z.number().positive('amount deve ser positivo — valor zero/negativo não é um lançamento válido'),
  dueDate: z.string().optional(),
  paymentDate: z.string().optional(),
  status: TransactionStatusSchema,
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  saleId: z.string().optional(),
  paymentMethod: TransactionPaymentMethodSchema.optional(),
  recurrenceId: z.string().optional(),
  bankAccountId: z.string().optional(),
  businessUnitId: z.string().optional(),
  costCenter: z.string().optional(),
  notes: z.string().optional(),
  channelType: TransactionChannelTypeSchema.optional(),
  conversationId: z.string().optional(),
  contactId: z.string().optional(),
  campaignId: z.string().optional(),
  sectorId: z.string().optional(),
  // ── Vínculo opcional com um projeto (ex: SaaS específico em software house) ──
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  // ── Vínculos de origem — mesmos 4 campos auditados em m03-financial-audit.ts ──
  appointmentId: z.string().optional(),
  deliveryOrderId: z.string().optional(),
  orderId: z.string().optional(),
  purchaseNoteId: z.string().optional(),
  supplierId: z.string().optional(),
  supplierName: z.string().optional(),
  sourceType: TransactionSourceTypeSchema.optional(),
  idempotencyKey: z.string().optional(),
  clientMembershipId: z.string().optional(),
  membershipId: z.string().optional(),
  // ── Auditoria de cancelamento ──────────────────────────────────────────────
  cancelledAt: z.string().optional(),
  cancelledBy: z.string().optional(),
  cancelledByName: z.string().optional(),
  // ── Parcelamento ─────────────────────────────────────────────────────────
  installmentGroupId: z.string().optional(),
  installmentNumber: z.number().int().positive().optional(),
  installmentTotal: z.number().int().positive().optional(),
  // ── Recorrência automática ───────────────────────────────────────────────
  recurrence: TransactionRecurrenceSchema.optional(),
  // ── Anexos (recibos, NFs, etc) ───────────────────────────────────────────
  attachments: z.array(TransactionAttachmentSchema).optional(),
  // ── Lock fiscal: true quando existe NF-e/NFC-e/NFSe autorizada vinculada ──
  isLocked: z.boolean().optional(),
  lockedReason: z.string().optional(),
  // ── Auditoria de quem criou/modificou ────────────────────────────────────
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedByName: z.string().optional(),
  // ── Idempotência de notificações (cron) ──────────────────────────────────
  dueSoonNotifiedAt: z.string().optional(),
  overdueNotifiedAt: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((t, ctx) => {
  // INVARIANTE: parcela sem grupo não faz sentido — installmentTotal/Number
  // descrevem uma posição DENTRO de um installmentGroupId.
  if ((t.installmentTotal !== undefined || t.installmentNumber !== undefined) && !t.installmentGroupId) {
    ctx.addIssue({
      code: 'custom',
      message: 'installmentTotal/installmentNumber exigem installmentGroupId',
      path: ['installmentGroupId'],
    });
  }
  if (t.installmentNumber !== undefined && t.installmentTotal !== undefined && t.installmentNumber > t.installmentTotal) {
    ctx.addIssue({
      code: 'custom',
      message: `installmentNumber (${t.installmentNumber}) não pode ser maior que installmentTotal (${t.installmentTotal})`,
      path: ['installmentNumber'],
    });
  }
});
export type Transaction = z.infer<typeof TransactionSchema>;
