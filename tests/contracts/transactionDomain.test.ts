import { describe, it, expect } from 'vitest';
import { TransactionSchema } from '@/contracts/domain/transaction';

/**
 * M03.1: primeira cobertura de teste pra TransactionSchema (nunca existiu —
 * Transaction vivia só como interface TS solta em lib/types/index.ts, sem
 * validação em nenhuma camada). Foco nas invariantes NOVAS introduzidas pelo
 * superRefine (parcelamento) — os campos simples são checados de passagem.
 */

function baseTransaction(over: Record<string, unknown> = {}) {
  return {
    id: 'tx1',
    businessId: 'biz1',
    type: 'receita',
    description: 'Pagamento cliente',
    amount: 100,
    status: 'pendente',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('TransactionSchema', () => {
  it('aceita uma transação mínima válida', () => {
    const result = TransactionSchema.safeParse(baseTransaction());
    expect(result.success).toBe(true);
  });

  it('rejeita type fora do enum', () => {
    expect(TransactionSchema.safeParse(baseTransaction({ type: 'lucro' })).success).toBe(false);
  });

  it('rejeita status fora do enum do FSM', () => {
    expect(TransactionSchema.safeParse(baseTransaction({ status: 'quitado' })).success).toBe(false);
  });

  it('rejeita amount zero ou negativo', () => {
    expect(TransactionSchema.safeParse(baseTransaction({ amount: 0 })).success).toBe(false);
    expect(TransactionSchema.safeParse(baseTransaction({ amount: -10 })).success).toBe(false);
  });

  it('rejeita description vazia', () => {
    expect(TransactionSchema.safeParse(baseTransaction({ description: '' })).success).toBe(false);
  });

  it('rejeita businessId ausente/vazio', () => {
    expect(TransactionSchema.safeParse(baseTransaction({ businessId: '' })).success).toBe(false);
  });

  it('aceita paymentMethod dentro do enum real de 10 valores (não o do agente)', () => {
    expect(TransactionSchema.safeParse(baseTransaction({ paymentMethod: 'creditoLoja' })).success).toBe(true);
    expect(TransactionSchema.safeParse(baseTransaction({ paymentMethod: 'gift_card' })).success).toBe(true);
  });

  it('rejeita paymentMethod fora do enum', () => {
    expect(TransactionSchema.safeParse(baseTransaction({ paymentMethod: 'transferencia' })).success).toBe(false);
  });

  describe('invariantes de parcelamento (superRefine)', () => {
    it('aceita parcela coerente (groupId + total + number dentro do limite)', () => {
      const result = TransactionSchema.safeParse(baseTransaction({
        installmentGroupId: 'grp-1', installmentTotal: 3, installmentNumber: 2,
      }));
      expect(result.success).toBe(true);
    });

    it('rejeita installmentTotal sem installmentGroupId', () => {
      const result = TransactionSchema.safeParse(baseTransaction({ installmentTotal: 3 }));
      expect(result.success).toBe(false);
    });

    it('rejeita installmentNumber sem installmentGroupId', () => {
      const result = TransactionSchema.safeParse(baseTransaction({ installmentNumber: 1 }));
      expect(result.success).toBe(false);
    });

    it('rejeita installmentNumber maior que installmentTotal', () => {
      const result = TransactionSchema.safeParse(baseTransaction({
        installmentGroupId: 'grp-1', installmentTotal: 2, installmentNumber: 3,
      }));
      expect(result.success).toBe(false);
    });

    it('aceita installmentGroupId sozinho, sem number/total (grupo aberto)', () => {
      const result = TransactionSchema.safeParse(baseTransaction({ installmentGroupId: 'grp-1' }));
      expect(result.success).toBe(true);
    });
  });

  describe('recurrence (objeto aninhado)', () => {
    it('aceita recurrence válida', () => {
      const result = TransactionSchema.safeParse(baseTransaction({
        recurrence: { frequency: 'monthly', nextDueDate: '2026-02-01', isActive: true, dayOfMonth: 10 },
      }));
      expect(result.success).toBe(true);
    });

    it('rejeita frequency fora do enum', () => {
      const result = TransactionSchema.safeParse(baseTransaction({
        recurrence: { frequency: 'daily', nextDueDate: '2026-02-01', isActive: true },
      }));
      expect(result.success).toBe(false);
    });

    it('rejeita dayOfMonth fora do intervalo 1-28', () => {
      const result = TransactionSchema.safeParse(baseTransaction({
        recurrence: { frequency: 'monthly', nextDueDate: '2026-02-01', isActive: true, dayOfMonth: 29 },
      }));
      expect(result.success).toBe(false);
    });
  });

  it('aceita attachments com o shape completo', () => {
    const result = TransactionSchema.safeParse(baseTransaction({
      attachments: [{ id: 'a1', name: 'recibo.pdf', url: 'https://x', path: 'biz1/a1.pdf', size: 1024, type: 'application/pdf', createdAt: '2026-01-01T00:00:00.000Z' }],
    }));
    expect(result.success).toBe(true);
  });
});
