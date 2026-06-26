/**
 * lib/contracts/api/fiscal/retry.ts — POST /api/fiscal/retry
 *
 * Reenvio de documento fiscal pendente/contingência. Mensagem unificada
 * preservada ('businessId e documentId são obrigatórios.').
 */

import { z } from 'zod';

export const RetryFiscalRequestSchema = z
  .object({
    businessId: z.string().min(1, 'businessId e documentId são obrigatórios.'),
    documentId: z.string().min(1, 'businessId e documentId são obrigatórios.'),
  })
  .passthrough();

export type RetryFiscalRequest = z.infer<typeof RetryFiscalRequestSchema>;
