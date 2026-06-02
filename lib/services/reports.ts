/**
 * lib/services/reports.ts — agregação de relatórios (pura, sem React/Firebase).
 *
 * Extraído da lógica de `app/components/features/reports/ReportsModule.tsx`
 * (auditoria P2.11) para ser reusado pela agent tool `tools/reports`. São funções
 * puras que recebem arrays já carregados e devolvem agregados — quem consulta o
 * Firestore (filtrando por businessId, R1) é o caller. Mantém os MESMOS critérios
 * de status/recorte do módulo de UI para que os números batam entre painel e agent.
 */

import type { Appointment, Client, Order, Sale, Transaction } from '@/lib/types';

// ─── Janela de período ─────────────────────────────────────────────────────────

export type ReportPeriod = '7d' | '30d' | '90d' | 'mes' | 'mes_anterior' | 'ano';

export interface PeriodRange {
  start: Date;
  end: Date;
}

/** Igual ao `getPeriodRange` do ReportsModule. */
export function getPeriodRange(period: ReportPeriod): PeriodRange {
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

/** Constrói um range a partir de duas datas YYYY-MM-DD (local, bordas inclusivas). */
export function rangeFromDates(fromDate: string, toDate: string): PeriodRange {
  const start = parseLocalDate(fromDate);
  start.setHours(0, 0, 0, 0);
  const end = parseLocalDate(toDate);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Parser de data tolerante a timezone (igual ReportsModule):
 *  "YYYY-MM-DD" → meia-noite LOCAL; ISO/qualquer outra → Date default. */
export function parseLocalDate(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

export function inPeriod(dateStr: string | undefined | null, range: PeriodRange): boolean {
  if (!dateStr) return false;
  const d = parseLocalDate(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= range.start && d <= range.end;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── revenue_by_period ──────────────────────────────────────────────────────────
//
// Espelha a aba "Financeiro" do ReportsModule: só Transactions PAGAS recortadas
// por paymentDate||createdAt. Retorna receita/despesa/lucro/margem + quebra por
// categoria de receita e de despesa.

export interface RevenueByPeriodResult {
  totalReceita: number;
  totalDespesa: number;
  lucro: number;
  margem: number;
  paidCount: number;
  receitasPorCategoria: Array<{ category: string; total: number }>;
  despesasPorCategoria: Array<{ category: string; total: number }>;
}

export function revenueByPeriod(transactions: Transaction[], range: PeriodRange): RevenueByPeriodResult {
  const paid = transactions.filter(
    (t) => t.status === 'pago' && inPeriod(t.paymentDate || t.createdAt, range),
  );

  let receita = 0;
  let despesa = 0;
  const recCat = new Map<string, number>();
  const despCat = new Map<string, number>();

  for (const t of paid) {
    const cat = t.category || 'Sem categoria';
    if (t.type === 'receita') {
      receita += t.amount;
      recCat.set(cat, (recCat.get(cat) || 0) + t.amount);
    } else {
      despesa += t.amount;
      despCat.set(cat, (despCat.get(cat) || 0) + t.amount);
    }
  }

  const lucro = receita - despesa;
  const toRanked = (m: Map<string, number>) =>
    Array.from(m.entries())
      .map(([category, total]) => ({ category, total: round(total) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

  return {
    totalReceita: round(receita),
    totalDespesa: round(despesa),
    lucro: round(lucro),
    margem: receita > 0 ? round((lucro / receita) * 100) : 0,
    paidCount: paid.length,
    receitasPorCategoria: toRanked(recCat),
    despesasPorCategoria: toRanked(despCat),
  };
}

// ─── sales_by_product ───────────────────────────────────────────────────────────
//
// Espelha a aba "Produtos & Serviços": agrega items[] de sales (finalizada) +
// orders (confirmado/faturado/enviado/entregue) + appointments (concluido).
// Chave: productId/serviceId quando há, senão nome em lowercase.

interface RankRow { key: string; name: string; qty: number; total: number }

export interface SalesByProductResult {
  produtos: Array<{ name: string; qty: number; total: number }>;
  servicos: Array<{ name: string; qty: number; total: number }>;
  totalProdutos: number;
  totalServicos: number;
  qtyProdutos: number;
  qtyServicos: number;
}

export function salesByProduct(
  sales: Sale[],
  orders: Order[],
  appointments: Appointment[],
  range: PeriodRange,
): SalesByProductResult {
  const prodMap = new Map<string, RankRow>();
  const servMap = new Map<string, RankRow>();

  const bump = (map: Map<string, RankRow>, rawKey: string | undefined, name: string, qty: number, total: number) => {
    const key = rawKey || `name:${name.trim().toLowerCase()}`;
    const cleanName = name.trim() || '(sem nome)';
    const cur = map.get(key);
    if (cur) {
      cur.qty += qty;
      cur.total += total;
    } else {
      map.set(key, { key, name: cleanName, qty, total });
    }
  };

  const validSales = sales.filter((s) => s.status === 'finalizada' && inPeriod(s.createdAt, range));
  for (const s of validSales) {
    for (const item of s.items || []) {
      if (item.serviceId) bump(servMap, item.serviceId, item.description, item.quantity, item.total);
      else bump(prodMap, item.productId, item.description, item.quantity, item.total);
    }
  }

  const validOrders = orders.filter(
    (o) =>
      (o.status === 'confirmado' || o.status === 'faturado' || o.status === 'enviado' || o.status === 'entregue') &&
      inPeriod(o.createdAt, range),
  );
  for (const o of validOrders) {
    for (const item of o.items || []) {
      bump(prodMap, item.productId, item.productName, item.quantity, item.total);
    }
  }

  const validAppts = appointments.filter((a) => a.status === 'concluido' && inPeriod(a.date, range));
  for (const a of validAppts) {
    bump(servMap, a.serviceId, a.serviceName, 1, a.price || 0);
  }

  const allProdutos = Array.from(prodMap.values());
  const allServicos = Array.from(servMap.values());

  const shape = (r: RankRow) => ({ name: r.name, qty: r.qty, total: round(r.total) });

  return {
    produtos: allProdutos.sort((a, b) => b.total - a.total).slice(0, 20).map(shape),
    servicos: allServicos.sort((a, b) => b.total - a.total).slice(0, 20).map(shape),
    totalProdutos: round(allProdutos.reduce((acc, r) => acc + r.total, 0)),
    totalServicos: round(allServicos.reduce((acc, r) => acc + r.total, 0)),
    qtyProdutos: allProdutos.reduce((acc, r) => acc + r.qty, 0),
    qtyServicos: allServicos.reduce((acc, r) => acc + r.qty, 0),
  };
}

// ─── appointments_by_professional ────────────────────────────────────────────────
//
// Espelha a aba "Agenda": por profissional total/concluídos/no-show/receita +
// taxa de conclusão. Recorta appointments por `date` no período.

export interface AppointmentsByProfessionalResult {
  total: number;
  concluidos: number;
  cancelados: number;
  naoCompareceu: number;
  taxaConclusao: number;
  taxaNoShow: number;
  porProfissional: Array<{
    professionalId: string;
    name: string;
    total: number;
    concluidos: number;
    noShow: number;
    taxaConclusao: number;
    receita: number;
  }>;
}

export function appointmentsByProfessional(
  appointments: Appointment[],
  range: PeriodRange,
): AppointmentsByProfessionalResult {
  const filtered = appointments.filter((a) => inPeriod(a.date, range));
  const total = filtered.length;
  const concluidos = filtered.filter((a) => a.status === 'concluido').length;
  const cancelados = filtered.filter((a) => a.status === 'cancelado').length;
  const naoCompareceu = filtered.filter((a) => a.status === 'nao_compareceu').length;

  const m = new Map<string, { name: string; total: number; concluidos: number; noShow: number; receita: number }>();
  for (const a of filtered) {
    const k = a.professionalId || '__sem__';
    const name = a.professionalName || 'Sem profissional';
    const cur = m.get(k) ?? { name, total: 0, concluidos: 0, noShow: 0, receita: 0 };
    cur.total++;
    if (a.status === 'concluido') { cur.concluidos++; cur.receita += a.price; }
    if (a.status === 'nao_compareceu') cur.noShow++;
    m.set(k, cur);
  }

  const porProfissional = Array.from(m.entries())
    .map(([professionalId, r]) => ({
      professionalId,
      name: r.name,
      total: r.total,
      concluidos: r.concluidos,
      noShow: r.noShow,
      taxaConclusao: r.total > 0 ? round((r.concluidos / r.total) * 100) : 0,
      receita: round(r.receita),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total,
    concluidos,
    cancelados,
    naoCompareceu,
    taxaConclusao: total > 0 ? round((concluidos / total) * 100) : 0,
    taxaNoShow: total > 0 ? round((naoCompareceu / total) * 100) : 0,
    porProfissional,
  };
}

// ─── top_clients ─────────────────────────────────────────────────────────────────
//
// Espelha a aba "Clientes": ranking por `totalSpent` (CLV acumulado, não do
// período — igual ao módulo) + nº de visitas no período via appointments.

export interface TopClientsResult {
  totalClientes: number;
  novosNoPeriodo: number;
  ticketMedioCLV: number;
  topClients: Array<{
    id: string;
    name: string;
    totalSpent: number;
    visitCount: number;
    visitasNoPeriodo: number;
  }>;
}

export function topClients(
  clients: Client[],
  appointments: Appointment[],
  range: PeriodRange,
  limit = 10,
): TopClientsResult {
  const apptMap = new Map<string, number>();
  for (const a of appointments) {
    if (a.clientId && inPeriod(a.date, range)) {
      apptMap.set(a.clientId, (apptMap.get(a.clientId) || 0) + 1);
    }
  }

  const ranked = [...clients]
    .sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0))
    .slice(0, Math.min(Math.max(limit, 1), 50))
    .map((c) => ({
      id: c.id,
      name: c.name ?? '—',
      totalSpent: round(c.totalSpent || 0),
      visitCount: c.visitCount || 0,
      visitasNoPeriodo: apptMap.get(c.id) || 0,
    }));

  const novosNoPeriodo = clients.filter((c) => inPeriod(c.createdAt, range)).length;
  const avgSpent = clients.length > 0
    ? clients.reduce((s, c) => s + (c.totalSpent || 0), 0) / clients.length
    : 0;

  return {
    totalClientes: clients.length,
    novosNoPeriodo,
    ticketMedioCLV: round(avgSpent),
    topClients: ranked,
  };
}
