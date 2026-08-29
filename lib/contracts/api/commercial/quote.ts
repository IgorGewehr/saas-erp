import { z } from 'zod';
import { ErrorEnvelopeSchema, successEnvelope } from '../_envelope';
import { CommercialQuoteRequestSchema, CommercialQuoteSchema } from '../../domain/commercialV2';

export const CreateCommercialQuoteBodySchema = CommercialQuoteRequestSchema;
export const CreateCommercialQuoteResponseSchema = z.union([
  successEnvelope(CommercialQuoteSchema),
  ErrorEnvelopeSchema,
]);

export type CreateCommercialQuoteBody = z.infer<typeof CreateCommercialQuoteBodySchema>;
export type CreateCommercialQuoteResponse = z.infer<typeof CreateCommercialQuoteResponseSchema>;
