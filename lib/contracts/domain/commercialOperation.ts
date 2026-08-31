/**
 * Contrato persistido do coordenador recuperável da M02.
 *
 * `commercialOperations` é interno ao servidor. Ele não substitui `sales`,
 * `deliveryOrders` ou `orders`: registra intenção, checkpoints e referências
 * determinísticas para que uma falha possa ser retomada sem repetir efeitos.
 */

import { z } from 'zod';
import {
  CommercialChannelSchema,
  CommercialEffectReferencesSchema,
  CommercialPaymentAllocationSchema,
  CommercialQuoteSchema,
  CommercialSourceTypeSchema,
  MoneyCentsSchema,
} from './commercialV2';

export const COMMERCIAL_OPERATION_VERSION = 1 as const;

export const COMMERCIAL_OPERATION_CHECKPOINTS = [
  'input_validated',
  'benefits_reserved',
  'stock_applied',
  'document_persisted',
  'downstream_reconciled',
  'event_enqueued',
  'operation_completed',
] as const;

export const CommercialOperationCheckpointNameSchema = z.enum(COMMERCIAL_OPERATION_CHECKPOINTS);
export const CommercialOperationCheckpointStatusSchema = z.enum([
  'pending', 'in_progress', 'completed', 'skipped', 'failed',
]);

export const CommercialOperationErrorSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
  checkpoint: CommercialOperationCheckpointNameSchema,
  retryable: z.boolean(),
  occurredAt: z.string().datetime(),
});

export const CommercialOperationCheckpointSchema = z.object({
  status: CommercialOperationCheckpointStatusSchema,
  attempts: z.number().int().nonnegative(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  failedAt: z.string().datetime().optional(),
  result: z.unknown().optional(),
  error: CommercialOperationErrorSchema.optional(),
});

export const CommercialBenefitIntentSchema = z.object({
  intentId: z.string().min(1).max(120),
  type: z.enum(['coupon', 'gift_card', 'loyalty_points']),
  action: z.enum(['redeem', 'earn']).default('redeem'),
  referenceId: z.string().min(1).optional(),
  code: z.string().min(1).max(64).optional(),
  amountCents: MoneyCentsSchema,
  quantity: z.number().int().positive().optional(),
  unitAmountCents: MoneyCentsSchema.optional(),
}).superRefine((benefit, ctx) => {
  if ((benefit.type === 'coupon' || benefit.type === 'gift_card') && !benefit.referenceId) {
    ctx.addIssue({ code: 'custom', path: ['referenceId'], message: 'Cupom e gift card exigem referência autoritativa.' });
  }
  if ((benefit.type === 'coupon' || benefit.type === 'gift_card') && !benefit.code) {
    ctx.addIssue({ code: 'custom', path: ['code'], message: 'Cupom e gift card exigem código normalizado.' });
  }
  if (benefit.type === 'loyalty_points' && (!benefit.referenceId || !benefit.quantity || benefit.unitAmountCents === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Fidelidade exige cliente, pontos e valor unitário.' });
  }
  if (benefit.type !== 'loyalty_points' && benefit.action === 'earn') {
    ctx.addIssue({ code: 'custom', path: ['action'], message: 'Somente fidelidade pode acumular benefício.' });
  }
});

export const CommercialOperationActorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  type: z.enum(['user', 'api', 'agent', 'system']),
});

export const CommercialOperationTargetSchema = z.object({
  collection: z.enum(['sales', 'deliveryOrders', 'orders']),
});

export const CommercialOperationRequestSchema = z.object({
  schemaVersion: z.literal(COMMERCIAL_OPERATION_VERSION).default(COMMERCIAL_OPERATION_VERSION),
  businessId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(200),
  sourceType: CommercialSourceTypeSchema,
  channel: CommercialChannelSchema,
  quote: CommercialQuoteSchema,
  target: CommercialOperationTargetSchema,
  /** Documento no formato legado do canal. Campos de correlação são anexados pelo coordenador. */
  document: z.record(z.string(), z.unknown()),
  payments: z.array(CommercialPaymentAllocationSchema).max(50).default([]),
  benefits: z.array(CommercialBenefitIntentSchema).max(20).default([]),
  fiscalIntent: z.object({ type: z.enum(['nfse', 'nfce', 'nfe']) }).optional(),
  actor: CommercialOperationActorSchema,
}).superRefine((request, ctx) => {
  if (request.quote.businessId !== request.businessId) {
    ctx.addIssue({ code: 'custom', path: ['quote', 'businessId'], message: 'A cotação pertence a outro negócio.' });
  }
  if (request.quote.channel !== request.channel) {
    ctx.addIssue({ code: 'custom', path: ['quote', 'channel'], message: 'O canal diverge da cotação.' });
  }
  const expectedCollection = request.sourceType === 'sale'
    ? 'sales'
    : request.sourceType === 'deliveryOrder'
      ? 'deliveryOrders'
      : 'orders';
  if (request.target.collection !== expectedCollection) {
    ctx.addIssue({
      code: 'custom',
      path: ['target', 'collection'],
      message: `${request.sourceType} deve persistir em ${expectedCollection}.`,
    });
  }
  if (request.document.businessId !== request.businessId) {
    ctx.addIssue({ code: 'custom', path: ['document', 'businessId'], message: 'O documento comercial pertence a outro negócio.' });
  }
  if (typeof request.document.total !== 'number' || !Number.isFinite(request.document.total)) {
    ctx.addIssue({ code: 'custom', path: ['document', 'total'], message: 'O documento comercial exige total numérico.' });
  } else if (Math.round((request.document.total + Number.EPSILON) * 100) !== request.quote.pricing.totalCents) {
    ctx.addIssue({ code: 'custom', path: ['document', 'total'], message: 'O total do documento diverge da cotação autoritativa.' });
  }
  const allocationIds = request.payments.map((payment) => payment.allocationId);
  if (new Set(allocationIds).size !== allocationIds.length) {
    ctx.addIssue({ code: 'custom', path: ['payments'], message: 'allocationId de pagamento duplicado.' });
  }
  if (request.payments.length > 0) {
    const allocated = request.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (allocated !== request.quote.pricing.totalCents) {
      ctx.addIssue({ code: 'custom', path: ['payments'], message: 'A soma dos pagamentos diverge do total cotado.' });
    }
  }
  const benefitIds = request.benefits.map((benefit) => benefit.intentId);
  if (new Set(benefitIds).size !== benefitIds.length) {
    ctx.addIssue({ code: 'custom', path: ['benefits'], message: 'intentId de benefício duplicado.' });
  }
});

