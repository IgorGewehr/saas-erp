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
import { Upload, ClipboardPaste, AlertTriangle, Check, X, ChevronDown, Link as LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BroadcastRecipient, Client } from '@/lib/types';

interface ParsedLine {
  raw: string;
  name?: string;
  phoneNumber?: string;
  email?: string;
  error?: string;
  /** Colunas extras do CSV preservadas para uso em template params (5.8). */
  customColumns?: Record<string, string>;
}

interface ListStats {
  valid: number;
  invalid: number;
  duplicates: number;
  linkedToCrm: number;
  /** Nomes das colunas extras detectadas no CSV (ordenadas como aparecem). */
  csvColumns: string[];
}

/** Headers reservados — não viram csvColumn extra. */
const RESERVED_HEADERS = new Set(['nome', 'name', 'telefone', 'phone', 'whatsapp', 'celular', 'email', 'e-mail']);

// Regex razoavelmente estrito — exige TLD com 2+ chars alfabéticos
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** Normaliza telefone para E.164 (apenas dígitos, sem +). Retorna null se inválido.
 *
 * Aceita formatação livre (espaços, traços, parênteses, "+", pontos): tudo
 * é stripado antes da validação. Ex:
 *   "(54) 9678-5446"     → "545496785446" → "555496785446" (BR + DDI 55)
 *   "+55 11 99999-9999"  → "5511999999999"
 *   "011 99999-8888"     → "5511999998888" (drop 0 do DDD)
 *
 * Rejeita CNPJ (14 dígitos colados por engano) e CPF colado como número
 * (11 dígitos onde o "celular" não começa com 9 — regra ANATEL pós-2013).
 */
