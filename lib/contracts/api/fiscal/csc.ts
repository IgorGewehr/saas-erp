/**
 * lib/contracts/api/fiscal/csc.ts — POST /api/fiscal/csc
 *
 * Gravação do CSC (Código de Segurança do Contribuinte) da NFC-e.
 * cscId/cscToken aceitam string vazia/null — o handler grava null
 * (limpar CSC é operação válida). GET usa query param, sem schema.
 */

import { z } from 'zod';

export const CscSaveRequestSchema = z
  .object({
    businessId: z.string().min(1, 'businessId required'),
    cscId: z.string().nullish(),
    cscToken: z.string().nullish(),
  })
  .passthrough();

export type CscSaveRequest = z.infer<typeof CscSaveRequestSchema>;
