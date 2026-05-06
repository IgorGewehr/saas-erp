'use client';

/**
 * Formulário de cadastro/edição de cliente.
 *
 * Extraído do ClientsModule monolítico durante a Fase 1 da modularização.
 * Recebe `initial` + callback `onSave` — não conhece Firestore. A persistência
 * fica em ClientsModule (mutationFn que valida duplicata e chama setDoc).
 *
 * Exporta também:
 *   - ClientFormData (shape do payload, importado por ImportModal/ClientsModule)
 *   - emptyForm (estado inicial pra "novo cliente")
 *   - TagEditor (input de tags com autocomplete; reutilizável caso surja outro form)
 */

import { useState, useMemo } from 'react';
import { User, Building2, Tag, X, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeadSource, LeadStatus } from '@/lib/types';
import { STATUS_CONFIG, SOURCE_LABELS, TIPO_LABELS } from './shared/constants';

export interface ClientFormData {
  name: string;
  email: string;
  phone: string;
  whatsapp: string;
  company: string;
  tipo: 'pf' | 'pj';
  cpfCnpj: string;
  inscricaoEstadual: string;
  indicadorIE: '' | '1' | '2' | '9';
  /** ISO date YYYY-MM-DD. PF = data de nascimento; PJ = data de fundação.
   *  Mesmo campo serve aos dois casos pra simplificar automação de
   *  "aniversário do cliente" no futuro. Vazio quando não informado. */
  birthDate: string;
  source: LeadSource;
  status: LeadStatus;
  notes: string;
  tags: string[];
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  /** Aquisição (Fase 4): qual oferta/produto trouxe o cliente. Manual.
   *  acquisitionProductId vincula a um Product opcionalmente; se vazio,
   *  acquisitionOfferLabel vira o texto exibido (free-form). */
  acquisitionProductId: string;
  acquisitionOfferLabel: string;
}

export const emptyForm: ClientFormData = {
  name: '', email: '', phone: '', whatsapp: '', company: '',
  tipo: 'pf', cpfCnpj: '', inscricaoEstadual: '', indicadorIE: '',
  birthDate: '',
  source: 'outro', status: 'ganho', notes: '', tags: [],
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
  acquisitionProductId: '', acquisitionOfferLabel: '',
};

// ─── Tag editor ──────────────────────────────────────────────────────────────

