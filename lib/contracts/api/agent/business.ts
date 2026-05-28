/**
 * lib/contracts/api/agent/business.ts — /api/agent/tools/business
 * Actions: get_context
 */

import { z } from 'zod';

export const BusinessGetContextParamsSchema = z.object({});

export const BusinessGetContextDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  useCase: z.string().optional(),
  description: z.string().optional(),
  tone: z.string().optional(),
  // Ramo/vertical — humaniza o agente sem viés salão. Ausente = 'generico'.
  segment: z.enum(['academia', 'salao', 'clinica', 'consultoria', 'generico']).optional(),
  // Vocabulário pt-BR derivado do segment (cliente/servico/profissional/agendar).
  segmentVocab: z.object({
    cliente: z.string(),
    servico: z.string(),
    profissional: z.string(),
    agendar: z.string(),
  }).optional(),
  timezone: z.string().optional(),
  currency: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  openingHours: z.array(z.object({
    isOpen: z.boolean(),
    openTime: z.string().optional(),
    closeTime: z.string().optional(),
  })).nullable().optional(),
  isOpenNow: z.boolean().nullable().optional(),
  delivery: z.object({}).passthrough().nullable().optional(),
  promotions: z.array(z.object({}).passthrough()).optional(),
}).passthrough();

export const BusinessToolRequestSchema = z.object({
  action: z.literal('get_context'),
  params: BusinessGetContextParamsSchema,
});

export const BUSINESS_DATA_SCHEMAS = {
  get_context: BusinessGetContextDataSchema,
} as const;
