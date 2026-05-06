'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Plus, Search, Filter, X, Edit2, Trash2, Phone, Mail,
  Building2, User, ChevronDown, CheckCircle2, Tag, MapPin,
  TrendingUp, TrendingDown, ShoppingCart, Star, MoreVertical, Eye, FileText,
  Download, Upload, UserCheck, Gift, Calendar, MessageSquare, History, Clock,
  FileDown, Settings, Plus as PlusIcon, Minus, Trophy, Sparkles, LayoutList, AlignJustify,
} from 'lucide-react';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, limit as firestoreLimit, orderBy, writeBatch, deleteField } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { validateCPF, validateCNPJ } from '@/lib/utils/validators';
import { cn } from '@/lib/utils';
import type { Client, LeadSource, LeadStatus, LoyaltyConfig, LoyaltyTier, LoyaltyHistoryEntry } from '@/lib/types';
import { DEFAULT_LOYALTY_TIERS } from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';
import { toast } from 'react-toastify';
import ClientAgentMemoryPanel from './ClientAgentMemoryPanel';
import Papa from 'papaparse';
import { ClientTableView } from './ClientTableView';

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

// ─── Health / Churn Risk ──────────────────────────────────────────────────────

type ChurnRiskLevel = 'minimal' | 'low' | 'moderate' | 'high' | 'critical';

