import { describe, it, expect } from 'vitest';
import {
  splitInstallments,
  installmentDueDate,
  buildInstallmentSchedule,
  INSTALLMENT_INTERVAL_DAYS,
} from '@/lib/utils/installments';
import { splitInstallments as splitFromServer } from '@/lib/services/order-transition-admin';

const NOW = new Date('2026-09-18T12:00:00.000Z');

describe('paridade com o servidor', () => {
  it('order-transition-admin reexporta a MESMA função (prévia da Vitrine = o que o servidor grava)', () => {
    expect(splitFromServer).toBe(splitInstallments);
  });
});

describe('installmentDueDate', () => {
  it('parcela 0 vence hoje', () => {
    expect(installmentDueDate(NOW, 0)).toBe('2026-09-18');
  });

  it('parcelas seguintes vencem de 30 em 30 dias', () => {
    expect(INSTALLMENT_INTERVAL_DAYS).toBe(30);
    expect(installmentDueDate(NOW, 1)).toBe('2026-10-18');
    expect(installmentDueDate(NOW, 2)).toBe('2026-11-17');
  });
});

describe('buildInstallmentSchedule', () => {
  it('à vista = 1 parcela com o total inteiro vencendo hoje', () => {
    expect(buildInstallmentSchedule(1500, 1, NOW)).toEqual([{ number: 1, amount: 1500, dueDate: '2026-09-18' }]);
  });

  it('parcelado numera de 1..n, divide o total e a soma bate', () => {
    const schedule = buildInstallmentSchedule(100, 3, NOW);
    expect(schedule.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(schedule.map((s) => s.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(Math.round(schedule.reduce((sum, s) => sum + s.amount, 0) * 100) / 100).toBe(100);
  });

  it('número de parcelas inválido cai pra 1', () => {
    expect(buildInstallmentSchedule(500, 0, NOW)).toHaveLength(1);
    expect(buildInstallmentSchedule(500, -3, NOW)).toHaveLength(1);
  });
});
