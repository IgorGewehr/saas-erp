'use client';

/**
 * Adapter que transforma docs de coleções Firestore em IWorkbookData do
 * Univer (snapshot inicial pra renderizar planilha view-only sobre dados
 * vivos do tenant).
 *
 * Cada collection suportada tem um schema declarado de colunas: label
 * humano + key do field + formatador opcional. Operador escolhe quais
 * colunas exibir via SpreadsheetViewConfig.columns; sem essa config,
 * retornamos todas as default cols.
 *
 * Decisão MVP: views são READ-ONLY. Editar planilha → updateDoc seria
 * possível mas dobra superfície de bug (mapping bidirecional, conflito
 * com snapshot Univer). User edita pelo módulo nativo, planilha aqui é
 * pra visualizar, ordenar, filtrar in-Univer e exportar pra .xlsx.
 */

import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/format';
import type { Client, Product, Transaction, SpreadsheetSourceCollection } from '@/lib/types';

// ─── Schema de colunas por coleção ─────────────────────────────────────────

interface ColumnSpec<T> {
  /** Nome do campo no doc Firestore (ex: 'name', 'totalSpent'). */
  key: string;
  /** Label humano renderizado no header do workbook. */
  label: string;
  /** Largura padrão em px (Univer trabalha em pixels). */
  width?: number;
  /** Renderizador opcional. Recebe o valor cru e retorna string. */
  format?: (value: unknown, doc: T) => string;
}

const CLIENT_COLUMNS: ColumnSpec<Client>[] = [
  { key: 'name',        label: 'Nome',           width: 220 },
  { key: 'email',       label: 'Email',          width: 220 },
  { key: 'phone',       label: 'Telefone',       width: 140 },
  { key: 'tipo',        label: 'Tipo',           width: 70,  format: (v) => v === 'pj' ? 'PJ' : 'PF' },
  { key: 'cpfCnpj',     label: 'CPF/CNPJ',       width: 150 },
  { key: 'company',     label: 'Empresa',        width: 180 },
  { key: 'status',      label: 'Status',         width: 110 },
  { key: 'totalSpent',  label: 'Total gasto',    width: 130, format: (v) => typeof v === 'number' ? formatCurrency(v) : '' },
  { key: 'visitCount',  label: 'Visitas',        width: 80 },
  { key: 'createdAt',   label: 'Cadastro',       width: 160, format: (v) => typeof v === 'string' ? formatDateTime(v) : '' },
];

const PRODUCT_COLUMNS: ColumnSpec<Product>[] = [
  { key: 'name',          label: 'Nome',          width: 240 },
  { key: 'sku',           label: 'SKU',           width: 110 },
  { key: 'barcode',       label: 'Código barras', width: 140 },
  { key: 'category',      label: 'Categoria',     width: 130 },
  { key: 'salePrice',     label: 'Preço venda',   width: 120, format: (v) => typeof v === 'number' ? formatCurrency(v) : '' },
  { key: 'costPrice',     label: 'Preço custo',   width: 120, format: (v) => typeof v === 'number' ? formatCurrency(v) : '' },
  {
    key: 'margin',
    label: 'Margem',
    width: 90,
    format: (_v, doc) => doc.salePrice > 0
      ? `${(((doc.salePrice - doc.costPrice) / doc.salePrice) * 100).toFixed(1)}%`
      : '0,0%',
  },
  { key: 'currentStock',  label: 'Estoque atual', width: 110 },
  { key: 'minStock',      label: 'Estoque min',   width: 110 },
  { key: 'unit',          label: 'Un.',           width: 60 },
  { key: 'purchaseUnit',  label: 'Un. compra',    width: 90, format: (v, doc) => String(v || doc.unit || '') },
  { key: 'variants',      label: 'Variações',     width: 80, format: (v) => Array.isArray(v) ? String(v.length) : '0' },
  { key: 'images',        label: 'Imagens',       width: 75, format: (v, doc) => Array.isArray(v) ? String(v.length) : (doc.imageUrl ? '1' : '0') },
  { key: 'isActive',      label: 'Ativo',         width: 70,  format: (v) => v === undefined || v === null ? '' : (v === false ? 'Não' : 'Sim') },
  { key: 'updatedAt',     label: 'Atualizado',    width: 160, format: (v) => typeof v === 'string' ? formatDateTime(v) : '' },
];

