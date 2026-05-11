/**
 * lib/contracts/api/agent/conversations.ts — /api/agent/tools/conversations
 * Actions: list, get, list_messages, set_label, set_priority, set_status,
 *          list_snippets, search_snippets
 */

import { z } from 'zod';
import {
  ConversationChannelSchema,
  ConversationPrioritySchema,
  ConversationStatusSchema,
  DocIdSchema,
} from './_shared';

const ConvShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  channel: ConversationChannelSchema,
  status: ConversationStatusSchema.optional(),
  priority: ConversationPrioritySchema.optional(),
  labels: z.array(z.string()).optional(),
  lastMessage: z.string().optional(),
  lastMessageAt: z.string().optional(),
}).passthrough();

const ConvMsgShape = z.object({
  id: DocIdSchema,
  conversationId: DocIdSchema,
  businessId: z.string(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  content: z.string().optional(),
  sentAt: z.string().optional(),
}).passthrough();

const SnippetShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  shortcode: z.string(),
  content: z.string(),
  category: z.string().optional(),
  sectorId: DocIdSchema.optional(),
}).passthrough();

export const ConversationsListParamsSchema = z.object({
  channel: ConversationChannelSchema.optional(),
  status: ConversationStatusSchema.optional(),
  priority: ConversationPrioritySchema.optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export const ConversationsListDataSchema = z.array(ConvShape);

export const ConversationsGetParamsSchema = z.object({ id: DocIdSchema });
export const ConversationsGetDataSchema = ConvShape.nullable();

export const ConversationsListMessagesParamsSchema = z.object({
  conversationId: DocIdSchema,
  limit: z.number().int().min(1).max(200).default(50),
});
export const ConversationsListMessagesDataSchema = z.array(ConvMsgShape);

export const ConversationsSetLabelParamsSchema = z.object({
  id: DocIdSchema,
  label: z.string().min(1).max(50),
  remove: z.boolean().optional(),
});
export const ConversationsSetLabelDataSchema = ConvShape;

export const ConversationsSetPriorityParamsSchema = z.object({
  id: DocIdSchema,
  priority: ConversationPrioritySchema,
});
export const ConversationsSetPriorityDataSchema = ConvShape;

export const ConversationsSetStatusParamsSchema = z.object({
  id: DocIdSchema,
  status: ConversationStatusSchema,
});
export const ConversationsSetStatusDataSchema = ConvShape;

export const ConversationsListSnippetsParamsSchema = z.object({
  category: z.string().optional(),
  sectorId: DocIdSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export const ConversationsListSnippetsDataSchema = z.array(SnippetShape);

export const ConversationsSearchSnippetsParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
});
export const ConversationsSearchSnippetsDataSchema = z.array(SnippetShape);

export const ConversationsToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),             params: ConversationsListParamsSchema }),
  z.object({ action: z.literal('get'),              params: ConversationsGetParamsSchema }),
  z.object({ action: z.literal('list_messages'),    params: ConversationsListMessagesParamsSchema }),
  z.object({ action: z.literal('set_label'),        params: ConversationsSetLabelParamsSchema }),
  z.object({ action: z.literal('set_priority'),     params: ConversationsSetPriorityParamsSchema }),
  z.object({ action: z.literal('set_status'),       params: ConversationsSetStatusParamsSchema }),
  z.object({ action: z.literal('list_snippets'),    params: ConversationsListSnippetsParamsSchema }),
  z.object({ action: z.literal('search_snippets'),  params: ConversationsSearchSnippetsParamsSchema }),
]);

export const CONVERSATIONS_DATA_SCHEMAS = {
  list:            ConversationsListDataSchema,
  get:             ConversationsGetDataSchema,
  list_messages:   ConversationsListMessagesDataSchema,
  set_label:       ConversationsSetLabelDataSchema,
  set_priority:    ConversationsSetPriorityDataSchema,
  set_status:      ConversationsSetStatusDataSchema,
  list_snippets:   ConversationsListSnippetsDataSchema,
  search_snippets: ConversationsSearchSnippetsDataSchema,
} as const;
