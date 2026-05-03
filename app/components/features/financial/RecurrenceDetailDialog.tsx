'use client';

/**
 * RecurrenceDetailDialog — modal de gestão completa de uma transação recorrente.
 *
 * Três abas:
 *   1. Histórico  — timeline das ocorrências pagas com badge de status
 *                  (Em dia / Atrasou Xd / Antecipou Yd) + comprovantes
 *   2. Próximas   — projeção de N meses à frente (3/6/12) usando a mesma
 *                  lógica de `computeNextDueDate`. A primeira (nextDueDate)
 *                  é a única acionável; as demais são só visualização.
 *   3. Configuração — frequência, multa/juros, reajuste, pausar, encerrar.
 *
 * Métricas no topo (sempre visíveis):
 *   - Total pago no histórico
 *   - % pago em dia (diff <= 0)
 *   - Atraso médio em dias (apenas atrasos contam)
 *   - Valor médio das ocorrências
 *
 * Reusa os mesmos callbacks de mutação do RecurringContent — o pai (FinancialModule)
 * cuida da persistência. Esse modal é puramente apresentação + dispatch.
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  X, Clock, History as HistoryIcon, Calendar as CalendarIcon, Settings2,
  CheckCircle2, AlertTriangle, TrendingDown, TrendingUp, Loader2,
  PauseCircle, PlayCircle, StopCircle, Percent, ChevronRight, Edit3,
  Paperclip,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils/format';
import { useCurrencyFormat } from './CurrencyContext';
import type { Transaction, TransactionRecurrenceEntry } from '@/lib/types';

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  biweekly_fixed: 'Quinzenal (dias fixos)',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  yearly: 'Anual',
};

// Replicado de FinancialModule pra manter o modal independente.
function adjustForBusinessDay(dateStr: string, adjust: 'none' | 'before' | 'after' | undefined): string {
  if (!adjust || adjust === 'none') return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  const step = adjust === 'before' ? -1 : 1;
  let guard = 0;
  while ((d.getDay() === 0 || d.getDay() === 6) && guard++ < 10) {
    d.setDate(d.getDate() + step);
  }
  return d.toISOString().slice(0, 10);
}

function computeNextDueDate(
  currentDue: string,
  frequency: string,
  dayOfMonth?: number,
  secondDayOfMonth?: number,
  holidayAdjust?: 'none' | 'before' | 'after',
): string {
  const d = new Date(currentDue + 'T00:00:00');
  const day = dayOfMonth ? Math.min(dayOfMonth, 28) : undefined;
  switch (frequency) {
    case 'weekly':     d.setDate(d.getDate() + 7); break;
    case 'biweekly':   d.setDate(d.getDate() + 14); break;
    case 'monthly':    d.setMonth(d.getMonth() + 1);   if (day) d.setDate(day); break;
    case 'quarterly':  d.setMonth(d.getMonth() + 3);   if (day) d.setDate(day); break;
    case 'semiannual': d.setMonth(d.getMonth() + 6);   if (day) d.setDate(day); break;
    case 'yearly':     d.setFullYear(d.getFullYear() + 1); if (day) d.setDate(day); break;
    case 'biweekly_fixed': {
      const d1 = day ?? 1;
      const d2 = secondDayOfMonth ? Math.min(secondDayOfMonth, 28) : 15;
      const first = Math.min(d1, d2);
      const second = Math.max(d1, d2);
      const cur = d.getDate();
      if (cur < first)        { d.setDate(first); }
      else if (cur < second)  { d.setDate(second); }
      else                    { d.setMonth(d.getMonth() + 1); d.setDate(first); }
      break;
    }
  }
  return adjustForBusinessDay(d.toISOString().slice(0, 10), holidayAdjust);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((db - da) / 86400000);
}

interface PaymentStatus {
  kind: 'on_time' | 'early' | 'late';
  diffDays: number;        // negativo = adiantado, 0 = no dia, positivo = atrasado
  label: string;           // "Em dia", "Antecipou 5d", "Atrasou 12d"
  color: string;           // tailwind classes p/ badge
}

function classifyPayment(entry: TransactionRecurrenceEntry): PaymentStatus {
  const diff = daysBetween(entry.dueDate, entry.paidDate);
  if (diff <= 0 && diff >= -1) {
    return { kind: 'on_time', diffDays: diff, label: 'Em dia', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' };
  }
  if (diff < -1) {
    return { kind: 'early', diffDays: diff, label: `Antecipou ${Math.abs(diff)}d`, color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' };
  }
  if (diff <= 3) {
    return { kind: 'late', diffDays: diff, label: `Atrasou ${diff}d`, color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' };
  }
  return { kind: 'late', diffDays: diff, label: `Atrasou ${diff}d`, color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' };
}

type Tab = 'historico' | 'proximas' | 'config';
type StatusFilter = 'todos' | 'on_time' | 'early' | 'late';

interface Props {
  transaction: Transaction;
  onClose: () => void;
  onPause: (txId: string) => Promise<void>;
  onResume: (txId: string) => Promise<void>;
  onEndSeries: (txId: string, cancelCurrent: boolean) => Promise<void>;
  onAdjustValue: (txId: string, mode: 'pct' | 'fixed', value: number) => Promise<void>;
  onMarkPaid: (txId: string, paidAmount?: number) => Promise<void>;
  onSkip: (txId: string) => Promise<void>;
  onEdit: (tx: Transaction) => void;
}

export default function RecurrenceDetailDialog({
  transaction: tx,
  onClose,
  onPause, onResume, onEndSeries, onAdjustValue,
  onMarkPaid, onSkip, onEdit,
}: Props) {
  const formatCurrency = useCurrencyFormat();
  const recurrence = tx.recurrence;
  const history = useMemo(() => recurrence?.history ?? [], [recurrence]);
  const isActive = recurrence?.isActive ?? false;
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Mount-check pra createPortal: document.body só existe no browser, e o
  // primeiro render no Next.js pode acontecer no servidor (mesmo com 'use client'
  // pode rodar SSR antes de hidratar). Sem isso, hydration mismatch.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // Lock body scroll while the modal is open. Antes a lógica caminhava pelo DOM
  // procurando o primeiro overflow:auto/scroll ancestor, mas isso é frágil:
  // em alguns layouts achava o elemento errado e travava UI inteira (ou nem
  // travava nada). Agora trava o body diretamente — modal renderiza via portal
  // fora do tree do app, então não há conflito com scrolls internos.
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const [tab, setTab] = useState<Tab>('historico');

  // ── Histórico filtros ─────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [yearFilter, setYearFilter] = useState<string>('todos');

  // ── Próximas: horizonte de projeção ───────────────────────────────
  const [horizon, setHorizon] = useState<3 | 6 | 12>(6);

  // ── Configuração: estados de loading ──────────────────────────────
  const [pausing, setPausing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endCancelCurrent, setEndCancelCurrent] = useState(false);
  const [adjustMode, setAdjustMode] = useState<'pct' | 'fixed'>('pct');
  const [adjustValue, setAdjustValue] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  // ── Quitar / pular (ocorrência atual) ─────────────────────────────
  const [paying, setPaying] = useState(false);
  const [skipping, setSkipping] = useState(false);

  // ── Métricas agregadas ────────────────────────────────────────────
  const metrics = useMemo(() => {
    if (history.length === 0) {
      return { total: 0, count: 0, pctOnTime: null as number | null, avgLate: null as number | null, avgAmount: null as number | null };
    }
    let total = 0;
    let onTimeCount = 0;
    let lateSum = 0;
    let lateCount = 0;
    for (const e of history) {
      total += e.amount;
      const status = classifyPayment(e);
      if (status.diffDays <= 0) onTimeCount++;
      if (status.diffDays > 0) { lateSum += status.diffDays; lateCount++; }
    }
    return {
      total,
      count: history.length,
      pctOnTime: history.length > 0 ? (onTimeCount / history.length) * 100 : null,
      avgLate: lateCount > 0 ? lateSum / lateCount : null,
      avgAmount: history.length > 0 ? total / history.length : null,
    };
  }, [history]);

  // ── Anos disponíveis pro filtro de histórico ──────────────────────
  const availableYears = useMemo(() => {
    const ys = new Set<string>();
    for (const e of history) ys.add(e.dueDate.slice(0, 4));
    return Array.from(ys).sort((a, b) => b.localeCompare(a));
  }, [history]);

  const filteredHistory = useMemo(() => {
    let list = [...history].reverse(); // mais recente primeiro
    if (statusFilter !== 'todos') {
      list = list.filter(e => classifyPayment(e).kind === statusFilter);
    }
    if (yearFilter !== 'todos') {
      list = list.filter(e => e.dueDate.startsWith(yearFilter));
    }
    return list;
  }, [history, statusFilter, yearFilter]);

  // ── Próximas ocorrências (projeção a partir de nextDueDate) ───────
  const upcoming = useMemo(() => {
    if (!recurrence?.nextDueDate) return [] as Array<{ date: string; isCurrent: boolean; isPastEndDate: boolean }>;
    const list: Array<{ date: string; isCurrent: boolean; isPastEndDate: boolean }> = [];
    let cursor = recurrence.nextDueDate;
    for (let i = 0; i < horizon; i++) {
      const isPastEndDate = !!(recurrence.endDate && cursor > recurrence.endDate);
      list.push({ date: cursor, isCurrent: i === 0, isPastEndDate });
      if (isPastEndDate) break;
      cursor = computeNextDueDate(
        cursor,
        recurrence.frequency,
        recurrence.dayOfMonth,
        recurrence.secondDayOfMonth,
        recurrence.holidayAdjust,
      );
    }
    return list;
  }, [recurrence, horizon]);

  if (!recurrence) {
    return null;
  }

  const isOverdue = !!(recurrence.nextDueDate && recurrence.nextDueDate < todayStr);

  // ── Handlers wrappers ─────────────────────────────────────────────
  const doPay = async () => {
    setPaying(true);
    try { await onMarkPaid(tx.id); }
    finally { setPaying(false); }
  };
  const doSkip = async () => {
    if (!confirm(`Pular o vencimento de ${formatDate(recurrence.nextDueDate)} (não quita, só avança)?`)) return;
    setSkipping(true);
    try { await onSkip(tx.id); }
    finally { setSkipping(false); }
  };
  const doPause = async () => {
    setPausing(true);
    try { await (isActive ? onPause(tx.id) : onResume(tx.id)); }
    finally { setPausing(false); }
  };
  const doEnd = async () => {
    if (!confirm(`Encerrar série "${recurrence.label || tx.description}"?\n\n${endCancelCurrent ? 'A ocorrência atual também será cancelada.' : 'A ocorrência atual será mantida.'}`)) return;
    setEnding(true);
    try { await onEndSeries(tx.id, endCancelCurrent); onClose(); }
    finally { setEnding(false); }
  };
  const doAdjust = async () => {
    const v = parseFloat(adjustValue);
    if (!Number.isFinite(v) || v <= 0) return;
    setAdjustSaving(true);
    try { await onAdjustValue(tx.id, adjustMode, v); setAdjustValue(''); }
    finally { setAdjustSaving(false); }
  };

  // Render via portal direto no document.body — sem isso, position:fixed do
  // backdrop fica RELATIVO a algum ancestor com transform/will-change (motion
  // components do framer-motion no shell da app criam containing block pra
  // fixed). Resultado: modal ficava preso dentro do <main>, com header coberto
  // pelo TopBar e tela parecendo travada.
  if (!portalReady) return null;
  return createPortal(
    <motion.div
      ref={backdropRef}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
        className="w-full max-w-3xl max-h-[90vh] bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 truncate">
                {recurrence.label || tx.description}
              </h3>
              <span className={cn(
                'text-[10px] font-bold px-2 py-0.5 rounded-full',
                tx.type === 'receita'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
              )}>
                {tx.type === 'receita' ? 'RECEITA' : 'DESPESA'}
              </span>
              {!isActive && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                  PAUSADA
                </span>
              )}
              {isOverdue && isActive && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">
                  ATRASADA
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {RECURRENCE_LABELS[recurrence.frequency] || recurrence.frequency}
              {recurrence.dayOfMonth ? ` · dia ${recurrence.dayOfMonth}` : ''}
              {recurrence.secondDayOfMonth ? ` e ${recurrence.secondDayOfMonth}` : ''}
              {tx.category ? ` · ${tx.category}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onEdit(tx)}
              title="Editar lançamento original"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Métricas agregadas */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-2 bg-gray-50/50 dark:bg-white/[0.02]">
          <MetricCard
            label="Pagamentos"
            value={metrics.count.toString()}
            sub={`${formatCurrency(metrics.total)} total`}
          />
          <MetricCard
            label="Pago em dia"
            value={metrics.pctOnTime !== null ? `${metrics.pctOnTime.toFixed(0)}%` : '—'}
            sub={metrics.pctOnTime !== null && metrics.pctOnTime >= 90 ? '👏 alto' : metrics.pctOnTime !== null && metrics.pctOnTime < 60 ? '⚠️ baixo' : ''}
            valueClass={
              metrics.pctOnTime === null ? 'text-gray-400'
              : metrics.pctOnTime >= 90 ? 'text-emerald-600 dark:text-emerald-400'
              : metrics.pctOnTime >= 60 ? 'text-amber-600 dark:text-amber-400'
              : 'text-red-600 dark:text-red-400'
            }
          />
          <MetricCard
            label="Atraso médio"
            value={metrics.avgLate !== null ? `${metrics.avgLate.toFixed(1)}d` : '—'}
            sub={metrics.avgLate !== null ? '(quando atrasa)' : ''}
            valueClass={
              metrics.avgLate === null ? 'text-gray-400'
              : metrics.avgLate <= 2 ? 'text-emerald-600 dark:text-emerald-400'
              : metrics.avgLate <= 7 ? 'text-amber-600 dark:text-amber-400'
              : 'text-red-600 dark:text-red-400'
            }
          />
          <MetricCard
            label="Valor médio"
            value={metrics.avgAmount !== null ? formatCurrency(metrics.avgAmount) : '—'}
            sub={`atual: ${formatCurrency(tx.amount)}`}
          />
        </div>

        {/* Tabs */}
        <div className="px-5 pt-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-0.5">
          <TabButton active={tab === 'historico'} onClick={() => setTab('historico')} icon={<HistoryIcon className="w-3.5 h-3.5" />}>
            Histórico ({history.length})
          </TabButton>
          <TabButton active={tab === 'proximas'} onClick={() => setTab('proximas')} icon={<CalendarIcon className="w-3.5 h-3.5" />}>
            Próximas
          </TabButton>
          <TabButton active={tab === 'config'} onClick={() => setTab('config')} icon={<Settings2 className="w-3.5 h-3.5" />}>
            Configuração
          </TabButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ─── Tab Histórico ─────────────────────────────────────── */}
          {tab === 'historico' && (
            <div className="p-5 space-y-3">
              {history.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-400">
                  Nenhuma ocorrência paga ainda. Quando a primeira for quitada, vai aparecer aqui.
                </div>
              ) : (
                <>
                  {/* Filtros */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex p-0.5 bg-gray-100 dark:bg-white/[0.06] rounded-lg">
                      {([
                        { key: 'todos',   label: 'Todos' },
                        { key: 'on_time', label: 'Em dia' },
                        { key: 'early',   label: 'Antecipados' },
                        { key: 'late',    label: 'Atrasados' },
                      ] as const).map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => setStatusFilter(opt.key as StatusFilter)}
                          className={cn(
                            'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                            statusFilter === opt.key
                              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {availableYears.length > 1 && (
                      <select
                        value={yearFilter}
                        onChange={e => setYearFilter(e.target.value)}
                        className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-red-400"
                      >
                        <option value="todos">Todos os anos</option>
                        {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    )}
                    <span className="ml-auto text-[11px] text-gray-400">
                      {filteredHistory.length} {filteredHistory.length === 1 ? 'item' : 'itens'}
                    </span>
                  </div>

                  {/* Timeline */}
                  <div className="space-y-2">
                    {filteredHistory.map((entry, i) => {
                      const status = classifyPayment(entry);
                      return (
                        <div
                          key={`${entry.dueDate}_${i}`}
                          className="p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-white/[0.02] hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1', status.color)}>
                                  {status.kind === 'on_time' && <CheckCircle2 className="w-3 h-3" />}
                                  {status.kind === 'early' && <TrendingUp className="w-3 h-3" />}
                                  {status.kind === 'late' && <TrendingDown className="w-3 h-3" />}
                                  {status.label}
                                </span>
                                <span className="text-xs text-gray-700 dark:text-gray-300">
                                  Venc. <strong>{formatDate(entry.dueDate)}</strong>
                                </span>
                                <span className="text-[11px] text-gray-400">
                                  → pago em {formatDate(entry.paidDate)}
                                </span>
                              </div>
                            </div>
                            <span className={cn(
                              'text-sm font-bold tabular-nums shrink-0',
                              tx.type === 'receita'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400',
                            )}>
                              {tx.type === 'receita' ? '+' : '-'}{formatCurrency(entry.amount)}
                            </span>
                          </div>
                          {(entry.attachments?.length ?? 0) > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(entry.attachments ?? []).map(att => (
                                <a
                                  key={att.id}
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-md text-[10px] text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
                                  title={att.name}
                                >
                                  <Paperclip className="w-2.5 h-2.5" />
                                  <span className="max-w-[120px] truncate">{att.name}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredHistory.length === 0 && (
                      <div className="text-center py-6 text-xs text-gray-400">
                        Nenhuma ocorrência com esse filtro.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── Tab Próximas ───────────────────────────────────────── */}
          {tab === 'proximas' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Horizonte:
                </span>
                <div className="inline-flex p-0.5 bg-gray-100 dark:bg-white/[0.06] rounded-lg">
                  {([3, 6, 12] as const).map(h => (
                    <button
                      key={h}
                      onClick={() => setHorizon(h)}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                        horizon === h
                          ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                      )}
                    >
                      {h} ocorrências
                    </button>
                  ))}
                </div>
                <span className="ml-auto text-[11px] text-gray-400">
                  Total projetado: <strong>{formatCurrency(tx.amount * upcoming.filter(u => !u.isPastEndDate).length)}</strong>
                </span>
              </div>

              {!isActive && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-400">
                  ⚠️ Série pausada — projeção mostra o que aconteceria se fosse retomada agora.
                </div>
              )}

              <div className="space-y-1.5">
                {upcoming.map((u, i) => {
                  const isOverdueProj = u.date < todayStr;
                  return (
                    <div
                      key={u.date + i}
                      className={cn(
                        'flex items-center justify-between gap-3 p-3 rounded-xl border',
                        u.isCurrent
                          ? 'border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5'
                          : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-white/[0.02]',
                        u.isPastEndDate && 'opacity-50',
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          'w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0',
                          u.isCurrent
                            ? 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400'
                            : 'bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400',
                        )}>
                          <span className="text-[9px] font-bold leading-none uppercase">
                            {new Date(u.date + 'T00:00:00').toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}
                          </span>
                          <span className="text-sm font-bold leading-none mt-0.5">
                            {u.date.slice(8, 10)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            {formatDate(u.date)}
                            {u.isCurrent && (
                              <span className="ml-2 text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">
                                {isOverdueProj ? '· ATRASADA' : '· PRÓXIMA'}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500">
                            {i === 0 ? 'Próximo vencimento' : `+${i} ocorrências à frente`}
                            {u.isPastEndDate && ' · após data fim'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn(
                          'text-sm font-bold tabular-nums',
                          tx.type === 'receita'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400',
                        )}>
                          {tx.type === 'receita' ? '+' : '-'}{formatCurrency(tx.amount)}
                        </span>
                        {u.isCurrent && isActive && !u.isPastEndDate && (
                          <>
                            <button
                              onClick={doPay}
                              disabled={paying || skipping}
                              title="Quitar agora"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
                            >
                              {paying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                              Quitar
                            </button>
                            <button
                              onClick={doSkip}
                              disabled={paying || skipping}
                              title="Pular este vencimento"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.1] disabled:opacity-50 transition-colors"
                            >
                              {skipping ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                              Pular
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {upcoming.length === 0 && (
                  <div className="text-center py-6 text-xs text-gray-400">
                    Sem próximos vencimentos previstos.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Tab Configuração ──────────────────────────────────── */}
          {tab === 'config' && (
            <div className="p-5 space-y-4">
              {/* Resumo */}
              <div className="grid grid-cols-2 gap-3">
                <ConfigCell label="Frequência" value={RECURRENCE_LABELS[recurrence.frequency] || recurrence.frequency} />
                <ConfigCell
                  label="Dia(s) do mês"
                  value={
                    recurrence.dayOfMonth
                      ? `${recurrence.dayOfMonth}${recurrence.secondDayOfMonth ? ` e ${recurrence.secondDayOfMonth}` : ''}`
                      : '—'
                  }
                />
                <ConfigCell
                  label="Ajuste fim de semana"
                  value={
                    recurrence.holidayAdjust === 'before' ? 'Dia útil anterior'
                    : recurrence.holidayAdjust === 'after' ? 'Dia útil posterior'
                    : 'Nenhum'
                  }
                />
                <ConfigCell
                  label="Multa por atraso"
                  value={recurrence.lateFeePct ? `${recurrence.lateFeePct}%` : '—'}
                />
                <ConfigCell
                  label="Juros mensal"
                  value={recurrence.interestPctMonth ? `${recurrence.interestPctMonth}%/mês` : '—'}
                />
                <ConfigCell
                  label="Data fim"
                  value={recurrence.endDate ? formatDate(recurrence.endDate) : '—'}
                />
              </div>

              {/* Reajuste */}
              <div className="p-3 rounded-xl bg-violet-50 dark:bg-violet-500/5 border border-violet-200 dark:border-violet-500/20 space-y-2.5">
                <p className="text-xs font-semibold text-violet-700 dark:text-violet-400 flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5" />
                  Reajustar valor da série
                </p>
                <div className="flex items-center gap-1 p-0.5 bg-violet-100 dark:bg-violet-500/10 rounded-lg w-fit">
                  {(['pct', 'fixed'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => { setAdjustMode(m); setAdjustValue(''); }}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                        adjustMode === m
                          ? 'bg-white dark:bg-gray-800 text-violet-700 dark:text-violet-300 shadow-sm'
                          : 'text-violet-500 dark:text-violet-400',
                      )}
                    >
                      {m === 'pct' ? '% Percentual' : 'R$ Valor fixo'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{adjustMode === 'pct' ? '+' : 'R$'}</span>
                  <input
                    type="number"
                    value={adjustValue}
                    onChange={e => setAdjustValue(e.target.value)}
                    placeholder={adjustMode === 'pct' ? 'Ex: 5 (= +5%)' : `Novo valor (atual: ${tx.amount.toFixed(2)})`}
                    className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-violet-200 dark:border-violet-500/30 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-violet-400"
                  />
                  {adjustValue && parseFloat(adjustValue) > 0 && (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">
                      → {formatCurrency(adjustMode === 'pct' ? tx.amount * (1 + parseFloat(adjustValue) / 100) : parseFloat(adjustValue))}
                    </span>
                  )}
                  <button
                    disabled={adjustSaving || !adjustValue || parseFloat(adjustValue) <= 0}
                    onClick={doAdjust}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-40 transition-colors shrink-0"
                  >
                    {adjustSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Aplicar'}
                  </button>
                </div>
              </div>

              {/* Pausar/Retomar */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-white/[0.02]">
                <div>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    {isActive ? <PauseCircle className="w-3.5 h-3.5 text-amber-500" /> : <PlayCircle className="w-3.5 h-3.5 text-emerald-500" />}
                    {isActive ? 'Pausar série' : 'Retomar série'}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {isActive
                      ? 'Para de gerar próximos vencimentos. Pode retomar depois.'
                      : 'Volta a gerar vencimentos a partir da próxima data.'}
                  </p>
                </div>
                <button
                  onClick={doPause}
                  disabled={pausing}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50',
                    isActive
                      ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-500/25'
                      : 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/25',
                  )}
                >
                  {pausing
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : isActive ? <PauseCircle className="w-3 h-3" /> : <PlayCircle className="w-3 h-3" />}
                  {isActive ? 'Pausar' : 'Retomar'}
                </button>
              </div>

              {/* Danger zone */}
              <div className="p-3 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/40 dark:bg-red-500/5 space-y-2.5">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Zona de perigo
                </p>
                <label className="flex items-center gap-2 text-[11px] text-red-700 dark:text-red-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={endCancelCurrent}
                    onChange={e => setEndCancelCurrent(e.target.checked)}
                    className="rounded border-red-300 dark:border-red-500/30 text-red-600 focus:ring-red-400"
                  />
                  Também cancelar a ocorrência atual ({recurrence.nextDueDate ? formatDate(recurrence.nextDueDate) : '—'})
                </label>
                <button
                  onClick={doEnd}
                  disabled={ending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
                >
                  {ending ? <Loader2 className="w-3 h-3 animate-spin" /> : <StopCircle className="w-3 h-3" />}
                  Encerrar série permanentemente
                </button>
                <p className="text-[10px] text-red-600/70 dark:text-red-400/70">
                  A série fica inativa. Lançamentos antigos não são alterados. Não tem como desfazer.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer rápido — quitar/pular ocorrência atual */}
        {recurrence.nextDueDate && isActive && tab !== 'proximas' && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 bg-gray-50/50 dark:bg-white/[0.02]">
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 min-w-0">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Próximo vencimento: <strong>{formatDate(recurrence.nextDueDate)}</strong>
                {isOverdue && <span className="ml-2 text-red-600 dark:text-red-400 font-bold">(ATRASADO)</span>}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={doSkip}
                disabled={paying || skipping}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.1] disabled:opacity-50 transition-colors"
              >
                {skipping ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                Pular
              </button>
              <button
                onClick={doPay}
                disabled={paying || skipping}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
              >
                {paying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Quitar agora
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function MetricCard({
  label, value, sub, valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="px-3 py-2 rounded-lg bg-white dark:bg-white/[0.02] border border-gray-100 dark:border-gray-800">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">
        {label}
      </p>
      <p className={cn('text-base font-bold tabular-nums leading-tight mt-0.5', valueClass || 'text-gray-900 dark:text-gray-100')}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function TabButton({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px',
        active
          ? 'border-red-500 text-red-600 dark:text-red-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ConfigCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-white/[0.02]">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">
        {label}
      </p>
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-0.5 truncate">
        {value}
      </p>
    </div>
  );
}
