/**
 * lib/contracts/domain/conversationMessage.ts
 *
 * Cada mensagem (inbound ou outbound) numa Conversation.
 * INVARIANTE crítica: direction='inbound' ⇒ externalMessageId obrigatório
 *                     (sem isso, idempotência de webhook quebra).
 */

import { z } from 'zod';
import { ConversationChannelSchema, ConversationConnectedViaSchema } from './conversation';

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export const MessageDirectionSchema = z.enum(MESSAGE_DIRECTIONS);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MESSAGE_STATUSES = ['sending', 'sent', 'delivered', 'read', 'failed'] as const;
export const MessageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker', 'location'] as const;
export const MediaTypeSchema = z.enum(MEDIA_TYPES);

export const ConversationMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  businessId: z.string().min(1),
  channel: ConversationChannelSchema,
  connectedVia: ConversationConnectedViaSchema.optional(),
  direction: MessageDirectionSchema,
  status: MessageStatusSchema,

  // External tracking — wamid (Meta) ou key.id (Baileys)
  externalMessageId: z.string().optional(),

  // Conteúdo (mutex: text vs media)
  content: z.string().optional(),
  mediaUrl: z.string().url().optional().or(z.literal('')),
  mediaType: MediaTypeSchema.optional(),
  mediaMimeType: z.string().optional(),
  caption: z.string().optional(),

  // Quem enviou (outbound) — agent ou operador
  sentByUserId: z.string().optional(),
  sentByUserName: z.string().optional(),
  sentByAgent: z.boolean().optional(),

  // Anotações internas (não enviadas ao contato)
  isInternal: z.boolean().optional(),
  mentionedUserIds: z.array(z.string()).optional(),

  // Timestamps de delivery (Meta callbacks)
  sentAt: z.string().optional(),
  deliveredAt: z.string().optional(),
  readAt: z.string().optional(),
  failedAt: z.string().optional(),
  errorMessage: z.string().optional(),

  // Reply-to
  replyToMessageId: z.string().optional(),

  // Broadcast tracking
  broadcastId: z.string().optional(),
  isFromCampaign: z.boolean().optional(),

  createdAt: z.string().min(1),
}).superRefine((m, ctx) => {
  // INVARIANTE 1: inbound ⇒ externalMessageId obrigatório (idempotência de webhook)
  if (m.direction === 'inbound' && !m.externalMessageId) {
    ctx.addIssue({
      code: 'custom',
      message: 'direction=inbound exige externalMessageId (idempotência de webhook)',
      path: ['externalMessageId'],
    });
  }
  // INVARIANTE 2: precisa ter content OU mediaUrl (não pode ser vazia)
  const hasContent = (m.content && m.content.trim().length > 0);
  const hasMedia = (m.mediaUrl && m.mediaUrl.length > 0);
  if (!hasContent && !hasMedia) {
    ctx.addIssue({
      code: 'custom',
      message: 'Message precisa de content ou mediaUrl',
      path: ['content'],
    });
  }
  // INVARIANTE 3: mediaUrl ⇒ mediaType obrigatório
  if (hasMedia && !m.mediaType) {
    ctx.addIssue({ code: 'custom', message: 'mediaUrl exige mediaType', path: ['mediaType'] });
  }
  // INVARIANTE 4: isInternal ⇒ direction='outbound' (notas internas são saída lógica do business)
  if (m.isInternal && m.direction !== 'outbound') {
    ctx.addIssue({ code: 'custom', message: 'isInternal exige direction=outbound', path: ['isInternal'] });
  }
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
