/**
 * Contrato de TableSession (comanda de mesa) — trava as invariantes do schema
 * (lib/contracts/domain/tableSession.ts) e as transições da FSM
 * (lib/contracts/fsm/tableSession.ts).
 *
 * A comanda é a entidade que garante RECEITA ÚNICA por mesa: se uma invariante
 * de fechamento/pagamento ou uma aresta da FSM mudar sem intenção, o
 * fechamento no PDV pode dobrar ou pular receita — estes testes falham cedo.
 */

import { describe, it, expect } from 'vitest';
import {
  TableSessionSchema,
  TABLE_SESSION_STATUS_LABELS,
  type TableSession,
} from '@/lib/contracts/domain/tableSession';
import {
  canTransitionTableSession,
  assertTransitionTableSession,
  TABLE_SESSION_TERMINAL_STATUSES,
} from '@/lib/contracts/fsm/tableSession';

const NOW = '2026-09-02T12:00:00.000Z';

function makeSession(overrides: Partial<TableSession> = {}): TableSession {
  return {
    businessId: 'biz-1',
    tableLabel: 'Mesa 12',
    status: 'aberta',
    openedAt: NOW,
    openedByUid: 'user-1',
    openedByName: 'Garçom',
    orderIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('TableSessionSchema — invariantes', () => {
  it('aceita uma comanda aberta mínima', () => {
    expect(TableSessionSchema.safeParse(makeSession()).success).toBe(true);
  });

  it('rejeita comanda aberta com campos de fechamento preenchidos', () => {
    const res = TableSessionSchema.safeParse(makeSession({ closedAt: NOW, closedByUid: 'u', subtotalSnapshot: 10 }));
    expect(res.success).toBe(false);
  });

  it('rejeita comanda fechada sem subtotalSnapshot', () => {
    const res = TableSessionSchema.safeParse(makeSession({
      status: 'fechada', closedAt: NOW, closedByUid: 'u', closedByName: 'X',
    }));
    expect(res.success).toBe(false);
  });

  it('aceita comanda fechada completa', () => {
    const res = TableSessionSchema.safeParse(makeSession({
      status: 'fechada', closedAt: NOW, closedByUid: 'u', closedByName: 'X', subtotalSnapshot: 120.5,
    }));
    expect(res.success).toBe(true);
  });

  it('rejeita comanda paga sem saleId', () => {
    const res = TableSessionSchema.safeParse(makeSession({
      status: 'paga', closedAt: NOW, closedByUid: 'u', closedByName: 'X', subtotalSnapshot: 50, paidAt: NOW,
    }));
    expect(res.success).toBe(false);
  });

  it('aceita comanda paga completa', () => {
    const res = TableSessionSchema.safeParse(makeSession({
      status: 'paga', closedAt: NOW, closedByUid: 'u', closedByName: 'X',
      subtotalSnapshot: 50, saleId: 'sale-1', paidAt: NOW, paidByUid: 'u',
    }));
    expect(res.success).toBe(true);
  });

  it('rejeita orderIds duplicados', () => {
    const res = TableSessionSchema.safeParse(makeSession({ orderIds: ['a', 'a'] }));
    expect(res.success).toBe(false);
  });

  it('tem rótulo para todo status', () => {
    for (const s of ['aberta', 'fechada', 'paga', 'cancelada'] as const) {
      expect(TABLE_SESSION_STATUS_LABELS[s]).toBeTruthy();
    }
  });
});

describe('TableSession FSM', () => {
  it('permite as transições válidas', () => {
    expect(canTransitionTableSession('aberta', 'fechada')).toBe(true);
    expect(canTransitionTableSession('aberta', 'cancelada')).toBe(true);
    expect(canTransitionTableSession('fechada', 'paga')).toBe(true);
    expect(canTransitionTableSession('fechada', 'aberta')).toBe(true);
    expect(canTransitionTableSession('fechada', 'cancelada')).toBe(true);
  });

  it('bloqueia transições inválidas', () => {
    expect(canTransitionTableSession('aberta', 'paga')).toBe(false);
    expect(canTransitionTableSession('paga', 'aberta')).toBe(false);
    expect(canTransitionTableSession('paga', 'fechada')).toBe(false);
    expect(canTransitionTableSession('cancelada', 'aberta')).toBe(false);
    expect(() => assertTransitionTableSession('aberta', 'paga')).toThrow(/transição inválida/);
  });

  it('paga e cancelada são terminais', () => {
    expect(TABLE_SESSION_TERMINAL_STATUSES.has('paga')).toBe(true);
    expect(TABLE_SESSION_TERMINAL_STATUSES.has('cancelada')).toBe(true);
    expect(TABLE_SESSION_TERMINAL_STATUSES.has('aberta')).toBe(false);
  });
});
