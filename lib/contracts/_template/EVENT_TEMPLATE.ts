/**
 * lib/contracts/_template/EVENT_TEMPLATE.ts
 *
 * Template para declarar eventos cross-módulo.
 * Copie para lib/contracts/events/index.ts e expanda a discriminated union.
 *
 * Filosofia:
 * - Não precisa de event bus de runtime no dia 1.
 * - Começa como REGISTRO da semântica: quem emite, quem reage.
 * - dispatchDomainEvent() pode ser síncrono (chama os handlers conhecidos em ordem)
 *   ou enfileirar para processamento async — escolha por evento.
 */

import { z } from 'zod';

// === Eventos ===
// Cada evento é uma entrada na discriminated union abaixo.

export const AppointmentCompletedSchema = z.object({
  type: z.literal('appointment.completed'),
  businessId: z.string(),
  appointmentId: z.string(),
  clientId: z.string().optional(),
  professionalId: z.string().optional(),
  serviceId: z.string().optional(),
  amount: z.number(),
  occurredAt: z.string().datetime(),
  /**
   * Subscribers conhecidos (documentação, não código):
   * - lib/services/commission.ts → cria Transaction de comissão
   * - lib/services/loyalty.ts → addLoyaltyPoints
   * - lib/services/calendarSync.ts → push update GCal (status mudou)
   */
});

export const BookingCreatedSchema = z.object({
  type: z.literal('booking.created'),
  businessId: z.string(),
  appointmentId: z.string(),
  clientId: z.string(),
  source: z.enum(['agenda_ui', 'booking_chat', 'api_v1', 'agent_tool']),
  channelType: z.enum(['web', 'whatsapp', 'facebook', 'instagram']).optional(),
  conversationId: z.string().optional(),
  occurredAt: z.string().datetime(),
  /**
   * Subscribers conhecidos:
   * - CRM: criar/atualizar Client.lifecycleStage (gap atual G5)
   * - Conversations: ensureConversation se vier de booking_chat
   * - Notifications: avisar profissional via TeamChat
   */
});

export const FormSubmittedSchema = z.object({
  type: z.literal('form.submitted'),
  businessId: z.string(),
  formResponseId: z.string(),
  templateId: z.string(),
  submittedVia: z.enum(['link', 'operator', 'booking']),
  contact: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
  }),
  occurredAt: z.string().datetime(),
  /**
   * Subscribers conhecidos:
   * - Clients: criar Client se contato não existe (gap atual G5)
   * - CRM: criar Activity vinculada
   */
});

export const BroadcastRepliedSchema = z.object({
  type: z.literal('broadcast.replied'),
  businessId: z.string(),
  broadcastId: z.string(),
  contactId: z.string(),
  conversationId: z.string(),
  replyMessageId: z.string(),
  occurredAt: z.string().datetime(),
  /**
   * Subscribers conhecidos:
   * - CRM: atualizar Client.lifecycleStage (lead → contatado)
   * - Broadcast stats: incrementar replied count
   */
});

// === Discriminated union — fonte da verdade dos eventos do sistema ===
export const DomainEventSchema = z.discriminatedUnion('type', [
  AppointmentCompletedSchema,
  BookingCreatedSchema,
  FormSubmittedSchema,
  BroadcastRepliedSchema,
  // expandir conforme surgirem novos side-effects cross-módulo
]);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventType = DomainEvent['type'];

/**
 * Skeleton do dispatcher. Implementação real em lib/contracts/_runtime/dispatch.ts
 * quando o primeiro consumidor for plugado.
 */
export async function dispatchDomainEvent(_event: DomainEvent): Promise<void> {
  // 1. validate (DomainEventSchema.parse)
  // 2. persist em domainEvents/{id} para auditoria
  // 3. fan-out síncrono para handlers registrados (por type)
  // 4. retry policy por handler — não bloqueia o caller se um falhar
  throw new Error('Not implemented — preencher quando primeiro handler for plugado');
}