function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Rejeita 14+ dígitos preventivamente — CNPJ tem 14, e phone E.164 com 14+
  // dígitos é extremamente raro (a regra técnica permite até 15, mas na
  // prática nenhum país comum chega lá). Catch principal pro caso reportado:
  // CNPJ "91155234000244" passava antes pela validação genérica E.164.
  if (digits.length > 13) return null;
  if (digits.length < 8) return null;
  // Caso BR com 0 no DDD (ex: 011 99999-8888 → 11999998888)
  if (digits.length === 12 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  // Brasileiro sem DDI (10 ou 11 dígitos): adiciona 55
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  // BR (DDI 55): aceita só 12 (fixo: 55 + DDD + 8) ou 13 (celular: 55 + DDD + 9 + 8)
  if (digits.startsWith('55')) {
    if (digits.length !== 12 && digits.length !== 13) return null;
    // DDD válido: 11-99 (índices 2-3)
    const ddd = parseInt(digits.slice(2, 4), 10);
    if (!Number.isFinite(ddd) || ddd < 11 || ddd > 99) return null;
    // Celular BR pós-2013: 5º dígito (após 55 + DDD) deve ser 9. Catch
    // adicional pra CPFs colados (11 dígitos onde o "celular" não começa
    // com 9). Fixo de 12 dígitos não tem essa regra.
    if (digits.length === 13 && digits[4] !== '9') return null;
    return digits;
  }
  // Internacional E.164: começa com 1-9 (sem 0), 8-13 dígitos. Aceita os
  // formatos comuns (US/UK/EU/etc) mas rejeita o ranges suspeitos acima.
  if (!/^[1-9]\d{7,12}$/.test(digits)) return null;
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
  const [expandedSection, setExpandedSection] = useState<'valid' | 'invalid' | 'duplicates' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Categoriza as linhas em 3 buckets para os painéis expansíveis:
   *  - validLines: passaram parse + não são duplicadas (entram no envio)
   *  - invalidLines: parse falhou (formato inválido)
   *  - duplicateLines: parse OK mas chave já vista (segunda+ ocorrência)
   * Linkagem ao CRM é feita em buildRecipients (filtro por phone/email match).
   */
  const categorizedLines = useMemo(() => {
    const valid: ParsedLine[] = [];
    const invalid: ParsedLine[] = [];
    const duplicates: ParsedLine[] = [];
    const seen = new Set<string>();
    for (const line of parsedLines) {
      if (line.error) { invalid.push(line); continue; }
      const rawKey = mode === 'phone' ? line.phoneNumber : line.email;
      if (!rawKey) { invalid.push(line); continue; }
      const key = mode === 'email' ? rawKey.toLowerCase() : rawKey;
      if (seen.has(key)) { duplicates.push(line); continue; }
      seen.add(key);
      valid.push(line);
    }
    return { valid, invalid, duplicates };
  }, [parsedLines, mode]);

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
          // 5.8: propaga colunas extras do CSV (ex: produto, desconto) para
          // permitir mapeamento em template params no backend.
          ...(line.customColumns && Object.keys(line.customColumns).length > 0
            ? { customColumns: line.customColumns }
            : {}),
        });
      }

      // Coleta TODAS as colunas extras únicas (preserva ordem de primeira aparição)
      // para o parent listar na UI de template params.
      const seenCols = new Set<string>();
      const csvColumns: string[] = [];
      for (const line of lines) {
        if (!line.customColumns) continue;
        for (const k of Object.keys(line.customColumns)) {
          if (!seenCols.has(k)) {
            seenCols.add(k);
            csvColumns.push(k);
          }
        }
      }

      return {
        recipients,
        stats: {
          valid: recipients.length,
          invalid: lines.filter(l => l.error).length,
          duplicates,
          linkedToCrm,
          csvColumns,
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

  /**
   * Heurística de extração de nome no paste mode.
   *
   * Formatos comuns aceitos:
   *   "(54) 99959-5528 - Cembranel Beauty & Barber"
   *   "54 99959-5528  Cembranel Beauty"
   *   "Cembranel Beauty: 54999595528"
   *   "5499959-5528 — Cembranel"
   *
   * Estratégia: extrai a substring que parece o phone (sequência de digits
   * com possíveis separadores parens/spaces/dashes/dots) e usa o RESTANTE
   * como nome candidato, descartando separadores ao redor.
   */
  const PHONE_SUBSTRING_RE = /(?:\+?\d[\d\s().-]{8,20}\d)/;

  const extractNameFromToken = useCallback((token: string): string | undefined => {
    // Remove a sequência de phone do token e usa o resto como nome candidato.
    // BUG corrigido: o cleanup anterior `[\s\-—,:•|]` não incluía parens/
    // brackets/dots. Quando o phone vinha entre parênteses ("(54) 99..."),
    // o phone match capturava só os dígitos+espaços+parens internos, deixando
    // o `(` aberto na ponta. Resultado: nome no Firestore vinha como
    // "(- Daia Salão" — visível em conversas/CRM.
    const phoneMatch = token.match(PHONE_SUBSTRING_RE);
    if (!phoneMatch) return undefined;
    const rest = token.replace(phoneMatch[0], '')
      // Limpa separadores comuns + parens/brackets/dots/asteriscos nas pontas
      .replace(/^[\s\-—–_,:.;•|<>(){}\[\]*]+|[\s\-—–_,:.;•|<>(){}\[\]*]+$/g, '')
      .trim();
    // Filtra ruído: nomes muito curtos (< 2 chars), só dígitos, ou só símbolos
    if (rest.length < 2) return undefined;
    if (/^\d+$/.test(rest)) return undefined;
    if (!/[a-zA-ZÀ-ú]/.test(rest)) return undefined;
    return rest.slice(0, 120); // cap de segurança
  }, []);

  const extractEmailFromToken = useCallback((token: string): { email?: string; name?: string } => {
    const match = token.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (!match) return {};
    const email = match[0];
    const rest = token.replace(email, '')
      .replace(/^[\s\-—–_,:.;•|<>(){}\[\]*]+|[\s\-—–_,:.;•|<>(){}\[\]*]+$/g, '')
      .trim();
    const name = rest.length >= 2 && /[a-zA-ZÀ-ú]/.test(rest) ? rest.slice(0, 120) : undefined;
    return { email, name };
  }, []);

  /** Parse texto colado: 1 por linha, ou separado por vírgula/ponto-vírgula. */
  const handleTextChange = useCallback(
    (raw: string) => {
      setTextValue(raw);
      // Quebra por linha ou ponto-e-vírgula. Vírgula NÃO é separador porque
      // costuma aparecer dentro de nomes ("Cembranel, Ltda" / "(54) 99-5528,
      // Loja"). Operador que quiser separar por vírgula deve trocar por
      // ponto-e-vírgula ou linha.
      const tokens = raw
        .split(/[\n;]/)
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const lines: ParsedLine[] = tokens.map(token => {
        if (mode === 'phone') {
          const phone = normalizePhone(token);
          if (!phone) return { raw: token, error: 'Telefone inválido' };
          const name = extractNameFromToken(token);
          return { raw: token, phoneNumber: phone, ...(name ? { name } : {}) };
        } else {
          // Email mode: extrai email + nome opcional do token.
          // Aceita formatos: "joao@x.com", "Joao Silva <joao@x.com>",
          // "Joao Silva - joao@x.com", "joao@x.com (Joao Silva)" etc.
          const { email, name } = extractEmailFromToken(token);
          if (!email || !EMAIL_RE.test(email)) return { raw: token, error: 'Email inválido' };
          return { raw: token, email, ...(name ? { name } : {}) };
        }
      });
      updateAndNotify(lines);
    },
    [mode, updateAndNotify, extractNameFromToken, extractEmailFromToken],
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

      // 5.8: identifica colunas extras (não-reservadas) para preservar como customColumns.
      // Headers em lowercase já foram normalizados pelo parseCsv.
      // Dedup por key — se CSV tem 2 colunas com mesmo header, mantém apenas a PRIMEIRA
      // (comportamento determinístico; último-vence causaria mapeamento misterioso).
      const extraColIdxs: { name: string; idx: number }[] = [];
      const seenKeys = new Set<string>();
      headers.forEach((h, idx) => {
        if (!h) return;
        if (RESERVED_HEADERS.has(h)) return;
        const key = h.trim().toLowerCase();
        if (!key) return;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        extraColIdxs.push({ name: key, idx });
      });

      const lines: ParsedLine[] = rows.map(cells => {
        const name = nameIdx >= 0 ? cells[nameIdx] : (cells.length > 1 ? cells[0] : undefined);
        // Coleta valores das colunas extras (string vazia → omite)
        const customColumns: Record<string, string> = {};
        for (const { name: colName, idx } of extraColIdxs) {
          const v = cells[idx];
          if (v && v.trim()) customColumns[colName] = v.trim();
        }
        const hasExtras = Object.keys(customColumns).length > 0;

        if (mode === 'phone') {
          const rawPhone = phoneIdx >= 0 ? cells[phoneIdx] : cells[cells.length === 1 ? 0 : 1];
          if (!rawPhone) return { raw: cells.join(','), error: 'Telefone vazio' };
          const phone = normalizePhone(rawPhone);
          if (!phone) return { raw: rawPhone, error: 'Telefone inválido' };
          return {
            raw: rawPhone,
            name: name && name !== rawPhone ? name : undefined,
            phoneNumber: phone,
            ...(hasExtras ? { customColumns } : {}),
          };
        } else {
          const rawEmail = emailIdx >= 0 ? cells[emailIdx] : cells[cells.length === 1 ? 0 : 1];
          if (!rawEmail) return { raw: cells.join(','), error: 'Email vazio' };
          if (!EMAIL_RE.test(rawEmail.trim())) return { raw: rawEmail, error: 'Email inválido' };
          return {
            raw: rawEmail,
            name: name && name !== rawEmail ? name : undefined,
            email: rawEmail.trim(),
            ...(hasExtras ? { customColumns } : {}),
          };
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
    setExpandedSection(null);
    onChange([], { valid: 0, invalid: 0, duplicates: 0, linkedToCrm: 0, csvColumns: [] });
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

      {/* Stats — badges clicáveis: click expande painel com a lista */}
      {parsedLines.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-[10px]">
          <BadgeButton
            active={expandedSection === 'valid'}
            onClick={() => setExpandedSection(s => s === 'valid' ? null : 'valid')}
            count={stats.valid}
            label="válidos"
            tone="emerald"
            icon={<Check className="w-2.5 h-2.5" />}
          />
          {stats.invalid > 0 && (
            <BadgeButton
              active={expandedSection === 'invalid'}
              onClick={() => setExpandedSection(s => s === 'invalid' ? null : 'invalid')}
              count={stats.invalid}
              label="inválidos"
              tone="red"
              icon={<AlertTriangle className="w-2.5 h-2.5" />}
            />
          )}
          {stats.duplicates > 0 && (
            <BadgeButton
              active={expandedSection === 'duplicates'}
              onClick={() => setExpandedSection(s => s === 'duplicates' ? null : 'duplicates')}
              count={stats.duplicates}
              label="duplicados"
              tone="amber"
            />
          )}
          {stats.linkedToCrm > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
              <LinkIcon className="w-2.5 h-2.5" /> {stats.linkedToCrm} vinculados ao CRM
            </span>
          )}
          {stats.csvColumns.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 font-semibold" title={stats.csvColumns.join(', ')}>
              {stats.csvColumns.length} {stats.csvColumns.length === 1 ? 'coluna extra' : 'colunas extras'}
            </span>
          )}
        </div>
      )}

      {/* Painel expansível — mostra a lista da seção ativa */}
      <AnimatePresence>
        {expandedSection && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
              'overflow-hidden rounded-lg border',
              expandedSection === 'valid' && 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/5',
              expandedSection === 'invalid' && 'border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5',
              expandedSection === 'duplicates' && 'border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5',
            )}
          >
            <RecipientPanel
              section={expandedSection}
              lines={
                expandedSection === 'valid' ? categorizedLines.valid
                : expandedSection === 'invalid' ? categorizedLines.invalid
                : categorizedLines.duplicates
              }
              mode={mode}
              onClose={() => setExpandedSection(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const BADGE_TONES = {
  emerald: {
    base: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    active: 'ring-2 ring-emerald-400 bg-emerald-100 dark:bg-emerald-500/20',
  },
  red: {
    base: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
    active: 'ring-2 ring-red-400 bg-red-100 dark:bg-red-500/20',
  },
  amber: {
    base: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    active: 'ring-2 ring-amber-400 bg-amber-100 dark:bg-amber-500/20',
  },
} as const;

interface BadgeButtonProps {
  active: boolean;
  onClick: () => void;
  count: number;
  label: string;
  tone: keyof typeof BADGE_TONES;
  icon?: React.ReactNode;
}
function BadgeButton({ active, onClick, count, label, tone, icon }: BadgeButtonProps) {
  const cfg = BADGE_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold transition-all cursor-pointer',
        cfg.base,
        active && cfg.active,
        'hover:brightness-105',
      )}
      title={`Clique para ${active ? 'ocultar' : 'ver'} a lista`}
    >
      {icon}
      {count} {label}
      <ChevronDown className={cn('w-2.5 h-2.5 transition-transform', active && 'rotate-180')} />
    </button>
  );
}

interface RecipientPanelProps {
  section: 'valid' | 'invalid' | 'duplicates';
  lines: ParsedLine[];
  mode: 'phone' | 'email';
  onClose: () => void;
}
function RecipientPanel({ section, lines, mode, onClose }: RecipientPanelProps) {
  const titles = {
    valid: 'Recipientes válidos',
    invalid: 'Entradas inválidas',
    duplicates: 'Duplicados (ignorados no envio)',
  };
  const colors = {
    valid: 'text-emerald-700 dark:text-emerald-400',
    invalid: 'text-red-700 dark:text-red-400',
    duplicates: 'text-amber-700 dark:text-amber-400',
  };

  if (lines.length === 0) {
    return (
      <div className="px-3 py-2 text-[10px] text-gray-500 dark:text-gray-400">
        Nenhum item nesta categoria.
      </div>
    );
  }

  // Limita scroll quando lista for grande (>20)
  const maxVisible = lines.length > 20 ? 20 : lines.length;

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className={cn('text-[10px] font-bold uppercase tracking-wider', colors[section])}>
          {titles[section]} ({lines.length})
        </p>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          aria-label="Fechar"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <div
        className="space-y-0.5 overflow-y-auto pr-1"
        style={{ maxHeight: `${Math.min(maxVisible * 22, 240)}px` }}
      >
        {lines.map((l, i) => (
          <RecipientLineRow key={i} line={l} mode={mode} section={section} />
        ))}
      </div>
    </div>
  );
}

function RecipientLineRow({ line, mode, section }: { line: ParsedLine; mode: 'phone' | 'email'; section: 'valid' | 'invalid' | 'duplicates' }) {
  // Formato exibido: phone/email "primário" + nome se houver + erro se inválido
  const primary = mode === 'phone' ? line.phoneNumber : line.email;
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      {section === 'invalid' ? (
        <>
          <span className="text-red-500 dark:text-red-400 truncate">&quot;{line.raw}&quot;</span>
          <span className="text-red-500/70 italic shrink-0">— {line.error}</span>
        </>
      ) : (
        <>
          <span className="text-gray-700 dark:text-gray-300 tabular-nums">{primary || line.raw}</span>
          {line.name && (
            <span className="text-gray-500 dark:text-gray-500 font-sans truncate">· {line.name}</span>
          )}
        </>
      )}
    </div>
  );
}
