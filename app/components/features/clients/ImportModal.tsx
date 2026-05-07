'use client';

/**
 * Modal de importação CSV de clientes.
 *
 * Extraído do ClientsModule durante a Fase 1 da modularização.
 * Fluxo de 3 passos: upload → mapear colunas → preview/import. Persiste via
 * `addDoc` no Firestore (precisa de businessId, recebido por prop).
 *
 * Heurísticas relevantes:
 *   - autoMap: bate headers do CSV contra um catálogo de aliases pra preencher
 *     o mapping inicial sem fricção (cobre nomes em pt-BR e en).
 *   - parseDateToIso: aceita ISO, BR (DD/MM/YYYY), e BR com 2-digit year.
 *   - rowToFormData: detecta PF/PJ por CNPJ vs CPF, ou por sufixo "LTDA"/"ME".
 *   - findDuplicate: pula linhas que dariam conflito com cliente existente
 *     (CPF, e-mail, telefone, WhatsApp). Toggle pra incluir mesmo assim
 *     (fluxo: importa duplicatas → user faz merge depois).
 */

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Upload, X, FileText, CheckCircle2 } from 'lucide-react';
import Papa from 'papaparse';
import { addDoc, collection } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import type { Client, LeadSource, LeadStatus } from '@/lib/types';
import { STATUS_CONFIG, SOURCE_LABELS } from './shared/constants';
import { findDuplicate } from './shared/duplicates';
import type { ClientFormData } from './ClientForm';

const IMPORT_FIELDS: { id: string; label: string; required?: boolean }[] = [
  { id: 'name',        label: 'Nome',                      required: true },
  { id: 'email',       label: 'E-mail' },
  { id: 'phone',       label: 'Telefone' },
  { id: 'whatsapp',    label: 'WhatsApp' },
  { id: 'company',     label: 'Empresa' },
  { id: 'tipo',        label: 'Tipo (pf / pj)' },
  { id: 'cpfCnpj',     label: 'CPF / CNPJ' },
  { id: 'birthDate',   label: 'Data de Nascimento' },
  { id: 'status',      label: 'Status' },
  { id: 'source',      label: 'Origem' },
  { id: 'tags',        label: 'Tags (vírgula)' },
  { id: 'notes',       label: 'Observações' },
  { id: 'cep',         label: 'CEP' },
  { id: 'logradouro',  label: 'Logradouro' },
  { id: 'numero',      label: 'Número' },
  { id: 'bairro',      label: 'Bairro' },
  { id: 'municipio',   label: 'Município' },
  { id: 'uf',          label: 'UF' },
];

const FIELD_ALIASES: Record<string, string[]> = {
  name:       ['nome', 'name', 'cliente', 'razao social', 'razão social'],
  email:      ['email', 'e-mail', 'mail'],
  phone:      ['telefone', 'phone', 'tel', 'fone', 'celular'],
  whatsapp:   ['whatsapp', 'wpp', 'zap', 'whats'],
  company:    ['empresa', 'company', 'negocio', 'negócio', 'corporação'],
  tipo:       ['tipo', 'type', 'pessoa'],
  cpfCnpj:   ['cpf', 'cnpj', 'cpf/cnpj', 'documento', 'doc'],
  birthDate:  ['nascimento', 'aniversário', 'aniversario', 'data de nascimento', 'birthday', 'birthdate', 'dob'],
  status:     ['status', 'situação', 'situacao'],
  source:     ['origem', 'source', 'canal', 'procedência'],
  tags:       ['tags', 'etiquetas', 'categorias', 'labels'],
  notes:      ['notas', 'observações', 'observacoes', 'notes', 'obs', 'comentario'],
  cep:        ['cep', 'zip', 'postal'],
  logradouro: ['logradouro', 'rua', 'endereco', 'endereço', 'street'],
  numero:     ['numero', 'número', 'num', 'number', 'n°'],
  bairro:     ['bairro', 'district', 'neighborhood'],
  municipio:  ['municipio', 'município', 'cidade', 'city'],
  uf:         ['uf', 'estado', 'state', 'province'],
};

