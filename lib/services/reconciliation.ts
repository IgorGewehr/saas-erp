/**
 * Bank reconciliation service — parse statements and auto-match with transactions.
 */

import type { BankStatementEntry, Transaction } from '@/lib/types';

// ── OFX Parser ──────────────────────────────────────────────────────────────

/**
 * Parse OFX (Open Financial Exchange) file content.
 * Supports basic OFX 1.x (SGML) format used by Brazilian banks.
 */
export function parseOFX(content: string): BankStatementEntry[] {
  const entries: BankStatementEntry[] = [];
  // Match each <STMTTRN>...</STMTTRN> block
  const txRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;

  while ((match = txRegex.exec(content)) !== null) {
    const block = match[1];
    const tag = (name: string): string => {
      const m = block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, 'i'));
      return m ? m[1].trim() : '';
    };

    const dtPosted = tag('DTPOSTED'); // YYYYMMDDHHmmss or YYYYMMDD
    const amount = parseFloat(tag('TRNAMT')) || 0;
    const memo = tag('MEMO') || tag('NAME') || '';
    const refNum = tag('FITID') || tag('REFNUM') || '';

    if (!dtPosted) continue;

    const year = dtPosted.slice(0, 4);
    const month = dtPosted.slice(4, 6);
    const day = dtPosted.slice(6, 8);
    const date = `${year}-${month}-${day}`;

    entries.push({
      date,
      description: memo,
      amount,
      reference: refNum,
    });
  }

  return entries;
}

// ── CSV Parser ──────────────────────────────────────────────────────────────

/**
 * Split a CSV line respecting quoted fields.
 * e.g. `"Supplier, Inc.";100` → ["Supplier, Inc.", "100"]
 */
function splitCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } // escaped quote
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse CSV bank statement. Auto-detects delimiter (;, , or \t).
 * Expects columns: date, description, amount (or value/valor).
 * Supports Brazilian formats (DD/MM/YYYY, comma decimal separator).
 */
