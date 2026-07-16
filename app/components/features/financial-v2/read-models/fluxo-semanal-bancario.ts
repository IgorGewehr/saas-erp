/**
 * fluxo-semanal-bancario.ts — read-model do card esquerdo de Bancário: "entrou
 * × saiu por semana ⇄ dias + principais movimentos" (mockup bancario.html,
 * plano §2.3 `FluxoSemanalRealizado`). FUNÇÃO PURA.
 *
 * Só realizado bancário (Transaction `pago` com `bankAccountId` de conta
 * `accountType !== 'caixa'`) do mês selecionado, agrupado em semanas ISO
 * (segunda–domingo, recortadas ao mês — a mesma matemática usada no mockup:
 * julho/2026 começa numa quarta, então a 1ª semana tem só 5 dias).
 *
 * `movimentos` também alimenta o Extrato (tabela) e a mini-lista do drill de
 * dia — uma única passada pelos dados, sem duplicar a lógica de filtro.
 */

import type { BankAccount, Transaction } from '@/lib/types';
import { PAYMENT_METHOD_LABEL } from './extrato-unificado';
import { parseYmdLocal, toDateStr, addDays, startOfDay, monthKeyOf, shortDayLabel, shortMonthLabel } from './date-utils';

export interface FluxoBancarioDia {
  date: string;
  label: string;
  entrou: number;
  saiu: number;
}

export interface FluxoBancarioSemana {
  id: string;
  label: string;
  /** A semana ainda contém dias futuros (ainda "em andamento", como no mockup). */
  partial: boolean;
  entrou: number;
  saiu: number;
  dias: FluxoBancarioDia[];
}

export interface FluxoBancarioMovimento {
  id: string;
  weekId: string;
  date: string;
  dateLabel: string;
  desc: string;
  forma: string;
  contaId?: string;
  contaLabel?: string;
  valorSigned: number;
}

export interface FluxoBancarioOverview {
  semanas: FluxoBancarioSemana[];
  movimentos: FluxoBancarioMovimento[];
}

function isoWeekMondayKey(dateStr: string): string {
  const d = parseYmdLocal(dateStr);
  const dow = d.getDay(); // 0=dom..6=sáb
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return toDateStr(addDays(d, diffToMonday));
}

export function computeFluxoBancario(
  transactions: Transaction[],
  bankAccounts: BankAccount[],
  period: string,
  now: Date = new Date(),
): FluxoBancarioOverview {
  const contas = bankAccounts.filter(a => a.isActive && a.accountType !== 'caixa');
  const nonCaixaIds = new Set(contas.map(a => a.id));
  const contaById = new Map(contas.map(a => [a.id, a]));
  const todayStr = toDateStr(startOfDay(now));
  const [year, month] = period.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  const dayBuckets = new Map<string, { entrou: number; saiu: number }>();
  const movimentos: FluxoBancarioMovimento[] = [];

  for (const t of transactions) {
    if (t.status !== 'pago' || !t.bankAccountId || !nonCaixaIds.has(t.bankAccountId) || !t.paymentDate) continue;
    if (monthKeyOf(t.paymentDate) !== period) continue;

    const bucket = dayBuckets.get(t.paymentDate) ?? { entrou: 0, saiu: 0 };
    if (t.type === 'receita') bucket.entrou += t.amount;
    else bucket.saiu += t.amount;
    dayBuckets.set(t.paymentDate, bucket);

    const conta = contaById.get(t.bankAccountId);
    movimentos.push({
      id: t.id,
      weekId: isoWeekMondayKey(t.paymentDate),
      date: t.paymentDate,
      dateLabel: shortDayLabel(t.paymentDate),
      desc: t.description,
      forma: t.paymentMethod ? (PAYMENT_METHOD_LABEL[t.paymentMethod] ?? t.paymentMethod) : '—',
      contaId: conta?.id,
      contaLabel: conta?.name,
      valorSigned: t.type === 'receita' ? t.amount : -t.amount,
    });
  }

  const weekMap = new Map<string, FluxoBancarioDia[]>();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${period}-${String(day).padStart(2, '0')}`;
    const weekKey = isoWeekMondayKey(dateStr);
    const bucket = dayBuckets.get(dateStr) ?? { entrou: 0, saiu: 0 };
    const dias = weekMap.get(weekKey) ?? [];
    dias.push({ date: dateStr, label: String(day).padStart(2, '0'), entrou: bucket.entrou, saiu: bucket.saiu });
    weekMap.set(weekKey, dias);
  }

  const monthShort = shortMonthLabel(period).toLowerCase();
  const semanas: FluxoBancarioSemana[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    // `id` = a própria chave ISO (segunda-feira da semana) — mesma chave usada
    // em `movimentos[].weekId`, então o drill filtra sem lookup indireto.
    .map(([weekId, dias]) => {
      const partial = dias.some(d => d.date > todayStr);
      return {
        id: weekId,
        label: `${dias[0].label}–${dias[dias.length - 1].label} ${monthShort}${partial ? '*' : ''}`,
        partial,
        entrou: dias.reduce((s, d) => s + d.entrou, 0),
        saiu: dias.reduce((s, d) => s + d.saiu, 0),
        dias,
      };
    });

  movimentos.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { semanas, movimentos };
}