/**
 * Normaliza uma data de nascimento de CSV pra formato ISO YYYY-MM-DD.
 * Aceita: ISO ("1990-05-04"), BR ("04/05/1990"), BR com 2-digit year ("04/05/90").
 * Retorna '' (vazio) se ausente ou parse falhar — não falha a importação,
 * só descarta o campo da linha problemática.
 */
function parseDateToIso(raw: string): string {
  const v = (raw || '').trim();
  if (!v) return '';
  // Já em ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // BR com slash ou hífen?
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!m) return '';
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  let year = m[3];
  if (year.length === 2) {
    // 2-digit: <50 vira 20XX, >=50 vira 19XX (heurística usual pra DOB)
    const n = Number(year);
    year = n < 50 ? `20${year}` : `19${year}`;
  }
  return `${year}-${month}-${day}`;
}

function autoMap(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = {};
  for (const h of headers) {
    const norm = h.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (!used.has(field) && aliases.some(a => norm === a || norm.includes(a) || a.includes(norm))) {
        result[h] = field;
        used.add(field);
        break;
      }
    }
  }
  return result;
}

function normalizeStatus(raw: string): LeadStatus {
  const m: Record<string, LeadStatus> = {
    novo: 'novo', new: 'novo', lead: 'novo',
    contatado: 'contatado', contacted: 'contatado',
    qualificado: 'qualificado', qualified: 'qualificado',
    proposta: 'proposta', proposal: 'proposta',
    negociacao: 'negociacao', 'negociação': 'negociacao', negotiation: 'negociacao',
    ganho: 'ganho', cliente: 'ganho', won: 'ganho', ativo: 'ganho', active: 'ganho',
    perdido: 'perdido', inativo: 'perdido', lost: 'perdido', inactive: 'perdido',
  };
  return m[raw.toLowerCase().trim()] ?? 'ganho';
}

function normalizeSource(raw: string): LeadSource {
  const m: Record<string, LeadSource> = {
    site: 'site', website: 'site',
    'indicacao': 'indicacao', 'indicação': 'indicacao', referral: 'indicacao',
    whatsapp: 'whatsapp', instagram: 'instagram', facebook: 'facebook',
    'google': 'google_ads', 'google ads': 'google_ads', google_ads: 'google_ads',
    linkedin: 'linkedin',
    evento: 'evento', event: 'evento',
    email: 'email', 'e-mail': 'email',
    telefone: 'telefone', phone: 'telefone',
  };
  return m[raw.toLowerCase().trim()] ?? 'outro';
}

