import { z } from 'zod';

const base = z.object({
  businessId: z.string().min(1),
});

export const PurchaseFiscalSyncRequestSchema = z.discriminatedUnion('action', [
  base.extend({
    action: z.literal('sync'),
    maxPages: z.number().int().min(1).max(10).default(3),
  }),
  base.extend({
    action: z.literal('hydrate'),
    inboxId: z.string().min(1).max(128),
  }),
  base.extend({
    action: z.literal('prepare'),
    inboxId: z.string().min(1).max(128),
  }),
]);

export type PurchaseFiscalSyncRequest = z.infer<typeof PurchaseFiscalSyncRequestSchema>;
