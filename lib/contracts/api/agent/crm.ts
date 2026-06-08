/**
 * lib/contracts/api/agent/crm.ts — /api/agent/tools/crm
 * Actions: list_contacts, search_contacts, list_deals, search_deals, get_deal,
 *          create_deal, update_deal_stage, close_deal, list_activities, log_activity,
 *          list_segments, segment_query
 */

import { z } from 'zod';
import {
  CRMActivityTypeSchema, DocIdSchema, LeadStatusSchema, LifecycleStageSchema, MoneySchema,
} from './_shared';

const ContactShape = z.object({ id: DocIdSchema, businessId: z.string(), name: z.string() }).passthrough();
const DealShape = z.object({
  id: DocIdSchema, businessId: z.string(), contactId: DocIdSchema, contactName: z.string().optional(),
  title: z.string(), value: MoneySchema, stage: z.string(),
  probability: z.number().min(0).max(100).optional(),
  expectedCloseDate: z.string().optional(),
  closedDate: z.string().optional(),
  lostReason: z.string().optional(),
  // FKs de resultado (P2.10) — entidade de receita que concretizou o deal ganho.
  saleId: DocIdSchema.optional(),
  appointmentId: DocIdSchema.optional(),
  deliveryOrderId: DocIdSchema.optional(),
}).passthrough();
const ActivityShape = z.object({
  id: DocIdSchema, businessId: z.string(),
  type: CRMActivityTypeSchema, title: z.string(),
  contactId: DocIdSchema.optional(), dealId: DocIdSchema.optional(),
}).passthrough();
const SegmentShape = z.object({ id: DocIdSchema, businessId: z.string(), name: z.string() }).passthrough();

// ---------- list_contacts ----------
export const CRMListContactsParamsSchema = z.object({
  status: LeadStatusSchema.optional(),
  lifecycleStage: LifecycleStageSchema.optional(),
  tag: z.string().optional(),
  assignedTo: DocIdSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export const CRMListContactsDataSchema = z.array(ContactShape);

// ---------- search_contacts ----------
export const CRMSearchContactsParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});
export const CRMSearchContactsDataSchema = z.array(ContactShape.extend({ _score: z.number() }));

// ---------- list_deals ----------
export const CRMListDealsParamsSchema = z.object({
  stage: z.string().optional(),
  assignedTo: DocIdSchema.optional(),
  contactId: DocIdSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export const CRMListDealsDataSchema = z.array(DealShape);

// ---------- search_deals ----------
export const CRMSearchDealsParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});
export const CRMSearchDealsDataSchema = z.array(DealShape.extend({ _score: z.number() }));

// ---------- get_deal ----------
export const CRMGetDealParamsSchema = z.object({ id: DocIdSchema });
export const CRMGetDealDataSchema = DealShape.nullable();

// ---------- create_deal ----------
export const CRMCreateDealParamsSchema = z.object({
  contactId: DocIdSchema,
  title: z.string().min(1).max(200),
  value: MoneySchema,
  stage: z.string().min(1),
  contactName: z.string().optional(),
  probability: z.number().min(0).max(100).default(50),
  expectedCloseDate: z.string().optional(),
  assignedTo: DocIdSchema.optional(),
  assignedToName: z.string().optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
});
export const CRMCreateDealDataSchema = DealShape;

// ---------- update_deal_stage ----------
export const CRMUpdateDealStageParamsSchema = z.object({
  id: DocIdSchema,
  stage: z.string().min(1),
  probability: z.number().min(0).max(100).optional(),
});
export const CRMUpdateDealStageDataSchema = DealShape;

// ---------- close_deal ----------
export const CRMCloseDealParamsSchema = z.object({
  id: DocIdSchema,
  won: z.boolean(),
  reason: z.string().max(500).optional(),
  // FKs de resultado (P2.10) — gravadas só quando won=true e a origem é conhecida.
  saleId: DocIdSchema.optional(),
  appointmentId: DocIdSchema.optional(),
  deliveryOrderId: DocIdSchema.optional(),
});
export const CRMCloseDealDataSchema = DealShape;

