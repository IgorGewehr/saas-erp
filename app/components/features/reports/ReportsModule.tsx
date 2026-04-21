'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import {
  BarChart3,
  Calendar,
  DollarSign,
  Users,
  TrendingUp,
  TrendingDown,
  FileDown,
  Award,
  ChevronDown,
  Loader2,
  ShoppingBag,
} from 'lucide-react';
import type { Transaction, Appointment, Client } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportTab = 'vendas' | 'agenda' | 'financeiro' | 'clientes' | 'comissoes';
type Period = '7d' | '30d' | '90d' | 'mes' | 'mes_anterior' | 'ano';

interface PeriodOption { value: Period; label: string }

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: '7d',          label: 'Últimos 7 dias' },
  { value: '30d',         label: 'Últimos 30 dias' },
  { value: '90d',         label: 'Últimos 90 dias' },
  { value: 'mes',         label: 'Este mês' },
  { value: 'mes_anterior', label: 'Mês passado' },
  { value: 'ano',         label: 'Este ano' },
];

function getPeriodRange(period: Period): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (period) {
    case '7d': {
      const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case '30d': {
      const start = new Date(now); start.setDate(start.getDate() - 29); start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case '90d': {
      const start = new Date(now); start.setDate(start.getDate() - 89); start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case 'mes': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end };
    }
    case 'mes_anterior': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0); e.setHours(23, 59, 59, 999);
      return { start, end: e };
    }
    case 'ano': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start, end };
    }
  }
}

/** Date string can be YYYY-MM-DD or ISO datetime */
function inPeriod(dateStr: string | undefined | null, start: Date, end: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= start && d <= end;
}

function pct(n: number, dec = 1): string { return `${n.toFixed(dec)}%`; }

// ─── Shared sub-components ────────────────────────────────────────────────────

type KpiColor = 'blue' | 'green' | 'red' | 'amber' | 'violet' | 'rose';

function KpiCard({
  title, value, sub, color = 'blue', icon: Icon,
}: {
  title: string; value: string; sub?: string; color?: KpiColor; icon?: React.ElementType;
}) {
  const colorMap: Record<KpiColor, string> = {
    blue:   'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
    green:  'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    red:    'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
    amber:  'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
    violet: 'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400',
    rose:   'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400',
  };
  return (
    <div className="surface rounded-2xl p-4 flex items-start gap-3">
      {Icon && (
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', colorMap[color])}>
          <Icon className="w-4 h-4" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{title}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-0.5 tabular-nums">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${w}%`, backgroundColor: color }} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ icon: Icon, msg }: { icon: React.ElementType; msg: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <Icon className="w-9 h-9 text-gray-300 dark:text-gray-600 mb-2" />
      <p className="text-sm text-gray-400 dark:text-gray-500">{msg}</p>
    </div>
  );
}

function ExportBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <div className="flex justify-end">
      <button
        onClick={onClick}
        disabled={disabled}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
      >
        <FileDown className="w-4 h-4" />
        Exportar PDF
      </button>
    </div>
  );
}

// ─── PDF export (dynamic import to avoid SSR issues) ─────────────────────────

