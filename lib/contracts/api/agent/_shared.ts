/**
 * lib/contracts/api/agent/_shared.ts
 *
 * Schemas compartilhados pelas agent tools. Toda tool segue o mesmo padrão:
 *
 *   POST /api/agent/tools/{domain}
 *     headers: AgentHmacHeadersSchema
 *     body:    { action: string, params: object }
 *     response: { ok: true, data: ??? } | ErrorEnvelope
 *
 * Cada domain expõe seu próprio schema discriminado por `action`.
 */

import { z } from 'zod';
import { ErrorEnvelopeSchema, successEnvelope } from '../_envelope';

/** Headers HMAC enviados pelo agente Python ao chamar /api/agent/tools/*. */
export const AgentHmacHeadersSchema = z.object({
  'x-agent-signature': z.string().regex(/^[a-f0-9]{64}$/i, 'HMAC-SHA256 hex esperado'),
  'x-agent-timestamp': z.string().regex(/^\d+$/, 'Unix ms timestamp esperado'),
  'x-business-id': z.string().min(1),
});

/** Tipo do payload de tools/operator (operator pode chamar sem `action` em alguns casos). */
export function agentToolBody<TActions extends z.ZodTypeAny>(actionsSchema: TActions) {
  return z.object({
    action: z.string().min(1),
    params: z.unknown().optional(),
  }).passthrough().transform((v) => v);
}

/** Helper pra criar response envelope tipado pelas ferramentas. */
export function agentToolResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.discriminatedUnion('ok', [
    successEnvelope(dataSchema),
    ErrorEnvelopeSchema,
  ]);
}

/** Discriminated union de uma tool inteira: mapeia action → (params, response).
 *  Use em domains que mapeamos abaixo (cada agenda.ts, orders.ts, etc). */
export interface ToolActionDefinition<
  TName extends string,
  TParams extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
> {
  action: TName;
  params: TParams;
  response: TResponse;
}

/** Enums compartilhados que aparecem em várias tools. */
export const ChannelTypeSchema = z.enum(['whatsapp', 'facebook', 'instagram', 'web', 'manual', 'site']);
export const ConversationChannelSchema = z.enum(['whatsapp', 'facebook', 'instagram']);
export const ConversationStatusSchema = z.enum(['open', 'waiting', 'resolved']);
export const ConversationPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const LeadStatusSchema = z.enum([
  'novo', 'contatado', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido',
]);
export const LifecycleStageSchema = z.enum([
  'new_lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'customer', 'churned',
]);

export const TransactionTypeSchema = z.enum(['receita', 'despesa']);
export const TransactionStatusSchema = z.enum(['pendente', 'pago', 'atrasado', 'cancelado']);
export const PaymentMethodSchema = z.enum([
  'dinheiro', 'pix', 'credito', 'debito', 'boleto', 'transferencia', 'cartao_loja', 'outro',
]);

export const AppointmentStatusSchema = z.enum([
  'agendado', 'confirmado', 'em_atendimento', 'concluido', 'cancelado', 'falta',
]);
export const DeliveryOrderStatusSchema = z.enum([
  'recebido', 'preparando', 'pronto', 'saiu_entrega', 'entregue', 'cancelado',
]);
export const SaleStatusSchema = z.enum(['aberta', 'finalizada', 'cancelada']);
export const PurchaseNoteStatusSchema = z.enum(['pendente', 'importada', 'cancelada']);

export const KanbanPrioritySchema = z.enum(['urgent', 'high', 'medium', 'low']);
export const CRMActivityTypeSchema = z.enum([
  'ligacao', 'email', 'reuniao', 'whatsapp', 'tarefa', 'nota', 'proposta',
]);
export const KnowledgeSourceSchema = z.enum([
  'product', 'service', 'snippet', 'faq', 'business_desc', 'policy',
]);

/** Audit fields que aparecem em quase todo doc Firestore. */
export const TimestampsSchema = z.object({
  createdAt: z.string().datetime().or(z.string().min(1)),
  updatedAt: z.string().datetime().or(z.string().min(1)),
});

/** Generic `id` ref. */
export const DocIdSchema = z.string().min(1).max(200);
export const BusinessIdSchema = z.string().min(1);

/** Phone normalizado (BR aceita variações; canonical em E.164). */
export const PhoneSchema = z.string().min(8).max(20);

/** Valor monetário não-negativo com 2 casas no máximo. */
export const MoneySchema = z.number().nonnegative().multipleOf(0.01);
