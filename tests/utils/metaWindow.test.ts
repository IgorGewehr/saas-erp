import { describe, it, expect } from 'vitest';
import { isOutsideMetaWindow } from '@/lib/utils/metaWindow';

const now = new Date('2026-05-15T14:00:00Z');
const inWindow = new Date('2026-05-15T01:00:00Z').toISOString(); // 13h atras
const outsideWindow = new Date('2026-05-13T14:00:00Z').toISOString(); // 48h atras
const exactly24h = new Date('2026-05-14T14:00:00Z').toISOString(); // 24h exato

describe('isOutsideMetaWindow', () => {
  it('retorna false pra inbound dentro de 24h', () => {
    expect(isOutsideMetaWindow(inWindow, now)).toBe(false);
  });

  it('retorna true pra inbound >24h atras', () => {
    expect(isOutsideMetaWindow(outsideWindow, now)).toBe(true);
  });

  it('retorna true pra null/undefined (sem inbound conhecido)', () => {
    expect(isOutsideMetaWindow(null, now)).toBe(true);
    expect(isOutsideMetaWindow(undefined, now)).toBe(true);
  });

  it('retorna false EXATAMENTE em 24h (borda inclusiva)', () => {
    expect(isOutsideMetaWindow(exactly24h, now)).toBe(false);
  });

  it('retorna true pra ISO invalido (defensivo)', () => {
    expect(isOutsideMetaWindow('not-a-date', now)).toBe(true);
  });
});
