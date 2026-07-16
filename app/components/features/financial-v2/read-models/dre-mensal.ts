/**
 * dre-mensal.ts — read-model do card "DRE do mês" de Relatórios (mockup
 * `relatorios.html`: mini-DRE de 4 linhas — Receita bruta / (–) Impostos /
 * (–) Despesas e custos / Resultado). FUNÇÃO PURA.
 *
 * Os DOIS regimes são sempre calculados (o toggle na UI só troca qual já está
 * pronto — plano §1.2 "Relatórios: o regime é a única tela em que é um toggle
 * explícito e global"):
 *
 *  · competência — `dueDate`, receita/despesa não-canceladas do período (gap
 *    g3 do plano: sem `competenceDate` explícita, `dueDate` é o proxy) + o DAS
 *    (`DasRecord`) daquela COMPETÊNCIA, pago ou não — é despesa incorrida no
 *    mês mesmo que o boleto vença depois.
 *  · caixa — só `status:'pago'`, por `paymentDate` + DAS já pago dentro do
 *    período (por `pagoEm`) — dinheiro que realmente mudou de mão.
 *
 * "Impostos" isola a categoria `Impostos` (uma das `EXPENSE_CATEGORIES`
 * hardcoded do app, ver `LancarSheet.tsx`) do resto — a mesma distinção do
 * mockup. Nada aqui duplica `resultado-do-mes.ts` (aquele é só competência,
 * sem separar imposto nem somar DAS) — este é o read-model dedicado ao
 * documento contábil, não ao cockpit da Visão Geral.
 */

import type { DasRecord, Transaction } from '@/lib/types';
import type { DREData } from '@/lib/utils/financial-export';
import { monthKeyOf, shiftMonthKey } from './date-utils';

const TAX_CATEGORY = 'Impostos';

export type DreRegime = 'competencia' | 'caixa';

export interface DreRegimeResult {
  receitaBruta: number;
  impostos: number;
  despesas: number;
  resultado: number;
}

export interface DreMensalOverview {
  period: string;
  competencia: DreRegimeResult;
  competenciaAnterior: DreRegimeResult;
  caixa: DreRegimeResult;
  /** competencia.resultado − caixa.resultado do MESMO período (a "ponte"). */
  bridgeDiff: number;
}

/** 'YYYY-MM' → 'AAAAMM' (formato de `DasRecord.competencia`). */
function toDasCompetencia(period: string): string {
  const [y, m] = period.split('-');
  return `${y}${m}`;
}

function competenciaRegime(transactions: Transaction[], dasRecords: DasRecord[], period: string): DreRegimeResult {
  let receitaBruta = 0;
  let despesaBruta = 0;
  let impostosTransacoes = 0;

  for (const t of transactions) {
    if (t.status === 'cancelado' || monthKeyOf(t.dueDate) !== period) continue;
    if (t.type === 'receita') { receitaBruta += t.amount; continue; }
    despesaBruta += t.amount;
    if (t.category === TAX_CATEGORY) impostosTransacoes += t.amount;
  }

  const dasCompetencia = dasRecords
    .filter(d => d.competencia === toDasCompetencia(period))
    .reduce((s, d) => s + d.valorDas, 0);

  const impostos = impostosTransacoes + dasCompetencia;
  const despesas = despesaBruta - impostosTransacoes;
  return { receitaBruta, impostos, despesas, resultado: receitaBruta - impostos - despesas };
}

function caixaRegime(transactions: Transaction[], dasRecords: DasRecord[], period: string): DreRegimeResult {
  let receitaBruta = 0;
  let despesaBruta = 0;
  let impostosTransacoes = 0;

  for (const t of transactions) {
    if (t.status !== 'pago' || monthKeyOf(t.paymentDate) !== period) continue;
    if (t.type === 'receita') { receitaBruta += t.amount; continue; }
    despesaBruta += t.amount;
    if (t.category === TAX_CATEGORY) impostosTransacoes += t.amount;
  }

  const dasPago = dasRecords
    .filter(d => d.status === 'pago' && monthKeyOf(d.pagoEm) === period)
    .reduce((s, d) => s + d.valorDas, 0);

  const impostos = impostosTransacoes + dasPago;
  const despesas = despesaBruta - impostosTransacoes;
  return { receitaBruta, impostos, despesas, resultado: receitaBruta - impostos - despesas };
}

export function computeDreMensal(transactions: Transaction[], dasRecords: DasRecord[], period: string): DreMensalOverview {
  const competencia = competenciaRegime(transactions, dasRecords, period);
  const caixa = caixaRegime(transactions, dasRecords, period);
  const competenciaAnterior = competenciaRegime(transactions, dasRecords, shiftMonthKey(period, -1));
  return { period, competencia, competenciaAnterior, caixa, bridgeDiff: competencia.resultado - caixa.resultado };
}

/**
 * Adapta um regime do mini-DRE pro `DREData` genérico de
 * `lib/utils/financial-export.ts` (reuso do exportador PDF/CSV do módulo
 * clássico — plano §1.2 "exports reutilizam financial-export.ts"). Só 3
 * linhas de detalhe (Receita bruta / Impostos / Despesas e custos) — o mesmo
 * nível de granularidade mostrado na tela, sem inventar uma quebra por
 * categoria que o usuário não viu no card.
 */
export function toDREData(regime: DreRegimeResult): DREData {
  const receitaLiquida = regime.receitaBruta - regime.impostos;
  return {
    receitaBruta: regime.receitaBruta,
    receitaByCategory: new Map([['Receita bruta', regime.receitaBruta]]),
    totalDeducoes: regime.impostos,
    deducaoByCategory: new Map([['Impostos', regime.impostos]]),
    receitaLiquida,
    totalCPV: 0,
    cpvByCategory: new Map(),
    lucroBruto: receitaLiquida,
    totalOpex: regime.despesas,
    opexByCategory: new Map([['Despesas e custos', regime.despesas]]),
    resultadoOperacional: regime.resultado,
    receitaFinanceira: 0,
    despesaFinanceira: 0,
    resultadoFinanceiro: 0,
    resultadoLiquido: regime.resultado,
    margemBruta: regime.receitaBruta > 0 ? (receitaLiquida / regime.receitaBruta) * 100 : 0,
    margemLiquida: regime.receitaBruta > 0 ? (regime.resultado / regime.receitaBruta) * 100 : 0,
  };
}
