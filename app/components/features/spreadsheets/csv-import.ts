'use client';

/**
 * Helpers de importação de CSV → IWorkbookData (snapshot Univer).
 *
 * Decisões:
 *  - Parsing via papaparse (já no bundle do projeto). Auto-detecta delimitador
 *    (vírgula / ponto-vírgula / tab) e trata aspas/escapes corretamente.
 *  - Linhas viram array-of-arrays; primeira linha não é tratada especialmente
 *    (header opcional do user — o Univer não distingue). Quando vier de CSV
 *    com header, fica visível como linha 1 da planilha.
 *  - Cell value: tenta number coercion (rendimentos como `1234.56` viram
 *    number; rendimentos com R$/separadores ficam string).
 *  - Limites: MAX_ROWS protege contra arquivos absurdos (Firestore doc tem
 *    teto ~1MB no snapshot serializado).
 */

import Papa from 'papaparse';

const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

export interface CsvImportResult {
  workbook: Record<string, unknown>;
  rowCount: number;
  colCount: number;
  truncated: boolean;
}

export interface CsvImportError {
  code: 'too_large' | 'parse_failed' | 'empty';
  message: string;
}

/** Tenta converter string pra number quando "limpa" (sem letras/símbolos).
 *  Aceita ponto e vírgula como decimal — `1.234,56` vira 1234.56. */
function tryNumber(s: string): number | string {
  const trimmed = s.trim();
  if (!trimmed) return s;
  // Detect formato BR (1.234,56) vs US (1,234.56). Heurística simples:
  // se tem vírgula e ponto, o último decide; se só tem vírgula, BR.
  let normalized = trimmed;
  if (/^-?[\d.,]+$/.test(trimmed)) {
    const lastComma = trimmed.lastIndexOf(',');
    const lastDot = trimmed.lastIndexOf('.');
    if (lastComma > lastDot) {
      // BR: 1.234,56 → remover . (milhares), substituir , por .
      normalized = trimmed.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      // US: 1,234.56 → remover , (milhares)
      normalized = trimmed.replace(/,/g, '');
    }
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

/** Lê um File como texto (UTF-8). Papaparse aceita File direto, mas usar
 *  text() permite controlar encoding e tamanho antes do parse. */
async function readFileAsText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // Decode UTF-8 com fallback. BOM ﻿ é comum em CSVs salvos do Excel —
  // strip pra não virar lixo na primeira célula.
  const decoder = new TextDecoder('utf-8');
  let text = decoder.decode(buf);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text;
}

/** Parse CSV → array de arrays de strings. Papaparse synchronous mode com
 *  `skipEmptyLines: true` pra ignorar linhas em branco no fim. */
function parseCsv(text: string): string[][] {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
  });
  if (result.errors && result.errors.length > 0) {
    // Erros de parse podem ser não-fatais (linha mal formada). Logamos pra
    // diagnóstico mas só lançamos se ZERO linhas saíram.
    console.warn('[csv-import] parse warnings:', result.errors);
  }
  return result.data;
}

/** Constrói IWorkbookData (shape Univer) a partir de array-of-arrays. */
function buildWorkbookFromRows(rows: string[][], sheetName: string): {
  workbook: Record<string, unknown>;
  rowCount: number;
  colCount: number;
} {
  const cellData: Record<number, Record<number, { v: string | number | null }>> = {};
  let maxCol = 0;
  rows.forEach((row, rIdx) => {
    const cells: Record<number, { v: string | number | null }> = {};
    row.forEach((cell, cIdx) => {
      cells[cIdx] = { v: tryNumber(cell) as string | number };
      if (cIdx > maxCol) maxCol = cIdx;
    });
    cellData[rIdx] = cells;
  });

  const colCount = maxCol + 1;
  const rowCount = rows.length;

  const sheetId = 'imported-sheet';

  return {
    workbook: {
      id: `import-${Date.now()}`,
      name: sheetName,
      sheetOrder: [sheetId],
      sheets: {
        [sheetId]: {
          id: sheetId,
          name: sheetName,
          // Espaço extra pra user crescer a planilha; cap mínimo pra UX (Univer
          // sem rowCount mostra área visual mínima).
          rowCount: Math.max(rowCount + 50, 100),
          columnCount: Math.max(colCount + 5, 26),
          cellData,
        },
      },
    },
    rowCount,
    colCount,
  };
}

/** Pipeline principal: File → IWorkbookData pronto pra criar Spreadsheet
 *  no Firestore. Validações e tradução de erros pro user.
 *
 *  Retorna resultado OU erro estruturado (não throw — facilita UX). */
export async function importCsvToWorkbook(
  file: File,
  sheetName: string,
): Promise<{ ok: true; data: CsvImportResult } | { ok: false; error: CsvImportError }> {
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: {
        code: 'too_large',
        message: `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Limite: ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
      },
    };
  }

  let text: string;
  try {
    text = await readFileAsText(file);
  } catch {
    return { ok: false, error: { code: 'parse_failed', message: 'Não foi possível ler o arquivo.' } };
  }

  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (e) {
    return {
      ok: false,
      error: { code: 'parse_failed', message: e instanceof Error ? e.message : 'Falha no parse do CSV.' },
    };
  }

  if (rows.length === 0) {
    return { ok: false, error: { code: 'empty', message: 'CSV vazio ou sem dados.' } };
  }

  // Cap de linhas — protege contra arquivos absurdos. Trunca silenciosamente
  // mas avisa via flag pra UI mostrar toast informativo.
  let truncated = false;
  if (rows.length > MAX_ROWS) {
    rows = rows.slice(0, MAX_ROWS);
    truncated = true;
  }

  const { workbook, rowCount, colCount } = buildWorkbookFromRows(rows, sheetName);

  return { ok: true, data: { workbook, rowCount, colCount, truncated } };
}

/** Helper UI: extrai nome de planilha do nome do arquivo (sem extensão,
 *  truncado pra caber bem em UI). */
export function suggestSheetNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^/.]+$/, '').trim();
  return base.length > 60 ? base.slice(0, 57) + '...' : base || 'Planilha importada';
}
