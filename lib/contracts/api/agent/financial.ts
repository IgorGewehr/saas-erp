/**
 * lib/contracts/api/agent/financial.ts — /api/agent/tools/financial
 * Actions: list, get, create_receivable, create_payable, mark_paid, cancel, summary_today, summary_month
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema, PaymentMethodSchema, TransactionStatusSchema, TransactionTypeSchema } from './_shared';

const TransactionShapeSchema = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  type: TransactionTypeSchema,
  status: TransactionStatusSchema,
  amount: MoneySchema,
  description: z.string(),
  dueDate: z.string().optional(),
  paymentDate: z.string().optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  category: z.string().optional(),
  clientId: DocIdSchema.optional(),
  clientName: z.string().optional(),
  installmentGroupId: z.string().optional(),
  installmentNumber: z.number().int().optional(),
  installmentTotal: z.number().int().optional(),
}).passthrough();

const DateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const YearMonth = z.string().regex(/^\d{4}-\d{2}$/);

// ---------- list ----------
export const FinancialListParamsSchema = z.object({
  type: TransactionTypeSchema.optional(),
  status: TransactionStatusSchema.optional(),
  fromDate: DateYmd.optional(),
  toDate: DateYmd.optional(),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  orderBy: z.enum(['dueDate', 'createdAt']).default('dueDate'),
});
export const FinancialListDataSchema = z.array(TransactionShapeSchema);

// ---------- get ----------
export const FinancialGetParamsSchema = z.object({ id: DocIdSchema });
export const FinancialGetDataSchema = TransactionShapeSchema.nullable();

// ---------- create_receivable / create_payable ----------
const CreateTxParamsBase = z.object({
  description: z.string().min(1).max(500),
  amount: MoneySchema.refine((v) => v > 0, 'amount > 0'),
  dueDate: DateYmd.optional(),
  category: z.string().max(100).optional(),
  clientId: DocIdSchema.optional(),
  clientName: z.string().max(200).optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  notes: z.string().max(2000).optional(),
  installments: z.number().int().min(1).max(48).default(1),
});
export const FinancialCreateReceivableParamsSchema = CreateTxParamsBase;
export const FinancialCreatePayableParamsSchema = CreateTxParamsBase;
export const FinancialCreateTxDataSchema = z.union([
  TransactionShapeSchema,
  z.array(TransactionShapeSchema),
]);

// ---------- mark_paid ----------
export const FinancialMarkPaidParamsSchema = z.object({
  id: DocIdSchema,
  paymentDate: DateYmd.optional(),
  paymentMethod: PaymentMethodSchema.optional(),
});
export const FinancialMarkPaidDataSchema = TransactionShapeSchema;

// ---------- cancel ----------
export const FinancialCancelParamsSchema = z.object({
  id: DocIdSchema,
  reason: z.string().max(500).optional(),
});
export const FinancialCancelDataSchema = TransactionShapeSchema;

// ---------- summary_today ----------
export const FinancialSummaryTodayParamsSchema = z.object({});
export const FinancialSummaryTodayDataSchema = z.object({
  date: DateYmd,
  pendingIn: MoneySchema,
  pendingOut: MoneySchema,
  paidInToday: MoneySchema,
  paidOutToday: MoneySchema,
  netPendingBalance: z.number(),
  netPaidToday: z.number(),
  overdueCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
});

// ---------- summary_month ----------
export const FinancialSummaryMonthParamsSchema = z.object({
  month: YearMonth.optional(),
});
export const FinancialSummaryMonthDataSchema = z.object({
  month: YearMonth,
  totalReceita: MoneySchema,
  totalDespesa: MoneySchema,
  netBalance: z.number(),
  counts: z.object({
    pendente: z.number().int().nonnegative(),
    pago: z.number().int().nonnegative(),
    atrasado: z.number().int().nonnegative(),
    cancelado: z.number().int().nonnegative(),
  }),
  byCategory: z.array(z.object({
    category: z.string(),
    amount: MoneySchema,
    count: z.number().int().nonnegative(),
  })),
});

export const FinancialToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),               params: FinancialListParamsSchema }),
  z.object({ action: z.literal('get'),                params: FinancialGetParamsSchema }),
  z.object({ action: z.literal('create_receivable'),  params: FinancialCreateReceivableParamsSchema }),
  z.object({ action: z.literal('create_payable'),     params: FinancialCreatePayableParamsSchema }),
  z.object({ action: z.literal('mark_paid'),          params: FinancialMarkPaidParamsSchema }),
  z.object({ action: z.literal('cancel'),             params: FinancialCancelParamsSchema }),
  z.object({ action: z.literal('summary_today'),      params: FinancialSummaryTodayParamsSchema }),
  z.object({ action: z.literal('summary_month'),      params: FinancialSummaryMonthParamsSchema }),
]);

export const FINANCIAL_DATA_SCHEMAS = {
  list:              FinancialListDataSchema,
  get:               FinancialGetDataSchema,
  create_receivable: FinancialCreateTxDataSchema,
  create_payable:    FinancialCreateTxDataSchema,
  mark_paid:         FinancialMarkPaidDataSchema,
  cancel:            FinancialCancelDataSchema,
  summary_today:     FinancialSummaryTodayDataSchema,
  summary_month:     FinancialSummaryMonthDataSchema,
} as const;
