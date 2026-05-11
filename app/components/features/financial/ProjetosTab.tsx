'use client';

import React, { useMemo, useState } from 'react';
import {
  Briefcase, Plus, Edit3, Trash2, X, Check, AlertTriangle,
  ArrowUpRight, ArrowDownRight, TrendingUp, Palette, Search,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts';
import {
  ModernDialog, ModernDialogActions, ModernCancelButton, ModernPrimaryButton,
} from '@/app/components/ui/dialog';
import { Button, TextField } from '@mui/material';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import type { Project, ProjectStatus, Transaction } from '@/lib/types';

const PROJECT_COLORS = [
  '#7C3AED', '#DC2626', '#F59E0B', '#10B981', '#3B82F6',
  '#EC4899', '#F97316', '#06B6D4', '#6366F1', '#14B8A6',
  '#A855F7', '#0EA5E9',
];

const STATUS_META: Record<ProjectStatus, { label: string; bg: string; text: string }> = {
  ativo:     { label: 'Ativo',     bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400' },
  pausado:   { label: 'Pausado',   bg: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-700 dark:text-amber-400' },
  encerrado: { label: 'Encerrado', bg: 'bg-slate-100 dark:bg-gray-800',         text: 'text-slate-500 dark:text-gray-400' },
};

interface Props {
  businessId: string;
  userId: string;
  userName: string;
  projects: Project[];
  transactions: Transaction[];
}

export default function ProjetosTab({ businessId, userId, userName, projects, transactions }: Props) {
  const { isDark } = useTheme();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | ProjectStatus>('todos');
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formColor, setFormColor] = useState(PROJECT_COLORS[0]);
  const [formStatus, setFormStatus] = useState<ProjectStatus>('ativo');
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const txByProject = useMemo(() => {
    const m = new Map<string, { receitas: number; despesas: number; count: number; txs: Transaction[] }>();
    for (const tx of transactions) {
      if (!tx.projectId) continue;
      const bucket = m.get(tx.projectId) || { receitas: 0, despesas: 0, count: 0, txs: [] };
      if (tx.type === 'receita') bucket.receitas += tx.amount;
      else bucket.despesas += tx.amount;
      bucket.count += 1;
      bucket.txs.push(tx);
      m.set(tx.projectId, bucket);
    }
    return m;
  }, [transactions]);

  const chartData = useMemo(() => {
    return projects
      .filter(p => p.status !== 'encerrado')
      .map(p => {
        const stats = txByProject.get(p.id) || { receitas: 0, despesas: 0, count: 0, txs: [] };
        return {
          name: p.name,
          color: p.color,
          receitas: stats.receitas,
          despesas: stats.despesas,
          saldo: stats.receitas - stats.despesas,
        };
      })
      .sort((a, b) => b.receitas - a.receitas);
  }, [projects, txByProject]);

  const filteredProjects = useMemo(() => {
    let list = [...projects];
    if (statusFilter !== 'todos') list = list.filter(p => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    }
    return list;
  }, [projects, statusFilter, search]);

  const totalReceitas = chartData.reduce((s, d) => s + d.receitas, 0);
  const totalDespesas = chartData.reduce((s, d) => s + d.despesas, 0);
  const totalSaldo = totalReceitas - totalDespesas;

  const openNewForm = () => {
    setEditingProject(null);
    setFormName('');
    setFormDescription('');
    setFormColor(PROJECT_COLORS[projects.length % PROJECT_COLORS.length]);
    setFormStatus('ativo');
    setShowForm(true);
  };

  const openEditForm = (p: Project) => {
    setEditingProject(p);
    setFormName(p.name);
    setFormDescription(p.description || '');
    setFormColor(p.color);
    setFormStatus(p.status);
    setShowForm(true);
  };

  const handleSave = async () => {
    const name = formName.trim();
    if (!name) { toast.error('Informe um nome'); return; }
    if (!businessId) return;
    setSaving(true);
    const now = new Date().toISOString();
    try {
      if (editingProject) {
        await updateDoc(doc(db, 'projects', editingProject.id), {
          name, description: formDescription || null, color: formColor, status: formStatus,
          updatedAt: now,
        });
        toast.success('Projeto atualizado');
      } else {
        await addDoc(collection(db, 'projects'), {
          businessId, name, description: formDescription || null, color: formColor, status: formStatus,
          createdBy: userId, createdByName: userName, createdAt: now, updatedAt: now,
        });
        toast.success('Projeto criado');
      }
      setShowForm(false);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar projeto');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const linked = txByProject.get(id);
    if (linked && linked.count > 0) {
      toast.error(`Não é possível excluir — há ${linked.count} transação(ões) vinculada(s). Desvincule ou encerre o projeto.`);
      setDeleteConfirm(null);
      return;
    }
    try {
      await deleteDoc(doc(db, 'projects', id));
      toast.success('Projeto excluído');
      setDeleteConfirm(null);
      if (selectedProjectId === id) setSelectedProjectId(null);
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) : null;
  const selectedStats = selectedProjectId ? (txByProject.get(selectedProjectId) || { receitas: 0, despesas: 0, count: 0, txs: [] }) : null;

  return (
    <div className="space-y-5">
      {/* Header / KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-gray-500 mb-1">Projetos ativos</p>
          <p className="text-xl font-bold font-display text-slate-900 dark:text-gray-100">
            {projects.filter(p => p.status === 'ativo').length}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700/70 dark:text-emerald-400/70 mb-1">Receita total</p>
          <p className="text-xl font-bold font-display text-emerald-700 dark:text-emerald-400">
            {formatCurrency(totalReceitas)}
          </p>
        </div>
        <div className="rounded-2xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-red-700/70 dark:text-red-400/70 mb-1">Despesa total</p>
          <p className="text-xl font-bold font-display text-red-700 dark:text-red-400">
            {formatCurrency(totalDespesas)}
          </p>
        </div>
        <div className={cn(
          'rounded-2xl border p-4',
          totalSaldo >= 0
            ? 'border-blue-200 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/10'
            : 'border-orange-200 dark:border-orange-500/20 bg-orange-50 dark:bg-orange-500/10'
        )}>
          <p className={cn(
            'text-[10px] uppercase tracking-wider font-bold mb-1',
            totalSaldo >= 0 ? 'text-blue-700/70 dark:text-blue-400/70' : 'text-orange-700/70 dark:text-orange-400/70'
          )}>Saldo</p>
          <p className={cn(
            'text-xl font-bold font-display',
            totalSaldo >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-orange-700 dark:text-orange-400'
          )}>{formatCurrency(totalSaldo)}</p>
        </div>
      </div>

      {/* Comparison chart */}
      {chartData.length > 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100 mb-4">Comparativo por projeto</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1E293B' : '#F1F5F9'} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} width={56} />
              <RechartsTooltip
                formatter={(v: number, name: string) => [formatCurrency(v), name]}
                contentStyle={{ background: isDark ? '#1e293b' : '#fff', border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', borderRadius: 10, fontSize: 12 }}
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="receitas" name="Receitas" radius={[4, 4, 0, 0]} barSize={20}>
                {chartData.map((entry, idx) => <Cell key={idx} fill={entry.color} fillOpacity={0.85} />)}
              </Bar>
              <Bar dataKey="despesas" name="Despesas" radius={[4, 4, 0, 0]} barSize={20}>
                {chartData.map((entry, idx) => <Cell key={idx} fill={entry.color} fillOpacity={0.35} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-10 text-center">
          <Briefcase className="w-10 h-10 text-slate-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">Nenhum projeto ativo ainda</p>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">Crie seu primeiro projeto e comece a vincular transações a ele.</p>
        </div>
      )}

      {/* Project list */}
      <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl">
        <div className="px-5 pt-4 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">Projetos</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl text-xs text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
            </div>
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-gray-800 rounded-xl">
              {(['todos', 'ativo', 'pausado', 'encerrado'] as const).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={cn('px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors capitalize',
                    statusFilter === s ? 'bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-700'
                  )}
                >{s === 'todos' ? 'Todos' : STATUS_META[s].label}</button>
              ))}
            </div>
            <button onClick={openNewForm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white shadow-sm transition-all">
              <Plus size={13} /> Novo projeto
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-50 dark:divide-gray-800">
          {filteredProjects.length === 0 && (
            <div className="px-5 py-12 text-center text-sm text-slate-400 dark:text-gray-500">
              {projects.length === 0 ? 'Nenhum projeto cadastrado' : 'Nenhum projeto encontrado'}
            </div>
          )}
          <AnimatePresence>
            {filteredProjects.map((p, i) => {
              const stats = txByProject.get(p.id) || { receitas: 0, despesas: 0, count: 0, txs: [] };
              const saldo = stats.receitas - stats.despesas;
              const isSelected = selectedProjectId === p.id;
              const statusStyle = STATUS_META[p.status];
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className={cn(
                    'px-5 py-4 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors group cursor-pointer',
                    isSelected && 'bg-violet-50/40 dark:bg-violet-500/5'
                  )}
                  onClick={() => setSelectedProjectId(isSelected ? null : p.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${p.color}20`, color: p.color }}>
                      <Briefcase size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900 dark:text-gray-100">{p.name}</span>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', statusStyle.bg, statusStyle.text)}>
                          {statusStyle.label}
                        </span>
                        {stats.count > 0 && (
                          <span className="text-[10px] font-medium text-slate-500 dark:text-gray-400">{stats.count} tx</span>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-xs text-slate-500 dark:text-gray-400 truncate mt-0.5">{p.description}</p>
                      )}
                    </div>
                    <div className="hidden sm:flex items-center gap-5 shrink-0">
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-gray-500">Receita</p>
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">+{formatCurrency(stats.receitas)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-gray-500">Despesa</p>
                        <p className="text-sm font-bold text-red-600 dark:text-red-400 tabular-nums">-{formatCurrency(stats.despesas)}</p>
                      </div>
                      <div className="text-right min-w-[100px]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-gray-500">Saldo</p>
                        <p className={cn('text-sm font-bold tabular-nums', saldo >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400')}>
                          {formatCurrency(saldo)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); openEditForm(p); }}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(p.id); }}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-500 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isSelected && stats.txs.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                      className="mt-4 pt-4 border-t border-slate-100 dark:border-gray-800 overflow-hidden">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400 mb-2">Últimas transações</p>
                      <div className="space-y-1.5">
                        {stats.txs.slice(0, 8).map(tx => (
                          <div key={tx.id} className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              {tx.type === 'receita'
                                ? <ArrowUpRight size={11} className="text-emerald-500 shrink-0" />
                                : <ArrowDownRight size={11} className="text-red-500 shrink-0" />}
                              <span className="truncate text-slate-700 dark:text-gray-300">{tx.description}</span>
                              <span className="text-slate-400 shrink-0">{tx.category}</span>
                            </div>
                            <span className={cn('font-bold tabular-nums shrink-0',
                              tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                              {tx.type === 'receita' ? '+' : '-'}{formatCurrency(tx.amount)}
                            </span>
                          </div>
                        ))}
                        {stats.txs.length > 8 && (
                          <p className="text-[11px] text-slate-400 dark:text-gray-500 pt-1">+ {stats.txs.length - 8} mais...</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Form dialog */}
      <ModernDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingProject ? 'Editar projeto' : 'Novo projeto'}
        icon={Briefcase}
        maxWidth="sm"
        footer={
          <ModernDialogActions>
            <ModernCancelButton onClick={() => setShowForm(false)}>Cancelar</ModernCancelButton>
            <ModernPrimaryButton onClick={handleSave} disabled={saving || !formName.trim()}>
              {saving ? 'Salvando...' : (editingProject ? 'Salvar' : 'Criar')}
            </ModernPrimaryButton>
          </ModernDialogActions>
        }
      >
        <TextField label="Nome" value={formName} onChange={(e) => setFormName(e.target.value)} fullWidth size="small"
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }} autoFocus />
        <TextField label="Descrição (opcional)" value={formDescription} onChange={(e) => setFormDescription(e.target.value)}
          fullWidth size="small" multiline minRows={2}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }} />

        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
            <Palette size={12} /> Cor
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {PROJECT_COLORS.map(c => (
              <button key={c} onClick={() => setFormColor(c)}
                className={cn('w-7 h-7 rounded-lg transition-all flex items-center justify-center', formColor === c ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900' : 'hover:scale-110')}
                style={{ backgroundColor: c, boxShadow: formColor === c ? `0 0 0 2px ${c}` : undefined }}
              >
                {formColor === c && <Check size={14} className="text-white" />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 mb-2">Status</p>
          <div className="flex items-center gap-1.5">
            {(['ativo', 'pausado', 'encerrado'] as const).map(s => (
              <button key={s} onClick={() => setFormStatus(s)}
                className={cn('px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                  formStatus === s
                    ? `${STATUS_META[s].bg} ${STATUS_META[s].text} ring-1 ring-current`
                    : 'bg-slate-50 dark:bg-gray-800 text-slate-500 dark:text-gray-400 hover:bg-slate-100'
                )}
              >{STATUS_META[s].label}</button>
            ))}
          </div>
        </div>
      </ModernDialog>

      {/* Delete confirm */}
      <ModernDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Excluir projeto?"
        icon={AlertTriangle}
        maxWidth="xs"
        footer={
          <ModernDialogActions>
            <ModernCancelButton onClick={() => setDeleteConfirm(null)}>Cancelar</ModernCancelButton>
            <Button
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              variant="contained"
              sx={{
                borderRadius: '14px',
                px: 2.75,
                minHeight: 44,
                bgcolor: '#DC2626',
                textTransform: 'none',
                fontWeight: 800,
                '&:hover': { bgcolor: '#B91C1C' },
              }}
            >
              Excluir
            </Button>
          </ModernDialogActions>
        }
      >
        <p className="text-sm text-slate-600 dark:text-gray-400">
          O projeto será removido. Transações vinculadas precisam ser desvinculadas antes.
        </p>
      </ModernDialog>
    </div>
  );
}