function rowToFormData(row: Record<string, string>, mapping: Record<string, string>): ClientFormData {
  const get = (fieldId: string) => {
    const col = Object.entries(mapping).find(([, v]) => v === fieldId)?.[0];
    return col ? (row[col] ?? '').trim() : '';
  };
  // Auto-detecta PF/PJ a partir do CNPJ/CPF (se mapeado) ou do nome.
  // Se o cpfCnpj tem 14 dígitos = CNPJ → pj. Se 11 = CPF → pf.
  // Se não há documento, procura por sufixos típicos de razão social
  // (LTDA, ME, EIRELI, S/A, S.A., MEI) no nome ou na coluna company.
  const tipoRaw = get('tipo').toLowerCase();
  const cpfCnpjDigits = get('cpfCnpj').replace(/\D/g, '');
  const nameUpper = (get('name') + ' ' + get('company')).toUpperCase();
  const looksLikePJ = /\b(LTDA|EIRELI|S\.?A\.?|S\/A|MEI|ME|EPP)\b/.test(nameUpper);
  let tipo: 'pf' | 'pj';
  if (tipoRaw.startsWith('pj') || tipoRaw.includes('jur')) tipo = 'pj';
  else if (tipoRaw.startsWith('pf') || tipoRaw.includes('fis')) tipo = 'pf';
  else if (cpfCnpjDigits.length === 14) tipo = 'pj';
  else if (cpfCnpjDigits.length === 11) tipo = 'pf';
  else if (looksLikePJ) tipo = 'pj';
  else tipo = 'pf';
  return {
    name: get('name'),
    email: get('email'),
    phone: get('phone'),
    whatsapp: get('whatsapp'),
    company: get('company'),
    tipo,
    cpfCnpj: get('cpfCnpj'),
    inscricaoEstadual: '',
    indicadorIE: '',
    // CSV: tenta importar data de nascimento. Aceita formatos ISO YYYY-MM-DD
    // ou BR DD/MM/YYYY (normalizado pra ISO). Vazio se ausente ou inválido.
    birthDate: parseDateToIso(get('birthDate')),
    source: get('source') ? normalizeSource(get('source')) : 'outro',
    status: get('status') ? normalizeStatus(get('status')) : 'ganho',
    notes: get('notes'),
    tags: get('tags') ? get('tags').split(',').map(t => t.trim()).filter(Boolean) : [],
    cep: get('cep'),
    logradouro: get('logradouro'),
    numero: get('numero'),
    complemento: '',
    bairro: get('bairro'),
    municipio: get('municipio'),
    uf: get('uf').toUpperCase().slice(0, 2),
    // Aquisição (Fases 4A+4B): CSV não mapeia produto/oferta por id (usuário
    // não conhece o id Firestore). Vazio na importação — operador preenche
    // manualmente depois se quiser tag específica.
    acquisitionOfferId: '',
    acquisitionProductId: '',
    acquisitionOfferLabel: '',
  };
}

interface ImportResult { created: number; skipped: number; errors: number }

