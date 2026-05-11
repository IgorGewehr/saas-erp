/**
 * lib/contracts/api/agent/kanban.ts — /api/agent/tools/kanban
 * Actions: list_boards, get_board, list_cards, search_cards, get_card,
 *          create_card, move_card, update_card, assign, add_comment, archive_card
 */

import { z } from 'zod';
import { DocIdSchema, KanbanPrioritySchema } from './_shared';

const LabelSchema = z.object({
  id: DocIdSchema,
  name: z.string(),
  color: z.string(),
}).passthrough();

const ColumnSchema = z.object({
  id: DocIdSchema,
  name: z.string(),
  order: z.number().int().nonnegative().optional(),
}).passthrough();

const BoardShape = z.object({
  id: DocIdSchema,
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  columns: z.array(ColumnSchema),
  isArchived: z.boolean(),
}).passthrough();

const CardShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  boardId: DocIdSchema,
  columnId: DocIdSchema,
  title: z.string(),
  description: z.string().optional(),
  priority: KanbanPrioritySchema.optional(),
  assigneeIds: z.array(DocIdSchema).optional(),
  assigneeNames: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  labels: z.array(LabelSchema).optional(),
  order: z.number().int().nonnegative().optional(),
  coverColor: z.string().optional(),
}).passthrough();

const CommentShape = z.object({
  id: DocIdSchema,
  text: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
});

export const KanbanListBoardsParamsSchema = z.object({});
export const KanbanListBoardsDataSchema = z.array(BoardShape);

export const KanbanGetBoardParamsSchema = z.object({ id: DocIdSchema });
export const KanbanGetBoardDataSchema = BoardShape.nullable();

export const KanbanListCardsParamsSchema = z.object({
  boardId: DocIdSchema,
  columnId: DocIdSchema.optional(),
  assigneeId: DocIdSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export const KanbanListCardsDataSchema = z.array(CardShape);

export const KanbanSearchCardsParamsSchema = z.object({
  query: z.string().min(1),
  boardId: DocIdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export const KanbanSearchCardsDataSchema = z.array(CardShape.extend({ _score: z.number() }));

export const KanbanGetCardParamsSchema = z.object({ id: DocIdSchema });
export const KanbanGetCardDataSchema = CardShape.nullable();

export const KanbanCreateCardParamsSchema = z.object({
  boardId: DocIdSchema,
  columnId: DocIdSchema.optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priority: KanbanPrioritySchema.optional(),
  assigneeIds: z.array(DocIdSchema).optional(),
  assigneeNames: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  labels: z.array(LabelSchema).optional(),
});
export const KanbanCreateCardDataSchema = CardShape;

export const KanbanMoveCardParamsSchema = z.object({
  id: DocIdSchema,
  columnId: DocIdSchema,
});
export const KanbanMoveCardDataSchema = CardShape;

export const KanbanUpdateCardParamsSchema = z.object({
  id: DocIdSchema,
  patch: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    priority: KanbanPrioritySchema.optional(),
    dueDate: z.string().optional(),
    labels: z.array(LabelSchema).optional(),
    assigneeIds: z.array(DocIdSchema).optional(),
    assigneeNames: z.array(z.string()).optional(),
    coverColor: z.string().optional(),
  }).strict(),
});
export const KanbanUpdateCardDataSchema = CardShape;

export const KanbanAssignParamsSchema = z.object({
  id: DocIdSchema,
  assigneeIds: z.array(DocIdSchema),
  assigneeNames: z.array(z.string()).optional(),
});
export const KanbanAssignDataSchema = CardShape;

export const KanbanAddCommentParamsSchema = z.object({
  id: DocIdSchema,
  text: z.string().min(1).max(1000),
  authorId: z.string().default('agent'),
  authorName: z.string().default('Agente IA'),
});
export const KanbanAddCommentDataSchema = CommentShape;

export const KanbanArchiveCardParamsSchema = z.object({ id: DocIdSchema });
export const KanbanArchiveCardDataSchema = z.object({
  id: DocIdSchema,
  archived: z.literal(true),
});

export const KanbanToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_boards'),   params: KanbanListBoardsParamsSchema }),
  z.object({ action: z.literal('get_board'),     params: KanbanGetBoardParamsSchema }),
  z.object({ action: z.literal('list_cards'),    params: KanbanListCardsParamsSchema }),
  z.object({ action: z.literal('search_cards'),  params: KanbanSearchCardsParamsSchema }),
  z.object({ action: z.literal('get_card'),      params: KanbanGetCardParamsSchema }),
  z.object({ action: z.literal('create_card'),   params: KanbanCreateCardParamsSchema }),
  z.object({ action: z.literal('move_card'),     params: KanbanMoveCardParamsSchema }),
  z.object({ action: z.literal('update_card'),   params: KanbanUpdateCardParamsSchema }),
  z.object({ action: z.literal('assign'),        params: KanbanAssignParamsSchema }),
  z.object({ action: z.literal('add_comment'),   params: KanbanAddCommentParamsSchema }),
  z.object({ action: z.literal('archive_card'),  params: KanbanArchiveCardParamsSchema }),
]);

export const KANBAN_DATA_SCHEMAS = {
  list_boards:  KanbanListBoardsDataSchema,
  get_board:    KanbanGetBoardDataSchema,
  list_cards:   KanbanListCardsDataSchema,
  search_cards: KanbanSearchCardsDataSchema,
  get_card:     KanbanGetCardDataSchema,
  create_card:  KanbanCreateCardDataSchema,
  move_card:    KanbanMoveCardDataSchema,
  update_card:  KanbanUpdateCardDataSchema,
  assign:       KanbanAssignDataSchema,
  add_comment:  KanbanAddCommentDataSchema,
  archive_card: KanbanArchiveCardDataSchema,
} as const;
