/**
 * lib/contracts/api/fiscal/shared.ts — sub-schemas comuns às rotas fiscais.
 */

import { z } from 'zod';

/**
 * Certificado A1 enviado no body (fallback quando o tenant não tem cert em
 * `businesses/{id}/fiscalCerts`). Caminho normal: omitir e o handler resolve
 * via `getCertificadoPayload()`.
 */
export const CertificadoInputSchema = z
  .object({
    pfxBase64: z.string().min(1),
    password: z.string().min(1),
  })
  .passthrough();

export type CertificadoInput = z.infer<typeof CertificadoInputSchema>;
