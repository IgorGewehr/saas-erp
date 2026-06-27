/**
 * lib/contracts/events/index.ts
 *
 * Eventos cross-módulo do sistema. Cada evento é um fato imutável que
 * "aconteceu" no domínio (no past tense): "appointment.completed",
 * "form.submitted", "broadcast.replied", etc.
 *
 * FILOSOFIA SDD:
 * - Eventos resolvem o gap G5: side-effects implícitos entre módulos.
 *   Hoje, criar uma sale dispara: stock, transaction, fiscal, loyalty, etc.
 *   Tudo inline, espalhado, frágil. Eventos centralizam essa lista.
 *
 * - Não precisa de event bus de runtime no dia 1.
 *   `dispatchDomainEvent()` pode ser síncrono — chama handlers conhecidos
 *   em ordem. Persiste o evento em `domainEvents/{id}` para auditoria.
 *
 * - Cada evento documenta no body Zod (jsdoc) quem reage.
 *   Adicionar/remover subscriber = mudança visível em 1 lugar.
 */

import { z } from 'zod';

// ─── Sub-schemas comuns ─────────────────────────────────────────────────────

const EventEnvelopeBase = z.object({
  businessId: z.string().min(1),
  occurredAt: z.string().datetime(),
  /** Quem causou o evento. Operador (uid), api ('api'), agent ('agent'), system. */
  actorType: z.enum(['user', 'api', 'agent', 'system']).optional(),
  actorId: z.string().optional(),
});

// ============================================================================
// Eventos — listados em ordem de prioridade SDD (mais valor primeiro)
// ============================================================================

/**
 * Subscribers conhecidos:
 *   - lib/services/commission.ts → cria Transaction de comissão
 *   - lib/services/loyalty.ts → addLoyaltyPoints
 *   - lib/services/calendarSync.ts → push update GCal (status mudou)
 *   - clients.update → incrementar visitCount, lastVisit, totalSpent
 *
 * Substitui: chamadas inline em AgendaModule.tsx:handleSaveAppointment
 */
export const AppointmentCompletedSchema = EventEnvelopeBase.extend({
  type: z.literal('appointment.completed'),
  appointmentId: z.string().min(1),
  clientId: z.string().optional(),
  professionalId: z.string().optional(),
  serviceId: z.string().optional(),
  amount: z.number().nonnegative(),
});

/**
 * Subscribers conhecidos:
 *   - lib/services/commission.ts → maybeCancelCommission
 *   - lib/services/loyalty.ts → revertLoyaltyPoints
 *   - lib/services/calendarSync.ts → push delete/update GCal
 */
export const AppointmentCanceledSchema = EventEnvelopeBase.extend({
  type: z.literal('appointment.canceled'),
  appointmentId: z.string().min(1),
  reason: z.string().optional(),
});

/**
 * Aula experimental (trial) concluída — funil de aquisição (P2.8).
 *
 * Emitido quando um Appointment com `isTrial === true` transiciona para
 * `concluido` e o operador/agente marca `trialOutcome`.
 *
 * Subscribers conhecidos:
 *   - CRM: se outcome === 'converteu' → avançar Client.lifecycleStage
 *     (qualified → customer) e, se aplicável, criar ClientMembership.
 *   - Reports: alimentar taxa de conversão de trials (aquisição).
 */
export const AppointmentTrialCompletedSchema = EventEnvelopeBase.extend({
  type: z.literal('appointment.trialCompleted'),
  appointmentId: z.string().min(1),
  clientId: z.string().optional(),
  serviceId: z.string().optional(),
  outcome: z.enum(['converteu', 'nao_converteu', 'pendente']),
});

/**
 * Booking IA criou agendamento via /api/booking/chat.
 *
 * Subscribers conhecidos (GAP G5 — não implementado ainda):
 *   - CRM: criar/atualizar Client.lifecycleStage
 *   - Conversations: ensureConversation se vier de booking_chat
 *   - Notifications: avisar profissional via TeamChat
 */
export const BookingCreatedSchema = EventEnvelopeBase.extend({
  type: z.literal('booking.created'),
  appointmentId: z.string().min(1),
  clientId: z.string().min(1),
  source: z.enum(['agenda_ui', 'booking_chat', 'api_v1', 'agent_tool']),
  channelType: z.enum(['web', 'whatsapp', 'facebook', 'instagram']).optional(),
  conversationId: z.string().optional(),
});

/**
 * Subscribers conhecidos (GAP G5 — não implementado ainda):
 *   - Clients: criar Client se contato não existe (atualmente form ≠ Client)
 *   - CRM: criar Activity vinculada
 *   - Notifications: alertar operador
 */
export const FormSubmittedSchema = EventEnvelopeBase.extend({
  type: z.literal('form.submitted'),
  formResponseId: z.string().min(1),
  templateId: z.string().min(1),
  submittedVia: z.enum(['link', 'operator', 'booking']),
  contact: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }),
});

/**
 * Subscribers conhecidos:
 *   - CRM: atualizar Client.lifecycleStage (lead → contatado)
 *   - Broadcast stats: incrementar replied count
 */
