import { describe, it, expect } from 'vitest';
import { isActiveRecord, filterActive } from '@/lib/utils/recordFilters';

describe('isActiveRecord', () => {
  it('aceita doc sem nenhum campo (default = ativo)', () => {
    expect(isActiveRecord({})).toBe(true);
  });

  it('aceita doc com campos auxiliares (id, nome, etc) sem soft-delete', () => {
    expect(isActiveRecord({ deletedAt: undefined, mergedInto: undefined })).toBe(true);
  });

  it('rejeita doc com deletedAt preenchido', () => {
    expect(isActiveRecord({ deletedAt: '2026-05-19T10:00:00Z' })).toBe(false);
  });

  it('rejeita doc com mergedInto preenchido', () => {
    expect(isActiveRecord({ mergedInto: 'parent-id' })).toBe(false);
  });

  it('aceita doc com deletedAt vazio (string vazia trata como ausente)', () => {
    expect(isActiveRecord({ deletedAt: '' })).toBe(true);
  });

  it('aceita doc com mergedInto vazio', () => {
    expect(isActiveRecord({ mergedInto: '' })).toBe(true);
  });

  it('aceita doc com deletedAt null', () => {
    expect(isActiveRecord({ deletedAt: null })).toBe(true);
  });

  it('aceita doc com mergedInto null', () => {
    expect(isActiveRecord({ mergedInto: null })).toBe(true);
  });

  it('Deploy C concluido: legados isActive=false e isDeleted=true viram extra fields ignorados', () => {
    // Pos-Deploy C, helper ignora os campos legados — tratamos doc como
    // ativo a nao ser que tenha deletedAt/mergedInto. Backfill ja migrou
    // todos os legados pra deletedAt antes desse cleanup.
    expect(isActiveRecord({ isActive: false } as never)).toBe(true);
    expect(isActiveRecord({ isDeleted: true } as never)).toBe(true);
  });

  it('rejeita null e undefined (defensivo)', () => {
    expect(isActiveRecord(null)).toBe(false);
    expect(isActiveRecord(undefined)).toBe(false);
  });

  it('combinacao: doc com deletedAt + isActive=true continua rejeitado', () => {
    expect(isActiveRecord({ deletedAt: '2026-01-01T00:00:00Z', isActive: true } as never)).toBe(false);
  });

  it('combinacao: doc mergedInto + deletedAt ausente continua rejeitado', () => {
    expect(isActiveRecord({ mergedInto: 'x', deletedAt: undefined })).toBe(false);
  });
});

describe('filterActive', () => {
  it('filtra array preservando so ativos (deletedAt/mergedInto presentes)', () => {
    const docs = [
      { id: 1 },
      { id: 2, deletedAt: '2026-01-01T00:00:00Z' },
      { id: 3, mergedInto: 'p' },
      { id: 4 },
    ];
    expect(filterActive(docs).map(d => d.id)).toEqual([1, 4]);
  });

  it('retorna array vazio quando todos com deletedAt', () => {
    const docs = [
      { id: 1, deletedAt: '2026-01-01T00:00:00Z' },
      { id: 2, deletedAt: '2026-02-01T00:00:00Z' },
    ];
    expect(filterActive(docs)).toEqual([]);
  });

  it('retorna array vazio pra entrada vazia', () => {
    expect(filterActive([])).toEqual([]);
  });

  it('preserva ordem original', () => {
    const docs = [
      { id: 3 },
      { id: 1 },
      { id: 2, deletedAt: '2026-01-01T00:00:00Z' },
      { id: 4 },
    ];
    expect(filterActive(docs).map(d => d.id)).toEqual([3, 1, 4]);
  });
});
