/**
 * lib/contracts/api/fiscal/inutilizar.ts — POST /api/fiscal/inutilizar
 *
 * Inutilização de faixa de numeração NF-e/NFC-e. Mensagens preservadas.
 * `cnpj` agora é validado como presente no boundary (antes, body sem cnpj
 * estourava TypeError → 500; agora retorna 400 acionável).
 */

import { z } from 'zod';
import { CertificadoInputSchema } from './shared';

export const InutilizarRequestSchema = z
  .object({
    businessId: z.string().min(1, 'businessId e obrigatorio.'),
    /** Handler usa os 2 últimos dígitos; default ano corrente quando ausente. */
    ano: z.coerce.number().int().optional(),
    serie: z.union([z.string(), z.number()]).transform(String),
    numeroInicial: z.coerce.number().int().positive('Numero inicial deve ser positivo.'),
    numeroFinal: z.coerce.number().int().positive('Numero final deve ser positivo.'),
    justificativa: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 15, 'Justificativa deve ter no minimo 15 caracteres.')
      .refine((v) => v.length <= 255, 'Justificativa deve ter no maximo 255 caracteres.'),
    ufEmitente: z.string().min(1, 'ufEmitente e obrigatorio.'),
    cnpj: z.string().min(1, 'cnpj e obrigatorio.'),
    /** 55=NFe, 65=NFCe. Handler aplica default '55'. */
    modelo: z.enum(['55', '65']).optional(),
    certificado: CertificadoInputSchema.optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if (data.numeroInicial > data.numeroFinal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['numeroInicial'],
        message: 'Numero inicial deve ser menor ou igual ao numero final.',
      });
    }
  });

export type InutilizarRequest = z.infer<typeof InutilizarRequestSchema>;
