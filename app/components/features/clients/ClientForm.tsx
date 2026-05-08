'use client';

/**
 * Formulário de cadastro/edição de cliente.
 *
 * Usa o padrão ModernSection do sistema. Os botões de ação ficam no footer
 * do ModernDialog que envelopa este form (em ClientsModule.tsx) — este
 * componente só renderiza o conteúdo (sections + campos).
 *
 * Exporta também:
 *   - ClientFormData (shape do payload, importado por ImportModal/ClientsModule)
 *   - emptyForm (estado inicial pra "novo cliente")
 *   - TagEditor (input de tags com autocomplete; reutilizável)
 */

import React, { useState, useMemo } from 'react';
import {
  TextField, FormControl, InputLabel, Select, MenuItem, InputAdornment,
} from '@mui/material';
import { User, Building2, Tag, X, Phone, MapPin, FileText, Briefcase, Calendar, Mail, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeadSource, LeadStatus } from '@/lib/types';
import { STATUS_CONFIG, SOURCE_LABELS, TIPO_LABELS } from './shared/constants';
import { ModernSection, ModernPill } from '@/app/components/ui/dialog';

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
  /** ISO date YYYY-MM-DD. PF = data de nascimento; PJ = data de fundação. */
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
  /** Aquisição (Fases 4A + 4B): 3 níveis de granularidade. */
  acquisitionOfferId: string;
  acquisitionProductId: string;
  acquisitionOfferLabel: string;
}

