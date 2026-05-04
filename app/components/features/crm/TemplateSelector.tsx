'use client';

/**
 * TemplateSelector — UI para escolher template WhatsApp aprovado
 * e mapear suas variáveis ({{1}}, {{2}}, …) para valores literais ou
 * campos do recipiente.
 *
 * Output: { name, language, params: BroadcastTemplateParam[] }
 *
 * Props:
 *  - businessId
 *  - value (controlled)
 *  - onChange
 *  - sampleRecipient (opcional) — usado para preview do envio
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAuth } from 'firebase/auth';
import { Loader2, AlertTriangle, Check, Sparkles, Type as TypeIcon, User as UserIcon, Phone, Mail, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BroadcastRecipient, BroadcastTemplateParam } from '@/lib/types';

interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  preview: string;
  hasVariables: boolean;
}

export interface TemplateSelection {
  name: string;
  language: string;
  params: BroadcastTemplateParam[];
  /** Body cru com `{{N}}` placeholders — usado pra render no histórico
   *  da conversa (sem isso, broadcast aparecia como "[Template: nome]"). */
  preview?: string;
}

interface Props {
  businessId: string;
  value: TemplateSelection | null;
  onChange: (next: TemplateSelection | null) => void;
  sampleRecipient?: BroadcastRecipient;
  /** Canal da campanha — usado para filtrar opções de field (ex: oculta email em WA). */
  channel?: 'whatsapp' | 'facebook' | 'instagram' | 'email';
  /** 5.8: nomes de colunas extras do CSV — viram opções de mapeamento de variáveis. */
  csvColumns?: string[];
  className?: string;
}

const ALL_FIELD_OPTIONS: { value: 'name' | 'phoneNumber' | 'email'; label: string; icon: React.ReactNode }[] = [
  { value: 'name', label: 'Nome do contato', icon: <UserIcon className="w-3 h-3" /> },
  { value: 'phoneNumber', label: 'Telefone', icon: <Phone className="w-3 h-3" /> },
  { value: 'email', label: 'Email', icon: <Mail className="w-3 h-3" /> },
];

/** Filtra opções de field por canal — email só faz sentido em campanhas de email. */
function fieldOptionsForChannel(channel?: Props['channel']) {
  if (channel === 'email') return ALL_FIELD_OPTIONS;
  return ALL_FIELD_OPTIONS.filter(o => o.value !== 'email');
}

/**
 * Retorna o maior índice {{N}} no body — usado para dimensionar params[].
 * Ex: "{{2}} {{4}}" retorna 4 (params precisa de 4 slots, mesmo com slot 1 e 3 vazios).
 * Templates Meta convencionalmente usam índices sequenciais 1..N, mas isso garante
 * que gaps não causem mismatch entre UI e renderização.
 * Index 0 ou inválido é ignorado (Meta exige >= 1).
 */
function maxVariableIndex(body: string): number {
  const matches = body.matchAll(/\{\{(\d+)\}\}/g);
  let max = 0;
  for (const m of matches) {
    const idx = Number(m[1]);
    if (idx >= 1 && idx > max) max = idx;
  }
  return max;
}

/** Renderiza o body do template substituindo {{N}} por valores resolvidos. */
function renderPreview(body: string, params: BroadcastTemplateParam[], sample?: BroadcastRecipient): string {
  return body.replace(/\{\{(\d+)\}\}/g, (matched, idx) => {
    const n = Number(idx);
    if (n < 1) return matched; // {{0}} ou inválido — não substitui
    const p = params[n - 1];
    if (!p) return matched;
    if (p.kind === 'literal') return p.value || matched;
    if (p.kind === 'field') {
      if (!sample) return `[${p.field}]`;
      if (p.field === 'name') return sample.name || '[sem nome]';
      if (p.field === 'phoneNumber') return sample.phoneNumber || '[sem telefone]';
      if (p.field === 'email') return sample.email || '[sem email]';
    }
    if (p.kind === 'csvColumn') {
      if (!sample?.customColumns) return `[${p.column}]`;
      return sample.customColumns[p.column] || `[${p.column}]`;
    }
    return matched;
  });
}

