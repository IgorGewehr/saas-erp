/**
 * projecao-mes.ts — "Como fecha o mês" (KPI ④ de Entradas & Saídas) + a nota-
 * ponte caixa×competência (Refinamento D.4) que explica por que ela diverge do
 * "Resultado do mês" (`resultado-do-mes.ts`). FUNÇÕES PURAS.
 *
 * `saldoProjetado` = saldo bancário de hoje + tudo que ainda está em aberto
 * (pendente/atrasado avulso, ou a ocorrência corrente de uma recorrência
 * ativa) com vencimento efetivo dentro do período — "se tudo que vence neste
 * mês for pago", fiel ao rótulo do mockup. Não é uma projeção de 30 dias
 * corridos (isso é `projecao-caixa.ts`, bloco ② da Visão Geral) — é escopada
 * ao mês do PeriodContext.
 *
 * A nota-ponte é honesta sobre o gap g3 do plano (sem `dataCompetencia`
 * explícita): a única diferença matematicamente correta entre "resultado"
 * (todo mundo com dueDate no mês, pago ou não) e "como fecha" (só o que ainda
 * falta se mover) é o que JÁ foi realizado dentro do próprio mês — não
 * inventa uma competência futura que os dados não guardam.
 */

import type { BankAccount, Transaction } from '@/lib/types';
import type { ResultadoDoMesOverview } from './resultado-do-mes';
import { effectiveDueDate, isOpenCommitment } from './recurrence-projection';
import { monthKeyOf } from './date-utils';

export interface FechamentoMesOverview {
  period: string;
  saldoAtual: number;
  saldoProjetado: number;
  /** Assinado — soma de tudo que ainda está em aberto com vencimento efetivo no período. */
  deltaAberto: number;
}

export function computeFechamentoMes(
  transactions: Transaction[],
  bankAccounts: BankAccount[],
  period: string,
): FechamentoMesOverview {
  const saldoAtual = bankAccounts.filter(a => a.isActive).reduce((s, a) => s + a.balance, 0);

  let deltaAberto = 0;
  for (const t of transactions) {
    if (!isOpenCommitment(t)) continue;
    const date = effectiveDueDate(t);
    if (monthKeyOf(date) !== period) continue;
    deltaAberto += t.type === 'despesa' ? -t.amount : t.amount;
  }

  return { period, saldoAtual, saldoProjetado: saldoAtual + deltaAberto, deltaAberto };
}

export interface BridgeCaixaCompetenciaNote {
  show: boolean;
  competenciaValue: number;
  caixaValue: number;
  diffValue: number;
}

const MIN_DIFF_TO_SHOW = 1;

export function computeBridgeCaixaCompetencia(
  resultado: ResultadoDoMesOverview,
  fechamento: FechamentoMesOverview,
): BridgeCaixaCompetenciaNote {
  const diffValue = resultado.lucro - fechamento.deltaAberto;
  return {
    show: Math.abs(diffValue) >= MIN_DIFF_TO_SHOW,
    competenciaValue: resultado.lucro,
    caixaValue: fechamento.deltaAberto,
    diffValue,
  };
}
