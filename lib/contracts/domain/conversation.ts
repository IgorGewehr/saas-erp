/**
 * lib/contracts/domain/conversation.ts
 *
 * Conversation = thread com um contato externo em um canal específico.
 * Espelha lib/types/index.ts:Conversation, com FSM declarada em
 * `lib/contracts/fsm/conversation.ts` (status `open|waiting|resolved`).
 */

import { z } from 'zod';

export const CONVERSATION_CHANNELS = ['whatsapp', 'facebook', 'instagram'] as const;
export const ConversationChannelSchema = z.enum(CONVERSATION_CHANNELS);
export type ConversationChannel = z.infer<typeof ConversationChannelSchema>;

export const CONVERSATION_CONNECTED_VIA = ['embedded_signup', 'baileys'] as const;
export const ConversationConnectedViaSchema = z.enum(CONVERSATION_CONNECTED_VIA);

export const CONVERSATION_STATUSES = ['open', 'waiting', 'resolved'] as const;
export const ConversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const CONVERSATION_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const ConversationPrioritySchema = z.enum(CONVERSATION_PRIORITIES);

export const CONVERSATION_OWNER_TYPES = ['business', 'user'] as const;
export const ConversationOwnerTypeSchema = z.enum(CONVERSATION_OWNER_TYPES);

export const ConversationSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  channel: ConversationChannelSchema,
  connectedVia: ConversationConnectedViaSchema.optional(),
  channelConnectionId: z.string().optional(),
  channelOwnerType: ConversationOwnerTypeSchema.optional(),
  channelOwnerId: z.string().optional(),

  status: ConversationStatusSchema,
  priority: ConversationPrioritySchema.optional(),
  labels: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),

  // Contato
  contactName: z.string().optional(),
  contactExternalId: z.string().optional(),  // wamid root (digits-only para WhatsApp), psid para FB/IG
  contactPhone: z.string().optional(),
  contactAvatarUrl: z.string().url().optional(),

  // Link com CRM
  crmContactId: z.string().optional(),
  clientId: z.string().optional(),

  // Roteamento
  assignedTo: z.string().optional(),
  assignedToName: z.string().optional(),
  sectorIds: z.array(z.string()).optional(),
  assignedToSectorId: z.string().optional(),
  isPrivate: z.boolean().optional(),

  // Métricas
  lastMessage: z.string().optional(),
  lastMessageAt: z.string().optional(),
  unreadCount: z.number().int().nonnegative().optional(),
  firstResponseAt: z.string().optional(),
  slaBreached: z.boolean().optional(),

  // AI agent
  aiEnabled: z.boolean().optional(),

  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((c, ctx) => {
  // INVARIANTE: WhatsApp Baileys ⇒ channelOwnerType='user'
  if (c.connectedVia === 'baileys' && c.channelOwnerType && c.channelOwnerType !== 'user') {
    ctx.addIssue({ code: 'custom', message: 'connectedVia=baileys exige channelOwnerType=user', path: ['channelOwnerType'] });
  }
  // INVARIANTE: WhatsApp Cloud (embedded_signup) ⇒ channelOwnerType='business'
  if (c.connectedVia === 'embedded_signup' && c.channelOwnerType && c.channelOwnerType !== 'business') {
    ctx.addIssue({ code: 'custom', message: 'connectedVia=embedded_signup exige channelOwnerType=business', path: ['channelOwnerType'] });
  }
  // INVARIANTE: channelOwnerType=user ⇒ channelOwnerId obrigatório
  if (c.channelOwnerType === 'user' && !c.channelOwnerId) {
    ctx.addIssue({ code: 'custom', message: 'channelOwnerType=user exige channelOwnerId (uid)', path: ['channelOwnerId'] });
  }
});

export type Conversation = z.infer<typeof ConversationSchema>;
