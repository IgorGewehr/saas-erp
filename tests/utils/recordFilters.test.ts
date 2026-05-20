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

  it('rejeita doc com isActive=false (legado clients)', () => {
    expect(isActiveRecord({ isActive: false })).toBe(false);
  });

  it('aceita doc com isActive=true ou ausente', () => {
    expect(isActiveRecord({ isActive: true })).toBe(true);
    expect(isActiveRecord({})).toBe(true);
  });

  it('rejeita doc com isDeleted=true (legado conversations)', () => {
    expect(isActiveRecord({ isDeleted: true })).toBe(false);
  });

  it('aceita doc com isDeleted=false ou ausente', () => {
    expect(isActiveRecord({ isDeleted: false })).toBe(true);
    expect(isActiveRecord({})).toBe(true);
  });

  it('rejeita null e undefined (defensivo)', () => {
    expect(isActiveRecord(null)).toBe(false);
    expect(isActiveRecord(undefined)).toBe(false);
  });

  it('combinacao: doc com deletedAt + isActive=true continua rejeitado', () => {
    expect(isActiveRecord({ deletedAt: '2026-01-01T00:00:00Z', isActive: true })).toBe(false);
  });

  it('combinacao: doc mergedInto + deletedAt ausente continua rejeitado', () => {
    expect(isActiveRecord({ mergedInto: 'x', deletedAt: undefined })).toBe(false);
  });
});

describe('filterActive', () => {
  it('filtra array preservando so ativos', () => {
    const docs = [
      { id: 1 },
      { id: 2, deletedAt: '2026-01-01T00:00:00Z' },
      { id: 3, mergedInto: 'p' },
      { id: 4, isActive: false },
      { id: 5 },
    ];
    expect(filterActive(docs).map(d => d.id)).toEqual([1, 5]);
  });

  it('retorna array vazio quando todos deletados', () => {
    const docs = [
      { id: 1, deletedAt: '2026-01-01T00:00:00Z' },
      { id: 2, isDeleted: true },
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
