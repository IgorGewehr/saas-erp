'use client';

import Papa from 'papaparse';
import type { ProductCatalogData } from '@/lib/contracts/api/product-catalog';
import { createCatalogProduct } from '@/lib/services/product-catalog-client';

export interface ProductCsvRow {
  rowNumber: number;
  data?: ProductCatalogData;
  initialStock: number;
  error?: string;
}

export interface ProductCsvImportResult {
  imported: number;
  errors: Array<{ rowNumber: number; message: string }>;
}

function normalizedKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function read(row: Record<string, unknown>, aliases: string[]): string {
  const index = new Map(Object.entries(row).map(([key, value]) => [normalizedKey(key), String(value ?? '').trim()]));
  for (const alias of aliases) {
    const value = index.get(normalizedKey(alias));
    if (value) return value;
  }
  return '';
}

function number(value: string): number {
  if (!value) return 0;
  const normalized = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function parseProductCsv(text: string): ProductCsvRow[] {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.some((error) => error.type === 'Quotes' || error.type === 'Delimiter')) {
    throw new Error(parsed.errors[0]?.message || 'CSV inválido.');
  }
  if (parsed.data.length > 1000) throw new Error('A importação aceita no máximo 1.000 produtos por arquivo.');

  return parsed.data.map((row, index) => {
    const rowNumber = index + 2;
    const name = read(row, ['name', 'nome', 'produto']);
    const salePrice = number(read(row, ['salePrice', 'precoVenda', 'preco', 'venda']));
    const costPrice = number(read(row, ['costPrice', 'precoCusto', 'custo']));
    const initialStock = number(read(row, ['currentStock', 'estoque', 'saldo']));
    const minStock = number(read(row, ['minStock', 'estoqueMinimo', 'minimo']));
    const rawMaxStock = read(row, ['maxStock', 'estoqueMaximo', 'maximo']);
    const maxStock = rawMaxStock ? number(rawMaxStock) : undefined;
    const rawFactor = read(row, ['purchaseToStockFactor', 'fatorCompra']);
    const purchaseToStockFactor = rawFactor ? number(rawFactor) : 1;
    const ncm = read(row, ['ncm']);
    if (!name) return { rowNumber, initialStock: 0, error: 'Nome obrigatório.' };
    if ([salePrice, costPrice, initialStock, minStock, maxStock].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
      return { rowNumber, initialStock: 0, error: 'Preços e estoques devem ser números não negativos.' };
    }
    if (!Number.isFinite(purchaseToStockFactor) || purchaseToStockFactor <= 0) {
      return { rowNumber, initialStock: 0, error: 'Fator de compra deve ser maior que zero.' };
    }
    if (ncm && !/^\d{8}$/.test(ncm.replace(/\D/g, ''))) {
      return { rowNumber, initialStock: 0, error: 'NCM deve conter 8 dígitos.' };
    }

    const unit = read(row, ['unit', 'unidade']) || 'UN';
    const data: ProductCatalogData = {
      name,
      description: read(row, ['description', 'descricao']) || undefined,
      sku: read(row, ['sku', 'codigoInterno']) || undefined,
      barcode: read(row, ['barcode', 'codigoBarras', 'ean', 'gtin']) || undefined,
      category: read(row, ['category', 'categoria']) || 'Produto',
      unit,
      purchaseUnit: read(row, ['purchaseUnit', 'unidadeCompra']) || unit,
      purchaseToStockFactor,
      costMethod: 'moving_average',
      costPrice,
      salePrice,
      minStock,
      maxStock,
      ncm: ncm ? ncm.replace(/\D/g, '') : undefined,
      cfop: read(row, ['cfop']) || undefined,
      isActive: !['nao', 'não', 'false', '0', 'inativo'].includes(read(row, ['isActive', 'ativo']).toLowerCase()),
      images: [],
      variants: [],
      isDeliverable: false,
      menuAvailable: true,
      trackStock: true,
      components: [],
      modifierGroups: [],
    };
    return { rowNumber, data, initialStock };
  });
}

export async function importProductCsvRows(input: {
  businessId: string;
  rows: ProductCsvRow[];
  operationId: string;
  onProgress?: (processed: number, total: number) => void;
}): Promise<ProductCsvImportResult> {
  const validRows = input.rows.filter((row) => row.data);
  const errors = input.rows
    .filter((row) => row.error)
    .map((row) => ({ rowNumber: row.rowNumber, message: row.error! }));
  let imported = 0;

  for (const [index, row] of validRows.entries()) {
    try {
      await createCatalogProduct({
        businessId: input.businessId,
        data: row.data!,
        initialStock: row.initialStock,
        idempotencyKey: `csv:${input.operationId}:row:${row.rowNumber}`,
      });
      imported++;
    } catch (cause) {
      errors.push({
        rowNumber: row.rowNumber,
        message: cause instanceof Error ? cause.message : 'Falha ao importar produto.',
      });
    }
    input.onProgress?.(index + 1, validRows.length);
  }

  return { imported, errors: errors.sort((a, b) => a.rowNumber - b.rowNumber) };
}