export const BroadcastRepliedSchema = EventEnvelopeBase.extend({
  type: z.literal('broadcast.replied'),
  broadcastId: z.string().min(1),
  contactId: z.string().min(1),
  conversationId: z.string().min(1),
  replyMessageId: z.string().min(1),
});

/**
 * Sale finalizada via PDV ou /api/v1/sales.
 *
 * Subscribers conhecidos:
 *   - lib/services/stock.ts → deductStock (já invocado inline no caminho atual,
 *     mas seria mais limpo plugar via handler aqui)
 *   - Clients update (totalSpent, visitCount)
 *   - Loyalty.addPoints (se enabled)
 *   - Fiscal NFC-e (se autoIssue)
 */
export const SaleFinalizedSchema = EventEnvelopeBase.extend({
  type: z.literal('sale.finalized'),
  saleId: z.string().min(1),
  clientId: z.string().optional(),
  total: z.number().nonnegative(),
  paymentMethod: z.string().optional(),
});

/**
 * Client criado (via agent, form, manual). Útil para automações CRM.
 */
export const ClientCreatedSchema = EventEnvelopeBase.extend({
  type: z.literal('client.created'),
  clientId: z.string().min(1),
  source: z.enum(['manual', 'agent', 'form', 'booking', 'api']),
});

/**
 * DeliveryOrder confirmada (status mudou recebido → preparando).
 * Útil para stock deduction async, kitchen display.
 */
export const DeliveryOrderConfirmedSchema = EventEnvelopeBase.extend({
  type: z.literal('deliveryOrder.confirmed'),
  orderId: z.string().min(1),
  number: z.number().int().nonnegative(),
});

/**
 * PurchaseNote importada — XML NF-e fornecedor virou stock movements.
 */
export const PurchaseImportedSchema = EventEnvelopeBase.extend({
  type: z.literal('purchase.imported'),
  purchaseNoteId: z.string().min(1),
  movementsCreated: z.number().int().nonnegative(),
});

/**
 * Conversation reaberta automaticamente por inbound após resolve.
 */
export const ConversationReopenedSchema = EventEnvelopeBase.extend({
  type: z.literal('conversation.reopened'),
  conversationId: z.string().min(1),
  reason: z.enum(['inbound_after_resolve', 'manual_reopen']),
});

/**
 * Pagamento online aprovado (Mercado Pago) — payment FSM → paid.
 * Emitido pelo webhook do MP após confirmar o pagamento (dedup por externalPaymentId).
 *
 * Subscribers conhecidos (GAP G5 — não implementado ainda):
 *   - DeliveryOrder: paymentStatus = 'pago', set paidAt + assertTransitionPayment → paid
 *   - lib/services/* (financial): cria Transaction de RECEITA idempotente
 *     (guard order.transactionId)
 *   - Notifications: avisa cliente via WhatsApp ("pagamento confirmado")
 */
export const PaymentApprovedSchema = EventEnvelopeBase.extend({
  type: z.literal('payment.approved'),
  orderId: z.string().min(1),
  externalPaymentId: z.string().min(1),
  paymentMethodKind: z.enum(['pix', 'card']).optional(),
  amount: z.number().nonnegative(),
});

/**
 * Pagamento estornado (refund total) — payment FSM paid → refunded.
 *
 * Subscribers conhecidos (GAP G5 — não implementado ainda):
 *   - lib/services/stock.ts → restoreStock (devolve itens ao estoque)
 *   - lib/services/* (financial): estorna/contra-lança a Transaction de receita
 *   - DeliveryOrder: paymentStatus = 'estornado', set refundedAt
 */
export const PaymentRefundedSchema = EventEnvelopeBase.extend({
  type: z.literal('payment.refunded'),
  orderId: z.string().min(1),
  externalPaymentId: z.string().min(1),
  amount: z.number().nonnegative(),
});

// ============================================================================
// Discriminated union — fonte da verdade dos eventos do sistema
// ============================================================================

export const DomainEventSchema = z.discriminatedUnion('type', [
  AppointmentCompletedSchema,
  AppointmentCanceledSchema,
  AppointmentTrialCompletedSchema,
  BookingCreatedSchema,
  FormSubmittedSchema,
  BroadcastRepliedSchema,
  SaleFinalizedSchema,
  ClientCreatedSchema,
  DeliveryOrderConfirmedSchema,
  PurchaseImportedSchema,
  ConversationReopenedSchema,
  PaymentApprovedSchema,
  PaymentRefundedSchema,
]);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventType = DomainEvent['type'];

export const DOMAIN_EVENT_TYPES = [
  'appointment.completed',
  'appointment.canceled',
  'appointment.trialCompleted',
  'booking.created',
  'form.submitted',
  'broadcast.replied',
  'sale.finalized',
  'client.created',
  'deliveryOrder.confirmed',
  'purchase.imported',
  'conversation.reopened',
  'payment.approved',
  'payment.refunded',
] as const satisfies readonly DomainEventType[];

/** Extrai o evento concreto de um tipo da union. */
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