export const CommercialOperationEffectIdsSchema = z.object({
  documentId: z.string().min(1),
  stockIdempotencyKey: z.string().min(1),
  transactionIds: z.record(z.string(), z.string().min(1)),
  couponRedemptionIds: z.record(z.string(), z.string().min(1)),
  giftCardRedemptionIds: z.record(z.string(), z.string().min(1)),
  loyaltyTransactionIds: z.record(z.string(), z.string().min(1)),
  fiscalDocumentId: z.string().min(1).optional(),
  domainEventId: z.string().min(1),
});

export const CommercialOperationStepEffectsSchema = z.object({
  transactionIds: z.array(z.string()).default([]),
  couponRedemptionIds: z.array(z.string()).default([]),
  giftCardRedemptionIds: z.array(z.string()).default([]),
  loyaltyTransactionIds: z.array(z.string()).default([]),
  fiscalDocumentIds: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CommercialStockEffectSchema = z.object({
  stockOperationId: z.string().min(1),
  replayed: z.boolean(),
  movementIds: z.array(z.string().min(1)),
  adjustments: z.array(z.object({
    productId: z.string().min(1),
    variantId: z.string().min(1).optional(),
    productName: z.string().min(1),
    movementId: z.string().min(1),
    delta: z.number(),
    previousStock: z.number(),
    newStock: z.number(),
    alert: z.object({
      businessId: z.string().min(1),
      productId: z.string().min(1),
      variantId: z.string().min(1).optional(),
      productName: z.string().min(1),
      previousStock: z.number(),
      newStock: z.number(),
      minStock: z.number(),
      severity: z.enum(['zeroed', 'min']),
    }).optional(),
    lotAllocations: z.array(z.object({
      lotId: z.string().min(1),
      lotCode: z.string().min(1),
      quantity: z.number().positive(),
      expiresAt: z.string().optional(),
    })).optional(),
  })),
});

export const CommercialOperationResultSchema = z.object({
  operationId: z.string().min(1),
  documentCollection: z.enum(['sales', 'deliveryOrders', 'orders']),
  documentId: z.string().min(1),
  stockOperationId: z.string().optional(),
  effects: CommercialEffectReferencesSchema,
  domainEventId: z.string().min(1),
  completedAt: z.string().datetime(),
});

export const CommercialOperationCompensationSchema = z.object({
  status: z.enum(['not_required', 'pending', 'in_progress', 'completed', 'failed']),
  reason: z.string().min(5).max(1000).optional(),
  requestedAt: z.string().datetime().optional(),
  requestedBy: CommercialOperationActorSchema.optional(),
  completedAt: z.string().datetime().optional(),
  error: z.string().max(2000).optional(),
});

export const CommercialOperationSchema = z.object({
  schemaVersion: z.literal(COMMERCIAL_OPERATION_VERSION),
  operationId: z.string().min(1),
  businessId: z.string().min(1),
  idempotencyKey: z.string().min(8),
  requestFingerprint: z.string().min(1),
  sourceType: CommercialSourceTypeSchema,
  channel: CommercialChannelSchema,
  status: z.enum([
    'pending', 'running', 'failed', 'completed',
    'compensation_pending', 'compensating', 'compensated',
  ]),
  request: CommercialOperationRequestSchema,
  effectIds: CommercialOperationEffectIdsSchema,
  checkpoints: z.record(CommercialOperationCheckpointNameSchema, CommercialOperationCheckpointSchema),
  currentCheckpoint: CommercialOperationCheckpointNameSchema.nullable(),
  attempts: z.number().int().positive(),
  lease: z.object({
    token: z.string().min(1),
    acquiredAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  }).nullable(),
  compensation: CommercialOperationCompensationSchema,
  lastError: CommercialOperationErrorSchema.optional(),
  result: CommercialOperationResultSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export type CommercialOperationCheckpointName = z.infer<typeof CommercialOperationCheckpointNameSchema>;
export type CommercialOperationCheckpoint = z.infer<typeof CommercialOperationCheckpointSchema>;
export type CommercialOperationRequest = z.infer<typeof CommercialOperationRequestSchema>;
export type CommercialOperationEffectIds = z.infer<typeof CommercialOperationEffectIdsSchema>;
export type CommercialOperationStepEffectsInput = z.input<typeof CommercialOperationStepEffectsSchema>;
export type CommercialOperationStepEffects = z.infer<typeof CommercialOperationStepEffectsSchema>;
export type CommercialStockEffect = z.infer<typeof CommercialStockEffectSchema>;
export type CommercialOperationResult = z.infer<typeof CommercialOperationResultSchema>;
export type CommercialOperation = z.infer<typeof CommercialOperationSchema>;
