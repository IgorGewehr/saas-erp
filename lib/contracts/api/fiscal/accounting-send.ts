/**
 * lib/contracts/api/fiscal/accounting-send.ts — POST /api/fiscal/accounting/send
 *
 * Envio mensal de XMLs fiscais + resumo SPED pro contador.
 *
 * Segurança (auditoria P2):
 *  - businessName/businessCnpj NÃO fazem mais parte do contrato confiável —
 *    o handler busca razaoSocial/nomeFantasia/cnpj de businesses/{id}.
 *    Campos ainda são aceitos no body (passthrough) por compat, mas ignorados.
 *  - Role admin+ exigida no handler (antes: qualquer membership).
 */

import { z } from 'zod';

export const AccountingDocumentSchema = z
  .object({
    type: z.string().min(1),
    number: z.coerce.number().optional(),
    series: z.union([z.string(), z.number()]).transform(String).optional(),
    accessKey: z.string().optional(),
    totalValue: z.coerce.number().optional(),
    issueDate: z.string().optional(),
    clientName: z.string().optional(),
    xml: z.string().optional(),
  })
  .passthrough();

export const AccountingSendRequestSchema = z
  .object({
    businessId: z.string().min(1, 'businessId obrigatório.'),
    accountingEmail: z.string().min(1, 'Email do contador é obrigatório.'),
    month: z.coerce.number().int().min(1, 'Mês inválido.').max(12, 'Mês inválido.'),
    year: z.coerce.number().int().min(2020, 'Ano inválido.').max(2099, 'Ano inválido.'),
    documents: z.array(AccountingDocumentSchema).optional(),
  })
  .passthrough();

export type AccountingSendRequest = z.infer<typeof AccountingSendRequestSchema>;
export type AccountingDocument = z.infer<typeof AccountingDocumentSchema>;
