import { describe, it, expect } from 'vitest';
import { sanitizeSpecs, moveSpec, resolveProductSpecs } from '@/lib/utils/productSpecs';

describe('sanitizeSpecs', () => {
  it('tira espaços das pontas', () => {
    expect(sanitizeSpecs([{ label: '  Duração ', value: ' 30 segundos  ' }])).toEqual([{ label: 'Duração', value: '30 segundos' }]);
  });

  it('descarta linha com rótulo ou valor vazio (linha meio digitada)', () => {
    expect(sanitizeSpecs([
      { label: 'Duração', value: '' },
      { label: '', value: '30s' },
      { label: '   ', value: '   ' },
      { label: 'Horário', value: 'nobre' },
    ])).toEqual([{ label: 'Horário', value: 'nobre' }]);
  });

  it('limita a 30 linhas (teto do contrato)', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ label: `L${index}`, value: 'v' }));
    expect(sanitizeSpecs(many)).toHaveLength(30);
  });

  it('nulo/undefined viram lista vazia', () => {
    expect(sanitizeSpecs(undefined)).toEqual([]);
    expect(sanitizeSpecs(null)).toEqual([]);
  });
});

describe('moveSpec', () => {
  const list = [
    { label: 'A', value: '1' },
    { label: 'B', value: '2' },
    { label: 'C', value: '3' },
  ];

  it('sobe e desce uma posição, sem mutar o original', () => {
    expect(moveSpec(list, 1, -1).map((s) => s.label)).toEqual(['B', 'A', 'C']);
    expect(moveSpec(list, 1, 1).map((s) => s.label)).toEqual(['A', 'C', 'B']);
    expect(list.map((s) => s.label)).toEqual(['A', 'B', 'C']);
  });

  it('fora dos limites devolve a mesma lista', () => {
    expect(moveSpec(list, 0, -1)).toBe(list);
    expect(moveSpec(list, 2, 1)).toBe(list);
    expect(moveSpec(list, 9, 1)).toBe(list);
    expect(moveSpec(list, -1, 1)).toBe(list);
  });
});

describe('resolveProductSpecs', () => {
  it('com campo estruturado: ele manda e a descrição inteira vira texto', () => {
    const result = resolveProductSpecs({
      specs: [{ label: 'Duração', value: '30 segundos' }],
      description: 'Pacote mensal.\nHorário: nobre\nInserções: 60',
    });
    expect(result.specs).toEqual([{ label: 'Duração', value: '30 segundos' }]);
    expect(result.rest).toBe('Pacote mensal.\nHorário: nobre\nInserções: 60');
  });

  it('sem campo estruturado: interpreta as linhas "Rótulo: valor" da descrição (produtos antigos)', () => {
    const result = resolveProductSpecs({ description: 'Duração: 30s\nHorário: nobre' });
    expect(result.specs.map((s) => s.label)).toEqual(['Duração', 'Horário']);
    expect(result.rest).toBe('');
  });

  it('campo estruturado vazio ou só com linhas em branco cai no legado', () => {
    expect(resolveProductSpecs({ specs: [], description: 'Duração: 30s\nHorário: nobre' }).specs).toHaveLength(2);
    expect(resolveProductSpecs({ specs: [{ label: ' ', value: '' }], description: 'Só texto.' })).toEqual({ specs: [], rest: 'Só texto.' });
  });

  it('usa a descrição do cardápio quando não há descrição', () => {
    expect(resolveProductSpecs({ specs: [{ label: 'A', value: 'b' }], menuDescription: 'Do cardápio' }).rest).toBe('Do cardápio');
  });

  it('produto sem nada devolve vazio', () => {
    expect(resolveProductSpecs({})).toEqual({ specs: [], rest: '' });
  });
});
