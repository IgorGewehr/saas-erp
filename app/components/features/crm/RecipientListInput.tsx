'use client';

/**
 * RecipientListInput — input universal para listas de disparo em massa.
 *
 * Aceita:
 *  - Texto colado (1 por linha, vírgula ou ponto-e-vírgula)
 *  - Upload CSV com header (nome, telefone OU email)
 *
 * Valida E.164 brasileiro (ou DDI internacional) para telefones,
 * regex razoável para email. Faz dedup automático e mostra erros.
 *
 * Uso:
 *   <RecipientListInput
 *     mode="phone" | "email"
 *     onChange={(recipients, stats) => ...}
 *     existingClients={clients}  // opcional, faz auto-link com CRM
 *   />
 */

import { useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, ClipboardPaste, AlertTriangle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BroadcastRecipient, Client } from '@/lib/types';

interface ParsedLine {
  raw: string;
  name?: string;
  phoneNumber?: string;
  email?: string;
  error?: string;
}

interface ListStats {
  valid: number;
  invalid: number;
  duplicates: number;
  linkedToCrm: number;
}

// Regex razoavelmente estrito — exige TLD com 2+ chars alfabéticos
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** Normaliza telefone para E.164 (apenas dígitos, sem +). Retorna null se inválido. */
function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Caso BR com 0 no DDD (ex: 011 99999-8888 → 11999998888)
  if (digits.length === 12 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  // Brasileiro sem DDI (10 ou 11 dígitos): adiciona 55
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  // E.164 válido: [1-9] inicial (sem 0), entre 8 e 15 dígitos no total
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

/** Divide uma linha CSV respeitando aspas — aceita células com vírgula dentro. */
function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Aspas escapadas: "" dentro de campo entre aspas vira "
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/** Parse CSV — aceita vírgula ou ponto-e-vírgula, primeira linha como header opcional. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // Remove BOM se presente (arquivos Excel UTF-8)
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const sep = lines[0].includes(';') ? ';' : ',';
  const first = parseCsvLine(lines[0], sep);
  // Detecta se primeira linha é header
  const looksLikeHeader = first.some(c =>
    /^(nome|name|telefone|phone|email|e-?mail|whatsapp|celular)$/i.test(c)
  );
  if (looksLikeHeader) {
    return {
      headers: first.map(h => h.toLowerCase()),
      rows: lines.slice(1).map(l => parseCsvLine(l, sep)),
    };
  }
  return { headers: [], rows: lines.map(l => parseCsvLine(l, sep)) };
}

interface Props {
  mode: 'phone' | 'email';
  onChange: (recipients: BroadcastRecipient[], stats: ListStats) => void;
  existingClients?: Client[];
  className?: string;
}

export default function RecipientListInput({ mode, onChange, existingClients, className }: Props) {
  const [activeTab, setActiveTab] = useState<'paste' | 'csv'>('paste');
  const [textValue, setTextValue] = useState('');
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const indexOfErrors = useMemo(() => parsedLines.filter(l => l.error), [parsedLines]);

  /** Aplica dedup, valida e produz array de BroadcastRecipient + stats. */
  const buildRecipients = useCallback(
    (lines: ParsedLine[]): { recipients: BroadcastRecipient[]; stats: ListStats } => {
      const seen = new Set<string>();
      let duplicates = 0;
      let linkedToCrm = 0;
      const recipients: BroadcastRecipient[] = [];

      for (const line of lines) {
        if (line.error) continue;
        const rawKey = mode === 'phone' ? line.phoneNumber : line.email;
        if (!rawKey) continue;
        // Email é case-insensitive; phone já vem normalizado
        const key = mode === 'email' ? rawKey.toLowerCase() : rawKey;
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key);

        // Auto-link com CRM
        let contactId: string | undefined;
        let inferredName: string | undefined = line.name;
        if (existingClients?.length) {
          const matched = existingClients.find(c => {
            if (mode === 'phone') {
              const phoneDigits = (s?: string) => (s || '').replace(/\D/g, '');
              const target = key;
              return phoneDigits(c.phone).endsWith(target.slice(-10))
                || phoneDigits(c.whatsapp).endsWith(target.slice(-10));
            }
            return c.email?.toLowerCase() === key.toLowerCase();
          });
          if (matched) {
            contactId = matched.id;
            linkedToCrm++;
            if (!inferredName) inferredName = matched.name;
          }
        }

        recipients.push({
          contactId,
          name: inferredName,
          ...(mode === 'phone' ? { phoneNumber: line.phoneNumber } : { email: line.email }),
        });
      }

      return {
        recipients,
        stats: {
          valid: recipients.length,
          invalid: lines.filter(l => l.error).length,
          duplicates,
          linkedToCrm,
        },
      };
    },
    [mode, existingClients]
  );

  /** Notifica parent quando linhas mudam. */
  const updateAndNotify = useCallback(
    (lines: ParsedLine[]) => {
      setParsedLines(lines);
      const { recipients, stats } = buildRecipients(lines);
      onChange(recipients, stats);
    },
    [buildRecipients, onChange]
  );

  /** Parse texto colado: 1 por linha, ou separado por vírgula/ponto-vírgula. */
  const handleTextChange = useCallback(
    (raw: string) => {
      setTextValue(raw);
      // Quebra por linha, vírgula ou ponto-vírgula
      const tokens = raw
        .split(/[\n,;]/)
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const lines: ParsedLine[] = tokens.map(token => {
        if (mode === 'phone') {
          const phone = normalizePhone(token);
          if (!phone) return { raw: token, error: 'Telefone inválido' };
          return { raw: token, phoneNumber: phone };
        } else {
          const trimmed = token.trim();
          if (!EMAIL_RE.test(trimmed)) return { raw: token, error: 'Email inválido' };
          return { raw: token, email: trimmed };
        }
      });
      updateAndNotify(lines);
    },
    [mode, updateAndNotify]
  );

  /** Parse arquivo CSV. */
  const handleFile = useCallback(
    async (file: File) => {
      setCsvFileName(file.name);
      const text = await file.text();
      const { headers, rows } = parseCsv(text);

      // Detecta colunas relevantes
      const nameIdx = headers.findIndex(h => /^(nome|name)$/.test(h));
      const phoneIdx = headers.findIndex(h => /^(telefone|phone|whatsapp)$/.test(h));
      const emailIdx = headers.findIndex(h => /^(email|e-?mail)$/.test(h));

      const lines: ParsedLine[] = rows.map(cells => {
        const name = nameIdx >= 0 ? cells[nameIdx] : (cells.length > 1 ? cells[0] : undefined);
        if (mode === 'phone') {
          const rawPhone = phoneIdx >= 0 ? cells[phoneIdx] : cells[cells.length === 1 ? 0 : 1];
          if (!rawPhone) return { raw: cells.join(','), error: 'Telefone vazio' };
          const phone = normalizePhone(rawPhone);
          if (!phone) return { raw: rawPhone, error: 'Telefone inválido' };
          return { raw: rawPhone, name: name && name !== rawPhone ? name : undefined, phoneNumber: phone };
        } else {
          const rawEmail = emailIdx >= 0 ? cells[emailIdx] : cells[cells.length === 1 ? 0 : 1];
          if (!rawEmail) return { raw: cells.join(','), error: 'Email vazio' };
          if (!EMAIL_RE.test(rawEmail.trim())) return { raw: rawEmail, error: 'Email inválido' };
          return { raw: rawEmail, name: name && name !== rawEmail ? name : undefined, email: rawEmail.trim() };
        }
      });
      updateAndNotify(lines);
    },
    [mode, updateAndNotify]
  );

  const stats = useMemo(() => buildRecipients(parsedLines).stats, [parsedLines, buildRecipients]);

  const reset = () => {
    setTextValue('');
    setCsvFileName(null);
    setParsedLines([]);
    onChange([], { valid: 0, invalid: 0, duplicates: 0, linkedToCrm: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const placeholder = mode === 'phone'
    ? '11999999999\n21988887777\nou cole separado por vírgula'
    : 'cliente@example.com\noutro@example.com';

  return (
    <div className={cn('space-y-2', className)}>
      {/* Tab selector */}
      <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-white/[0.04] rounded-lg">
        <button type="button" onClick={() => setActiveTab('paste')}
          className={cn('flex-1 flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded-md font-semibold transition-colors',
            activeTab === 'paste' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
          <ClipboardPaste className="w-3 h-3" />
          Colar lista
        </button>
        <button type="button" onClick={() => setActiveTab('csv')}
          className={cn('flex-1 flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded-md font-semibold transition-colors',
            activeTab === 'csv' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
          <Upload className="w-3 h-3" />
          Upload CSV
        </button>
      </div>

      {activeTab === 'paste' ? (
        <textarea
          value={textValue}
          onChange={e => handleTextChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 resize-none font-mono"
        />
      ) : (
        <div>
          {csvFileName ? (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 min-w-0">
                <Upload className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{csvFileName}</span>
              </div>
              <button type="button" onClick={reset} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-red-400 dark:hover:border-red-500/50 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              <Upload className="w-5 h-5" />
              <span className="text-xs">Clique para selecionar CSV</span>
              <span className="text-[10px] text-gray-400">
                {mode === 'phone' ? 'Coluna: nome, telefone' : 'Coluna: nome, email'}
              </span>
            </button>
          )}
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {/* Stats */}
      {parsedLines.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap text-[10px]">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold">
            <Check className="w-2.5 h-2.5" /> {stats.valid} válidos
          </span>
          {stats.invalid > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-semibold">
              <AlertTriangle className="w-2.5 h-2.5" /> {stats.invalid} inválidos
            </span>
          )}
          {stats.duplicates > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold">
              {stats.duplicates} duplicados
            </span>
          )}
          {stats.linkedToCrm > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
              {stats.linkedToCrm} vinculados ao CRM
            </span>
          )}
        </div>
      )}

      {/* Error preview */}
      <AnimatePresence>
        {indexOfErrors.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
            <p className="text-[10px] font-semibold text-red-700 dark:text-red-400 mb-1">
              {indexOfErrors.length} {indexOfErrors.length === 1 ? 'entrada inválida' : 'entradas inválidas'}:
            </p>
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {indexOfErrors.slice(0, 10).map((l, i) => (
                <div key={i} className="text-[10px] text-red-600 dark:text-red-400 font-mono truncate">
                  &quot;{l.raw}&quot; — {l.error}
                </div>
              ))}
              {indexOfErrors.length > 10 && (
                <div className="text-[10px] text-red-500 italic">…e mais {indexOfErrors.length - 10}</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
