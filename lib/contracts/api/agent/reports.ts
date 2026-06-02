/**
 * lib/contracts/api/agent/reports.ts — /api/agent/tools/reports (P2.11)
 *
 * READ-ONLY: agregações cross-coleção do ReportsModule expostas ao agent (modo
 * analyst). Nenhuma action muta dados — só lê transactions/sales/orders/
 * appointments/clients filtrados por businessId e devolve agregados.
 *
 * Actions: revenue_by_period, sales_by_product, appointments_by_professional, top_clients
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema } from './_shared';

// Período: preset OU intervalo explícito YYYY-MM-DD. Default '30d' (igual UI).
const ReportPeriodSchema = z.enum(['7d', '30d', '90d', 'mes', 'mes_anterior', 'ano']);
const DateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PeriodParamsSchema = z.object({
  period: ReportPeriodSchema.default('30d'),
  fromDate: DateYmd.optional(),
  toDate: DateYmd.optional(),
});

// ---------- revenue_by_period ----------
export const RevenueByPeriodParamsSchema = PeriodParamsSchema;
export const RevenueByPeriodDataSchema = z.object({
  totalReceita: MoneySchema,
  totalDespesa: MoneySchema,
  lucro: z.number(),
  margem: z.number(),
  paidCount: z.number().int().nonnegative(),
  receitasPorCategoria: z.array(z.object({ category: z.string(), total: MoneySchema })),
  despesasPorCategoria: z.array(z.object({ category: z.string(), total: MoneySchema })),
});

// ---------- sales_by_product ----------
export const SalesByProductParamsSchema = PeriodParamsSchema;
const RankItemSchema = z.object({
  name: z.string(),
  qty: z.number().int().nonnegative(),
  total: MoneySchema,
});
export const SalesByProductDataSchema = z.object({
  produtos: z.array(RankItemSchema),
  servicos: z.array(RankItemSchema),
  totalProdutos: MoneySchema,
  totalServicos: MoneySchema,
  qtyProdutos: z.number().int().nonnegative(),
  qtyServicos: z.number().int().nonnegative(),
});

// ---------- appointments_by_professional ----------
export const AppointmentsByProfessionalParamsSchema = PeriodParamsSchema;
export const AppointmentsByProfessionalDataSchema = z.object({
  total: z.number().int().nonnegative(),
  concluidos: z.number().int().nonnegative(),
  cancelados: z.number().int().nonnegative(),
  naoCompareceu: z.number().int().nonnegative(),
  taxaConclusao: z.number(),
  taxaNoShow: z.number(),
  porProfissional: z.array(z.object({
    professionalId: z.string(),
    name: z.string(),
    total: z.number().int().nonnegative(),
    concluidos: z.number().int().nonnegative(),
    noShow: z.number().int().nonnegative(),
    taxaConclusao: z.number(),
    receita: MoneySchema,
  })),
});

// ---------- top_clients ----------
export const TopClientsParamsSchema = PeriodParamsSchema.extend({
  limit: z.number().int().min(1).max(50).default(10),
});
export const TopClientsDataSchema = z.object({
  totalClientes: z.number().int().nonnegative(),
  novosNoPeriodo: z.number().int().nonnegative(),
  ticketMedioCLV: MoneySchema,
  topClients: z.array(z.object({
    id: DocIdSchema,
    name: z.string(),
    totalSpent: MoneySchema,
    visitCount: z.number().int().nonnegative(),
    visitasNoPeriodo: z.number().int().nonnegative(),
  })),
});

// ============================================================================
// Discriminated union do request body inteiro
// ============================================================================

export const ReportsToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('revenue_by_period'),             params: RevenueByPeriodParamsSchema }),
  z.object({ action: z.literal('sales_by_product'),              params: SalesByProductParamsSchema }),
  z.object({ action: z.literal('appointments_by_professional'),  params: AppointmentsByProfessionalParamsSchema }),
  z.object({ action: z.literal('top_clients'),                   params: TopClientsParamsSchema }),
]);

export type ReportsToolRequest = z.infer<typeof ReportsToolRequestSchema>;
export type ReportsToolAction = ReportsToolRequest['action'];

export const REPORTS_DATA_SCHEMAS = {
  revenue_by_period:            RevenueByPeriodDataSchema,
  sales_by_product:             SalesByProductDataSchema,
  appointments_by_professional: AppointmentsByProfessionalDataSchema,
  top_clients:                  TopClientsDataSchema,
} as const satisfies Record<ReportsToolAction, z.ZodTypeAny>;