async function exportPDF(title: string, subtitle: string, headers: string[], rows: string[][]) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF();
  doc.setFontSize(16); doc.setTextColor(30, 30, 30);
  doc.text('Aevo — Relatório', 14, 16);
  doc.setFontSize(12); doc.text(title, 14, 24);
  doc.setFontSize(9); doc.setTextColor(120, 120, 120);
  doc.text(subtitle, 14, 31);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 37);
  autoTable(doc, {
    head: [headers], body: rows, startY: 45, theme: 'striped',
    headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9 },
  });
  doc.save(`aevo-${title.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}

// ─── Tab: Vendas ──────────────────────────────────────────────────────────────

function VendasTab({ transactions, periodRange, periodLabel }: {
  transactions: Transaction[]; periodRange: { start: Date; end: Date }; periodLabel: string;
}) {
  const filtered = useMemo(
    () => transactions.filter(t =>
      t.type === 'receita' && t.status === 'pago' &&
      inPeriod(t.paymentDate || t.createdAt, periodRange.start, periodRange.end)
    ),
    [transactions, periodRange],
  );

  const totalReceita = filtered.reduce((s, t) => s + t.amount, 0);
  const ticketMedio  = filtered.length > 0 ? totalReceita / filtered.length : 0;

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(t => { const k = t.category || 'Sem categoria'; m.set(k, (m.get(k) || 0) + t.amount); });
    return Array.from(m.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filtered]);

  const PAYMENT_LABELS: Record<string, string> = {
    dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', boleto: 'Boleto', outros: 'Outros',
  };
  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(t => { const k = t.paymentMethod || 'outros'; m.set(k, (m.get(k) || 0) + t.amount); });
    return Array.from(m.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const maxCat = byCategory[0]?.total || 1;

  const handleExport = () => exportPDF('Relatório de Vendas', periodLabel,
    ['Categoria', 'Total (R$)', '% do Total'],
    byCategory.map(r => [r.name, formatCurrency(r.total), pct((r.total / (totalReceita || 1)) * 100)]),
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Receita total"       value={formatCurrency(totalReceita)} color="green"  icon={DollarSign} />
        <KpiCard title="Lançamentos pagos"   value={String(filtered.length)}      color="blue"   icon={BarChart3} />
        <KpiCard title="Ticket médio"        value={formatCurrency(ticketMedio)}  color="violet" icon={TrendingUp} />
        <KpiCard title="Categorias"          value={String(byCategory.length)}    color="amber"  icon={ShoppingBag} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Receita por categoria">
          {byCategory.length === 0
            ? <Empty icon={BarChart3} msg="Nenhuma receita neste período" />
            : <div className="space-y-3">
                {byCategory.map(r => (
                  <div key={r.name}>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[60%]">{r.name}</span>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(r.total)}</span>
                    </div>
                    <Bar value={r.total} max={maxCat} color="#10B981" />
                  </div>
                ))}
              </div>
          }
        </Card>
        <Card title="Formas de pagamento">
          {byMethod.length === 0
            ? <Empty icon={DollarSign} msg="Nenhum dado disponível" />
            : <div className="space-y-2">
                {byMethod.map(r => (
                  <div key={r.name} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{PAYMENT_LABELS[r.name] ?? r.name}</span>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums">{formatCurrency(r.total)}</div>
                      <div className="text-[10px] text-gray-400">{pct((r.total / (totalReceita || 1)) * 100)}</div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </Card>
      </div>
      <ExportBtn onClick={handleExport} disabled={filtered.length === 0} />
    </div>
  );
}

// ─── Tab: Agenda ──────────────────────────────────────────────────────────────

function AgendaTab({ appointments, periodRange, periodLabel }: {
  appointments: Appointment[]; periodRange: { start: Date; end: Date }; periodLabel: string;
}) {
  const filtered = useMemo(
    () => appointments.filter(a => inPeriod(a.date, periodRange.start, periodRange.end)),
    [appointments, periodRange],
  );

  const total         = filtered.length;
  const concluidos    = filtered.filter(a => a.status === 'concluido').length;
  const cancelados    = filtered.filter(a => a.status === 'cancelado').length;
  const naoCompareceu = filtered.filter(a => a.status === 'nao_compareceu').length;
  const outros        = total - concluidos - cancelados - naoCompareceu;
  const taxaConclusao = total > 0 ? (concluidos / total) * 100 : 0;
  const taxaNoShow    = total > 0 ? (naoCompareceu / total) * 100 : 0;

  const byProfessional = useMemo(() => {
    const m = new Map<string, { name: string; total: number; concluidos: number; noShow: number; receita: number }>();
    filtered.forEach(a => {
      const k = a.professionalId || '__sem__';
      const name = a.professionalName || 'Sem profissional';
      const cur = m.get(k) ?? { name, total: 0, concluidos: 0, noShow: 0, receita: 0 };
      cur.total++;
      if (a.status === 'concluido') { cur.concluidos++; cur.receita += a.price; }
      if (a.status === 'nao_compareceu') cur.noShow++;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const byService = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    filtered.forEach(a => {
      const k = a.serviceName;
      const cur = m.get(k) ?? { name: a.serviceName, count: 0 };
      cur.count++;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [filtered]);

  const maxSvc = byService[0]?.count || 1;

  const statusDist = [
    { label: 'Concluídos',      count: concluidos,    color: '#6366F1' },
    { label: 'Cancelados',      count: cancelados,    color: '#EF4444' },
    { label: 'Não compareceu',  count: naoCompareceu, color: '#6B7280' },
    { label: 'Outros',          count: outros,        color: '#3B82F6' },
  ].filter(s => s.count > 0);

  const handleExport = () => exportPDF('Relatório de Agenda', periodLabel,
    ['Profissional', 'Total', 'Concluídos', 'No-shows', 'Tx. Conclusão', 'Receita'],
    byProfessional.map(r => [
      r.name, String(r.total), String(r.concluidos), String(r.noShow),
      pct(r.total > 0 ? (r.concluidos / r.total) * 100 : 0),
      formatCurrency(r.receita),
    ]),
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Total agendamentos" value={String(total)}               color="blue"   icon={Calendar} />
        <KpiCard title="Taxa de conclusão"  value={pct(taxaConclusao)}          sub={`${concluidos} concluídos`} color="green" icon={TrendingUp} />
        <KpiCard title="Taxa de no-show"    value={pct(taxaNoShow)}             sub={`${naoCompareceu} ausências`} color="red" icon={TrendingDown} />
        <KpiCard title="Cancelamentos"      value={String(cancelados)}          sub={pct(total > 0 ? (cancelados / total) * 100 : 0)} color="amber" icon={TrendingDown} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Por profissional">
          {byProfessional.length === 0
            ? <Empty icon={Users} msg="Nenhum agendamento neste período" />
            : <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
                      <th className="text-left py-2 font-medium">Profissional</th>
                      <th className="text-right py-2 font-medium">Total</th>
                      <th className="text-right py-2 font-medium">Conclusão</th>
                      <th className="text-right py-2 font-medium">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byProfessional.map(r => (
                      <tr key={r.name} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                        <td className="py-2 font-medium text-gray-700 dark:text-gray-300">{r.name}</td>
                        <td className="py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{r.total}</td>
                        <td className="py-2 text-right tabular-nums">
                          <span className={r.total > 0 && (r.concluidos / r.total) >= 0.7 ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                            {pct(r.total > 0 ? (r.concluidos / r.total) * 100 : 0)}
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(r.receita)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </Card>

        <Card title="Serviços mais agendados">
          {byService.length === 0
            ? <Empty icon={Calendar} msg="Nenhum dado disponível" />
            : <div className="space-y-2.5">
                {byService.map((r, i) => (
                  <div key={r.name} className="flex items-center gap-3">
                    <span className="w-5 text-xs text-gray-400 text-right flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between mb-0.5">
                        <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{r.name}</span>
                        <span className="text-xs font-medium text-gray-500 ml-2">{r.count}×</span>
                      </div>
                      <Bar value={r.count} max={maxSvc} color="#6366F1" />
                    </div>
                  </div>
                ))}
              </div>
          }
        </Card>
      </div>

      {statusDist.length > 0 && (
        <Card title="Distribuição por status">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {statusDist.map(s => (
              <div key={s.label} className="flex flex-col items-center py-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                <div className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.count}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 text-center leading-tight">{s.label}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{pct(total > 0 ? (s.count / total) * 100 : 0)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ExportBtn onClick={handleExport} disabled={filtered.length === 0} />
    </div>
  );
}

// ─── Tab: Financeiro ─────────────────────────────────────────────────────────

function FinanceiroTab({ transactions, periodRange, periodLabel }: {
  transactions: Transaction[]; periodRange: { start: Date; end: Date }; periodLabel: string;
}) {
  const filtered = useMemo(
    () => transactions.filter(t =>
      t.status === 'pago' && inPeriod(t.paymentDate || t.createdAt, periodRange.start, periodRange.end)
    ),
    [transactions, periodRange],
  );

  const receita = filtered.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
  const despesa = filtered.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);
  const lucro   = receita - despesa;
  const margem  = receita > 0 ? (lucro / receita) * 100 : 0;

  const receitasCat = useMemo(() => {
    const m = new Map<string, number>();
    filtered.filter(t => t.type === 'receita').forEach(t => { const k = t.category || 'Sem categoria'; m.set(k, (m.get(k) || 0) + t.amount); });
    return Array.from(m.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filtered]);

  const despesasCat = useMemo(() => {
    const m = new Map<string, number>();
    filtered.filter(t => t.type === 'despesa').forEach(t => { const k = t.category || 'Sem categoria'; m.set(k, (m.get(k) || 0) + t.amount); });
    return Array.from(m.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filtered]);

  const maxR = receitasCat[0]?.total || 1;
  const maxD = despesasCat[0]?.total || 1;

  const handleExport = () => {
    const rows: string[][] = [
      ...receitasCat.map(r => ['Receita', r.name, formatCurrency(r.total)]),
      ...despesasCat.map(r => ['Despesa', r.name, formatCurrency(r.total)]),
    ];
    exportPDF('Relatório Financeiro', periodLabel, ['Tipo', 'Categoria', 'Total'], rows);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Receita total" value={formatCurrency(receita)} color="green"               icon={TrendingUp} />
        <KpiCard title="Despesas"      value={formatCurrency(despesa)} color="red"                 icon={TrendingDown} />
        <KpiCard title="Resultado"     value={formatCurrency(lucro)}   color={lucro >= 0 ? 'green' : 'red'} icon={DollarSign} />
        <KpiCard title="Margem"        value={pct(margem)}             sub="lucro sobre receita"   color={margem >= 0 ? 'blue' : 'rose'} icon={BarChart3} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Receitas por categoria">
          {receitasCat.length === 0
            ? <Empty icon={TrendingUp} msg="Nenhuma receita neste período" />
            : <div className="space-y-3">
                {receitasCat.map(r => (
                  <div key={r.name}>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[60%]">{r.name}</span>
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(r.total)}</span>
                    </div>
                    <Bar value={r.total} max={maxR} color="#10B981" />
                  </div>
                ))}
              </div>
          }
        </Card>

        <Card title="Despesas por categoria">
          {despesasCat.length === 0
            ? <Empty icon={TrendingDown} msg="Nenhuma despesa neste período" />
            : <div className="space-y-3">
                {despesasCat.map(r => (
                  <div key={r.name}>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[60%]">{r.name}</span>
                      <span className="text-sm font-semibold text-red-600 dark:text-red-400 tabular-nums">{formatCurrency(r.total)}</span>
                    </div>
                    <Bar value={r.total} max={maxD} color="#EF4444" />
                  </div>
                ))}
              </div>
          }
        </Card>
      </div>

      <ExportBtn onClick={handleExport} disabled={filtered.length === 0} />
    </div>
  );
}

// ─── Tab: Clientes ────────────────────────────────────────────────────────────

function ClientesTab({ clients, appointments, periodRange, periodLabel }: {
  clients: Client[]; appointments: Appointment[]; periodRange: { start: Date; end: Date }; periodLabel: string;
}) {
  const topClients = useMemo(
    () => [...clients].sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0)).slice(0, 10),
    [clients],
  );

  const newInPeriod = useMemo(
    () => clients.filter(c => inPeriod(c.createdAt, periodRange.start, periodRange.end)).length,
    [clients, periodRange],
  );

  const apptMap = useMemo(() => {
    const m = new Map<string, number>();
    appointments
      .filter(a => inPeriod(a.date, periodRange.start, periodRange.end))
      .forEach(a => { if (a.clientId) m.set(a.clientId, (m.get(a.clientId) || 0) + 1); });
    return m;
  }, [appointments, periodRange]);

  const maxSpent = topClients[0]?.totalSpent || 1;
  const avgSpent = clients.length > 0 ? clients.reduce((s, c) => s + (c.totalSpent || 0), 0) / clients.length : 0;

  const handleExport = () => exportPDF('Relatório de Clientes', periodLabel,
    ['Cliente', 'Total gasto', 'Visitas', 'Visitas no período'],
    topClients.map(c => [c.name, formatCurrency(c.totalSpent || 0), String(c.visitCount || 0), String(apptMap.get(c.id) || 0)]),
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Total de clientes"  value={String(clients.length)}        color="blue"   icon={Users} />
        <KpiCard title="Novos no período"   value={String(newInPeriod)}           color="green"  icon={TrendingUp} />
        <KpiCard title="Ticket médio (CLV)" value={formatCurrency(avgSpent)}      color="violet" icon={DollarSign} />
        <KpiCard title="Maior CLV"          value={formatCurrency(topClients[0]?.totalSpent || 0)} sub={topClients[0]?.name ?? '—'} color="amber" icon={Award} />
      </div>

      <Card title="Top 10 clientes por gasto total (CLV)">
        {topClients.length === 0
          ? <Empty icon={Users} msg="Nenhum cliente cadastrado" />
          : <div className="space-y-3">
              {topClients.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3">
                  <div className="w-5 text-xs text-gray-400 text-right flex-shrink-0 font-medium">{i + 1}</div>
                  <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-red-600 dark:text-red-400">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{c.name}</span>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        {apptMap.get(c.id) ? (
                          <span className="text-[10px] text-gray-400">{apptMap.get(c.id)} vis. período</span>
                        ) : null}
                        <span className="text-sm font-bold tabular-nums">{formatCurrency(c.totalSpent || 0)}</span>
                      </div>
                    </div>
                    <Bar value={c.totalSpent || 0} max={maxSpent} color="#DC2626" />
                  </div>
                </div>
              ))}
            </div>
        }
      </Card>

      <ExportBtn onClick={handleExport} disabled={topClients.length === 0} />
    </div>
  );
}

// ─── Tab: Comissões ───────────────────────────────────────────────────────────

function ComissoesTab({ transactions, periodRange, periodLabel }: {
  transactions: Transaction[]; periodRange: { start: Date; end: Date }; periodLabel: string;
}) {
  const commissions = useMemo(
    () => transactions.filter(t =>
      t.type === 'despesa' &&
      (t.category?.toLowerCase().includes('comiss') || t.description?.toLowerCase().includes('comiss')) &&
      inPeriod(t.paymentDate || t.createdAt, periodRange.start, periodRange.end)
    ),
    [transactions, periodRange],
  );

  const byProfessional = useMemo(() => {
    const m = new Map<string, { name: string; total: number; count: number }>();
    commissions.forEach(t => {
      const name = t.createdByName || 'Profissional';
      const cur = m.get(name) ?? { name, total: 0, count: 0 };
      cur.total += t.amount; cur.count++;
      m.set(name, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [commissions]);

  const totalComissao = commissions.reduce((s, t) => s + t.amount, 0);
  const receitaPeriodo = useMemo(
    () => transactions.filter(t =>
      t.type === 'receita' && t.status === 'pago' &&
      inPeriod(t.paymentDate || t.createdAt, periodRange.start, periodRange.end)
    ).reduce((s, t) => s + t.amount, 0),
    [transactions, periodRange],
  );

  const pctReceita = receitaPeriodo > 0 ? (totalComissao / receitaPeriodo) * 100 : 0;
  const maxCom = byProfessional[0]?.total || 1;

  const handleExport = () => exportPDF('Relatório de Comissões', periodLabel,
    ['Profissional', 'Lançamentos', 'Total comissão'],
    byProfessional.map(r => [r.name, String(r.count), formatCurrency(r.total)]),
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard title="Total de comissões" value={formatCurrency(totalComissao)} color="violet" icon={DollarSign} />
        <KpiCard title="Lançamentos"        value={String(commissions.length)}   color="blue"   icon={BarChart3} />
        <KpiCard title="% da receita"       value={pct(pctReceita)}              sub="comissões sobre receita" color="amber" icon={TrendingUp} />
      </div>

      <Card title="Comissões por profissional">
        {byProfessional.length === 0
          ? <Empty icon={Award} msg="Nenhuma comissão registrada neste período" />
          : <div className="space-y-3">
              {byProfessional.map(r => (
                <div key={r.name}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{r.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{r.count} lançamento{r.count !== 1 ? 's' : ''}</span>
                      <span className="text-sm font-bold text-violet-600 dark:text-violet-400 tabular-nums">{formatCurrency(r.total)}</span>
                    </div>
                  </div>
                  <Bar value={r.total} max={maxCom} color="#7C3AED" />
                </div>
              ))}
            </div>
        }
      </Card>

      <ExportBtn onClick={handleExport} disabled={commissions.length === 0} />
    </div>
  );
}

// ─── Main Module ──────────────────────────────────────────────────────────────

export default function ReportsModule() {
  const { business } = useAuth();
  const businessId = business?.id;

  const [activeTab, setActiveTab] = useState<ReportTab>('vendas');
  const [period, setPeriod]       = useState<Period>('30d');
  const [periodOpen, setPeriodOpen] = useState(false);

  const periodRange = useMemo(() => getPeriodRange(period), [period]);
  const periodLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label ?? '';

  const { data: transactions = [], isLoading: loadingTx } = useQuery({
    queryKey: ['transactions', businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const q = query(collection(db, 'transactions'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'));
      return (await getDocs(q)).docs.map(d => ({ ...d.data(), id: d.id } as Transaction));
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: appointments = [], isLoading: loadingAppt } = useQuery({
    queryKey: ['appointments', businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const q = query(collection(db, 'appointments'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'));
      return (await getDocs(q)).docs.map(d => ({ ...d.data(), id: d.id } as Appointment));
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: clients = [], isLoading: loadingClients } = useQuery({
    queryKey: ['clients', businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const q = query(collection(db, 'clients'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'));
      return (await getDocs(q)).docs.map(d => ({ ...d.data(), id: d.id } as Client));
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = loadingTx || loadingAppt || loadingClients;

  const tabs: { id: ReportTab; label: string; icon: React.ElementType }[] = [
    { id: 'vendas',     label: 'Vendas',     icon: DollarSign },
    { id: 'agenda',     label: 'Agenda',     icon: Calendar },
    { id: 'financeiro', label: 'Financeiro', icon: BarChart3 },
    { id: 'clientes',   label: 'Clientes',   icon: Users },
    { id: 'comissoes',  label: 'Comissões',  icon: Award },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -4, scale: 0.998 }}
      transition={{ duration: 0.25 }}
      className="max-w-6xl mx-auto"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-gray-900 dark:text-gray-100">Relatórios</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Análises e exportações do seu negócio</p>
        </div>

        {/* Period selector */}
        <div className="relative">
          <button
            onClick={() => setPeriodOpen(v => !v)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
          >
            <Calendar className="w-4 h-4 text-gray-400" />
            {periodLabel}
            <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', periodOpen && 'rotate-180')} />
          </button>
          <AnimatePresence>
            {periodOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden"
              >
                {PERIOD_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setPeriod(opt.value); setPeriodOpen(false); }}
                    className={cn(
                      'w-full text-left px-4 py-2.5 text-sm transition-colors',
                      period === opt.value
                        ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-medium'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Tab nav */}
      <div className="overflow-x-auto scrollbar-hide mb-6">
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800/60 rounded-2xl w-max border border-gray-200/50 dark:border-gray-700/30">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
                  active
                    ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {isLoading
        ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
          </div>
        )
        : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {activeTab === 'vendas'     && <VendasTab     transactions={transactions} periodRange={periodRange} periodLabel={periodLabel} />}
              {activeTab === 'agenda'     && <AgendaTab     appointments={appointments} periodRange={periodRange} periodLabel={periodLabel} />}
              {activeTab === 'financeiro' && <FinanceiroTab  transactions={transactions} periodRange={periodRange} periodLabel={periodLabel} />}
              {activeTab === 'clientes'   && <ClientesTab    clients={clients} appointments={appointments} periodRange={periodRange} periodLabel={periodLabel} />}
              {activeTab === 'comissoes'  && <ComissoesTab   transactions={transactions} periodRange={periodRange} periodLabel={periodLabel} />}
            </motion.div>
          </AnimatePresence>
        )
      }
    </motion.div>
  );
}
