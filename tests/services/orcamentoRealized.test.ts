import { describe, it, expect } from 'vitest';
import { realizedByCategory } from '@/app/components/features/financial/OrcamentoTab';
import type { Transaction } from '@/lib/types';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx1',
    businessId: 'biz1',
    type: 'despesa',
    status: 'pendente',
    category: 'Marketing',
    amount: 100,
    description: 'x',
    dueDate: '2026-09-15',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as Transaction;
}

describe('realizedByCategory', () => {
  it('soma por (type, category) dentro do período', () => {
    const map = realizedByCategory(
      [
        tx({ type: 'despesa', category: 'Marketing', amount: 100 }),
        tx({ type: 'despesa', category: 'Marketing', amount: 50 }),
        tx({ type: 'despesa', category: 'Software', amount: 30 }),
      ],
      '2026-09',
    );
    expect(map.get('despesa:Marketing')).toBe(150);
    expect(map.get('despesa:Software')).toBe(30);
  });

  it('ignora transações canceladas', () => {
    const map = realizedByCategory(
      [tx({ status: 'cancelado', amount: 999 })],
      '2026-09',
    );
    expect(map.get('despesa:Marketing')).toBeUndefined();
  });

  it('ignora transações fora do período (por dueDate)', () => {
    const map = realizedByCategory(
      [tx({ dueDate: '2026-08-15', amount: 999 })],
      '2026-09',
    );
    expect(map.get('despesa:Marketing')).toBeUndefined();
  });

  it('categoria ausente cai em "Outros"', () => {
    const map = realizedByCategory(
      [tx({ category: undefined, amount: 42 })],
      '2026-09',
    );
    expect(map.get('despesa:Outros')).toBe(42);
  });

  it('separa receita e despesa da mesma categoria nominal', () => {
    const map = realizedByCategory(
      [
        tx({ type: 'receita', category: 'Outros', amount: 200 }),
        tx({ type: 'despesa', category: 'Outros', amount: 80 }),
      ],
      '2026-09',
    );
    expect(map.get('receita:Outros')).toBe(200);
    expect(map.get('despesa:Outros')).toBe(80);
  });
});
