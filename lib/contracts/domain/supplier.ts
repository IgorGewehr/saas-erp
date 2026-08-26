/** Contrato canônico V2 de fornecedor e normalização de documentos legados. */

import { z } from 'zod';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const SUPPLIER_V2_VERSION = 2 as const;
export const SUPPLIER_DOCUMENT_TYPES = ['cpf', 'cnpj'] as const;

export function normalizeBrazilianDocument(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export const SupplierAddressSchema = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
}).passthrough();

const SupplierCanonicalSchema = z.object({
  schemaVersion: z.literal(SUPPLIER_V2_VERSION),
  id: z.string().min(1),
  businessId: z.string().min(1),
  documentType: z.enum(SUPPLIER_DOCUMENT_TYPES),
  document: z.string().regex(/^(\d{11}|\d{14})$/, 'CPF/CNPJ deve estar normalizado'),
  /** Compatibilidade de leitura com os consumidores V1. Ausente para CPF. */
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  razaoSocial: z.string().min(1).max(200),
  nomeFantasia: z.string().max(200).optional(),
  inscricaoEstadual: z.string().max(40).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  endereco: SupplierAddressSchema.optional(),
  notes: z.string().max(2000).optional(),
  paymentTerms: z.string().max(300).optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  minimumOrderValue: z.number().nonnegative().optional(),
  minimumOrderQuantity: z.number().nonnegative().optional(),
  orderMultiple: z.number().positive().optional(),
  isActive: z.boolean(),
  archivedAt: z.string().optional(),
  archivedBy: z.string().optional(),
  totalPurchases: z.number().nonnegative().optional(),
  lastPurchaseAt: z.string().optional(),
  migration: z.object({
    sourceVersion: z.literal(1),
    legacyCnpj: z.string().optional(),
  }).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((supplier, ctx) => {
  if (supplier.documentType === 'cpf' && supplier.document.length !== 11) {
    ctx.addIssue({ code: 'custom', message: 'documentType=cpf exige 11 dígitos', path: ['document'] });
  }
  if (supplier.documentType === 'cnpj' && supplier.document.length !== 14) {
    ctx.addIssue({ code: 'custom', message: 'documentType=cnpj exige 14 dígitos', path: ['document'] });
  }
});

export function normalizeSupplierToV2(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const source = { ...input };
  const rawDocument = source.document ?? source.cnpj;
  const document = normalizeBrazilianDocument(rawDocument);
  const isLegacy = source.schemaVersion !== SUPPLIER_V2_VERSION;

  return {
    ...source,
    schemaVersion: SUPPLIER_V2_VERSION,
    document,
    documentType: source.documentType ?? (document.length === 11 ? 'cpf' : 'cnpj'),
    cnpj: document.length === 14 ? document : undefined,
    razaoSocial: source.razaoSocial ?? source.name,
    isActive: source.isActive ?? true,
    ...(isLegacy
      ? {
          migration: {
            sourceVersion: 1,
            ...(typeof source.cnpj === 'string' ? { legacyCnpj: source.cnpj } : {}),
          },
        }
      : {}),
  };
}

export const SupplierSchema = z.preprocess(normalizeSupplierToV2, SupplierCanonicalSchema);
export const SupplierV2Schema = SupplierSchema;

export type SupplierV2 = z.infer<typeof SupplierV2Schema>;
