/**
 * lib/contracts/api/fiscal/cancel.ts — POST /api/fiscal/cancel
 *
 * Validação Zod do cancelamento de NF-e/NFC-e/NFSe. Converte as validações
 * manuais que viviam em `app/api/fiscal/cancel/route.ts` (R6 — validação no
 * boundary). Mensagens preservadas. Validações que dependem de Firestore
 * (lookup do fiscalDocument NFSe, dados do prestador) seguem no handler.
 */

import { z } from 'zod';
import { CertificadoInputSchema } from './shared';

export const CancelFiscalRequestSchema = z
  .object({
    /** Default 'nfe' aplicado no handler (legado: body sem type). */
    type: z.enum(['nfse', 'nfe', 'nfce']).optional(),
    businessId: z.string().min(1, 'businessId e obrigatorio.'),
    chaveAcesso: z.string().optional(),
    protocolo: z.string().optional(),
    justificativa: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 15, 'Justificativa deve ter no minimo 15 caracteres.')
      .refine((v) => v.length <= 255, 'Justificativa deve ter no maximo 255 caracteres.'),
    ufEmitente: z.string().optional(),
    /** NFSe only — código legal do motivo. Handler aplica default '1'. */
    codigoCancelamento: z.enum(['1', '2', '3', '4']).optional(),
    certificado: CertificadoInputSchema.optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const type = data.type || 'nfe';
    if (type === 'nfse') {
      // NFSe: chave de 50 dígitos (Betha/Nacional) OU código de verificação
      // alfanumérico (~8 chars, SP) — só exigimos não-vazio; o provider valida.
      if (!data.chaveAcesso || !data.chaveAcesso.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chaveAcesso'],
          message: 'Chave/código de verificação da NFSe ausente.',
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

export type CancelFiscalRequest = z.infer<typeof CancelFiscalRequestSchema>;
