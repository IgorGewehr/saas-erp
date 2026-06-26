/**
 * lib/contracts/api/fiscal/query.ts — POST /api/fiscal/query
 *
 * Consulta de documento fiscal (NF-e/NFC-e por chave 44; NFSe por chave 50;
 * NFSe por idDPS). Mensagens preservadas da validação manual anterior.
 * A verificação de POSSE (fiscalDocument do tenant com essa accessKey)
 * vive no handler — depende de read no Firestore.
 */

import { z } from 'zod';
import { CertificadoInputSchema } from './shared';

export const QueryFiscalRequestSchema = z
  .object({
    /** Default 'nfe' aplicado no handler (legado: body sem type). */
    type: z.enum(['nfse', 'nfse-dps', 'nfe', 'nfce']).optional(),
    businessId: z.string().min(1, 'businessId e obrigatorio.'),
    chaveAcesso: z.string().optional(),
    idDPS: z.string().optional(),
    ufEmitente: z.string().optional(),
    certificado: CertificadoInputSchema.optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const type = data.type || 'nfe';
    if (type === 'nfse') {
      if (!data.chaveAcesso || data.chaveAcesso.replace(/\D/g, '').length !== 50) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chaveAcesso'],
          message: 'Chave de acesso NFSe deve conter 50 digitos.',
        });
      }
    } else if (type === 'nfse-dps') {
      if (!data.idDPS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['idDPS'],
          message: 'ID do DPS e obrigatorio.',
        });
      }
    } else if (!data.chaveAcesso || data.chaveAcesso.replace(/\D/g, '').length !== 44) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chaveAcesso'],
        message: 'Chave de acesso deve conter 44 digitos.',
      });
    }
  });

export type QueryFiscalRequest = z.infer<typeof QueryFiscalRequestSchema>;
