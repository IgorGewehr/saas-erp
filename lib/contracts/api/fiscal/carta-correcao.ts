/**
 * lib/contracts/api/fiscal/carta-correcao.ts — POST /api/fiscal/carta-correcao
 *
 * Carta de Correção Eletrônica (CC-e) de NF-e. Mensagens preservadas da
 * validação manual anterior.
 */

import { z } from 'zod';
import { CertificadoInputSchema } from './shared';

export const CartaCorrecaoRequestSchema = z
  .object({
    businessId: z.string().min(1, 'businessId e obrigatorio.'),
    chaveAcesso: z
      .string({ error: 'Chave de acesso deve conter 44 digitos.' })
      .refine((v) => v.replace(/\D/g, '').length === 44, 'Chave de acesso deve conter 44 digitos.'),
    /** Handler aplica default 1 quando ausente/0. */
    sequencia: z.coerce.number().int().optional(),
    textoCorrecao: z
      .string({ error: 'Texto da correcao deve ter no minimo 15 caracteres.' })
      .transform((v) => v.trim())
      .refine((v) => v.length >= 15, 'Texto da correcao deve ter no minimo 15 caracteres.')
      .refine((v) => v.length <= 1000, 'Texto da correcao deve ter no maximo 1000 caracteres.'),
    ufEmitente: z.string().optional(),
    certificado: CertificadoInputSchema.optional(),
  })
  .passthrough();

export type CartaCorrecaoRequest = z.infer<typeof CartaCorrecaoRequestSchema>;
