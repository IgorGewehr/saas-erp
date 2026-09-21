import { describe, it, expect } from 'vitest';
import { syncLinesWithCatalog, type ProposalLine } from '@/lib/utils/vitrineProposal';
import type { Product, ProductVariant } from '@/lib/types';

function line(overrides: Partial<ProposalLine> = {}): ProposalLine {
  return { productId: 'p1', name: 'Pacote Spot', unitPriceCents: 150_000, quantity: 2, ...overrides };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', businessId: 'biz_1', name: 'Pacote Spot', category: 'Pacotes', unit: 'UN',
    costPrice: 0, salePrice: 1500, currentStock: 0, minStock: 0, isActive: true, trackStock: false,
    createdAt: '', updatedAt: '', ...overrides,
  };
}

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'v30', name: '30s', attributes: {}, salePrice: 1200, costPrice: 0, currentStock: 0,
    minStock: 0, trackStock: false, isActive: true, ...overrides,
  };
}

describe('syncLinesWithCatalog', () => {
  it('nada mudou: devolve a MESMA referência (sem re-render em loop) e listas vazias', () => {
    const lines = [line()];
    const result = syncLinesWithCatalog(lines, [product()]);
    expect(result.lines).toBe(lines);
    expect(result.removed).toEqual([]);
    expect(result.repriced).toEqual([]);
  });

  it('preço mudou no catálogo: atualiza a linha, mantém a quantidade e avisa', () => {
    const result = syncLinesWithCatalog([line()], [product({ salePrice: 1800 })]);
    expect(result.lines[0]).toMatchObject({ unitPriceCents: 180_000, quantity: 2 });
    expect(result.repriced).toEqual(['Pacote Spot']);
  });

  it('linha com opção acompanha o preço da opção', () => {
    const lines = [line({ variantId: 'v30', variantName: '30s', unitPriceCents: 120_000 })];
    const result = syncLinesWithCatalog(lines, [product({ variants: [variant({ salePrice: 1000 })] })]);
    expect(result.lines[0].unitPriceCents).toBe(100_000);
    expect(result.repriced).toEqual(['Pacote Spot — 30s']);
  });

  it('produto que saiu do catálogo é tirado da proposta', () => {
    const result = syncLinesWithCatalog([line(), line({ productId: 'p2', name: 'Outro' })], [product()]);
    expect(result.lines.map((l) => l.productId)).toEqual(['p1']);
    expect(result.removed).toEqual(['Outro']);
  });

  it('opção desativada ou removida tira a linha', () => {
    const lines = [line({ variantId: 'v30', variantName: '30s' })];
    expect(syncLinesWithCatalog(lines, [product({ variants: [variant({ isActive: false })] })]).removed).toEqual(['Pacote Spot — 30s']);
    expect(syncLinesWithCatalog(lines, [product({ variants: [] })]).lines).toEqual([]);
  });

  it('item que ficou sem preço sai (o servidor não cotaria)', () => {
    const result = syncLinesWithCatalog([line()], [product({ salePrice: 0 })]);
    expect(result.lines).toEqual([]);
    expect(result.removed).toEqual(['Pacote Spot']);
  });

  it('proposta vazia não muda nada', () => {
    const lines: ProposalLine[] = [];
    expect(syncLinesWithCatalog(lines, [product()]).lines).toBe(lines);
  });
});
