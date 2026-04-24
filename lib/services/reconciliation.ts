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
 * Parse CSV bank statement. Auto-detects delimiter (;, , or \t).
 * Expects columns: date, description, amount (or value/valor).
 * Supports Brazilian formats (DD/MM/YYYY, comma decimal separator).
 */
export function parseCSV(content: string): BankStatementEntry[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';

  const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/"/g, ''));

  // Find column indices
  const dateIdx = headers.findIndex(h => /^(data|date|dt)$/i.test(h));
  const descIdx = headers.findIndex(h => /^(descri|desc|memo|hist|lancamento|observa)/i.test(h));
  const amountIdx = headers.findIndex(h => /^(valor|amount|value|vlr|quantia)/i.test(h));
  const balanceIdx = headers.findIndex(h => /^(saldo|balance|bal)/i.test(h));

  if (dateIdx === -1 || amountIdx === -1) return [];

  const entries: BankStatementEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
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
 * Auto-match statement entries against existing transactions.
 * Matching criteria (scored):
 *   - Amount exact match: +50
 *   - Date within ±3 days: +30
 *   - Description similarity: +20
 */
export function autoMatch(
  entries: BankStatementEntry[],
  transactions: Transaction[],
): MatchResult[] {
  const results: MatchResult[] = [];
  const usedTxIds = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let bestMatch: { txId: string; score: number } | null = null;

    for (const tx of transactions) {
      if (usedTxIds.has(tx.id)) continue;

      let score = 0;

      // Amount match (exact or within 1 cent)
      const txAmount = tx.type === 'despesa' ? -tx.amount : tx.amount;
      if (Math.abs(entry.amount - txAmount) < 0.02) {
        score += 50;
      } else if (Math.abs(Math.abs(entry.amount) - tx.amount) < 0.02) {
        score += 40; // absolute match
      } else {
        continue; // skip if amount doesn't match at all
      }

      // Date proximity (±3 days)
      const txDate = tx.paymentDate || tx.dueDate;
      if (txDate) {
        const entryDate = new Date(entry.date + 'T00:00:00');
        const transDate = new Date(txDate + 'T00:00:00');
        const daysDiff = Math.abs(entryDate.getTime() - transDate.getTime()) / (24 * 60 * 60 * 1000);
        if (daysDiff === 0) score += 30;
        else if (daysDiff <= 1) score += 25;
        else if (daysDiff <= 3) score += 15;
        else if (daysDiff <= 7) score += 5;
      }

      // Description similarity (simple word overlap)
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
