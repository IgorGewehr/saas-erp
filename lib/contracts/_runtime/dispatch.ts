/**
 * lib/contracts/_runtime/dispatch.ts
 *
 * Dispatcher de eventos cross-módulo. Implementação V1: síncrona + persistência
 * em Firestore para auditoria. Pode evoluir para async (Cloud Tasks/PubSub) sem
 * mudar a API pública.
 *
 * Uso típico (no caller, ex: AgendaModule após status='concluido'):
 *
 *   await dispatchDomainEvent(adminDb, {
 *     type: 'appointment.completed',
 *     businessId: business.id,
 *     occurredAt: new Date().toISOString(),
 *     actorType: 'user',
 *     actorId: user.uid,
 *     appointmentId: appt.id,
 *     clientId: appt.clientId,
 *     professionalId: appt.professionalId,
 *     serviceId: appt.serviceId,
 *     amount: appt.price ?? 0,
 *   });
 *
 * Handlers ficam em `lib/contracts/_runtime/handlers/`. Cada handler é uma
 * função `(event, ctx) => Promise<void>` registrada via `registerHandler()`.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { DomainEventSchema, type DomainEvent, type DomainEventType } from '../events';

export interface DispatchContext {
  db: Firestore;
}

export type DomainEventHandler<T extends DomainEventType = DomainEventType> = (
  event: Extract<DomainEvent, { type: T }>,
  ctx: DispatchContext,
) => Promise<void>;

/** Handler internamente como `unknown`-typed para escapar variância contravariante. */
type AnyHandler = (event: DomainEvent, ctx: DispatchContext) => Promise<void>;
const handlers = new Map<DomainEventType, AnyHandler[]>();

/** Registra handler para um tipo de evento. Múltiplos handlers permitidos. */
export function registerHandler<T extends DomainEventType>(
  type: T,
  handler: DomainEventHandler<T>,
): void {
  const existing = handlers.get(type) ?? [];
  // Cast seguro: o dispatcher só chama esse handler quando event.type === T,
  // então `event` será sempre `Extract<DomainEvent, { type: T }>`.
  existing.push(handler as unknown as AnyHandler);
  handlers.set(type, existing);
}

/** Limpa todos os handlers (uso em testes). */
export function clearHandlers(): void {
  handlers.clear();
}

/** Lista handlers registrados para introspecção. */
export function listHandlers(): Record<DomainEventType, number> {
  const out: Partial<Record<DomainEventType, number>> = {};
  for (const [type, list] of handlers.entries()) {
    out[type] = list.length;
  }
  return out as Record<DomainEventType, number>;
}

export interface DispatchResult {
  /** ID do doc em `domainEvents/{id}`. */
  eventId: string;
  /** Resultado por handler: ok ou erro. */
  handlers: Array<{ index: number; ok: boolean; error?: string; durationMs: number }>;
}

/**
 * Dispatch principal:
 *   1. Valida o evento contra DomainEventSchema (fail-fast)
 *   2. Persiste em `domainEvents/{id}` para auditoria
 *   3. Roda handlers em série (NÃO bloqueia o caller se um falhar — só loga)
 *   4. Atualiza `domainEvents/{id}` com resultados
 *
 * Se algum handler crashar, NÃO propaga. O caller já fez o trabalho principal
 * (criar appointment, etc) — falha de handler não deve desfazer essa ação.
 */
export async function dispatchDomainEvent(
  db: Firestore,
  rawEvent: unknown,
): Promise<DispatchResult> {
  const parsed = DomainEventSchema.safeParse(rawEvent);
  if (!parsed.success) {
    throw new Error(
      `[dispatchDomainEvent] Evento inválido: ${JSON.stringify(parsed.error.flatten())}`,
    );
  }
  const event = parsed.data;
  const eventRef = db.collection('domainEvents').doc();
  const eventId = eventRef.id;

  await eventRef.set({
    ...event,
    id: eventId,
    status: 'dispatched',
    createdAt: new Date().toISOString(),
  });

  const handlerList = handlers.get(event.type) ?? [];
  const results: DispatchResult['handlers'] = [];

  for (let i = 0; i < handlerList.length; i++) {
    const start = Date.now();
    try {
      await handlerList[i]!(event, { db });
      results.push({ index: i, ok: true, durationMs: Date.now() - start });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[dispatchDomainEvent] handler #${i} for ${event.type} falhou:`, err);
      results.push({ index: i, ok: false, error: message, durationMs: Date.now() - start });
    }
  }

  await eventRef.update({
    status: 'processed',
    handlerResults: results,
    processedAt: new Date().toISOString(),
  });

  return { eventId, handlers: results };
}