const CHURN_CFG: Record<ChurnRiskLevel, { label: string; color: string; dot: string; bg: string; bar: string; min: number }> = {
  minimal:  { label: 'Saudável',   color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', bar: 'bg-emerald-500', min: 0  },
  low:      { label: 'Baixo risco',color: 'text-green-600 dark:text-green-400',     dot: 'bg-green-500',   bg: 'bg-green-50 dark:bg-green-500/10',     bar: 'bg-green-500',   min: 20 },
  moderate: { label: 'Moderado',   color: 'text-amber-600 dark:text-amber-400',     dot: 'bg-amber-500',   bg: 'bg-amber-50 dark:bg-amber-500/10',     bar: 'bg-amber-500',   min: 40 },
  high:     { label: 'Alto risco', color: 'text-orange-600 dark:text-orange-400',   dot: 'bg-orange-500',  bg: 'bg-orange-50 dark:bg-orange-500/10',   bar: 'bg-orange-500',  min: 60 },
  critical: { label: 'Crítico',    color: 'text-red-600 dark:text-red-400',         dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-500/10',         bar: 'bg-red-500',     min: 80 },
};

function getChurnLevel(risk: number): ChurnRiskLevel {
  if (risk >= 80) return 'critical';
  if (risk >= 60) return 'high';
  if (risk >= 40) return 'moderate';
  if (risk >= 20) return 'low';
  return 'minimal';
}

function getOverallColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-green-500';
  if (score >= 40) return 'bg-amber-500';
  if (score >= 20) return 'bg-orange-500';
  return 'bg-red-500';
}

// ─── Health Badge (list card) ─────────────────────────────────────────────────

function HealthBadge({ client }: { client: Client }) {
  const risk = client.scores?.churnRisk;
  if (risk == null) return null;
  const cfg = CHURN_CFG[getChurnLevel(risk)];
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium', cfg.bg, cfg.color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── Scores Section (Perfil tab) ──────────────────────────────────────────────

function ScoresSection({ client }: { client: Client }) {
  const scores = client.scores;
  if (!scores || scores.lastCalculatedAt == null) return null;

  const bars = [
    { label: 'Fidelidade',   value: scores.loyalty ?? 0,    color: 'bg-purple-500' },
    { label: 'Valor',        value: scores.value ?? 0,      color: 'bg-blue-500' },
    { label: 'Engajamento',  value: scores.engagement ?? 0, color: 'bg-sky-500' },
    { label: 'Risco de churn', value: scores.churnRisk ?? 0, color: CHURN_CFG[getChurnLevel(scores.churnRisk ?? 0)].bar, invert: true },
  ];

  const overall = scores.overall ?? 0;
  const churnLvl = getChurnLevel(scores.churnRisk ?? 0);
  const churnCfg = CHURN_CFG[churnLvl];

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Saúde do cliente</p>

      {/* Overall gauge */}
      <div className="flex items-center gap-3">
        <div className="relative w-14 h-14 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3.5"
              className="text-gray-100 dark:text-gray-800" />
            <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3.5"
              strokeDasharray={`${overall * 0.879} 87.9`}
              strokeLinecap="round"
              className={cn('transition-all duration-700', overall >= 60 ? 'text-emerald-500' : overall >= 40 ? 'text-amber-500' : 'text-red-500')}
              stroke="currentColor" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900 dark:text-white rotate-0">
            {overall}
          </span>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Score geral: {overall}/100</p>
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium mt-0.5', churnCfg.color)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', churnCfg.dot)} />
            {churnCfg.label}
          </span>
        </div>
      </div>

      {/* Individual bars */}
      <div className="space-y-2">
        {bars.map(b => (
          <div key={b.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{b.label}</span>
              <span className={cn('text-[10px] font-semibold', b.invert && b.value >= 60 ? 'text-red-500' : 'text-gray-600 dark:text-gray-300')}>
                {b.value}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <motion.div
                className={cn('h-full rounded-full', b.color)}
                initial={{ width: 0 }}
                animate={{ width: `${b.value}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
}

const emptyForm: ClientFormData = {
  name: '', email: '', phone: '', whatsapp: '', company: '',
  tipo: 'pf', cpfCnpj: '', inscricaoEstadual: '', indicadorIE: '',
  birthDate: '',
  source: 'outro', status: 'ganho', notes: '', tags: [],
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
};

// ─── Duplicate detection helpers ─────────────────────────────────────────────
const digits = (v: string | undefined | null) => (v || '').replace(/\D/g, '');
const normEmail = (v: string | undefined | null) => (v || '').trim().toLowerCase();

/**
 * Compara dois telefones BR considerando que o mesmo número pode aparecer com
 * ou sem 9º dígito (ex: 11987654321 vs 1187654321), com ou sem código do país
 * (5511987654321 vs 11987654321), e com formatação (parênteses/hífen).
 *
 * Estratégia: normalizar para "core" = últimos 10 dígitos (DDD+8) ou últimos
 * 11 dígitos (DDD+9). Se os "cores" baterem em qualquer combinação, consideramos
 * o mesmo número. Sem isso, cliente cadastrado manualmente como (11) 98765-4321
 * (11 dígitos) e webhook que recebe E.164 sem + (5511987654321, 13 dígitos)
 * não eram detectados como duplicata.
 */
function samePhoneBR(a: string, b: string): boolean {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // Remove código do país BR (55) se presente
  const stripCountry = (n: string) => (n.length >= 12 && n.startsWith('55')) ? n.slice(2) : n;
  const a2 = stripCountry(da);
  const b2 = stripCountry(db);
  if (a2 === b2) return true;
  // Compara últimos 8 dígitos (assinatura sem DDD nem 9º) — match mais agressivo
  const last8a = a2.slice(-8);
  const last8b = b2.slice(-8);
  // Mas só conta se DDD bate (evita falso positivo entre cidades distintas)
  const ddda = a2.slice(0, 2);
  const dddb = b2.slice(0, 2);
  return last8a === last8b && ddda === dddb && last8a.length === 8;
}

function findDuplicate(form: ClientFormData, clients: Client[], editingId?: string): { client: Client; field: string } | null {
  const cpfCnpj = digits(form.cpfCnpj);
  const phone = (form.phone || '').trim();
  const whatsapp = (form.whatsapp || '').trim();
  const email = normEmail(form.email);

  for (const c of clients) {
    if (editingId && c.id === editingId) continue;
    if (c.mergedInto) continue; // skip already-merged secondary records
    if ((c as { deletedAt?: string }).deletedAt) continue; // skip soft-deleted
    if (cpfCnpj && digits(c.cpfCnpj) === cpfCnpj) return { client: c, field: form.tipo === 'pj' ? 'CNPJ' : 'CPF' };
    if (email && normEmail(c.email) === email) return { client: c, field: 'e-mail' };
    if (phone) {
      if (samePhoneBR(c.phone || '', phone)) return { client: c, field: 'telefone' };
      if (samePhoneBR(c.whatsapp || '', phone)) return { client: c, field: 'telefone' };
    }
    if (whatsapp) {
      if (samePhoneBR(c.whatsapp || '', whatsapp)) return { client: c, field: 'WhatsApp' };
      if (samePhoneBR(c.phone || '', whatsapp)) return { client: c, field: 'WhatsApp' };
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

// ─── Export ──────────────────────────────────────────────────────────────────

interface ExportColumn {
  id: string;
  label: string;
  group: string;
  get: (c: Client) => string;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'name',          label: 'Nome',           group: 'Básico',     get: c => c.name },
  { id: 'email',         label: 'E-mail',         group: 'Básico',     get: c => c.email || '' },
  { id: 'phone',         label: 'Telefone',       group: 'Básico',     get: c => c.phone || '' },
  { id: 'whatsapp',      label: 'WhatsApp',       group: 'Básico',     get: c => c.whatsapp || '' },
  { id: 'company',       label: 'Empresa',        group: 'Básico',     get: c => c.company || '' },
  { id: 'tipo',          label: 'Tipo',           group: 'Básico',     get: c => TIPO_LABELS[c.tipo || 'pf'] },
  { id: 'cpfCnpj',       label: 'CPF/CNPJ',       group: 'Básico',     get: c => c.cpfCnpj || '' },
  { id: 'birthDate',     label: 'Aniversário',    group: 'Básico',     get: c => c.birthDate ? formatDate(c.birthDate) : '' },
  { id: 'status',        label: 'Status',         group: 'Básico',     get: c => STATUS_CONFIG[c.status]?.label || c.status },
  { id: 'source',        label: 'Origem',         group: 'Básico',     get: c => SOURCE_LABELS[c.source] || c.source },
  { id: 'tags',          label: 'Tags',           group: 'Básico',     get: c => (c.tags || []).join(', ') },
  { id: 'totalSpent',    label: 'Total gasto',    group: 'Financeiro', get: c => String(c.totalSpent || 0) },
  { id: 'visitCount',    label: 'Compras',        group: 'Financeiro', get: c => String(c.visitCount || 0) },
  { id: 'lastVisit',     label: 'Última compra',  group: 'Financeiro', get: c => formatDate(c.lastVisit || '') },
  { id: 'loyaltyPoints', label: 'Pts fidelidade', group: 'Financeiro', get: c => String(c.loyaltyPoints || 0) },
  { id: 'cep',           label: 'CEP',            group: 'Endereço',   get: c => c.endereco?.cep || '' },
  { id: 'logradouro',    label: 'Logradouro',     group: 'Endereço',   get: c => c.endereco?.logradouro || '' },
  { id: 'numero',        label: 'Número',         group: 'Endereço',   get: c => c.endereco?.numero || '' },
  { id: 'bairro',        label: 'Bairro',         group: 'Endereço',   get: c => c.endereco?.bairro || '' },
  { id: 'municipio',     label: 'Município',      group: 'Endereço',   get: c => c.endereco?.municipio || '' },
  { id: 'uf',            label: 'UF',             group: 'Endereço',   get: c => c.endereco?.uf || '' },
  { id: 'notes',         label: 'Observações',    group: 'Avançado',   get: c => c.notes || '' },
  { id: 'createdAt',     label: 'Cadastrado em',  group: 'Avançado',   get: c => formatDate(c.createdAt) },
];

const DEFAULT_EXPORT_COLS = new Set(['name', 'email', 'phone', 'whatsapp', 'company', 'tipo', 'cpfCnpj', 'status', 'source', 'tags', 'totalSpent', 'visitCount']);

const EXPORT_GROUPS = ['Básico', 'Financeiro', 'Endereço', 'Avançado'];

function downloadCSV(clients: Client[], selectedCols: Set<string>, filename: string) {
  const cols = EXPORT_COLUMNS.filter(c => selectedCols.has(c.id));
  if (cols.length === 0 || clients.length === 0) return;

  const escape = (v: string) => {
    const s = String(v ?? '').replace(/"/g, '""');
    return s.includes(';') || s.includes('\n') || s.includes('"') ? `"${s}"` : s;
  };

  const lines = [
    cols.map(c => escape(c.label)).join(';'),
    ...clients.map(client => cols.map(col => escape(col.get(client))).join(';')),
  ];

  // UTF-8 BOM so Excel BR opens with correct encoding
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportModal({
  allClients,
  filteredClients,
  onClose,
}: {
  allClients: Client[];
  filteredClients: Client[];
  onClose: () => void;
}) {
  const [source, setSource] = useState<'filtered' | 'all'>('filtered');
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(DEFAULT_EXPORT_COLS));

  const toggleCol = (id: string) =>
    setSelectedCols(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleGroup = (group: string) => {
    const groupIds = EXPORT_COLUMNS.filter(c => c.group === group).map(c => c.id);
    const allOn = groupIds.every(id => selectedCols.has(id));
    setSelectedCols(prev => {
      const next = new Set(prev);
      groupIds.forEach(id => allOn ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const clients = source === 'filtered' ? filteredClients : allClients;

  const handleExport = () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(clients, selectedCols, `clientes_${date}.csv`);
    onClose();
  };

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <FileDown className="w-4 h-4 text-emerald-500" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Exportar clientes</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Source */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Quais clientes</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'filtered', label: 'Filtrados atualmente', count: filteredClients.length },
                { key: 'all',      label: 'Todos os clientes',    count: allClients.length },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setSource(opt.key)}
                  className={cn(
                    'flex flex-col items-start px-4 py-3 rounded-xl border text-left transition-all',
                    source === opt.key
                      ? 'border-red-500 bg-red-50/50 dark:bg-red-500/5'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  )}
                >
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{opt.label}</span>
                  <span className={cn('text-lg font-bold mt-0.5', source === opt.key ? 'text-red-600 dark:text-red-400' : 'text-gray-400')}>
                    {opt.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Columns */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Colunas — {selectedCols.size} selecionadas
            </p>
            <div className="space-y-3">
              {EXPORT_GROUPS.map(group => {
                const groupCols = EXPORT_COLUMNS.filter(c => c.group === group);
                const allOn = groupCols.every(c => selectedCols.has(c.id));
                return (
                  <div key={group} className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleGroup(group)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/60 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      {group}
                      <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', allOn ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-500')}>
                        {allOn ? 'Desmarcar todos' : 'Marcar todos'}
                      </span>
                    </button>
                    <div className="px-3 py-2 flex flex-wrap gap-2">
                      {groupCols.map(col => (
                        <button
                          key={col.id}
                          onClick={() => toggleCol(col.id)}
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
                            selectedCols.has(col.id)
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300'
                          )}
                        >
                          <CheckCircle2 className={cn('w-3 h-3', selectedCols.has(col.id) ? 'opacity-100' : 'opacity-0')} />
                          {col.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Formato CSV • abre no Excel
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleExport}
              disabled={selectedCols.size === 0 || clients.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-40"
            >
              <FileDown className="w-4 h-4" />
              Baixar {clients.length} clientes
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ─── Import ──────────────────────────────────────────────────────────────────

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
  };
}

interface ImportResult { created: number; skipped: number; errors: number }

function ImportModal({
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

// ─── Merge duplicates ────────────────────────────────────────────────────────

function detectDuplicates(clients: Client[]): [Client, Client][] {
  const active = clients.filter(c => c.isActive !== false && !c.mergedInto);
  const pairs: [Client, Client][] = [];
  const seen = new Set<string>();

  const addPair = (a: Client, b: Client) => {
    const key = [a.id, b.id].sort().join('|');
    if (!seen.has(key)) { seen.add(key); pairs.push([a, b]); }
  };

  const byCpf  = new Map<string, Client[]>();
  const byMail = new Map<string, Client[]>();
  const byPhone = new Map<string, Client[]>();

  for (const c of active) {
    const cpf = digits(c.cpfCnpj);
    if (cpf.length >= 6) { const g = byCpf.get(cpf) ?? []; g.push(c); byCpf.set(cpf, g); }

    const mail = normEmail(c.email);
    if (mail) { const g = byMail.get(mail) ?? []; g.push(c); byMail.set(mail, g); }

    const ph = digits(c.phone || c.whatsapp || '').slice(-8);
    if (ph.length === 8) { const g = byPhone.get(ph) ?? []; g.push(c); byPhone.set(ph, g); }
  }

  for (const group of [...byCpf.values(), ...byMail.values(), ...byPhone.values()]) {
    for (let i = 0; i < group.length - 1; i++)
      for (let j = i + 1; j < group.length; j++)
        addPair(group[i], group[j]);
  }

  return pairs;
}

async function reassociateRelatedDocs(oldId: string, newId: string, businessId: string) {
  // Cobrir TODAS as coleções que apontam pra Client. Sem isso, merge deixa
  // crmDeals/crmActivities/kanbanCards/loyaltyHistory órfãos apontando pro
  // doc desativado. Conversations.contactName também é denormalizado e fica
  // stale (atualização separada após o merge — ver nameToPropagate abaixo).
  const targets = [
    { col: 'conversations',  field: 'crmContactId' },
    { col: 'appointments',   field: 'clientId' },
    { col: 'sales',          field: 'clientId' },
    { col: 'transactions',   field: 'clientId' },
    { col: 'transactions',   field: 'contactId' },
    { col: 'crmDeals',       field: 'contactId' },
    { col: 'crmActivities',  field: 'contactId' },
    { col: 'kanbanCards',    field: 'contactId' },
    { col: 'loyaltyHistory', field: 'clientId' },
  ];
  for (const { col, field } of targets) {
    try {
      const snap = await getDocs(query(
        collection(db, col),
        where('businessId', '==', businessId),
        where(field, '==', oldId),
      ));
      if (snap.empty) continue;
      // Chunk em batches de 400 (limite Firestore é 500, deixa folga)
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const slice = docs.slice(i, i + 400);
        const batch = writeBatch(db);
        slice.forEach(d => batch.update(d.ref, { [field]: newId, updatedAt: new Date().toISOString() }));
        await batch.commit();
      }
    } catch (err) {
      console.warn(`[Clients merge] reassociate ${col}.${field} failed:`, err);
    }
  }
}

/**
 * Atualiza Conversation.contactName em todas as conversas reassociadas pro
 * client primário (campos denormalizados ficavam stale após merge).
 */
async function propagateContactNameToConversations(clientId: string, newName: string, businessId: string) {
  try {
    const snap = await getDocs(query(
      collection(db, 'conversations'),
      where('businessId', '==', businessId),
      where('crmContactId', '==', clientId),
    ));
    if (snap.empty) return;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const slice = docs.slice(i, i + 400);
      const batch = writeBatch(db);
      slice.forEach(d => batch.update(d.ref, { contactName: newName, updatedAt: new Date().toISOString() }));
      await batch.commit();
    }
  } catch (err) {
    console.warn('[Clients merge] propagate contactName failed:', err);
  }
}

function MergeModal({
  clients,
  businessId,
  onClose,
  onDone,
}: {
  clients: Client[];
  businessId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const pairs = useMemo(() => detectDuplicates(clients), [clients]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [primaryIds, setPrimaryIds] = useState<Record<string, string>>({});
  const [fillEmpty, setFillEmpty] = useState<Record<string, boolean>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [merged, setMerged] = useState<Set<string>>(new Set());
  // Estado do batch "Mesclar tudo": progresso atual + total + flag de erro.
  const [batchMerging, setBatchMerging] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [confirmMergeAll, setConfirmMergeAll] = useState(false);

  const activePairs = pairs.filter(([a, b]) => {
    const key = [a.id, b.id].sort().join('|');
    return !dismissed.has(key) && !merged.has(key);
  });

  const pairKey = (a: Client, b: Client) => [a.id, b.id].sort().join('|');

  const handleMerge = async (a: Client, b: Client) => {
    const key = pairKey(a, b);
    const primaryId = primaryIds[key] ?? a.id;
    const primary   = primaryId === a.id ? a : b;
    const secondary = primaryId === a.id ? b : a;
    const fill = fillEmpty[key] ?? true;

    setMerging(key);
    try {
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { updatedAt: now };

      if (fill) {
        if (!primary.email      && secondary.email)      updates.email      = secondary.email;
        if (!primary.phone      && secondary.phone)      updates.phone      = secondary.phone;
        if (!primary.whatsapp   && secondary.whatsapp)   updates.whatsapp   = secondary.whatsapp;
        if (!primary.company    && secondary.company)    updates.company    = secondary.company;
        if (!primary.cpfCnpj    && secondary.cpfCnpj)    updates.cpfCnpj    = secondary.cpfCnpj;
        if (!primary.notes      && secondary.notes)      updates.notes      = secondary.notes;
        if (!primary.endereco   && secondary.endereco)   updates.endereco   = secondary.endereco;

        const allTags = [...new Set([...(primary.tags ?? []), ...(secondary.tags ?? [])])];
        if (allTags.length) updates.tags = allTags;

        if ((secondary.totalSpent ?? 0) > 0)
          updates.totalSpent = (primary.totalSpent ?? 0) + (secondary.totalSpent ?? 0);
        if ((secondary.visitCount ?? 0) > 0)
          updates.visitCount = (primary.visitCount ?? 0) + (secondary.visitCount ?? 0);
        if ((secondary.loyaltyPoints ?? 0) > 0)
          updates.loyaltyPoints = (primary.loyaltyPoints ?? 0) + (secondary.loyaltyPoints ?? 0);

        // Merge channel identities: secondary fills gaps in primary (primary takes precedence)
        const mergedIdentities = {
          ...(secondary.channelIdentities ?? {}),
          ...(primary.channelIdentities ?? {}),
        };
        if (Object.keys(mergedIdentities).length) updates.channelIdentities = mergedIdentities;
      }

      const batch = writeBatch(db);
      batch.update(doc(db, 'clients', primary.id), updates);
      batch.update(doc(db, 'clients', secondary.id), {
        isActive: false,
        mergedInto: primary.id,
        mergedAt: now,
        updatedAt: now,
      });
      await batch.commit();

      // Await reassociation so conversations/sales/appointments point to the primary
      // before the dialog closes. Each collection has its own try-catch — won't throw.
      await reassociateRelatedDocs(secondary.id, primary.id, businessId);
      // Propaga nome do primary nas conversas reassociadas (denorm fica stale)
      const finalName = (primary.name || '').trim();
      if (finalName) {
        await propagateContactNameToConversations(primary.id, finalName, businessId);
      }

      setMerged(prev => new Set([...prev, key]));
      onDone();
    } catch (err) {
      console.error('Merge error:', err);
    } finally {
      setMerging(null);
    }
  };

  // Mesclagem em lote: roda handleMerge sequencialmente em todos os pairs
  // ativos. Sequencial (não paralelo) porque writeBatch + reassociateRelatedDocs
  // mexem em coleções compartilhadas — paralelizar arrisca race em conv/sales/etc.
  // Cada par usa o primary atualmente selecionado (ou default = primeiro do par).
  const handleMergeAll = async () => {
    setConfirmMergeAll(false);
    const pairsToProcess = [...activePairs];
    setBatchMerging({ done: 0, total: pairsToProcess.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < pairsToProcess.length; i++) {
      const [a, b] = pairsToProcess[i];
      try {
        await handleMerge(a, b);
      } catch (err) {
        failed++;
        console.error(`[Merge all] Failed pair ${i + 1}:`, err);
      }
      setBatchMerging({ done: i + 1, total: pairsToProcess.length, failed });
    }
    // Mantém o status visível por 1.2s pra usuário ver o "concluído"
    setTimeout(() => setBatchMerging(null), 1200);
  };

  const ClientCard = ({ client, isPrimary, onSelect }: { client: Client; isPrimary: boolean; onSelect: () => void }) => (
    <div
      onClick={onSelect}
      // `min-w-0` é o que conserta o overflow horizontal: sem ele, flex-1
      // não shrinka abaixo do tamanho intrínseco do conteúdo (nomes longos
      // como "COMERCIO DE ERVA MATE COR E SABOR LTDA" forçavam o card a
      // crescer e cortavam o segundo card no eixo X).
      className={cn(
        'flex-1 min-w-0 rounded-xl p-3 border-2 cursor-pointer transition-all',
        isPrimary
          ? 'border-emerald-400 dark:border-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/5'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      )}
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {(client.name?.[0] ?? '?').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{client.name}</p>
          {client.company && <p className="text-[10px] text-gray-400 truncate">{client.company}</p>}
        </div>
        {isPrimary && (
          <span className="ml-auto flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            MANTER
          </span>
        )}
      </div>
      <div className="space-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
        {client.email  && <p className="truncate">✉ {client.email}</p>}
        {client.phone  && <p className="truncate">📞 {client.phone}</p>}
        {client.cpfCnpj && <p className="truncate">📄 {client.cpfCnpj}</p>}
        {(client.totalSpent ?? 0) > 0 && <p className="text-emerald-600 dark:text-emerald-400 font-medium truncate">💰 {formatCurrency(client.totalSpent ?? 0)}</p>}
        <p className="text-gray-300 dark:text-gray-600 truncate">Cadastro: {formatDate(client.createdAt)}</p>
      </div>
    </div>
  );

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-amber-500" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Duplicatas detectadas</h2>
              <p className="text-[10px] text-gray-400">
                {activePairs.length > 0 ? `${activePairs.length} par${activePairs.length > 1 ? 'es' : ''} encontrado${activePairs.length > 1 ? 's' : ''}` : 'Nenhuma duplicata pendente'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Botão "Mesclar tudo" — só aparece quando há ≥2 pares ativos.
                Mantém o "MANTER" atualmente selecionado em cada par (default
                = primeiro do par, mas usuário pode pré-selecionar antes). */}
            {activePairs.length >= 2 && !batchMerging && (
              <button
                onClick={() => setConfirmMergeAll(true)}
                disabled={!!merging}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mesclar tudo ({activePairs.length})
              </button>
            )}
            {batchMerging && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                  <Star className="w-3 h-3 text-amber-600" />
                </motion.div>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                  {batchMerging.done}/{batchMerging.total}
                  {batchMerging.failed > 0 && ` (${batchMerging.failed} falha${batchMerging.failed > 1 ? 's' : ''})`}
                </span>
              </div>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Confirmação inline pra "Mesclar tudo" — destrutivo, não dá pra desfazer
            sem restaurar manualmente (soft-delete só reativa o secundário). */}
        {confirmMergeAll && (
          <div className="px-6 py-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 flex items-center justify-between gap-3 flex-shrink-0">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Mesclar todos os {activePairs.length} pares? O card verde "MANTER" de cada par será preservado; o outro será desativado.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setConfirmMergeAll(false)}
                className="px-3 py-1 rounded-lg text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleMergeAll}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {activePairs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Tudo limpo!</p>
              <p className="text-xs text-gray-400 mt-1">Nenhuma duplicata encontrada na base de clientes.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {activePairs.map(([a, b]) => {
                const key = pairKey(a, b);
                const primaryId = primaryIds[key] ?? a.id;
                const fill = fillEmpty[key] ?? true;
                const isMerging = merging === key;

                return (
                  <div key={key} className="p-4 space-y-3">
                    {/* Cards */}
                    <div className="flex gap-2">
                      <ClientCard client={a} isPrimary={primaryId === a.id}
                        onSelect={() => setPrimaryIds(p => ({ ...p, [key]: a.id }))} />
                      <div className="flex items-center flex-shrink-0 text-gray-300 dark:text-gray-600 font-light text-lg">VS</div>
                      <ClientCard client={b} isPrimary={primaryId === b.id}
                        onSelect={() => setPrimaryIds(p => ({ ...p, [key]: b.id }))} />
                    </div>

                    {/* Options */}
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={fill}
                          onChange={e => setFillEmpty(p => ({ ...p, [key]: e.target.checked }))}
                          className="w-3.5 h-3.5 rounded accent-red-500"
                        />
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          Copiar campos vazios + somar totais
                        </span>
                      </label>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDismissed(p => new Set([...p, key]))}
                        disabled={!!batchMerging}
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                      >
                        Ignorar este par
                      </button>
                      <button
                        onClick={() => handleMerge(a, b)}
                        disabled={isMerging || !!batchMerging}
                        className="flex-1 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {isMerging ? (
                          <>
                            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                              <Star className="w-3 h-3" />
                            </motion.div>
                            Mesclando...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Mesclar — manter {primaryId === a.id ? (a.name ?? '').split(' ')[0] : (b.name ?? '').split(' ')[0]}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
          <p className="text-[10px] text-gray-400 text-center">
            Clicar no card verde seleciona qual registro será mantido. O outro é desativado e suas conversas, compras e agendamentos são transferidos.
          </p>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ─── Loyalty Program ─────────────────────────────────────────────────────────

function getClientTier(points: number, tiers: LoyaltyTier[]): LoyaltyTier | null {
  const sorted = [...tiers].sort((a, b) => b.minPoints - a.minPoints);
  return sorted.find(t => points >= t.minPoints) ?? null;
}

function TierBadge({ points, tiers }: { points: number; tiers: LoyaltyTier[] }) {
  const tier = getClientTier(points, tiers);
  if (!tier) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border"
      style={{ color: tier.color, backgroundColor: tier.color + '18', borderColor: tier.color + '50' }}
    >
      <Trophy className="w-2.5 h-2.5" />
      {tier.name}
    </span>
  );
}

// ─── Loyalty Settings Modal ───────────────────────────────────────────────────

function LoyaltySettingsModal({
  current,
  businessId,
  onClose,
  onSaved,
}: {
  current?: LoyaltyConfig;
  businessId: string;
  onClose: () => void;
  onSaved: (cfg: LoyaltyConfig) => void;
}) {
  const [isEnabled, setIsEnabled] = useState(current?.isEnabled ?? false);
  const [pointsPerReal, setPointsPerReal] = useState(String(current?.pointsPerReal ?? 1));
  const [pointValue, setPointValue] = useState(String(current?.pointValueInCentavos ?? 1));
  const [minRedeem, setMinRedeem] = useState(String(current?.minPointsToRedeem ?? 100));
  const [expireDays, setExpireDays] = useState(String(current?.expirationDays ?? ''));
  const [tiers, setTiers] = useState<LoyaltyTier[]>(current?.tiers ?? DEFAULT_LOYALTY_TIERS);
  const [saving, setSaving] = useState(false);

  const updateTier = (i: number, patch: Partial<LoyaltyTier>) =>
    setTiers(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t));

  const handleSave = async () => {
    setSaving(true);
    const parsePositive = (raw: string, fallback: number, min = 1) =>
      Math.max(min, Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : fallback);
    const cfg: LoyaltyConfig = {
      isEnabled,
      pointsPerReal:        parsePositive(pointsPerReal, 1, 0),
      pointValueInCentavos: parsePositive(pointValue, 1),
      minPointsToRedeem:    parsePositive(minRedeem, 100),
      expirationDays: expireDays && Number.isFinite(Number(expireDays)) && Number(expireDays) > 0
        ? Number(expireDays) : null,
      tiers: tiers.filter(t => t.name.trim()).sort((a, b) => a.minPoints - b.minPoints),
    };
    try {
      await updateDoc(doc(db, 'businesses', businessId), { 'settings.loyalty': cfg, updatedAt: new Date().toISOString() });
      onSaved(cfg);
      onClose();
    } catch (err) {
      console.error('Loyalty settings save error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-amber-500" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Programa de Fidelidade</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/60 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Ativar programa</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Clientes acumulam e resgatam pontos</p>
            </div>
            <button
              onClick={() => setIsEnabled(v => !v)}
              className={cn('w-11 h-6 rounded-full transition-colors relative', isEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600')}
            >
              <span className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', isEnabled ? 'translate-x-5' : 'translate-x-0.5')} />
            </button>
          </div>

          {/* Rules */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Regras de acúmulo e resgate</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Pontos por R$1 gasto', value: pointsPerReal, set: setPointsPerReal, hint: 'ex: 1' },
                { label: 'Centavos por ponto resgatado', value: pointValue, set: setPointValue, hint: 'ex: 1 = R$0,01/pt' },
                { label: 'Mínimo para resgatar (pts)', value: minRedeem, set: setMinRedeem, hint: 'ex: 100' },
                { label: 'Expiração (dias, vazio = nunca)', value: expireDays, set: setExpireDays, hint: 'ex: 365' },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">{f.label}</label>
                  <input
                    type="number"
                    value={f.value}
                    onChange={e => f.set(e.target.value)}
                    placeholder={f.hint}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Tiers */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tiers</p>
              <button
                onClick={() => setTiers(prev => [...prev, { name: '', minPoints: 0, color: '#6366F1', benefits: '' }])}
                className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 flex items-center gap-1"
              >
                <PlusIcon className="w-3 h-3" /> Adicionar tier
              </button>
            </div>
            <div className="space-y-2">
              {tiers.map((tier, i) => (
                <div key={i} className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700">
                  <input
                    type="color"
                    value={tier.color}
                    onChange={e => updateTier(i, { color: e.target.value })}
                    className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent flex-shrink-0"
                  />
                  <input
                    value={tier.name}
                    onChange={e => updateTier(i, { name: e.target.value })}
                    placeholder="Nome (ex: Ouro)"
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none"
                  />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input
                      type="number"
                      value={tier.minPoints}
                      onChange={e => updateTier(i, { minPoints: Number(e.target.value) })}
                      className="w-20 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none"
                      placeholder="Min pts"
                    />
                    <span className="text-[10px] text-gray-400">pts+</span>
                  </div>
                  <input
                    value={tier.benefits ?? ''}
                    onChange={e => updateTier(i, { benefits: e.target.value })}
                    placeholder="Benefício"
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none"
                  />
                  <button onClick={() => setTiers(prev => prev.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar programa'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ─── Points Adjust Modal ──────────────────────────────────────────────────────

function PointsAdjustModal({
  client,
  businessId,
  user,
  onClose,
  onDone,
}: {
  client: Client;
  businessId: string;
  user: { uid: string; name: string };
  onClose: () => void;
  onDone: (newBalance: number) => void;
}) {
  const [mode, setMode] = useState<'add' | 'subtract'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const currentPts = client.loyaltyPoints ?? 0;
  const delta = Number(amount) || 0;
  const newBalance = mode === 'add' ? currentPts + delta : Math.max(0, currentPts - delta);

  const handleSave = async () => {
    if (!delta || !reason.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const signedAmount = mode === 'add' ? delta : -delta;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'clients', client.id), { loyaltyPoints: newBalance, updatedAt: now });
      const histRef = doc(collection(db, 'loyaltyHistory'));
      const entry: Omit<LoyaltyHistoryEntry, 'id'> = {
        clientId: client.id,
        businessId,
        type: 'manual',
        amount: signedAmount,
        balance: newBalance,
        reason: reason.trim(),
        createdBy: user.uid,
        createdByName: user.name,
        createdAt: now,
      };
      batch.set(histRef, entry);
      await batch.commit();
      onDone(newBalance);
      onClose();
    } catch (err) {
      console.error('Points adjust error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Ajustar pontos</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current balance */}
          <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl">
            <p className="text-xs text-amber-700 dark:text-amber-300">Saldo atual de {client.name.split(' ')[0]}</p>
            <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{currentPts} pts</p>
          </div>

          {/* Add / Subtract toggle */}
          <div className="flex gap-2">
            {(['add', 'subtract'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all border',
                  mode === m
                    ? m === 'add' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-red-500 text-white border-red-500'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                )}
              >
                {m === 'add' ? <PlusIcon className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                {m === 'add' ? 'Adicionar' : 'Subtrair'}
              </button>
            ))}
          </div>

          <div>
            <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">Quantidade de pontos</label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-lg font-bold text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 text-center"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">Motivo *</label>
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="ex: Aniversário do cliente, resgate de brinde..."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            />
          </div>

          {delta > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl text-xs">
              <span className="text-gray-500">Novo saldo:</span>
              <span className={cn('font-bold', mode === 'add' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {newBalance} pts
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !delta || !reason.trim()}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Salvando...' : 'Confirmar'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ─── Loyalty History Section ──────────────────────────────────────────────────

const HISTORY_TYPE_CFG: Record<LoyaltyHistoryEntry['type'], { label: string; color: string }> = {
  add:      { label: '+', color: 'text-emerald-600 dark:text-emerald-400' },
  subtract: { label: '−', color: 'text-red-500 dark:text-red-400' },
  sale:     { label: '+', color: 'text-emerald-600 dark:text-emerald-400' },
  redeem:   { label: '−', color: 'text-amber-600 dark:text-amber-400' },
  expire:   { label: '−', color: 'text-gray-400' },
  manual:   { label: '±', color: 'text-blue-500 dark:text-blue-400' },
};

function LoyaltyHistorySection({ clientId, businessId }: { clientId: string; businessId: string }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['loyalty-history', clientId],
    queryFn: async (): Promise<LoyaltyHistoryEntry[]> => {
      // No orderBy to avoid requiring a composite Firestore index — sort client-side
      const snap = await getDocs(query(
        collection(db, 'loyaltyHistory'),
        where('businessId', '==', businessId),
        where('clientId', '==', clientId),
        firestoreLimit(30),
      ));
      return snap.docs
        .map(d => ({ ...d.data(), id: d.id } as LoyaltyHistoryEntry))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 15);
    },
    enabled: !!clientId && !!businessId,
    staleTime: 60 * 1000,
  });

  if (isLoading) return <div className="h-8 shimmer rounded-lg" />;
  if (!history.length) return (
    <p className="text-xs text-gray-400 italic">Nenhuma movimentação ainda</p>
  );

  return (
    <div className="space-y-1.5 mt-2">
      {history.map(h => {
        const cfg = HISTORY_TYPE_CFG[h.type];
        return (
          <div key={h.id} className="flex items-center gap-2">
            <span className={cn('text-xs font-bold w-4 text-center flex-shrink-0', cfg.color)}>
              {cfg.label}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-gray-700 dark:text-gray-300 truncate">{h.reason}</p>
              <p className="text-[9px] text-gray-400">{formatDate(h.createdAt)}</p>
            </div>
            <span className={cn('text-xs font-semibold flex-shrink-0', cfg.color)}>
              {h.amount > 0 ? '+' : ''}{h.amount} pts
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Client Timeline ─────────────────────────────────────────────────────────

type TimelineEventKind = 'conversation' | 'appointment' | 'sale' | 'transaction_in' | 'transaction_out';

interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  title: string;
  subtitle?: string;
  amount?: number;
  status?: string;
  timestamp: string;
}

const TL_CFG: Record<TimelineEventKind, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  conversation:    { icon: MessageSquare, color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-500/10',    label: 'Conversa'    },
  appointment:     { icon: Calendar,      color: 'text-purple-500',  bg: 'bg-purple-50 dark:bg-purple-500/10', label: 'Agendamento' },
  sale:            { icon: ShoppingCart,  color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', label: 'Venda'    },
  transaction_in:  { icon: TrendingUp,    color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', label: 'Receita'  },
  transaction_out: { icon: TrendingDown,  color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-500/10',      label: 'Despesa'    },
};

const APPT_STATUS_LABEL: Record<string, string> = {
  agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído',
  cancelado: 'Cancelado', 'no-show': 'Não compareceu', remarcado: 'Remarcado',
};
const CONV_STATUS_LABEL: Record<string, string> = { open: 'Aberta', waiting: 'Aguardando', resolved: 'Resolvida' };
const TX_STATUS_LABEL: Record<string, string> = { pendente: 'Pendente', pago: 'Pago', atrasado: 'Atrasado', cancelado: 'Cancelado' };
const CH_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram' };

function tlRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d > 365 ? '2-digit' : undefined });
  } catch { return '—'; }
}

async function safeQuery<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

function ClientTimeline({ client, businessId }: { client: Client; businessId: string }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['client-timeline', client.id, businessId],
    queryFn: async (): Promise<TimelineEvent[]> => {
      const all: TimelineEvent[] = [];

      const [convSnap, apptSnap, salesSnap, txSnap] = await Promise.all([
        safeQuery(() => getDocs(query(
          collection(db, 'conversations'),
          where('businessId', '==', businessId),
          where('crmContactId', '==', client.id),
          firestoreLimit(20),
        ))),
        safeQuery(() => getDocs(query(
          collection(db, 'appointments'),
          where('businessId', '==', businessId),
          where('clientId', '==', client.id),
          firestoreLimit(20),
        ))),
        safeQuery(() => getDocs(query(
          collection(db, 'sales'),
          where('businessId', '==', businessId),
          where('clientId', '==', client.id),
          firestoreLimit(20),
        ))),
        safeQuery(() => getDocs(query(
          collection(db, 'transactions'),
          where('businessId', '==', businessId),
          where('clientId', '==', client.id),
          firestoreLimit(20),
        ))),
      ]);

      convSnap?.docs?.forEach(d => {
        const v = d.data();
        all.push({
          id: `conv_${d.id}`, kind: 'conversation',
          title: `Conversa via ${CH_LABEL[v.channel] ?? v.channel}`,
          subtitle: v.lastMessage ? String(v.lastMessage).slice(0, 70) : undefined,
          status: v.status,
          timestamp: v.lastMessageAt || v.createdAt || '',
        });
      });

      apptSnap?.docs?.forEach(d => {
        const v = d.data();
        const dateStr = v.date ? `${v.date}T${v.startTime ?? '00:00'}` : (v.createdAt || '');
        all.push({
          id: `appt_${d.id}`, kind: 'appointment',
          title: v.serviceName || 'Agendamento',
          subtitle: v.professionalName ? `com ${v.professionalName} • ${v.date} ${v.startTime}` : `${v.date ?? ''} às ${v.startTime ?? ''}`,
          amount: v.price,
          status: v.status,
          timestamp: dateStr,
        });
      });

      salesSnap?.docs?.forEach(d => {
        const v = d.data();
        const items: Array<{ description: string }> = v.items || [];
        all.push({
          id: `sale_${d.id}`, kind: 'sale',
          title: `Venda — ${items.length} item${items.length !== 1 ? 's' : ''}`,
          subtitle: items.slice(0, 2).map(i => i.description).join(', ') || undefined,
          amount: v.total,
          status: v.status,
          timestamp: v.createdAt || '',
        });
      });

      txSnap?.docs?.forEach(d => {
        const v = d.data();
        all.push({
          id: `tx_${d.id}`, kind: v.type === 'receita' ? 'transaction_in' : 'transaction_out',
          title: v.description || (v.type === 'receita' ? 'Receita' : 'Despesa'),
          subtitle: v.category || undefined,
          amount: v.amount,
          status: v.status,
          timestamp: v.paymentDate || v.dueDate || v.createdAt || '',
        });
      });

      // Sort descending; empty timestamps go to end
      all.sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return b.timestamp.localeCompare(a.timestamp);
      });
      const seen = new Set<string>();
      return all.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
    },
    enabled: !!client.id && !!businessId,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-8 h-8 rounded-full shimmer flex-shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 rounded shimmer w-3/4" />
              <div className="h-2.5 rounded shimmer w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-5 text-center">
        <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
          <History className="w-5 h-5 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Sem histórico ainda</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Conversas, compras e agendamentos aparecerão aqui
        </p>
      </div>
    );
  }

  return (
    <div className="relative px-5 py-4">
      {/* linha vertical */}
      <div className="absolute left-[2.35rem] top-4 bottom-4 w-px bg-gray-100 dark:bg-gray-800" />

      <div className="space-y-5">
        {events.map(ev => {
          const cfg = TL_CFG[ev.kind];
          const Icon = cfg.icon;
          const statusLabel =
            ev.kind === 'appointment'     ? APPT_STATUS_LABEL[ev.status ?? ''] :
            ev.kind === 'conversation'    ? CONV_STATUS_LABEL[ev.status ?? ''] :
            ev.kind === 'transaction_in' || ev.kind === 'transaction_out'
                                          ? TX_STATUS_LABEL[ev.status ?? '']   : undefined;

          return (
            <div key={ev.id} className="flex gap-3 relative">
              <div className={cn('w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center z-10 ring-2 ring-white dark:ring-gray-900', cfg.bg)}>
                <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-snug">
                      {ev.title}
                    </p>
                    {ev.subtitle && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{ev.subtitle}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {tlRelative(ev.timestamp)}
                    </span>
                    {ev.amount != null && ev.amount > 0 && (
                      <span className={cn('text-[10px] font-bold', cfg.color)}>
                        {formatCurrency(ev.amount)}
                      </span>
                    )}
                  </div>
                </div>
                {statusLabel && (
                  <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {statusLabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Client Detail Panel ──────────────────────────────────────────────────────

function ClientDetailPanel({ client, onClose, onEdit, loyaltyConfig: loyaltyCfg }: { client: Client; onClose: () => void; onEdit: () => void; loyaltyConfig?: LoyaltyConfig }) {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'perfil' | 'timeline'>('perfil');
  const [showPointsAdjust, setShowPointsAdjust] = useState(false);
  const [localPoints, setLocalPoints] = useState<number | null>(null);

  // Reset local points state whenever the selected client changes
  const prevClientId = useState(client.id);
  if (prevClientId[0] !== client.id) {
    prevClientId[1](client.id);
    setLocalPoints(null);
  }

  const displayPoints = localPoints ?? client.loyaltyPoints ?? 0;
  const tiers = loyaltyCfg?.tiers ?? DEFAULT_LOYALTY_TIERS;
  const loyaltyEnabled = loyaltyCfg?.isEnabled ?? false;
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
          <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-sm flex-shrink-0">
            {client.avatarUrl ? (
              <img src={client.avatarUrl} alt={client.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white font-bold text-lg">
                {(client.name?.[0] || '?').toUpperCase()}
              </div>
            )}
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

      {/* Tabs */}
      <div className="flex border-b border-gray-100 dark:border-gray-800 px-5">
        {(['perfil', 'timeline'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors capitalize',
              activeTab === tab
                ? 'border-red-500 text-red-600 dark:text-red-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            )}
          >
            {tab === 'perfil' ? 'Perfil' : 'Timeline'}
          </button>
        ))}
      </div>

      {/* Tab: Timeline */}
      {activeTab === 'timeline' && (
        <ClientTimeline client={client} businessId={business?.id ?? ''} />
      )}

      {/* Tab: Perfil */}
      {activeTab === 'perfil' && (
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
          {(loyaltyEnabled || displayPoints > 0) && (
            <div className="col-span-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gift className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">Pontos de fidelidade</p>
                  <TierBadge points={displayPoints} tiers={tiers} />
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{displayPoints} pts</p>
                  <button
                    onClick={() => setShowPointsAdjust(true)}
                    className="p-1 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-500/30 transition-colors"
                    title="Ajustar pontos"
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {/* Tier progress */}
              {(() => {
                const currentTier = getClientTier(displayPoints, tiers);
                const sorted = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
                const nextTier = sorted.find(t => t.minPoints > displayPoints);
                if (!nextTier || !currentTier) return null;
                const range = nextTier.minPoints - currentTier.minPoints;
                if (range === 0) return null;
                const progress = Math.min(100, Math.max(0, ((displayPoints - currentTier.minPoints) / range) * 100));
                return (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] text-amber-600 dark:text-amber-400">
                      <span>{currentTier.name}</span>
                      <span>{nextTier.minPoints - displayPoints} pts para {nextTier.name}</span>
                    </div>
                    <div className="h-1.5 bg-amber-100 dark:bg-amber-900/40 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: nextTier.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </div>
                );
              })()}
              {/* Histórico de pontos */}
              <div className="border-t border-amber-100 dark:border-amber-800/30 pt-2">
                <p className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1.5">Histórico</p>
                <LoyaltyHistorySection clientId={client.id} businessId={business?.id ?? ''} />
              </div>
            </div>
          )}
        </div>

        {/* Scores / Health */}
        <ScoresSection client={client} />

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
          {/* Aniversário (PF) ou Fundação (PJ) — base pra automação futura
              de "feliz aniversário". Mostra quantos dias faltam pra vencer
              quando >= hoje, ou "hoje 🎂" quando bate. */}
          {client.birthDate && (() => {
            const isPj = client.tipo === 'pj';
            const label = isPj ? 'Fundação' : 'Nascimento';
            // Parse ISO YYYY-MM-DD como date local pra evitar shift de UTC.
            const [yStr, mStr, dStr] = client.birthDate.split('-');
            const year = Number(yStr); const month = Number(mStr); const day = Number(dStr);
            if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
            const formatted = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thisYearAnniv = new Date(today.getFullYear(), month - 1, day);
            const nextAnniv = thisYearAnniv >= today
              ? thisYearAnniv
              : new Date(today.getFullYear() + 1, month - 1, day);
            const daysUntil = Math.round((nextAnniv.getTime() - today.getTime()) / 86400000);
            const isToday = daysUntil === 0;
            return (
              <div className="flex items-center gap-3 p-2.5 rounded-lg">
                <Calendar className="w-4 h-4 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 dark:text-gray-300">{formatted}</p>
                  <p className={cn(
                    'text-[11px] mt-0.5',
                    isToday
                      ? 'text-amber-600 dark:text-amber-400 font-semibold'
                      : daysUntil <= 7
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-gray-400 dark:text-gray-500',
                  )}>
                    {isToday
                      ? `🎂 ${label} hoje!`
                      : `${label} · em ${daysUntil} dia${daysUntil === 1 ? '' : 's'}`}
                  </p>
                </div>
              </div>
            );
          })()}
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

        {/* Agent memory panel — what the AI remembers about this client (LGPD) */}
        <ClientAgentMemoryPanel contactId={client.id} contactName={client.name} />
      </div>
      )} {/* end perfil tab */}

      {/* Points adjust modal */}
      <AnimatePresence>
        {showPointsAdjust && user && (
          <PointsAdjustModal
            client={{ ...client, loyaltyPoints: displayPoints }}
            businessId={business?.id ?? ''}
            user={{ uid: user.uid, name: user.name }}
            onClose={() => setShowPointsAdjust(false)}
            onDone={newBalance => {
              setLocalPoints(newBalance);
              queryClient.invalidateQueries({ queryKey: ['loyalty-history', client.id] });
              queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────

export default function ClientsModule() {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();

  const [clientsView, setClientsView] = useState<'list' | 'table'>(() => {
    if (typeof window === 'undefined') return 'list';
    return (localStorage.getItem('clients_view') as 'list' | 'table') ?? 'table';
  });
  const handleClientsView = (v: 'list' | 'table') => {
    setClientsView(v);
    localStorage.setItem('clients_view', v);
  };
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState<'all' | 'pf' | 'pj'>('all');
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'all'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterChurnRisk, setFilterChurnRisk] = useState<ChurnRiskLevel | 'all'>('all');
  // 'all' = sem filtro; 'this_month' = mês corrente; 'next_month' = próximo;
  // 1-12 = mês específico (1=janeiro, 12=dezembro). Útil pra preparar
  // promoções de aniversário antes de criar a campanha automatizada.
  const [filterBirthMonth, setFilterBirthMonth] = useState<'all' | 'this_month' | 'next_month' | number>('all');
  const [sortBy, setSortBy] = useState<'name' | 'totalSpent' | 'createdAt' | 'churnRisk'>('name');
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showLoyaltySettings, setShowLoyaltySettings] = useState(false);
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig | undefined>(business?.settings?.loyalty);
  const isAdmin = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];
  const [showFilters, setShowFilters] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Client | null>(null);
  // Multi-seleção pra exclusão em massa (importação errada, etc.)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Lock-scroll do wrapper de tab ativo enquanto qualquer modal estiver aberto.
  // Sem isso, com os modais portalados pra document.body, a página atrás
  // ainda fica scrollável.
  useEffect(() => {
    const anyOpen = showForm || showImport || showExport || showMerge || showLoyaltySettings || !!deleteConfirm || bulkDeleteOpen;
    if (!anyOpen) return;
    const el = document.querySelector<HTMLElement>(
      '.will-change-transform.pointer-events-auto.overflow-y-auto',
    );
    if (!el) return;
    const prevOverflow = el.style.overflowY;
    el.style.overflowY = 'hidden';
    return () => { el.style.overflowY = prevOverflow; };
  }, [showForm, showImport, showExport, showMerge, showLoyaltySettings, deleteConfirm, bulkDeleteOpen]);

  // Quando o usuário seleciona um cliente pra ver detalhes, sobe a viewport
  // pra topo do wrapper de tab — sem isso, se ele tinha scrollado a lista
  // pra baixo procurando o cliente, o painel lateral abre fora da área visível.
  useEffect(() => {
    if (!selectedClient) return;
    const el = document.querySelector<HTMLElement>(
      '.will-change-transform.pointer-events-auto.overflow-y-auto',
    );
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedClient?.id]);

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

  // ─── Pré-seleção via sessionStorage ─────────────────────────────────────────
  // Usado pelo Conversas → "Ver/editar contato" para abrir o cliente direto
  // quando navega pra cá. Limpa o storage após consumir (não persiste entre
  // navegações repetidas).
  useEffect(() => {
    if (!clients.length || selectedClient) return;
    let preselectId: string | null = null;
    try {
      preselectId = sessionStorage.getItem('aevo:preselectClientId');
    } catch { /* indisponível */ }
    if (!preselectId) return;
    const target = clients.find(c => c.id === preselectId);
    if (target) {
      setSelectedClient(target);
    }
    try {
      sessionStorage.removeItem('aevo:preselectClientId');
    } catch { /* ok */ }
  }, [clients, selectedClient]);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const { mutate: saveClient, isPending: isSaving } = useMutation({
    mutationFn: async (data: ClientFormData) => {
      // Validação CPF/CNPJ — antes não era feita ANTES do save, então cliente
      // PJ com CNPJ inválido vinha a quebrar depois na emissão de NFe.
      // Só valida quando o campo está preenchido (CPF/CNPJ é opcional).
      const cpfCnpjRaw = (data.cpfCnpj || '').trim();
      if (cpfCnpjRaw) {
        const isValid = data.tipo === 'pj' ? validateCNPJ(cpfCnpjRaw) : validateCPF(cpfCnpjRaw);
        if (!isValid) {
          throw new Error(`${data.tipo === 'pj' ? 'CNPJ' : 'CPF'} inválido — confira os dígitos`);
        }
      }

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
        indicadorIE: (['1', '2', '9'] as const).includes(data.indicadorIE as '1' | '2' | '9')
          ? (data.indicadorIE as '1' | '2' | '9')
          : undefined,
        // ISO YYYY-MM-DD. Vazio vira undefined pra updateDoc descartar (o
        // mecanismo de deleteField em editingClient cuida do limpar).
        birthDate: data.birthDate.trim() || undefined,
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
        // updateDoc rejeita undefined — converte para deleteField() para limpar campos apagados
        const updatePayload = Object.fromEntries(
          Object.entries(payload).map(([k, v]) => [k, v === undefined ? deleteField() : v])
        );
        await updateDoc(doc(db, 'clients', editingClient.id), updatePayload);
      } else {
        // addDoc: remove undefined para não gravar campos vazios
        const createPayload = Object.fromEntries(
          Object.entries(payload).filter(([, v]) => v !== undefined)
        );
        await addDoc(collection(db, 'clients'), {
          ...createPayload,
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
      // Soft delete em vez de deleteDoc. Hard delete deixava órfãos em
      // conversations, sales, transactions, appointments, kanbanCards,
      // crmDeals, crmActivities — todos ainda apontavam pro doc fantasma.
      // Soft delete preserva a integridade histórica + audit trail e
      // permite rollback caso o operador tenha clicado errado.
      await updateDoc(doc(db, 'clients', id), {
        isActive: false,
        deletedAt: new Date().toISOString(),
        deletedBy: user?.uid || '',
        deletedByName: user?.name || '',
        updatedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
      toast.success('Cliente excluído');
      setDeleteConfirm(null);
      if (selectedClient?.id === deleteConfirm?.id) setSelectedClient(null);
    },
    onError: () => toast.error('Erro ao excluir cliente'),
  });

  // Soft-delete em massa via writeBatch (limite Firestore: 500 ops por batch).
  // Mantém o mesmo padrão do deleteClient single (isActive=false + deletedAt
  // pra preservar audit trail e referências em vendas/agendamentos/etc.).
  const { mutate: bulkDeleteClients, isPending: isBulkDeleting } = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const now = new Date().toISOString();
      const meta = {
        isActive: false,
        deletedAt: now,
        deletedBy: user?.uid || '',
        deletedByName: user?.name || '',
        updatedAt: now,
      };
      // Quebra em chunks de 500 (limite por writeBatch).
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const batch = writeBatch(db);
        for (const id of chunk) batch.update(doc(db, 'clients', id), meta);
        await batch.commit();
      }
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
      toast.success(`${ids.length} cliente(s) excluído(s)`);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      // Se o cliente atualmente aberto foi um dos deletados, fecha o painel.
      if (selectedClient && ids.includes(selectedClient.id)) setSelectedClient(null);
    },
    onError: (err: Error) => toast.error(`Erro ao excluir clientes: ${err.message}`),
  });

  // ─── Filtered & sorted list ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    // Drop malformed entries, already-merged records, e soft-deleted (deletedAt)
    let list = clients.filter(c =>
      c && typeof c.name === 'string' && c.name.length > 0
      && !c.mergedInto
      && !(c as { deletedAt?: string }).deletedAt
    );
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
    if (filterChurnRisk !== 'all') {
      list = list.filter(c => {
        // Clients with no scores are treated as 'minimal' risk (not filtered out)
        const risk = c.scores?.churnRisk ?? 0;
        return getChurnLevel(risk) === filterChurnRisk;
      });
    }
    // Filtro por mês de aniversário. ISO YYYY-MM-DD; mês são chars 5-6 (1-based MM).
    if (filterBirthMonth !== 'all') {
      const today = new Date();
      const targetMonth: number =
        filterBirthMonth === 'this_month' ? today.getMonth() + 1 :
        filterBirthMonth === 'next_month' ? ((today.getMonth() + 1) % 12) + 1 :
        filterBirthMonth;
      list = list.filter(c => {
        if (!c.birthDate || c.birthDate.length < 7) return false;
        const month = Number(c.birthDate.slice(5, 7));
        return month === targetMonth;
      });
    }

    list.sort((a, b) => {
      // Sort especial quando filtrando por aniversário: ordena por dia do mês
      // (ascendente). Operador escaneando "quem faz no próximo mês" prefere
      // ver dia 1 → 31 em vez de alfabético.
      if (filterBirthMonth !== 'all') {
        const da = a.birthDate ? Number(a.birthDate.slice(8, 10)) : 99;
        const db = b.birthDate ? Number(b.birthDate.slice(8, 10)) : 99;
        if (da !== db) return da - db;
      }
      if (sortBy === 'totalSpent') return (b.totalSpent || 0) - (a.totalSpent || 0);
      if (sortBy === 'createdAt') return (b.createdAt || '').localeCompare(a.createdAt || '');
      if (sortBy === 'churnRisk') return (b.scores?.churnRisk ?? 0) - (a.scores?.churnRisk ?? 0);
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [clients, search, filterTipo, filterStatus, filterTags, filterChurnRisk, filterBirthMonth, sortBy]);

  // ─── Duplicate count (for badge) ─────────────────────────────────────────────
  const dupeCount = useMemo(() => detectDuplicates(clients).length, [clients]);

  // ─── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active = clients.filter(c => c.status === 'ganho').length;
    const pj = clients.filter(c => c.tipo === 'pj').length;
    const totalSpent = clients.reduce((s, c) => s + (c.totalSpent || 0), 0);
    const withSpent = clients.filter(c => (c.totalSpent || 0) > 0);
    const avgTicket = withSpent.length > 0 ? totalSpent / withSpent.length : 0;
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
        birthDate: editingClient.birthDate || '',
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
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowLoyaltySettings(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium rounded-xl transition-colors"
              title="Configurar programa de fidelidade"
            >
              <Trophy className="w-4 h-4 text-amber-500" />
              Fidelidade
              {loyaltyConfig?.isEnabled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </button>
          )}
          {dupeCount > 0 && (
            <button
              onClick={() => setShowMerge(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-sm font-medium rounded-xl transition-colors"
            >
              <Users className="w-4 h-4" />
              Duplicatas
              <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {dupeCount}
              </span>
            </button>
          )}
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium rounded-xl transition-colors"
          >
            <Upload className="w-4 h-4" />
            Importar
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium rounded-xl transition-colors"
          >
            <FileDown className="w-4 h-4" />
            Exportar
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Novo cliente
          </button>
        </div>
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
            {(filterTipo !== 'all' || filterStatus !== 'all' || filterTags.length > 0 || filterChurnRisk !== 'all' || filterBirthMonth !== 'all') && (
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
            <option value="churnRisk">Maior risco</option>
          </select>
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-xl">
            <button
              onClick={() => handleClientsView('list')}
              title="Visão lista"
              className={cn('p-1.5 rounded-[10px] transition-all',
                clientsView === 'list'
                  ? 'bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              )}>
              <AlignJustify size={15} />
            </button>
            <button
              onClick={() => handleClientsView('table')}
              title="Visão tabela"
              className={cn('p-1.5 rounded-[10px] transition-all',
                clientsView === 'table'
                  ? 'bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              )}>
              <LayoutList size={15} />
            </button>
          </div>
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
              {/* Churn Risk filter */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Risco de churn</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setFilterChurnRisk('all')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterChurnRisk === 'all'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>Todos</button>
                  {(Object.entries(CHURN_CFG) as [ChurnRiskLevel, typeof CHURN_CFG[ChurnRiskLevel]][]).map(([key, cfg]) => (
                    <button key={key} onClick={() => setFilterChurnRisk(key)}
                      className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        filterChurnRisk === key
                          ? `${cfg.bg} ${cfg.color} ring-1 ring-current`
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Aniversário — preparação para campanhas. "Este mês" e
                  "Próximo mês" são atalhos pra fluxo recorrente; meses
                  específicos pra planejamento longo prazo. Quando filtro
                  está ativo, lista é re-ordenada por dia do mês. */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block inline-flex items-center gap-1.5">
                  <Gift className="w-3 h-3" />
                  Aniversário
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setFilterBirthMonth('all')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterBirthMonth === 'all'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>Todos</button>
                  <button onClick={() => setFilterBirthMonth('this_month')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterBirthMonth === 'this_month'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>Este mês</button>
                  <button onClick={() => setFilterBirthMonth('next_month')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterBirthMonth === 'next_month'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>Próximo mês</button>
                  <select
                    value={typeof filterBirthMonth === 'number' ? filterBirthMonth : ''}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) return;
                      setFilterBirthMonth(Number(v));
                    }}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border-0 focus:outline-none focus:ring-1 focus:ring-red-400 cursor-pointer',
                      typeof filterBirthMonth === 'number'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>
                    <option value="">Mês específico…</option>
                    {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
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
          {/* Bulk action bar — só aparece quando há seleção. Posicionada acima
              da lista pra não atrapalhar o scroll. Ações são destrutivas, daí
              o destaque vermelho + confirmação obrigatória antes do delete. */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 mb-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                  {selectedIds.size} selecionado(s)
                </span>
                <button
                  onClick={() => {
                    const allIds = filtered.map(c => c.id);
                    setSelectedIds(allIds.every(id => selectedIds.has(id))
                      ? new Set()
                      : new Set(allIds));
                  }}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  {filtered.every(c => selectedIds.has(c.id)) ? 'Limpar' : `Selecionar todos os ${filtered.length} filtrados`}
                </button>
              </div>
              <button
                onClick={() => setBulkDeleteOpen(true)}
                disabled={isBulkDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluir {selectedIds.size}
              </button>
            </div>
          )}
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
          ) : clientsView === 'table' ? (
            <ClientTableView
              clients={filtered}
              selectedClientId={selectedClient?.id ?? null}
              onSelectClient={setSelectedClient}
              selectedIds={selectedIds}
              onToggleSelectId={(id) => setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              })}
              onToggleSelectAll={() => {
                const allIds = filtered.map(c => c.id);
                const allSelected = allIds.every(id => selectedIds.has(id));
                setSelectedIds(allSelected ? new Set() : new Set(allIds));
              }}
            />
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
                      {/* Birthday badge — só aparece se aniversário <= 30 dias.
                          Cor amber pra urgência sem competir com status do CRM.
                          Útil pra operador escanear quem precisa de campanha. */}
                      {(() => {
                        if (!client.birthDate || client.birthDate.length < 10) return null;
                        const month = Number(client.birthDate.slice(5, 7));
                        const day = Number(client.birthDate.slice(8, 10));
                        if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const thisYear = new Date(today.getFullYear(), month - 1, day);
                        const next = thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, month - 1, day);
                        const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000);
                        if (daysUntil > 30) return null;
                        return (
                          <span className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
                            daysUntil === 0
                              ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 ring-1 ring-amber-400'
                              : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
                          )}>
                            🎂 {daysUntil === 0 ? 'Hoje!' : daysUntil === 1 ? 'Amanhã' : `${daysUntil}d`}
                          </span>
                        );
                      })()}
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', statusCfg.color)}>
                        <span className={cn('w-1 h-1 rounded-full', statusCfg.dot)} />
                        {statusCfg.label}
                      </span>
                      <HealthBadge client={client} />
                      {(client.totalSpent || 0) > 0 && (
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {formatCurrency(client.totalSpent || 0)}
                        </span>
                      )}
                      {(client.loyaltyPoints || 0) > 0 && (
                        <>
                          <TierBadge points={client.loyaltyPoints ?? 0} tiers={loyaltyConfig?.tiers ?? DEFAULT_LOYALTY_TIERS} />
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                            <Gift className="w-2.5 h-2.5" />
                            {client.loyaltyPoints} pts
                          </span>
                        </>
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
                loyaltyConfig={loyaltyConfig}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Create/Edit modal */}
      {typeof document !== 'undefined' && createPortal(
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
                className="w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl"
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
        </AnimatePresence>,
        document.body,
      )}

      {/* Loyalty settings modal */}
      <AnimatePresence>
        {showLoyaltySettings && (
          <LoyaltySettingsModal
            current={loyaltyConfig}
            businessId={business!.id}
            onClose={() => setShowLoyaltySettings(false)}
            onSaved={cfg => setLoyaltyConfig(cfg)}
          />
        )}
      </AnimatePresence>

      {/* Merge duplicates modal */}
      <AnimatePresence>
        {showMerge && (
          <MergeModal
            clients={clients}
            businessId={business!.id}
            onClose={() => setShowMerge(false)}
            onDone={() => queryClient.invalidateQueries({ queryKey: ['clients', business?.id] })}
          />
        )}
      </AnimatePresence>

      {/* Import modal */}
      <AnimatePresence>
        {showImport && (
          <ImportModal
            existingClients={clients}
            businessId={business!.id}
            onClose={() => setShowImport(false)}
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
              setShowImport(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Export modal */}
      <AnimatePresence>
        {showExport && (
          <ExportModal
            allClients={clients}
            filteredClients={filtered}
            onClose={() => setShowExport(false)}
          />
        )}
      </AnimatePresence>

      {/* Bulk delete confirm — destrutiva, daí confirmação dura antes de prosseguir */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {bulkDeleteOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={(e) => { if (e.target === e.currentTarget && !isBulkDeleting) setBulkDeleteOpen(false); }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6"
              >
                <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-2">
                  Excluir {selectedIds.size} cliente(s)?
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
                  Os clientes selecionados serão desativados. Conversas, vendas e
                  agendamentos vinculados são preservados pra audit trail.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setBulkDeleteOpen(false)}
                    disabled={isBulkDeleting}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => bulkDeleteClients(Array.from(selectedIds))}
                    disabled={isBulkDeleting}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {isBulkDeleting ? 'Excluindo...' : `Excluir ${selectedIds.size}`}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Delete confirm */}
      {typeof document !== 'undefined' && createPortal(
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
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
