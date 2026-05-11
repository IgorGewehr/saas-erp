/**
 * lib/contracts/api/agent/_routes.ts
 *
 * Contratos dos endpoints "infra" do agente (não-tools):
 *   /api/agent/runs           — registrar AgentRun
 *   /api/agent/budget         — checagem de orçamento diário
 *   /api/agent/circuit        — estado do circuit breaker
 *   /api/agent/operator/chat  — chat operacional (UI interna)
 *   /api/agent/scheduled/run  — cron de reminders/automações
 *   /api/agent/memory/admin   — admin de memory (operator UI)
 */

import { z } from 'zod';
import { DocIdSchema } from './_shared';

// ============================================================================
// /api/agent/runs (POST, HMAC)
// ============================================================================

export const AgentRunsLogBodySchema = z.object({
  action: z.literal('log'),
  params: z.object({
    id: DocIdSchema.optional(),
    status: z.string().optional(),
    error: z.string().optional(),
    costUsd: z.number().nonnegative().optional(),
    tools: z.array(z.object({
      name: z.string(),
      arguments: z.unknown().optional(),
      error: z.string().optional(),
    })).optional(),
    intent: z.string().optional(),
    response: z.string().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    conversationId: DocIdSchema.optional(),
    contactId: DocIdSchema.optional(),
    createdAt: z.string().optional(),
  }).passthrough(),
});

export const AgentRunsLogDataSchema = z.object({ id: DocIdSchema });

// ============================================================================
// /api/agent/budget (POST, HMAC)
// ============================================================================

export const AgentBudgetCheckBodySchema = z.object({
  action: z.literal('check'),
});

export const AgentBudgetCheckDataSchema = z.object({
  usdToday: z.number().nonnegative(),
  cap: z.number().nonnegative(),
  allowed: z.boolean(),
  runsToday: z.number().int().nonnegative(),
});

// ============================================================================
// /api/agent/circuit (GET + POST, Firebase session)
// ============================================================================

export const AgentCircuitGetQuerySchema = z.object({
  businessId: z.string().min(1),
});

export const AgentCircuitStateDataSchema = z.object({
  state: z.enum(['closed', 'open', 'half-open']),
  consecutiveFailures: z.number().int().nonnegative(),
  openUntil: z.string().optional(),
  lastError: z.string().optional(),
  lastStatusChangeAt: z.string().optional(),
}).passthrough();

export const AgentCircuitResetBodySchema = z.object({
  businessId: z.string().min(1),
});

// ============================================================================
// /api/agent/operator/chat (POST, Firebase session, role ≥ operator)
// ============================================================================

export const OperatorChatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(20).optional(),
  sessionId: z.string().min(1).max(200).optional(),
  mode: z.enum(['operator', 'analyst']).optional(),
});

export const OperatorChatDataSchema = z.object({
  runId: DocIdSchema,
  response: z.string().nullable(),
  intent: z.string().nullable(),
  toolCalls: z.array(z.object({
    name: z.string(),
    args: z.unknown().optional(),
    error: z.string().optional(),
  })),
  durationMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  autonomous: z.boolean(),
  agentStatus: z.enum(['success', 'error', 'skipped']).optional(),
  agentError: z.string().optional(),
});

// ============================================================================
// /api/agent/scheduled/run (POST, dual: cron secret OU HMAC per-tenant)
// ============================================================================

export const ScheduledRunDataSchema = z.object({
  remindersSent: z.number().int().nonnegative(),
  confirmationsAsked: z.number().int().nonnegative(),
  followUpsSent: z.number().int().nonnegative(),
  businessesProcessed: z.number().int().nonnegative(),
  financialNotifsSent: z.number().int().nonnegative(),
  kanbanNotifs: z.number().int().nonnegative().optional(),
  recurringGenerated: z.number().int().nonnegative().optional(),
  automationsRun: z.number().int().nonnegative().optional(),
  errors: z.array(z.object({
    appointmentId: DocIdSchema.optional(),
    phase: z.string(),
    error: z.string(),
  })),
});

// ============================================================================
// /api/agent/memory/admin (GET + DELETE, Firebase session)
// ============================================================================

export const MemoryAdminQuerySchema = z.object({
  contactId: DocIdSchema,
  factId: DocIdSchema.optional(),
});

export const MemoryAdminGetDataSchema = z.object({
  contactId: DocIdSchema,
  facts: z.array(z.object({
    id: DocIdSchema,
    content: z.string(),
    validUntil: z.string().optional(),
  }).passthrough()),
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

export const MemoryAdminDeleteDataSchema = z.union([
  z.object({ removed: z.boolean() }),
  z.object({ cleared: z.literal(true) }),
]);
