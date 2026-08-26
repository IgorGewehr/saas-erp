import { z } from 'zod';
import { SUPPLIER_DOCUMENT_TYPES, SupplierAddressSchema } from '@/lib/contracts/domain/supplier';

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const SupplierCatalogDataSchema = z.object({
  documentType: z.enum(SUPPLIER_DOCUMENT_TYPES),
  document: z.string().min(11).max(20),
  razaoSocial: z.string().trim().min(1).max(200),
  nomeFantasia: optionalText(200),
  inscricaoEstadual: optionalText(40),
  phone: optionalText(30),
  email: z.union([z.string().trim().email(), z.literal('')]).optional(),
  endereco: SupplierAddressSchema.optional(),
  notes: optionalText(2000),
  paymentTerms: optionalText(300),
  leadTimeDays: z.number().int().nonnegative().optional(),
  minimumOrderValue: z.number().nonnegative().optional(),
  minimumOrderQuantity: z.number().nonnegative().optional(),
  orderMultiple: z.number().positive().optional(),
  isActive: z.boolean().default(true),
}).strict();

export const SupplierCatalogPatchSchema = SupplierCatalogDataSchema.partial().strict();

export const CreateSupplierCatalogRequestSchema = z.object({
  businessId: z.string().min(1),
  data: SupplierCatalogDataSchema,
}).strict();

export const UpdateSupplierCatalogRequestSchema = z.object({
  businessId: z.string().min(1),
  supplierId: z.string().min(1),
  data: SupplierCatalogPatchSchema,
}).strict();

export const ArchiveSupplierCatalogRequestSchema = z.object({
  businessId: z.string().min(1),
  supplierId: z.string().min(1),
}).strict();

export type SupplierCatalogData = z.infer<typeof SupplierCatalogDataSchema>;
export type SupplierCatalogPatch = z.infer<typeof SupplierCatalogPatchSchema>;