const TRANSACTION_COLUMNS: ColumnSpec<Transaction>[] = [
  { key: 'description', label: 'Descrição',     width: 260 },
  { key: 'type',        label: 'Tipo',           width: 90,  format: (v) => v === 'receita' ? 'Receita' : 'Despesa' },
  { key: 'amount',      label: 'Valor',          width: 120, format: (v) => typeof v === 'number' ? formatCurrency(v) : '' },
  { key: 'status',      label: 'Status',         width: 100 },
  { key: 'category',    label: 'Categoria',      width: 140 },
  { key: 'dueDate',     label: 'Vencimento',     width: 110, format: (v) => typeof v === 'string' ? formatDate(v) : '' },
  { key: 'paymentDate', label: 'Pagamento',      width: 110, format: (v) => typeof v === 'string' ? formatDate(v) : '' },
  { key: 'paymentMethod', label: 'Forma pgto',   width: 110 },
  { key: 'createdAt',   label: 'Criado',         width: 160, format: (v) => typeof v === 'string' ? formatDateTime(v) : '' },
];

const SCHEMA_BY_COLLECTION: Record<SpreadsheetSourceCollection, ColumnSpec<unknown>[]> = {
  clients:      CLIENT_COLUMNS as ColumnSpec<unknown>[],
  products:     PRODUCT_COLUMNS as ColumnSpec<unknown>[],
  transactions: TRANSACTION_COLUMNS as ColumnSpec<unknown>[],
};

const COLLECTION_LABEL: Record<SpreadsheetSourceCollection, string> = {
  clients:      'Clientes',
  products:     'Produtos',
  transactions: 'Transações',
};

// ─── Transformação ──────────────────────────────────────────────────────────

/** Lê o valor de um campo. Suporta paths simples (ex: 'name') e aninhados
 *  (ex: 'endereco.cidade'), embora as cols default não usem paths aninhados
 *  ainda. */
function readField(doc: Record<string, unknown>, key: string): unknown {
  if (!key.includes('.')) return doc[key];
  let cur: unknown = doc;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Converte um valor cru pro shape esperado por uma célula do Univer.
 *  Strings/numbers viram primitivo; resto vai como string (cobre dates/bool). */
function toCellValue(raw: unknown): string | number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'boolean') return raw ? 'Sim' : 'Não';
  // Arrays, objetos, etc. — cair pra JSON pra evitar [object Object] visível
  try { return JSON.stringify(raw); } catch { return String(raw); }
}

/** Schema público — usado pela UI pra montar selector de colunas. */
export function getSchemaFor(collection: SpreadsheetSourceCollection): { key: string; label: string; width?: number }[] {
  return SCHEMA_BY_COLLECTION[collection].map(c => ({ key: c.key, label: c.label, width: c.width }));
}

export function getCollectionLabel(collection: SpreadsheetSourceCollection): string {
  return COLLECTION_LABEL[collection];
}

/** Constrói o IWorkbookData (shape do Univer) a partir de uma lista de
 *  docs + config de colunas. Header sempre na linha 0; dados a partir da 1. */
export function buildWorkbookFromCollection({
  collection,
  docs,
  columns,
  workbookName,
}: {
  collection: SpreadsheetSourceCollection;
  docs: Array<Record<string, unknown> & { id: string }>;
  /** Subset das colunas a exibir. Vazio/undefined = todas as default. */
  columns?: string[];
  workbookName?: string;
}): Record<string, unknown> {
  const schema = SCHEMA_BY_COLLECTION[collection];
  const selectedSchema = columns && columns.length > 0
    ? schema.filter(c => columns.includes(c.key))
    : schema;

  // Univer cell shape: { v: string | number, t?: CellType }. Pra MVP só `v`.
  const cellData: Record<number, Record<number, { v: string | number | null }>> = {};

  // Header (linha 0).
  const headerRow: Record<number, { v: string | number | null }> = {};
  selectedSchema.forEach((col, idx) => {
    headerRow[idx] = { v: col.label };
  });
  cellData[0] = headerRow;

  // Linhas de dados (a partir da 1).
  docs.forEach((doc, rowIdx) => {
    const row: Record<number, { v: string | number | null }> = {};
    selectedSchema.forEach((col, colIdx) => {
      const raw = readField(doc, col.key);
      const formatted = col.format ? col.format(raw, doc as never) : raw;
      row[colIdx] = { v: toCellValue(formatted) };
    });
    cellData[rowIdx + 1] = row;
  });

  // Column widths.
  const columnData: Record<number, { w?: number }> = {};
  selectedSchema.forEach((col, idx) => {
    if (col.width) columnData[idx] = { w: col.width };
  });

  const sheetId = 'view-sheet';
  const sheetName = workbookName || COLLECTION_LABEL[collection];

  return {
    id: `view-${collection}`,
    name: sheetName,
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: sheetName,
        rowCount: Math.max(docs.length + 50, 100), // espaço pra crescimento + scroll
        columnCount: Math.max(selectedSchema.length + 5, 26),
        cellData,
        columnData,
        // Linha 0 (header) congelada — Univer usa freeze.
        freeze: { startRow: 1, startColumn: 0, ySplit: 1, xSplit: 0 },
      },
    },
  };
}
