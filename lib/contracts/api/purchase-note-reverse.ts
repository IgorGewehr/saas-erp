import { z } from 'zod';

export const ReversePurchaseNoteRequestSchema = z.object({
  businessId: z.string().min(1),
  noteId: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
}).strict();

export type ReversePurchaseNoteRequest = z.infer<typeof ReversePurchaseNoteRequestSchema>;
