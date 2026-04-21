'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Plus, Search, Filter, X, Edit2, Trash2, Phone, Mail,
  Building2, User, ChevronDown, CheckCircle2, Tag, MapPin,
  TrendingUp, ShoppingCart, Star, MoreVertical, Eye, FileText,
  Download, Upload, UserCheck,
} from 'lucide-react';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, limit as firestoreLimit } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type { Client, LeadSource, LeadStatus } from '@/lib/types';
import { toast } from 'react-toastify';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; dot: string }> = {
  novo:         { label: 'Novo', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300', dot: 'bg-blue-400' },
  contatado:    { label: 'Contatado', color: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300', dot: 'bg-purple-400' },
  qualificado:  { label: 'Qualificado', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', dot: 'bg-amber-400' },
  proposta:     { label: 'Proposta', color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300', dot: 'bg-pink-400' },
  negociacao:   { label: 'Negociação', color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300', dot: 'bg-orange-400' },
  ganho:        { label: 'Cliente', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', dot: 'bg-emerald-400' },
  perdido:      { label: 'Inativo', color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300', dot: 'bg-red-400' },
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  site: 'Site', indicacao: 'Indicação', whatsapp: 'WhatsApp',
  instagram: 'Instagram', facebook: 'Facebook', google_ads: 'Google Ads',
  linkedin: 'LinkedIn', evento: 'Evento', email: 'E-mail', telefone: 'Telefone', outro: 'Outro',
};

const TIPO_LABELS = { pf: 'Pessoa Física', pj: 'Pessoa Jurídica' };

// ─── Client Form ─────────────────────────────────────────────────────────────

interface ClientFormData {
  name: string;
  email: string;
  phone: string;
  whatsapp: string;
  company: string;
  tipo: 'pf' | 'pj';
  cpfCnpj: string;
  inscricaoEstadual: string;
  indicadorIE: '' | '1' | '2' | '9';
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
}

const emptyForm: ClientFormData = {
  name: '', email: '', phone: '', whatsapp: '', company: '',
  tipo: 'pf', cpfCnpj: '', inscricaoEstadual: '', indicadorIE: '',
  source: 'outro', status: 'ganho', notes: '', tags: [],
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
};

// ─── Duplicate detection helpers ─────────────────────────────────────────────
const digits = (v: string | undefined | null) => (v || '').replace(/\D/g, '');
const normEmail = (v: string | undefined | null) => (v || '').trim().toLowerCase();

function findDuplicate(form: ClientFormData, clients: Client[], editingId?: string): { client: Client; field: string } | null {
  const cpfCnpj = digits(form.cpfCnpj);
  const phone = digits(form.phone);
  const whatsapp = digits(form.whatsapp);
  const email = normEmail(form.email);

  for (const c of clients) {
    if (editingId && c.id === editingId) continue;
    if (cpfCnpj && digits(c.cpfCnpj) === cpfCnpj) return { client: c, field: form.tipo === 'pj' ? 'CNPJ' : 'CPF' };
    if (email && normEmail(c.email) === email) return { client: c, field: 'e-mail' };
    if (phone) {
      if (digits(c.phone) === phone) return { client: c, field: 'telefone' };
      if (digits(c.whatsapp) === phone) return { client: c, field: 'telefone' };
    }
    if (whatsapp) {
      if (digits(c.whatsapp) === whatsapp) return { client: c, field: 'WhatsApp' };
      if (digits(c.phone) === whatsapp) return { client: c, field: 'WhatsApp' };
    }
  }
  return null;
}

function TagEditor({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (next: string[]) => void }) {
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

function ClientForm({
  initial,
  onSave,
  onCancel,
  isSaving,
  tagSuggestions,
}: {
  initial: ClientFormData;
  onSave: (data: ClientFormData) => void;
  onCancel: () => void;
  isSaving: boolean;
  tagSuggestions: string[];
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

// ─── Client Detail Panel ──────────────────────────────────────────────────────

function ClientDetailPanel({ client, onClose, onEdit }: { client: Client; onClose: () => void; onEdit: () => void }) {
  const statusCfg = STATUS_CONFIG[client.status] || STATUS_CONFIG.ganho;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="h-full flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            {(client.name?.[0] || '?').toUpperCase()}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">{client.name}</h3>
            {client.company && <p className="text-xs text-gray-500 dark:text-gray-400">{client.company}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors">
            <Edit2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Status + Stats */}
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', statusCfg.color)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', statusCfg.dot)} />
            {statusCfg.label}
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
            {client.tipo === 'pj' ? <Building2 className="w-3 h-3 inline mr-1" /> : <User className="w-3 h-3 inline mr-1" />}
            {TIPO_LABELS[client.tipo || 'pf']}
          </span>
        </div>

        {/* Tags */}
        {client.tags && client.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {client.tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200/60 dark:border-red-500/20">
                <Tag className="w-2.5 h-2.5" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total gasto</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(client.totalSpent || 0)}</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Compras</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{client.visitCount || 0}</p>
          </div>
        </div>

        {/* Contacts */}
        <div className="space-y-2">
          {client.phone && (
            <a href={`tel:${client.phone}`} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors group">
              <Phone className="w-4 h-4 text-gray-400 group-hover:text-red-500 transition-colors" />
              <span className="text-sm text-gray-700 dark:text-gray-300">{client.phone}</span>
            </a>
          )}
          {client.whatsapp && (
            <a href={`https://wa.me/${client.whatsapp?.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors group">
              <Phone className="w-4 h-4 text-gray-400 group-hover:text-green-500 transition-colors" />
              <span className="text-sm text-gray-700 dark:text-gray-300">{client.whatsapp} (WA)</span>
            </a>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors group">
              <Mail className="w-4 h-4 text-gray-400 group-hover:text-red-500 transition-colors" />
              <span className="text-sm text-gray-700 dark:text-gray-300">{client.email}</span>
            </a>
          )}
        </div>

        {/* Fiscal */}
        {(client.cpfCnpj || client.inscricaoEstadual) && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Dados Fiscais</p>
            {client.cpfCnpj && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">{client.tipo === 'pj' ? 'CNPJ' : 'CPF'}</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{client.cpfCnpj}</span>
              </div>
            )}
            {client.inscricaoEstadual && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">Insc. Estadual</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{client.inscricaoEstadual}</span>
              </div>
            )}
          </div>
        )}

        {/* Address */}
        {client.endereco && (client.endereco.logradouro || client.endereco.municipio) && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Endereço</p>
            <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
              <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 flex-shrink-0" />
              <span>
                {[client.endereco.logradouro, client.endereco.numero, client.endereco.complemento,
                  client.endereco.bairro, client.endereco.municipio, client.endereco.uf]
                  .filter(Boolean).join(', ')}
                {client.endereco.cep && ` — CEP ${client.endereco.cep}`}
              </span>
            </div>
          </div>
        )}

        {/* Notes */}
        {client.notes && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Observações</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{client.notes}</p>
          </div>
        )}

        {/* Metadata */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Origem</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">{SOURCE_LABELS[client.source] || client.source}</span>
          </div>
          {client.lastVisit && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Última compra</span>
              <span className="text-xs text-gray-600 dark:text-gray-400">{formatDate(client.lastVisit)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Cadastrado em</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">{formatDate(client.createdAt)}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────

export default function ClientsModule() {
  const { business } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState<'all' | 'pf' | 'pj'>('all');
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'all'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'totalSpent' | 'createdAt'>('name');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Client | null>(null);

  // ─── Data fetching ──────────────────────────────────────────────────────────
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'clients'),
        where('businessId', '==', business.id),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Client));
    },
    enabled: !!business?.id,
    staleTime: 3 * 60 * 1000,
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const { mutate: saveClient, isPending: isSaving } = useMutation({
    mutationFn: async (data: ClientFormData) => {
      const dup = findDuplicate(data, clients, editingClient?.id);
      if (dup) {
        throw new Error(`Já existe um cliente com esse ${dup.field}: "${dup.client.name}"`);
      }

      const now = new Date().toISOString();
      const payload: Partial<Client> = {
        name: data.name.trim(),
        email: data.email.trim() || undefined,
        phone: data.phone.trim() || undefined,
        whatsapp: data.whatsapp.trim() || undefined,
        company: data.company.trim() || undefined,
        tipo: data.tipo,
        cpfCnpj: data.cpfCnpj.trim() || undefined,
        inscricaoEstadual: data.inscricaoEstadual.trim() || undefined,
        indicadorIE: (data.indicadorIE || undefined) as '1' | '2' | '9' | undefined,
        source: data.source,
        status: data.status,
        notes: data.notes.trim() || undefined,
        tags: data.tags.length ? data.tags : undefined,
        updatedAt: now,
      };

      if (data.cep || data.logradouro || data.municipio) {
        payload.endereco = {
          cep: data.cep.trim() || undefined,
          logradouro: data.logradouro.trim() || undefined,
          numero: data.numero.trim() || undefined,
          complemento: data.complemento.trim() || undefined,
          bairro: data.bairro.trim() || undefined,
          municipio: data.municipio.trim() || undefined,
          uf: data.uf.trim() || undefined,
        };
      }

      if (editingClient) {
        await updateDoc(doc(db, 'clients', editingClient.id), payload);
      } else {
        await addDoc(collection(db, 'clients'), {
          ...payload,
          businessId: business!.id,
          score: 0,
          isActive: true,
          totalSpent: 0,
          visitCount: 0,
          createdAt: now,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
      toast.success(editingClient ? 'Cliente atualizado!' : 'Cliente cadastrado!');
      setShowForm(false);
      setEditingClient(null);
    },
    onError: (err: Error) => {
      console.error('[Clients] Save error:', err);
      toast.error(err?.message || 'Erro ao salvar cliente');
    },
  });

  const { mutate: deleteClient, isPending: isDeleting } = useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'clients', id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
      toast.success('Cliente excluído');
      setDeleteConfirm(null);
      if (selectedClient?.id === deleteConfirm?.id) setSelectedClient(null);
    },
    onError: () => toast.error('Erro ao excluir cliente'),
  });

  // ─── Filtered & sorted list ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    // Drop any malformed entries (corrupted docs missing name) before rendering.
    let list = clients.filter(c => c && typeof c.name === 'string' && c.name.length > 0);
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(term) ||
        c.cpfCnpj?.includes(term) ||
        c.email?.toLowerCase().includes(term) ||
        c.phone?.includes(term) ||
        c.company?.toLowerCase().includes(term)
      );
    }
    if (filterTipo !== 'all') list = list.filter(c => c.tipo === filterTipo);
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    if (filterTags.length) {
      const wanted = filterTags.map(t => t.toLowerCase());
      list = list.filter(c => {
        const cTags = (c.tags || []).map(t => t.toLowerCase());
        return wanted.every(w => cTags.includes(w));
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'totalSpent') return (b.totalSpent || 0) - (a.totalSpent || 0);
      if (sortBy === 'createdAt') return (b.createdAt || '').localeCompare(a.createdAt || '');
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [clients, search, filterTipo, filterStatus, filterTags, sortBy]);

  // ─── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active = clients.filter(c => c.status === 'ganho').length;
    const pj = clients.filter(c => c.tipo === 'pj').length;
    const totalSpent = clients.reduce((s, c) => s + (c.totalSpent || 0), 0);
    const avgTicket = active > 0 ? totalSpent / clients.filter(c => (c.totalSpent || 0) > 0).length : 0;
    return { total: clients.length, active, pj, totalSpent, avgTicket };
  }, [clients]);

  // ─── Form helpers ────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingClient(null);
    setShowForm(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    setShowForm(true);
    setSelectedClient(null);
  };

  const formInitial: ClientFormData = editingClient
    ? {
        name: editingClient.name,
        email: editingClient.email || '',
        phone: editingClient.phone || '',
        whatsapp: editingClient.whatsapp || '',
        company: editingClient.company || '',
        tipo: editingClient.tipo || 'pf',
        cpfCnpj: editingClient.cpfCnpj || '',
        inscricaoEstadual: editingClient.inscricaoEstadual || '',
        indicadorIE: editingClient.indicadorIE || '',
        source: editingClient.source,
        status: editingClient.status,
        notes: editingClient.notes || '',
        tags: editingClient.tags ? [...editingClient.tags] : [],
        cep: editingClient.endereco?.cep || '',
        logradouro: editingClient.endereco?.logradouro || '',
        numero: editingClient.endereco?.numero || '',
        complemento: editingClient.endereco?.complemento || '',
        bairro: editingClient.endereco?.bairro || '',
        municipio: editingClient.endereco?.municipio || '',
        uf: editingClient.endereco?.uf || '',
      }
    : emptyForm;

  // Aggregated tag suggestions across all clients (dedup, case-insensitive)
  const allTags = useMemo(() => {
    const seen = new Map<string, string>(); // lowercase → original
    for (const c of clients) {
      for (const t of c.tags || []) {
        const k = t.toLowerCase();
        if (!seen.has(k)) seen.set(k, t);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [clients]);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-display flex items-center gap-2.5">
            <Users className="w-6 h-6 text-red-500" />
            Clientes
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{clients.length} clientes cadastrados</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Novo cliente
        </button>
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total', value: kpis.total, icon: Users, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
          { label: 'Ativos', value: kpis.active, icon: UserCheck, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
          { label: 'Receita total', value: formatCurrency(kpis.totalSpent), icon: TrendingUp, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/10', isStr: true },
          { label: 'Ticket médio', value: formatCurrency(kpis.avgTicket), icon: ShoppingCart, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', isStr: true },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="surface rounded-2xl p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{kpi.label}</span>
              <div className={cn('p-1.5 rounded-lg', kpi.bg)}>
                <kpi.icon className={cn('w-4 h-4', kpi.color)} />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {kpi.isStr ? kpi.value : kpi.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, CPF/CNPJ, telefone, e-mail..."
            className="w-full pl-10 pr-10 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(v => !v)}
            className={cn(
              'inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-colors',
              showFilters
                ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/60'
            )}
          >
            <Filter className="w-4 h-4" />
            Filtros
            {(filterTipo !== 'all' || filterStatus !== 'all' || filterTags.length > 0) && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
          </button>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none"
          >
            <option value="name">Nome A-Z</option>
            <option value="totalSpent">Maior valor</option>
            <option value="createdAt">Mais recentes</option>
          </select>
        </div>
      </div>

      {/* Filters panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="surface rounded-xl p-4 flex flex-wrap gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Tipo</label>
                <div className="flex gap-2">
                  {(['all', 'pf', 'pj'] as const).map(t => (
                    <button key={t} onClick={() => setFilterTipo(t)}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        filterTipo === t
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}>
                      {t === 'all' ? 'Todos' : TIPO_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Status</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setFilterStatus('all')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterStatus === 'all'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    )}>
                    Todos
                  </button>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <button key={k} onClick={() => setFilterStatus(k as LeadStatus)}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        filterStatus === k
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      )}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              {allTags.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block flex items-center justify-between">
                    <span>Tags</span>
                    {filterTags.length > 0 && (
                      <button onClick={() => setFilterTags([])} className="text-[10px] text-red-500 hover:text-red-700 normal-case tracking-normal">Limpar</button>
                    )}
                  </label>
                  <div className="flex flex-wrap gap-2 max-w-xl">
                    {allTags.map(tag => {
                      const active = filterTags.some(t => t.toLowerCase() === tag.toLowerCase());
                      return (
                        <button
                          key={tag}
                          onClick={() => setFilterTags(prev => active ? prev.filter(t => t.toLowerCase() !== tag.toLowerCase()) : [...prev, tag])}
                          className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border',
                            active
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-red-300'
                          )}
                        >
                          <Tag className="w-2.5 h-2.5" />
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content area */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Client list */}
        <div className={cn('flex flex-col flex-1 min-w-0 overflow-hidden', selectedClient && 'hidden lg:flex')}>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl shimmer" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                <Users className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-gray-600 dark:text-gray-400 font-medium">
                {search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                {search ? 'Tente outros termos de busca' : 'Clique em "Novo cliente" para começar'}
              </p>
            </motion.div>
          ) : (
            <div className="space-y-1.5 overflow-y-auto pr-1">
              {filtered.map((client, i) => {
                const statusCfg = STATUS_CONFIG[client.status] || STATUS_CONFIG.ganho;
                return (
                  <motion.div
                    key={client.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    onClick={() => setSelectedClient(client)}
                    className={cn(
                      'group flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all border',
                      selectedClient?.id === client.id
                        ? 'border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'
                        : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                    )}
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden">
                      {client.avatarUrl ? (
                        <img src={client.avatarUrl} alt={client.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white font-bold text-sm">
                          {(client.name?.[0] || '?').toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{client.name}</p>
                        {client.tipo === 'pj' && <Building2 className="w-3 h-3 text-gray-400 flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {client.cpfCnpj || client.phone || client.whatsapp || client.email || client.company || '—'}
                      </p>
                      {client.tags && client.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {client.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                              <Tag className="w-2 h-2" />{tag}
                            </span>
                          ))}
                          {client.tags.length > 3 && (
                            <span className="text-[9px] text-gray-400 self-center">+{client.tags.length - 3}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right col */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', statusCfg.color)}>
                        <span className={cn('w-1 h-1 rounded-full', statusCfg.dot)} />
                        {statusCfg.label}
                      </span>
                      {(client.totalSpent || 0) > 0 && (
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {formatCurrency(client.totalSpent || 0)}
                        </span>
                      )}
                    </div>

                    {/* Actions (visible on hover) */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(client); }}
                        className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(client); }}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedClient && (
            <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800">
              <ClientDetailPanel
                client={selectedClient}
                onClose={() => setSelectedClient(null)}
                onEdit={() => openEdit(selectedClient)}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Create/Edit modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setEditingClient(null); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl"
            >
              <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-red-500" />
                  </div>
                  <h2 className="font-semibold text-gray-900 dark:text-white">
                    {editingClient ? 'Editar cliente' : 'Novo cliente'}
                  </h2>
                </div>
                <button onClick={() => { setShowForm(false); setEditingClient(null); }}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6">
                <ClientForm
                  initial={formInitial}
                  onSave={saveClient}
                  onCancel={() => { setShowForm(false); setEditingClient(null); }}
                  isSaving={isSaving}
                  tagSuggestions={allTags}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-2">Excluir cliente?</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
                <strong className="text-gray-700 dark:text-gray-300">{deleteConfirm.name}</strong> será removido permanentemente.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={() => deleteClient(deleteConfirm.id)}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {isDeleting ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
