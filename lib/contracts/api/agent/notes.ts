/**
 * lib/contracts/api/agent/notes.ts — /api/agent/tools/notes
 * Actions: list, get, create, update, delete, search
 */

import { z } from 'zod';
import { DocIdSchema } from './_shared';

const NoteColor = z.enum(['yellow', 'green', 'blue', 'pink', 'purple', 'orange', 'red', 'neutral']);
const NoteScope = z.enum(['personal', 'team']);

const NoteShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  authorInitials: z.string().optional(),
  title: z.string(),
  content: z.string(),
  color: NoteColor,
  scope: NoteScope,
  isPinned: z.boolean(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

export const NotesListParamsSchema = z.object({
  scope: NoteScope.optional(),
  authorId: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  onlyPinned: z.boolean().optional(),
});
export const NotesListDataSchema = z.array(NoteShape);

export const NotesGetParamsSchema = z.object({ id: DocIdSchema });
export const NotesGetDataSchema = NoteShape.nullable();

export const NotesCreateParamsSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  color: NoteColor.default('yellow'),
  scope: NoteScope.default('team'),
  isPinned: z.boolean().default(false),
  authorId: z.string().default('agent'),
  authorName: z.string().default('Agente IA'),
});
export const NotesCreateDataSchema = NoteShape;

export const NotesUpdateParamsSchema = z.object({
  id: DocIdSchema,
  patch: z.object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().max(10000).optional(),
    color: NoteColor.optional(),
    scope: NoteScope.optional(),
    isPinned: z.boolean().optional(),
  }).strict(),
});
export const NotesUpdateDataSchema = NoteShape;

export const NotesDeleteParamsSchema = z.object({ id: DocIdSchema });
export const NotesDeleteDataSchema = z.object({ id: DocIdSchema, deleted: z.literal(true) });

export const NotesSearchParamsSchema = z.object({
  query: z.string().min(1),
  scope: NoteScope.optional(),
  authorId: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const NotesSearchDataSchema = z.array(NoteShape.extend({ _score: z.number() }));

export const NotesToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),   params: NotesListParamsSchema }),
  z.object({ action: z.literal('get'),    params: NotesGetParamsSchema }),
  z.object({ action: z.literal('create'), params: NotesCreateParamsSchema }),
  z.object({ action: z.literal('update'), params: NotesUpdateParamsSchema }),
  z.object({ action: z.literal('delete'), params: NotesDeleteParamsSchema }),
  z.object({ action: z.literal('search'), params: NotesSearchParamsSchema }),
]);

export const NOTES_DATA_SCHEMAS = {
  list:   NotesListDataSchema,
  get:    NotesGetDataSchema,
  create: NotesCreateDataSchema,
  update: NotesUpdateDataSchema,
  delete: NotesDeleteDataSchema,
  search: NotesSearchDataSchema,
} as const;