export function TagEditor({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (next: string[]) => void }) {
  const [input, setInput] = useState('');
  const normalized = (v: string) => v.trim().replace(/\s+/g, ' ');

  const add = (raw: string) => {
    const v = normalized(raw);
    if (!v) return;
    if (tags.some(t => t.toLowerCase() === v.toLowerCase())) return;
    onChange([...tags, v]);
    setInput('');
  };

  const remove = (tag: string) => onChange(tags.filter(t => t !== tag));

  const filteredSuggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    return suggestions
      .filter(s => !tags.some(t => t.toLowerCase() === s.toLowerCase()))
      .filter(s => !q || s.toLowerCase().includes(q))
      .slice(0, 6);
  }, [input, suggestions, tags]);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200/60 dark:border-red-500/20">
            <Tag className="w-3 h-3" />
            {tag}
            <button type="button" onClick={() => remove(tag)} className="hover:text-red-800 dark:hover:text-red-300">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(input);
            } else if (e.key === 'Backspace' && !input && tags.length) {
              remove(tags[tags.length - 1]);
            }
          }}
          placeholder="Digite uma tag e pressione Enter..."
          className="w-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-400 transition-all"
        />
        {input && filteredSuggestions.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
            {filteredSuggestions.map(s => (
              <button key={s} type="button" onClick={() => add(s)}
                className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors">
                <Tag className="w-3 h-3 inline mr-1.5 text-gray-400" />{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Form ────────────────────────────────────────────────────────────────────

export function ClientForm({
  initial,
  onSave,
  onCancel,
  isSaving,
  tagSuggestions,
  products = [],
}: {
  initial: ClientFormData;
  onSave: (data: ClientFormData) => void;
  onCancel: () => void;
  isSaving: boolean;
  tagSuggestions: string[];
  /** Produtos do business (id+nome) — alimenta o select de "Origem da aquisição".
   *  Opcional: se vazio, só o input de label livre aparece. ClientsModule
   *  passa via useQuery em products collection. */
  products?: Array<{ id: string; name: string }>;
}) {
  const [form, setForm] = useState<ClientFormData>(initial);
  const [cepLoading, setCepLoading] = useState(false);

  const set = <K extends keyof ClientFormData>(key: K, value: ClientFormData[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const searchCep = async () => {
    const clean = form.cep.replace(/\D/g, '');
    if (clean.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm(f => ({
          ...f,
          logradouro: data.logradouro || f.logradouro,
          bairro: data.bairro || f.bairro,
          municipio: data.localidade || f.municipio,
          uf: data.uf || f.uf,
        }));
      }
    } catch { /* ignore */ }
    finally { setCepLoading(false); }
  };

  const inputCls = 'w-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-400 transition-all';
  const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider';

  return (
    <div className="space-y-6">
      {/* Tipo */}
      <div>
        <label className={labelCls}>Tipo de cadastro</label>
        <div className="grid grid-cols-2 gap-3">
          {(['pf', 'pj'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => set('tipo', t)}
              className={cn(
                'flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all',
                form.tipo === t
                  ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              {t === 'pf' ? <User className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
              {TIPO_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={labelCls}>Nome {form.tipo === 'pj' ? '/ Razão Social' : ''} *</label>
          <input className={inputCls} placeholder="Nome completo" value={form.name}
            onChange={e => set('name', e.target.value)} />
        </div>
        {form.tipo === 'pj' && (
          <div className="sm:col-span-2">
            <label className={labelCls}>Nome Fantasia</label>
            <input className={inputCls} placeholder="Nome fantasia" value={form.company}
              onChange={e => set('company', e.target.value)} />
          </div>
        )}
        <div>
          <label className={labelCls}>{form.tipo === 'pj' ? 'CNPJ' : 'CPF'}</label>
          <input className={inputCls} placeholder={form.tipo === 'pj' ? '00.000.000/0000-00' : '000.000.000-00'}
            value={form.cpfCnpj} onChange={e => set('cpfCnpj', e.target.value)} />
        </div>
        {form.tipo === 'pj' && (
          <div>
            <label className={labelCls}>Inscrição Estadual</label>
            <input className={inputCls} placeholder="Inscrição Estadual" value={form.inscricaoEstadual}
              onChange={e => set('inscricaoEstadual', e.target.value)} />
          </div>
        )}
        <div>
          <label className={labelCls}>Telefone</label>
          <input className={inputCls} placeholder="(00) 00000-0000" value={form.phone}
            onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>WhatsApp</label>
          <input className={inputCls} placeholder="(00) 00000-0000" value={form.whatsapp}
            onChange={e => set('whatsapp', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>E-mail</label>
          <input className={inputCls} type="email" placeholder="email@exemplo.com" value={form.email}
            onChange={e => set('email', e.target.value)} />
        </div>
        <div>
          {/* PF: data de nascimento; PJ: data de fundação. Mesmo campo
              `birthDate` serve aos dois — simplifica automação futura
              de "aniversário do cliente" (compara só mês+dia). */}
          <label className={labelCls}>
            {form.tipo === 'pj' ? 'Data de Fundação' : 'Data de Nascimento'}
          </label>
          <input className={inputCls} type="date" value={form.birthDate}
            onChange={e => set('birthDate', e.target.value)} />
        </div>
      </div>

      {/* Status & source */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Status</label>
          <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value as LeadStatus)}>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Origem</label>
          <select className={inputCls} value={form.source} onChange={e => set('source', e.target.value as LeadSource)}>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Aquisição — produto/oferta que trouxe o cliente.
          Diferente de "Origem" (canal genérico) — aqui captura QUAL oferta
          específica converteu. Útil pra ROI por oferta no futuro. */}
      <div>
        <label className={labelCls}>Aquisição (opcional)</label>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-1 mb-2">
          Qual oferta ou produto trouxe este cliente.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {products.length > 0 && (
            <select
              className={inputCls}
              value={form.acquisitionProductId}
              onChange={e => set('acquisitionProductId', e.target.value)}
            >
              <option value="">— Selecionar produto —</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <input
            className={cn(inputCls, products.length === 0 && 'sm:col-span-2')}
            placeholder="Label livre da oferta — ex: Black Friday, indicação parceiro X"
            value={form.acquisitionOfferLabel}
            onChange={e => set('acquisitionOfferLabel', e.target.value)}
          />
        </div>
      </div>

      {/* Address */}
      <div>
        <label className={labelCls}>Endereço</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex gap-2">
            <input className={inputCls} placeholder="CEP" value={form.cep}
              onChange={e => set('cep', e.target.value)}
              onBlur={searchCep} />
            {cepLoading && <div className="flex items-center"><div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>}
          </div>
          <input className={cn(inputCls, 'sm:col-span-2')} placeholder="Logradouro" value={form.logradouro}
            onChange={e => set('logradouro', e.target.value)} />
          <input className={inputCls} placeholder="Número" value={form.numero}
            onChange={e => set('numero', e.target.value)} />
          <input className={cn(inputCls, 'sm:col-span-2')} placeholder="Complemento" value={form.complemento}
            onChange={e => set('complemento', e.target.value)} />
          <input className={inputCls} placeholder="Bairro" value={form.bairro}
            onChange={e => set('bairro', e.target.value)} />
          <input className={inputCls} placeholder="Município" value={form.municipio}
            onChange={e => set('municipio', e.target.value)} />
          <input className={inputCls} placeholder="UF" maxLength={2} value={form.uf}
            onChange={e => set('uf', e.target.value.toUpperCase())} />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className={labelCls}>Tags</label>
        <TagEditor
          tags={form.tags}
          suggestions={tagSuggestions}
          onChange={next => set('tags', next)}
        />
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls}>Observações</label>
        <textarea className={cn(inputCls, 'resize-none')} rows={3} placeholder="Notas internas sobre o cliente..."
          value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={() => onSave(form)} disabled={!form.name.trim() || isSaving}
          className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
          {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Salvar
        </button>
      </div>
    </div>
  );
}
