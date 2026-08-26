/** Contracts for /api/agent/tools/suppliers. */

import { z } from 'zod';
import { DocIdSchema, PhoneSchema } from './_shared';

const DocumentSchema = z.string().regex(/^(\d{11}|\d{14})$/, 'CPF/CNPJ normalizado');

const AddressSchema = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
}).passthrough();

const SupplierShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  schemaVersion: z.literal(2).optional(),
  documentType: z.enum(['cpf', 'cnpj']).optional(),
  document: DocumentSchema.optional(),
  razaoSocial: z.string(),
  nomeFantasia: z.string().optional(),
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  inscricaoEstadual: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  endereco: AddressSchema.optional(),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  minimumOrderValue: z.number().nonnegative().optional(),
  minimumOrderQuantity: z.number().nonnegative().optional(),
  orderMultiple: z.number().positive().optional(),
  isActive: z.boolean(),
}).passthrough();

export const SuppliersListParamsSchema = z.object({
  includeInactive: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
});
export const SuppliersListDataSchema = z.array(SupplierShape);

export const SuppliersGetParamsSchema = z.object({ id: DocIdSchema });
export const SuppliersGetDataSchema = SupplierShape.nullable();

const SupplierMutableFields = z.object({
  razaoSocial: z.string().min(1).max(200).optional(),
  nomeFantasia: z.string().max(200).optional(),
  cnpj: z.string().min(11).max(20).optional(),
  document: z.string().min(11).max(20).optional(),
  documentType: z.enum(['cpf', 'cnpj']).optional(),
  inscricaoEstadual: z.string().max(40).optional(),
  phone: PhoneSchema.optional(),
  email: z.string().email().optional(),
  endereco: AddressSchema.optional(),
  notes: z.string().max(2000).optional(),
  paymentTerms: z.string().max(300).optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  minimumOrderValue: z.number().nonnegative().optional(),
  minimumOrderQuantity: z.number().nonnegative().optional(),
  orderMultiple: z.number().positive().optional(),
  isActive: z.boolean().optional(),
}).strict();

export const SuppliersCreateParamsSchema = SupplierMutableFields.extend({
  razaoSocial: z.string().min(1).max(200),
}).refine((data) => Boolean(data.cnpj || data.document), { message: 'CPF/CNPJ obrigatório' });
export const SuppliersCreateDataSchema = SupplierShape;

export const SuppliersUpdateParamsSchema = z.object({
  id: DocIdSchema,
  patch: SupplierMutableFields,
});
export const SuppliersUpdateDataSchema = SupplierShape;

export const SuppliersFindByCnpjParamsSchema = z.object({
  cnpj: z.string().min(11).max(20),
});
export const SuppliersFindByCnpjDataSchema = SupplierShape.nullable();

export const SuppliersSearchParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});
export const SuppliersSearchDataSchema = z.array(SupplierShape.extend({ _score: z.number() }));

export const SuppliersToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), params: SuppliersListParamsSchema }),
  z.object({ action: z.literal('get'), params: SuppliersGetParamsSchema }),
  z.object({ action: z.literal('create'), params: SuppliersCreateParamsSchema }),
  z.object({ action: z.literal('update'), params: SuppliersUpdateParamsSchema }),
  z.object({ action: z.literal('find_by_cnpj'), params: SuppliersFindByCnpjParamsSchema }),
  z.object({ action: z.literal('search'), params: SuppliersSearchParamsSchema }),
]);

export const SUPPLIERS_DATA_SCHEMAS = {
  list: SuppliersListDataSchema,
  get: SuppliersGetDataSchema,
  create: SuppliersCreateDataSchema,
  update: SuppliersUpdateDataSchema,
  find_by_cnpj: SuppliersFindByCnpjDataSchema,
  search: SuppliersSearchDataSchema,
} as const;