// ---------- list_activities ----------
export const CRMListActivitiesParamsSchema = z.object({
  contactId: DocIdSchema.optional(),
  dealId: DocIdSchema.optional(),
  type: CRMActivityTypeSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export const CRMListActivitiesDataSchema = z.array(ActivityShape);

// ---------- log_activity ----------
export const CRMLogActivityParamsSchema = z.object({
  type: CRMActivityTypeSchema,
  title: z.string().min(1).max(200),
  contactId: DocIdSchema.optional(),
  dealId: DocIdSchema.optional(),
  contactName: z.string().optional(),
  dealTitle: z.string().optional(),
  description: z.string().max(5000).optional(),
  scheduledAt: z.string().optional(),
  completedAt: z.string().optional(),
  isCompleted: z.boolean().optional(),
  assignedTo: DocIdSchema.optional(),
  assignedToName: z.string().optional(),
  duration: z.number().int().nonnegative().optional(),
}).superRefine((d, ctx) => {
  if (!d.contactId && !d.dealId) {
    ctx.addIssue({ code: 'custom', message: 'contactId ou dealId obrigatório', path: ['contactId'] });
  }
});
export const CRMLogActivityDataSchema = ActivityShape;

// ---------- list_segments ----------
export const CRMListSegmentsParamsSchema = z.object({});
export const CRMListSegmentsDataSchema = z.array(SegmentShape);

// ---------- segment_query ----------
export const CRMSegmentQueryParamsSchema = z.object({
  segmentId: DocIdSchema,
  limit: z.number().int().min(1).max(500).default(100),
});
export const CRMSegmentQueryDataSchema = z.object({
  segment: SegmentShape,
  contacts: z.array(ContactShape),
});

export const CRMToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_contacts'),     params: CRMListContactsParamsSchema }),
  z.object({ action: z.literal('search_contacts'),   params: CRMSearchContactsParamsSchema }),
  z.object({ action: z.literal('list_deals'),        params: CRMListDealsParamsSchema }),
  z.object({ action: z.literal('search_deals'),      params: CRMSearchDealsParamsSchema }),
  z.object({ action: z.literal('get_deal'),          params: CRMGetDealParamsSchema }),
  z.object({ action: z.literal('create_deal'),       params: CRMCreateDealParamsSchema }),
  z.object({ action: z.literal('update_deal_stage'), params: CRMUpdateDealStageParamsSchema }),
  z.object({ action: z.literal('close_deal'),        params: CRMCloseDealParamsSchema }),
  z.object({ action: z.literal('list_activities'),   params: CRMListActivitiesParamsSchema }),
  z.object({ action: z.literal('log_activity'),      params: CRMLogActivityParamsSchema }),
  z.object({ action: z.literal('list_segments'),     params: CRMListSegmentsParamsSchema }),
  z.object({ action: z.literal('segment_query'),     params: CRMSegmentQueryParamsSchema }),
]);

export const CRM_DATA_SCHEMAS = {
  list_contacts:     CRMListContactsDataSchema,
  search_contacts:   CRMSearchContactsDataSchema,
  list_deals:        CRMListDealsDataSchema,
  search_deals:      CRMSearchDealsDataSchema,
  get_deal:          CRMGetDealDataSchema,
  create_deal:       CRMCreateDealDataSchema,
  update_deal_stage: CRMUpdateDealStageDataSchema,
  close_deal:        CRMCloseDealDataSchema,
  list_activities:   CRMListActivitiesDataSchema,
  log_activity:      CRMLogActivityDataSchema,
  list_segments:     CRMListSegmentsDataSchema,
  segment_query:     CRMSegmentQueryDataSchema,
} as const;