export function parseCSV(rawContent: string): BankStatementEntry[] {
  // Strip BOM (UTF-8 BOM: \uFEFF)
  const content = rawContent.replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter (from header line, ignoring quoted sections)
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';

  const headers = splitCSVLine(lines[0], delimiter).map(h => h.trim().toLowerCase().replace(/"/g, ''));

  // Find column indices
  const dateIdx = headers.findIndex(h => /^(data|date|dt)$/i.test(h));
  const descIdx = headers.findIndex(h => /^(descri|desc|memo|hist|lancamento|observa)/i.test(h));
  const amountIdx = headers.findIndex(h => /^(valor|amount|value|vlr|quantia)/i.test(h));
  const balanceIdx = headers.findIndex(h => /^(saldo|balance|bal)/i.test(h));

  if (dateIdx === -1 || amountIdx === -1) return [];

  const entries: BankStatementEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length <= Math.max(dateIdx, amountIdx)) continue;

    const rawDate = cols[dateIdx];
    const rawAmount = cols[amountIdx];
    const description = descIdx >= 0 ? cols[descIdx] : '';

    // Parse date (DD/MM/YYYY or YYYY-MM-DD)
    let date: string;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
      const [d, m, y] = rawDate.split('/');
      date = `${y}-${m}-${d}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate;
    } else {
      continue;
    }

    // Parse amount (handle Brazilian format: 1.234,56 → 1234.56)
    const cleanAmount = rawAmount
      .replace(/\s/g, '')
      .replace(/\./g, '')    // remove thousand separator
      .replace(',', '.');    // decimal comma → dot
    const amount = parseFloat(cleanAmount);
    if (isNaN(amount)) continue;

    const balance = balanceIdx >= 0 ? parseFloat(
      cols[balanceIdx].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
    ) : undefined;

    entries.push({ date, description, amount, balance: isNaN(balance as number) ? undefined : balance });
  }

  return entries;
}

// ── Auto-matching Engine ────────────────────────────────────────────────────

interface MatchResult {
  statementIdx: number;
  transactionId: string;
  confidence: number;   // 0-100
}

/**
 * Valor líquido (netAmount) gravado pelo webhook do Mercado Pago na liquidação
 * (receita/pedido) — o extrato do MP credita o líquido (bruto − taxa), então o
 * `amount` bruto da Transaction não bate. O campo é opcional e não faz parte do
 * contrato base de Transaction; lido defensivamente só onde presente.
 */
type SettledTransaction = Transaction & { netAmount?: number };

/** Retorna o líquido (netAmount) da transação quando presente e válido. */
function getNetAmount(tx: Transaction): number | undefined {
  const net = (tx as SettledTransaction).netAmount;
  return typeof net === 'number' && net > 0 ? net : undefined;
}

export interface AutoMatchConfig {
  /** Max R$ difference to still consider an amount match. Default: 0.01 */
  amountTolerance?: number;
  /** Max days difference for date match. Default: 3 */
  dateTolerance?: number;
}

/**
 * Auto-match statement entries against existing transactions.
 * Matching criteria (scored):
 *   - Amount within tolerance: +50 (exact) or +40 (absolute)
 *   - Date within dateTolerance: up to +30
 *   - Description word overlap: up to +20
 *
 * FIN-DEL-06: recebíveis de cartão/PIX do Mercado Pago são creditados no extrato
 * pelo valor LÍQUIDO (bruto − taxa). Quando a transação carrega `netAmount`
 * (gravado pelo webhook na liquidação), o líquido é conferido primeiro; o bruto
 * (`amount`) permanece como fallback pros demais meios (dinheiro, transferência,
 * boleto), preservando a conciliação existente.
 */
export function autoMatch(
  entries: BankStatementEntry[],
  transactions: Transaction[],
  config: AutoMatchConfig = {},
): MatchResult[] {
  const { amountTolerance = 0.01, dateTolerance = 3 } = config;
  const results: MatchResult[] = [];
  const usedTxIds = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let bestMatch: { txId: string; score: number } | null = null;

    for (const tx of transactions) {
      if (usedTxIds.has(tx.id)) continue;

      let score = 0;

      // Amount match within configurable tolerance.
      // Confere o LÍQUIDO (netAmount) primeiro quando presente — o extrato do MP
      // credita já descontada a taxa. Cai pro BRUTO (amount) como fallback, o que
      // cobre os demais meios (sem netAmount) sem alterar seu comportamento.
      const sign = tx.type === 'despesa' ? -1 : 1;
      const txNet = getNetAmount(tx);
      let amountScore = 0;
      if (txNet !== undefined) {
        if (Math.abs(entry.amount - sign * txNet) <= amountTolerance) {
          amountScore = 50;
        } else if (Math.abs(Math.abs(entry.amount) - txNet) <= amountTolerance) {
          amountScore = 40; // absolute match (sign agnostic)
        }
      }
      if (amountScore === 0) {
        const txAmount = sign * tx.amount;
        if (Math.abs(entry.amount - txAmount) <= amountTolerance) {
          amountScore = 50;
        } else if (Math.abs(Math.abs(entry.amount) - tx.amount) <= amountTolerance) {
          amountScore = 40; // absolute match (sign agnostic)
        }
      }
      if (amountScore === 0) {
        continue; // skip — amount too far off (nem líquido nem bruto batem)
      }
      score += amountScore;

      // Date proximity within configurable tolerance
      const txDate = tx.paymentDate || tx.dueDate;
      if (txDate) {
        const daysDiff = Math.abs(
          new Date(entry.date + 'T00:00:00').getTime() -
          new Date(txDate + 'T00:00:00').getTime()
        ) / 86400000;
        if (daysDiff === 0) score += 30;
        else if (daysDiff <= 1) score += 25;
        else if (daysDiff <= dateTolerance) score += 15;
        else if (daysDiff <= dateTolerance * 2) score += 5;
      }

      // Description similarity (word overlap)
      if (entry.description && tx.description) {
        const entryWords = new Set(entry.description.toLowerCase().split(/\s+/));
        const txWords = tx.description.toLowerCase().split(/\s+/);
        const overlap = txWords.filter(w => w.length > 2 && entryWords.has(w)).length;
        if (overlap > 0) score += Math.min(20, overlap * 7);
      }

      if (score > (bestMatch?.score || 0)) {
        bestMatch = { txId: tx.id, score };
      }
    }

    if (bestMatch && bestMatch.score >= 50) {
      results.push({
        statementIdx: i,
        transactionId: bestMatch.txId,
        confidence: Math.min(100, bestMatch.score),
      });
      usedTxIds.add(bestMatch.txId);
    }
  }

  return results;
}
