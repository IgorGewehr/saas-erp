/**
 * lib/contracts/api/fiscal/status.ts — POST /api/fiscal/status
 *
 * Consulta de disponibilidade do webservice SEFAZ (statusSefaz). `ufEmitente`
 * sempre foi obrigatório no contrato TS da rota (statusSefaz exige) — agora a
 * obrigatoriedade é validada no boundary em vez de estourar no gateway.
 */

import { z } from 'zod';
import { CertificadoInputSchema } from './shared';

export const StatusSefazRequestSchema = z
  .object({
    businessId: z.string().min(1, 'businessId e obrigatorio.'),
    ufEmitente: z.string().min(1, 'ufEmitente e obrigatorio.'),
    certificado: CertificadoInputSchema.optional(),
  })
  .passthrough();

export type StatusSefazRequest = z.infer<typeof StatusSefazRequestSchema>;