export default function TemplateSelector({ businessId, value, onChange, sampleRecipient, channel, csvColumns, className }: Props) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fieldOptions = useMemo(() => fieldOptionsForChannel(channel), [channel]);

  // Fetch templates aprovados na WABA
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAuth().currentUser?.getIdToken();
        if (!token) {
          if (!cancelled) setError('Sessão expirada');
          return;
        }
        const res = await fetch(`/api/channels/whatsapp-templates?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) {
          // Endpoint enriquecido (commit c5e8aaa+) retorna `error` + flags
          // (isTokenExpired/isPermissionError/isRateLimited) quando upstream Meta
          // falha. Mensagens curtas e direcionadas baseadas no cenário.
          const data = await res.json().catch(() => ({} as {
            error?: string;
            isTokenExpired?: boolean;
            isPermissionError?: boolean;
            isRateLimited?: boolean;
          }));
          if (!cancelled) {
            if (data.isTokenExpired) {
              setError('Token do WhatsApp expirou. Reconecte em Configurações → Canais.');
            } else if (data.isRateLimited) {
              setError('Meta API rate-limited. Tente novamente em alguns minutos.');
            } else if (res.status === 400 && /não está conectado|configure/i.test(data.error || '')) {
              // WhatsApp Cloud não conectado — não é erro do usuário, é estado de config
              setError('WhatsApp Cloud não conectado. Configure em Settings → Canais para enviar templates.');
            } else if (res.status === 502 && !data.error) {
              // Resposta antiga sem detalhes — provavelmente deploy não atualizado
              setError('Servidor do WhatsApp inacessível. Verifique a conexão do canal Cloud.');
            } else {
              setError(data.error || `HTTP ${res.status}`);
            }
          }
          return;
        }
        const data = await res.json();
        const fetched: WhatsAppTemplate[] = data.templates ?? [];
        // Garante hello_world como fallback se WABA não tem nada
        const hasHelloWorld = fetched.some(t => t.name.toLowerCase() === 'hello_world');
        if (!cancelled) {
          setTemplates(hasHelloWorld ? fetched : [
            { name: 'hello_world', language: 'en_US', category: 'UTILITY', preview: 'Hello World', hasVariables: false },
            ...fetched,
          ]);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar templates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const selected = useMemo(() => {
    if (!value) return null;
    return templates.find(t => t.name === value.name && t.language === value.language) ?? null;
  }, [templates, value]);

  const variableCount = useMemo(() => selected ? maxVariableIndex(selected.preview) : 0, [selected]);

  // Sincroniza tamanho do params[] com a quantidade de variáveis do template
  // (sem perder valores já preenchidos quando o usuário troca de template)
  useEffect(() => {
    if (!selected || !value) return;
    if (value.params.length === variableCount) return;
    const next = [...value.params];
    while (next.length < variableCount) next.push({ kind: 'literal', value: '' });
    while (next.length > variableCount) next.pop();
    onChange({ ...value, params: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variableCount, selected]);

  const handleSelectTemplate = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (!v) { onChange(null); return; }
    const tpl = templates.find(t => `${t.name}__${t.language}` === v);
    if (!tpl) return;
    const count = maxVariableIndex(tpl.preview);
    onChange({
      name: tpl.name,
      language: tpl.language,
      params: Array.from({ length: count }, () => ({ kind: 'literal', value: '' } as BroadcastTemplateParam)),
      preview: tpl.preview,
    });
  };

  const updateParam = (index: number, next: BroadcastTemplateParam) => {
    if (!value) return;
    const newParams = value.params.map((p, i) => i === index ? next : p);
    onChange({ ...value, params: newParams });
  };

  // Validação: tudo mapeado e literais não-vazios
  const validationError = useMemo(() => {
    if (!value || !selected) return null;
    if (value.params.length !== variableCount) return 'Mapeamento incompleto';
    for (let i = 0; i < value.params.length; i++) {
      const p = value.params[i];
      if (p.kind === 'literal' && !p.value.trim()) return `Variável {{${i + 1}}} sem valor`;
    }
    return null;
  }, [value, selected, variableCount]);

  const inputCls = 'w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400';

  return (
    <div className={cn('space-y-2.5', className)}>
      {/* Dropdown de template */}
      <div>
        <label htmlFor="broadcast-template-select" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Template aprovado</label>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-2.5 px-3 bg-gray-50 dark:bg-white/[0.04] rounded-lg border border-gray-200 dark:border-gray-700">
            <Loader2 className="w-3 h-3 animate-spin" /> Carregando templates da WABA…
          </div>
        ) : error ? (
          <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
            <p className="text-[11px] text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
              {error}
            </p>
          </div>
        ) : (
          <select
            id="broadcast-template-select"
            value={value ? `${value.name}__${value.language}` : ''}
            onChange={handleSelectTemplate}
            className={inputCls}
          >
            <option value="">Selecione um template…</option>
            {templates.map(t => (
              <option key={`${t.name}__${t.language}`} value={`${t.name}__${t.language}`}>
                {t.name} — {t.category} ({t.language})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Preview do body */}
      {selected && (
        <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700">
          <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Conteúdo do template</p>
          <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{selected.preview}</p>
        </div>
      )}

      {/* Mapeamento de variáveis */}
      <AnimatePresence>
        {selected && variableCount > 0 && value && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Variáveis ({variableCount})</p>
            {value.params.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-1.5 py-1 rounded flex-shrink-0">
                  {`{{${i + 1}}}`}
                </span>
                <select
                  value={
                    p.kind === 'literal' ? '__literal'
                    : p.kind === 'field' ? `field:${p.field}`
                    : `csv:${p.column}`
                  }
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '__literal') updateParam(i, { kind: 'literal', value: '' });
                    else if (v.startsWith('field:')) {
                      updateParam(i, { kind: 'field', field: v.slice(6) as 'name' | 'phoneNumber' | 'email' });
                    } else if (v.startsWith('csv:')) {
                      updateParam(i, { kind: 'csvColumn', column: v.slice(4) });
                    }
                  }}
                  className={cn(inputCls, 'w-auto flex-shrink-0')}
                >
                  <option value="__literal">Texto fixo</option>
                  {fieldOptions.map(o => (
                    <option key={o.value} value={`field:${o.value}`}>{o.label}</option>
                  ))}
                  {csvColumns && csvColumns.length > 0 && (
                    <optgroup label="Colunas do CSV">
                      {csvColumns.map(col => (
                        <option key={col} value={`csv:${col}`}>↳ {col}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {p.kind === 'literal' ? (
                  <input
                    placeholder="Valor"
                    value={p.value}
                    onChange={e => updateParam(i, { kind: 'literal', value: e.target.value })}
                    className={inputCls}
                  />
                ) : p.kind === 'field' ? (
                  <span className="flex-1 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
                    {ALL_FIELD_OPTIONS.find(o => o.value === p.field)?.icon}
                    Resolvido por recipiente
                  </span>
                ) : (
                  <span className="flex-1 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 rounded-lg">
                    <Database className="w-3 h-3" />
                    coluna CSV: <code className="font-mono">{p.column}</code>
                  </span>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview com sample */}
      {selected && value && variableCount > 0 && !validationError && (
        <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20">
          <p className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 uppercase mb-1 flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5" />
            Como vai chegar {sampleRecipient ? '— exemplo do 1º recipiente' : ''}
          </p>
          <p className="text-xs text-emerald-900 dark:text-emerald-200 whitespace-pre-wrap leading-relaxed">
            {renderPreview(selected.preview, value.params, sampleRecipient)}
          </p>
        </div>
      )}

      {/* Validation error */}
      {validationError && (
        <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
          <p className="text-[10px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
            {validationError}
          </p>
        </div>
      )}

      {/* Hello world é template sem variáveis — confirma OK */}
      {selected && variableCount === 0 && (
        <div className="px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
          <p className="text-[10px] text-blue-700 dark:text-blue-400">
            <Check className="w-3 h-3 inline mr-1 -mt-0.5" />
            Template sem variáveis — pronto para envio
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Helper público — verifica se uma TemplateSelection está válida pra envio.
 *
 * @param sel — seleção atual
 * @param expectedVarCount — opcional: número de variáveis esperadas pelo template.
 *   Se passado, valida que sel.params.length === expectedVarCount (defesa contra
 *   sync incompleta após troca de template).
 */
export function isTemplateSelectionValid(
  sel: TemplateSelection | null,
  expectedVarCount?: number,
): boolean {
  if (!sel) return false;
  if (typeof expectedVarCount === 'number' && sel.params.length !== expectedVarCount) {
    return false;
  }
  for (const p of sel.params) {
    if (p.kind === 'literal' && !p.value.trim()) return false;
    if (p.kind === 'csvColumn' && !p.column.trim()) return false;
  }
  return true;
}
