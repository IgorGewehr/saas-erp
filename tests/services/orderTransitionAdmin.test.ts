import { describe, it, expect } from 'vitest';
import { splitInstallments } from '@/lib/services/order-transition-admin';

describe('splitInstallments', () => {
  it('parcela única = total inteiro', () => {
    expect(splitInstallments(300, 1)).toEqual([300]);
  });

  it('divide igualmente quando não há resto', () => {
    expect(splitInstallments(300, 3)).toEqual([100, 100, 100]);
  });

  it('a última parcela absorve o resto do arredondamento', () => {
    const parts = splitInstallments(100, 3);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    const sum = parts.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it('soma das parcelas sempre bate com o total (várias combinações)', () => {
    for (const [total, n] of [[999.99, 7], [1000, 4], [0.03, 3], [12345.67, 12]] as const) {
      const parts = splitInstallments(total, n);
      expect(parts).toHaveLength(n);
      const sum = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
      expect(sum).toBe(Math.round(total * 100) / 100);
    }
  });
});