export const emptyForm: ClientFormData = {
  name: '', email: '', phone: '', whatsapp: '', company: '',
  tipo: 'pf', cpfCnpj: '', inscricaoEstadual: '', indicadorIE: '',
  birthDate: '',
  source: 'outro', status: 'ganho', notes: '', tags: [],
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
  acquisitionOfferId: '', acquisitionProductId: '', acquisitionOfferLabel: '',
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
      {tags.length > 0 && (
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
      )}
      <div className="relative">
        <TextField
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
          placeholder="Digite uma tag e pressione Enter…"
          fullWidth
          size="small"
          InputProps={{
            startAdornment: <InputAdornment position="start"><Tag size={14} className="text-slate-400" /></InputAdornment>,
          }}
        />
        {input && filteredSuggestions.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
            {filteredSuggestions.map(s => (
              <button key={s} type="button" onClick={() => add(s)}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors">
                <Tag className="w-3 h-3 inline mr-1.5 text-slate-400" />{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Form ────────────────────────────────────────────────────────────────────

/**
 * Conteúdo do formulário de cliente. Recebe o estado externamente — o
 * componente pai (ClientsModule) controla `form` + `setForm` e os botões
 * de salvar/cancelar (que ficam no footer do ModernDialog).
 *
 * Diferente da versão antiga, o ClientForm agora não renderiza Cancelar/Salvar:
 * isso é responsabilidade do dialog wrapping.
 */
export function ClientForm({
  form,
  setForm,
  tagSuggestions,
  products = [],
  offers = [],
  onManageOffers,
}: {
  form: ClientFormData;
  setForm: React.Dispatch<React.SetStateAction<ClientFormData>>;
  tagSuggestions: string[];
  products?: Array<{ id: string; name: string }>;
  offers?: Array<{ id: string; name: string; isActive?: boolean }>;
  onManageOffers?: () => void;
}) {
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

  return (
    <>
      <ModernSection
        icon={User}
        title="Tipo & Identificação"
        meta={<ModernPill tone={form.tipo === 'pj' ? 'blue' : 'red'}>{TIPO_LABELS[form.tipo]}</ModernPill>}
      >
        {/* Tipo selector — radio cards */}
        <div className="grid grid-cols-2 gap-3">
          {(['pf', 'pj'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => set('tipo', t)}
              className={cn(
                'flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all text-left',
                form.tipo === t
                  ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
              )}
            >
              {t === 'pf' ? <User className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
              {TIPO_LABELS[t]}
            </button>
          ))}
        </div>

        <TextField
          label={`Nome ${form.tipo === 'pj' ? '/ Razão Social' : ''} *`}
          value={form.name}
          onChange={e => set('name', e.target.value)}
          fullWidth size="small"
          placeholder="Nome completo"
        />
        {form.tipo === 'pj' && (
          <TextField
            label="Nome Fantasia"
            value={form.company}
            onChange={e => set('company', e.target.value)}
            fullWidth size="small"
          />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label={form.tipo === 'pj' ? 'CNPJ' : 'CPF'}
            value={form.cpfCnpj}
            onChange={e => set('cpfCnpj', e.target.value)}
            fullWidth size="small"
            placeholder={form.tipo === 'pj' ? '00.000.000/0000-00' : '000.000.000-00'}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Hash size={14} className="text-slate-400" /></InputAdornment>,
            }}
          />
          {form.tipo === 'pj' && (
            <TextField
              label="Inscrição Estadual"
              value={form.inscricaoEstadual}
              onChange={e => set('inscricaoEstadual', e.target.value)}
              fullWidth size="small"
            />
          )}
        </div>
      </ModernSection>

      <ModernSection icon={Phone} title="Contato">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label="Telefone"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            fullWidth size="small"
            placeholder="(00) 00000-0000"
            InputProps={{
              startAdornment: <InputAdornment position="start"><Phone size={14} className="text-slate-400" /></InputAdornment>,
            }}
          />
          <TextField
            label="WhatsApp"
            value={form.whatsapp}
            onChange={e => set('whatsapp', e.target.value)}
            fullWidth size="small"
            placeholder="(00) 00000-0000"
            InputProps={{
              startAdornment: <InputAdornment position="start"><Phone size={14} className="text-emerald-500" /></InputAdornment>,
            }}
          />
        </div>
        <TextField
          label="E-mail"
          type="email"
          value={form.email}
          onChange={e => set('email', e.target.value)}
          fullWidth size="small"
          placeholder="email@exemplo.com"
          InputProps={{
            startAdornment: <InputAdornment position="start"><Mail size={14} className="text-slate-400" /></InputAdornment>,
          }}
        />
        <TextField
          label={form.tipo === 'pj' ? 'Data de Fundação' : 'Data de Nascimento'}
          type="date"
          value={form.birthDate}
          onChange={e => set('birthDate', e.target.value)}
          InputLabelProps={{ shrink: true }}
          fullWidth size="small"
          InputProps={{
            startAdornment: <InputAdornment position="start"><Calendar size={14} className={cn(form.birthDate ? 'text-emerald-500' : 'text-slate-400')} /></InputAdornment>,
          }}
        />
      </ModernSection>

      <ModernSection icon={Tag} title="Classificação & Aquisição">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormControl size="small" fullWidth>
            <InputLabel>Status</InputLabel>
            <Select value={form.status} label="Status" onChange={e => set('status', e.target.value as LeadStatus)}>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <MenuItem key={k} value={k}>{v.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Origem</InputLabel>
            <Select value={form.source} label="Origem" onChange={e => set('source', e.target.value as LeadSource)}>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                <MenuItem key={k} value={k}>{v}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>

        {/* Aquisição — 3 níveis */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/35 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Aquisição (opcional)
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Qual oferta, produto ou contexto trouxe este cliente.
              </p>
            </div>
            {onManageOffers && (
              <button
                type="button"
                onClick={onManageOffers}
                className="text-[10px] font-semibold text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                Gerenciar ofertas
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {offers.length > 0 && (
              <FormControl size="small" fullWidth>
                <InputLabel>Oferta formal</InputLabel>
                <Select
                  value={form.acquisitionOfferId}
                  label="Oferta formal"
                  onChange={e => set('acquisitionOfferId', e.target.value)}
                >
                  <MenuItem value="">— Sem oferta —</MenuItem>
                  {offers.map(o => (
                    <MenuItem key={o.id} value={o.id}>
                      {o.name}{o.isActive === false ? ' (arquivada)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {products.length > 0 && (
              <FormControl size="small" fullWidth>
                <InputLabel>Produto</InputLabel>
                <Select
                  value={form.acquisitionProductId}
                  label="Produto"
                  onChange={e => set('acquisitionProductId', e.target.value)}
                >
                  <MenuItem value="">— Sem produto —</MenuItem>
                  {products.map(p => (
                    <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </div>
          <TextField
            label="Label livre"
            placeholder="Ex: indicação parceiro X"
            value={form.acquisitionOfferLabel}
            onChange={e => set('acquisitionOfferLabel', e.target.value)}
            fullWidth size="small"
            InputProps={{
              startAdornment: <InputAdornment position="start"><Briefcase size={14} className="text-slate-400" /></InputAdornment>,
            }}
          />
        </div>
      </ModernSection>

      <ModernSection icon={MapPin} title="Endereço">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextField
            label="CEP"
            value={form.cep}
            onChange={e => set('cep', e.target.value)}
            onBlur={searchCep}
            fullWidth size="small"
            InputProps={{
              endAdornment: cepLoading ? (
                <InputAdornment position="end">
                  <div className="w-3.5 h-3.5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                </InputAdornment>
              ) : undefined,
            }}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Logradouro"
              value={form.logradouro}
              onChange={e => set('logradouro', e.target.value)}
              fullWidth size="small"
            />
          </div>
          <TextField
            label="Número"
            value={form.numero}
            onChange={e => set('numero', e.target.value)}
            fullWidth size="small"
          />
          <div className="sm:col-span-2">
            <TextField
              label="Complemento"
              value={form.complemento}
              onChange={e => set('complemento', e.target.value)}
              fullWidth size="small"
            />
          </div>
          <TextField
            label="Bairro"
            value={form.bairro}
            onChange={e => set('bairro', e.target.value)}
            fullWidth size="small"
          />
          <TextField
            label="Município"
            value={form.municipio}
            onChange={e => set('municipio', e.target.value)}
            fullWidth size="small"
          />
          <TextField
            label="UF"
            value={form.uf}
            onChange={e => set('uf', e.target.value.toUpperCase())}
            inputProps={{ maxLength: 2 }}
            fullWidth size="small"
          />
        </div>
      </ModernSection>

      <ModernSection icon={FileText} title="Tags & Observações">
        <div>
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Tags</p>
          <TagEditor
            tags={form.tags}
            suggestions={tagSuggestions}
            onChange={next => set('tags', next)}
          />
        </div>
        <TextField
          label="Observações"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          fullWidth size="small"
          multiline
          rows={3}
          placeholder="Notas internas sobre o cliente…"
        />
      </ModernSection>
    </>
  );
}