export function ImportModal({
  existingClients,
  businessId,
  onClose,
  onDone,
}: {
  existingClients: Client[];
  businessId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Permite importar duplicatas (cliente faz merge depois com a tela de
  // duplicatas detectadas). Default false — preserva comportamento prévio
  // de pular o que já existe.
  const [importDuplicates, setImportDuplicates] = useState(false);

  const handleFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: res => {
        const hdrs = res.meta.fields ?? [];
        setHeaders(hdrs);
        setRows(res.data);
        setMapping(autoMap(hdrs));
        setStep(2);
      },
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const preview = useMemo(() => rows.slice(0, 5).map(r => rowToFormData(r, mapping)), [rows, mapping]);

  const stats = useMemo(() => {
    let valid = 0, dupes = 0, noName = 0;
    for (const row of rows) {
      const fd = rowToFormData(row, mapping);
      if (!fd.name) { noName++; continue; }
      const isDup = !!findDuplicate(fd, existingClients);
      if (isDup) {
        dupes++;
        // Quando o usuário optou por importar duplicatas, elas contam como válidas
        // também — número de "Serão criados" reflete o que de fato vai pra base.
        if (importDuplicates) valid++;
        continue;
      }
      valid++;
    }
    return { valid, dupes, noName, total: rows.length };
  }, [rows, mapping, existingClients, importDuplicates]);

  const handleImport = async () => {
    setImporting(true);
    setProgress(0);
    let created = 0, skipped = 0, errors = 0;
    const errorSamples: string[] = []; // primeiras 3 mensagens pra exibir ao user
    const now = new Date().toISOString();

    /**
     * Strip-undefined: Firebase JS SDK rejeita addDoc com `field: undefined`
     * lançando "Unsupported field value: undefined". O código antigo usava
     * `field || undefined` e o catch silencioso engolia TODOS os erros —
     * resultado: 101 imports falhavam silenciosamente, user via 0 criados
     * sem nenhum aviso.
     */
    const stripUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          const inner = stripUndefined(v as Record<string, unknown>);
          if (Object.keys(inner).length > 0) out[k] = inner;
        } else {
          out[k] = v;
        }
      }
      return out;
    };

    for (let i = 0; i < rows.length; i++) {
      setProgress(Math.round(((i + 1) / rows.length) * 100));
      try {
        const fd = rowToFormData(rows[i], mapping);
        if (!fd.name) { errors++; continue; }
        // Pula duplicatas só quando o usuário NÃO optou por importá-las.
        // Com importDuplicates=true, registros duplicados são criados normalmente
        // — fluxo previsto pra dps usar a tela "Duplicatas detectadas" pra fazer merge.
        if (!importDuplicates && findDuplicate(fd, existingClients)) { skipped++; continue; }
        const payload: Record<string, unknown> = {
          businessId,
          name: fd.name,
          email: fd.email || undefined,
          phone: fd.phone || undefined,
          whatsapp: fd.whatsapp || undefined,
          company: fd.company || undefined,
          tipo: fd.tipo,
          cpfCnpj: fd.cpfCnpj || undefined,
          source: fd.source,
          status: fd.status,
          notes: fd.notes || undefined,
          tags: fd.tags.length ? fd.tags : undefined,
          score: 0, isActive: true, totalSpent: 0, visitCount: 0,
          createdAt: now, updatedAt: now,
        };
        if (fd.cep || fd.logradouro || fd.municipio) {
          payload.endereco = {
            cep: fd.cep || undefined,
            logradouro: fd.logradouro || undefined,
            numero: fd.numero || undefined,
            bairro: fd.bairro || undefined,
            municipio: fd.municipio || undefined,
            uf: fd.uf || undefined,
          };
        }
        await addDoc(collection(db, 'clients'), stripUndefined(payload));
        created++;
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        // Log per-row pra debug em DevTools (server logs não acessíveis pro user)
        console.error(`[Import] Row ${i + 1} (${rows[i]?.[mapping.name] || '?'}) failed:`, msg);
        if (errorSamples.length < 3) {
          errorSamples.push(`Linha ${i + 1}: ${msg.slice(0, 120)}`);
        }
      }
    }

    setResult({ created, skipped, errors });
    setImporting(false);
    // Toast com sumário — sem isso, user vê só "concluído" e dialog fecha
    if (errors > 0 && created === 0) {
      toast.error(
        `Falha em todas as importações (${errors}). ${errorSamples[0] || 'Verifique o console (F12).'}`,
        { autoClose: 10000 },
      );
    } else if (errors > 0) {
      toast.warn(
        `${created} importados, ${errors} falharam. ${errorSamples[0] || 'Veja console (F12) pros detalhes.'}`,
        { autoClose: 8000 },
      );
    } else if (created > 0) {
      toast.success(`${created} cliente(s) importado(s).`);
    }
    onDone();
  };

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget && !importing) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
              <Upload className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Importar clientes</h2>
              <p className="text-[10px] text-gray-400">
                {step === 1 ? 'Selecionar arquivo' : step === 2 ? 'Mapear colunas' : 'Revisar e importar'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicators */}
            <div className="flex items-center gap-1">
              {[1, 2, 3].map(s => (
                <div key={s} className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-colors',
                  step === s ? 'bg-red-600 text-white' :
                  step > s  ? 'bg-emerald-500 text-white' :
                  'bg-gray-100 dark:bg-gray-800 text-gray-400')}
                >
                  {step > s ? '✓' : s}
                </div>
              ))}
            </div>
            {!importing && (
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* STEP 1 — Upload */}
          {step === 1 && (
            <div className="p-6">
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('csv-file-input')?.click()}
                className={cn(
                  'border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all',
                  dragOver
                    ? 'border-red-400 bg-red-50 dark:bg-red-500/5'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/30'
                )}
              >
                <Upload className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Arraste um arquivo CSV ou clique para selecionar
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Suporte a UTF-8, separador vírgula ou ponto-e-vírgula
                </p>
              </div>
              <input
                id="csv-file-input"
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-500/10 rounded-xl flex items-start gap-2">
                <FileText className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <strong>Dica:</strong> Use o botão "Exportar" para baixar um CSV de exemplo com as colunas corretas e usá-lo como template.
                </p>
              </div>
            </div>
          )}

          {/* STEP 2 — Mapear colunas */}
          {step === 2 && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  <strong className="text-gray-900 dark:text-white">{rows.length}</strong> linhas encontradas
                </p>
                <p className="text-xs text-gray-400">Mapeie cada coluna do CSV a um campo do sistema</p>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_1fr] gap-0 text-[10px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/60 px-4 py-2">
                  <span>Coluna no CSV</span>
                  <span className="text-center px-4">→</span>
                  <span>Campo do sistema</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {headers.map(h => (
                    <div key={h} className="grid grid-cols-[1fr_auto_1fr] gap-0 items-center px-4 py-2.5">
                      <div>
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{h}</p>
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">
                          ex: {(rows[0]?.[h] ?? '').slice(0, 30) || '—'}
                        </p>
                      </div>
                      <div className="px-3 text-gray-300 dark:text-gray-600">→</div>
                      <select
                        value={mapping[h] ?? ''}
                        onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                        className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-500/40"
                      >
                        <option value="">— Ignorar —</option>
                        {IMPORT_FIELDS.map(f => (
                          <option key={f.id} value={f.id}>
                            {f.label}{f.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 — Preview + Import */}
          {step === 3 && (
            <div className="p-6 space-y-4">
              {/* Summary counts */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Serão criados',  value: stats.valid,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
                  { label: importDuplicates ? 'Duplicatas (incluir)' : 'Duplicatas (pular)', value: stats.dupes, color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-500/10' },
                  { label: 'Sem nome (erro)', value: stats.noName, color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-50 dark:bg-red-500/10' },
                ].map(s => (
                  <div key={s.label} className={cn('rounded-xl p-3 text-center', s.bg)}>
                    <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Toggle pra incluir duplicatas. Útil quando o usuário quer
                  importar tudo e usar a tela "Duplicatas detectadas" depois
                  pra fazer merge manual. Só aparece se há duplicata detectada. */}
              {stats.dupes > 0 && (
                <label className="flex items-start gap-3 p-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors">
                  <input
                    type="checkbox"
                    checked={importDuplicates}
                    onChange={e => setImportDuplicates(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 focus:ring-offset-0 accent-amber-600"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                      Importar duplicatas mesmo assim
                    </p>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                      As {stats.dupes} duplicatas serão criadas como registros separados.
                      Use a tela "Duplicatas" depois pra fazer merge manualmente.
                    </p>
                  </div>
                </label>
              )}

              {/* Preview table */}
              {preview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Preview (primeiras {preview.length} linhas)
                  </p>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800/60">
                        <tr>
                          {['Nome', 'E-mail', 'Telefone', 'Status', 'Origem'].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {preview.map((fd, i) => (
                          <tr key={i} className={cn(!fd.name && 'opacity-40')}>
                            <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200 truncate max-w-[120px]">{fd.name || '—'}</td>
                            <td className="px-3 py-2 text-gray-500 truncate max-w-[120px]">{fd.email || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{fd.phone || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{STATUS_CONFIG[fd.status]?.label || fd.status}</td>
                            <td className="px-3 py-2 text-gray-500">{SOURCE_LABELS[fd.source] || fd.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Progress / Result */}
              {importing && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Importando...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-red-500 rounded-full"
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              )}

              {result && (
                <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    <strong>{result.created}</strong> criados · <strong>{result.skipped}</strong> duplicatas puladas · <strong>{result.errors}</strong> erros
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
          <button
            onClick={() => { if (step > 1 && !importing && !result) setStep(s => (s - 1) as 1 | 2 | 3); }}
            disabled={step === 1 || importing || !!result}
            className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-30"
          >
            Voltar
          </button>

          {result ? (
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors">
              Fechar
            </button>
          ) : step < 3 ? (
            <button
              disabled={step === 2 && !Object.values(mapping).includes('name')}
              onClick={() => setStep(s => (s + 1) as 2 | 3)}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-40"
            >
              {step === 2 ? `Continuar — ${rows.length} linhas` : 'Continuar'}
            </button>
          ) : (
            <button
              onClick={handleImport}
              disabled={importing || stats.valid === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-40"
            >
              <Upload className="w-4 h-4" />
              Importar {stats.valid} clientes
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
