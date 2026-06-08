/**
 * lib/contracts/api/agent/fiscal.ts
 *
 * Contratos para /api/agent/tools/fiscal (P1.3 — expõe o módulo Fiscal ao agent).
 *
 * READ-FIRST: get / query_status / list operam sobre a coleção `fiscalDocuments`
 * já persistida (sem tocar SEFAZ). emit / cancel acionam o gateway SEFAZ via
 * /api/fiscal/* e são role-gated (>= manager) no use_case `operator` — o gate de
 * role é aplicado na camada de guardrails do agent Python (TOOL_MIN_ROLE), aqui
 * só validamos shape + tenant.
 *
 * Cada action tem ParamsSchema e ResponseDataSchema. O dispatcher exporta
 * `FiscalToolRequestSchema` (union por action) que o handler parseia e estreita
 * via discriminação `params.action`.
 */

import { z } from 'zod';
import { DocIdSchema, agentToolResponse } from './_shared';

// ============================================================================
// Sub-schemas reusados
// ============================================================================

/** Tipos de documento fiscal suportados pelo gateway. */
export const FiscalDocTypeSchema = z.enum(['nfe', 'nfce', 'nfse']);

/** Status interno do fiscalDocument (espelha o persistido em /api/fiscal/emit). */
export const FiscalDocStatusSchema = z.enum([
  'autorizada', 'processando', 'pendente', 'contingencia',
  'rejeitada', 'cancelada', 'denegada', 'erro',
]);

/** Forma resumida de um fiscalDocument retornada ao agent (sem XML/sefazResponse crus). */
export const FiscalDocumentShortSchema = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  type: FiscalDocTypeSchema,
  number: z.union([z.number(), z.string()]).optional(),
  series: z.union([z.number(), z.string()]).optional(),
  status: z.string(),
  statusMessage: z.string().nullable().optional(),
  accessKey: z.string().nullable().optional(),
  protocol: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCpfCnpj: z.string().nullable().optional(),
  totalValue: z.number().optional(),
  issueDate: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

// ============================================================================
// Actions — Params + Response data
// ============================================================================

// ---------- get ----------
export const GetParamsSchema = z.object({ id: DocIdSchema }).strict();
export const GetDataSchema = FiscalDocumentShortSchema.nullable();

// ---------- query_status ----------
// Consulta por id OU chave de acesso. Lê o documento persistido (read-first);
// não dispara consulta SEFAZ — o operador usa a UI/retry para reconsultar online.
export const QueryStatusParamsSchema = z.object({
  id: DocIdSchema.optional(),
  accessKey: z.string().min(1).max(60).optional(),
}).strict().superRefine((data, ctx) => {
  if (!data.id && !data.accessKey) {
    ctx.addIssue({ code: 'custom', message: 'id ou accessKey obrigatório', path: ['id'] });
  }
});
export const QueryStatusDataSchema = z.object({
  id: DocIdSchema.optional(),
  type: FiscalDocTypeSchema.optional(),
  status: z.string(),
  statusMessage: z.string().nullable().optional(),
  accessKey: z.string().nullable().optional(),
  protocol: z.string().nullable().optional(),
}).nullable();

// ---------- list ----------
export const ListParamsSchema = z.object({
  type: FiscalDocTypeSchema.optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
export const ListDataSchema = z.array(FiscalDocumentShortSchema);

// ---------- emit (mutates — gate >= manager / use_case operator) ----------
// Encaminha o payload de emissão ao gateway /api/fiscal/emit. O shape completo
// (items/recipient/tomador/...) é validado lá (EmitFiscalRequestSchema); aqui
// passamos passthrough mantendo o `type` obrigatório para o roteamento.
export const EmitParamsSchema = z.object({
  type: FiscalDocTypeSchema,
}).passthrough();
export const EmitDataSchema = z.object({
  success: z.boolean(),
  documentId: DocIdSchema.optional(),
  status: z.string().optional(),
  accessKey: z.string().nullable().optional(),
  protocol: z.string().nullable().optional(),
  message: z.string().optional(),
}).passthrough();

// ---------- cancel (mutates — gate >= manager / use_case operator) ----------
export const CancelParamsSchema = z.object({
  type: FiscalDocTypeSchema,
  chaveAcesso: z.string().min(1),
  justificativa: z.string().min(15).max(255),
  protocolo: z.string().optional(),
  codigoCancelamento: z.enum(['1', '2', '3', '4']).optional(),
}).strict();
export const CancelDataSchema = z.object({
  success: z.boolean(),
  status: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

// ============================================================================
// Discriminated union do request body inteiro
// ============================================================================

export const FiscalToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get'),          params: GetParamsSchema }),
  z.object({ action: z.literal('query_status'), params: QueryStatusParamsSchema }),
  z.object({ action: z.literal('list'),         params: ListParamsSchema }),
  z.object({ action: z.literal('emit'),         params: EmitParamsSchema }),
  z.object({ action: z.literal('cancel'),       params: CancelParamsSchema }),
]);

export type FiscalToolRequest = z.infer<typeof FiscalToolRequestSchema>;
export type FiscalToolAction = FiscalToolRequest['action'];

/** Mapa de action → schema da response data (pra validação no executor e no withContract). */
export const FISCAL_DATA_SCHEMAS = {
  get:          GetDataSchema,
  query_status: QueryStatusDataSchema,
  list:         ListDataSchema,
  emit:         EmitDataSchema,
  cancel:       CancelDataSchema,
} as const satisfies Record<FiscalToolAction, z.ZodTypeAny>;

/** Response envelope completo (success + error). */
export const FiscalToolResponseSchema = z.union([
  agentToolResponse(GetDataSchema),
  agentToolResponse(QueryStatusDataSchema),
  agentToolResponse(ListDataSchema),
  agentToolResponse(EmitDataSchema),
  agentToolResponse(CancelDataSchema),
]);
