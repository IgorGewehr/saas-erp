import { z } from 'zod';

export const ConfirmPurchaseNoteRequestSchema = z.object({
  businessId: z.string().min(1),
  noteId: z.string().min(1),
}).strict();

export type ConfirmPurchaseNoteRequest = z.infer<typeof ConfirmPurchaseNoteRequestSchema>;
