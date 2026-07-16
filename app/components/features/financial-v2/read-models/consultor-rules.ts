/**
 * consultor-rules.ts — o motor de regras do Super Consultor. FUNÇÃO PURA, zero
 * JSX, zero rede: recebe os arrays já carregados (client cache do TanStack
 * Query) e escolhe **1** fato prioritário determinístico, com sua frase
 * template pronta pra render imediato (progressive enhancement — a IA troca
 * a frase depois, nunca decide o quê dizer nem pra onde navegar).
 *
 * Catálogo inicial (Fase 0 = 1 regra "de verdade" por aba pra provar o
 * mecanismo ponta-a-ponta; o catálogo completo do plano — categoria-subiu,
 * fixo-degrau, churn-concentrado etc. — entra junto de cada aba nas Fases 1-5,
 * reusando exatamente este mesmo formato de regra).
 */

import type { Transaction, BankAccount } from '@/lib/types';
import type { FinancialConsultorTab } from '@/lib/contracts/api/financial/consultor';
import { formatCurrency } from '@/lib/utils/format';
import type { CompromissosFixosOverview } from './compromissos-fixos';
import type { AssinaturasOverview } from './assinaturas-overview';
import type { ProjecaoCaixaOverview } from './projecao-caixa';
import type { ResumoPorCategoriaOverview } from './resumo-por-categoria';
import type { ConciliacaoBaldesOverview } from './conciliacao-3-baldes';
import type { FluxoCaixaOverview } from './fluxo-caixa-especie';
import { effectiveDueDate, isOpenCommitment } from './recurrence-projection';
import { startOfDay, toDateStr, daysBetween, shortDayLabel } from './date-utils';

export interface ConsultorCta {
  label: string;
  targetTab: FinancialConsultorTab;
}

export interface ConsultorInsight {
  tab: FinancialConsultorTab;
  ruleId: string;
  /** Chaves curtas ≤12, sem PII — validado de novo no boundary da API (R6). */
  facts: Record<string, string | number>;
  /** Frase determinística — é o que a UI mostra até (e se) a IA responder. */
  templateFallback: string;
  /** CTA nunca vem do LLM — sempre decidido aqui. */
  cta?: ConsultorCta;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(dateStr: string, now: Date): number {
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  return Math.round((d.getTime() - now.getTime()) / DAY_MS);
}

export interface VisaoGeralInsightParams {
  transactions: Transaction[];
  projecao: ProjecaoCaixaOverview;
  now?: Date;
}

const PAGAR_ANTES_DE_RECEBER_HORIZON_DAYS = 10;
const RECEBIVEL_PARADO_DAYS = 30;

/**
 * Visão Geral › catálogo do plano §5, em ordem de severidade:
 * 1. 'caixa-cruza-zero' — o caixa projetado (bloco ②) fica negativo: a maior
 *    urgência possível, o dinheiro literalmente acaba.
 * 2. 'pagar-antes-de-receber' — a maior despesa que vence logo chega antes de
 *    receitas atrasadas serem cobradas (o padrão do mockup: aluguel × atrasados).
 * 3. 'recebivel-parado' — receita atrasada há 30+ dias, dinheiro parado.
 * 4/5. fallback: vencimentos atrasados/próximos de 7 dias, senão frase neutra.
 * Empate/nada disparou → frase neutra (nenhuma regra "de mentirinha").
 */
export function pickVisaoGeralInsight({ transactions, projecao, now = new Date() }: VisaoGeralInsightParams): ConsultorInsight {
  if (projecao.crossZeroIndex !== null && projecao.crossZeroDate && projecao.crossZeroBalance !== null) {
    const diasAte = Math.max(0, projecao.crossZeroIndex - projecao.todayIndex);
    const dataFmt = shortDayLabel(projecao.crossZeroDate);
    const saldoFmt = formatCurrency(projecao.crossZeroBalance);
    return {
      tab: 'visao-geral',
      ruleId: 'caixa-cruza-zero',
      facts: { dia: dataFmt, saldo: saldoFmt, prazo: `${diasAte}d` },
      templateFallback: diasAte === 0
        ? `Seu caixa já projeta ficar negativo hoje, em ${saldoFmt}. Adie uma despesa ou acelere um recebimento agora.`
        : `Seu caixa fica negativo em ${diasAte} dia${diasAte > 1 ? 's' : ''} (${dataFmt}), chegando a ${saldoFmt} projetado. Ajuste o que puder antes disso.`,
      cta: { label: 'Ver o que vence em Entradas & Saídas', targetTab: 'entradas-saidas' },
    };
  }

  const todayStr = toDateStr(startOfDay(now));

  // Atrasada de verdade: status explícito 'atrasado' OU pendente com dueDate no
  // passado — nenhum cron do saas-erp reescreve status pra 'atrasado' hoje (é
  // valor manual), então confiar só no status literal deixaria esta regra
  // praticamente nunca disparar em dado real.
  const isOverdueReceivable = (t: Transaction) =>
    t.type === 'receita' && (t.status === 'atrasado' || (t.status === 'pendente' && !!t.dueDate && t.dueDate < todayStr));

  const atrasadosReceita = transactions.filter(isOverdueReceivable);
  const atrasadosTotal = atrasadosReceita.reduce((s, t) => s + t.amount, 0);

  const proximaDespesaGrande = transactions
    .filter(t => t.type === 'despesa' && isOpenCommitment(t))
    .map(t => ({ t, due: effectiveDueDate(t) }))
    .filter((x): x is { t: Transaction; due: string } => !!x.due)
    .filter(({ due }) => {
      const dias = daysBetween(todayStr, due);
      return dias >= 0 && dias <= PAGAR_ANTES_DE_RECEBER_HORIZON_DAYS;
    })
    .sort((a, b) => b.t.amount - a.t.amount)[0]?.t;

  if (proximaDespesaGrande && atrasadosTotal > 0) {
    const despesaLabel = proximaDespesaGrande.recurrence?.label || proximaDespesaGrande.description;
    const despesaFmt = formatCurrency(proximaDespesaGrande.amount);
    const atrasadoFmt = formatCurrency(atrasadosTotal);
    return {
      tab: 'visao-geral',
      ruleId: 'pagar-antes-de-receber',
      facts: { despesa: despesaLabel, valor: despesaFmt, atrasado: atrasadoFmt, clientes: atrasadosReceita.length },
      templateFallback: `${despesaLabel} (${despesaFmt}) vence antes de você receber ${atrasadoFmt} atrasados de ${atrasadosReceita.length} cliente${atrasadosReceita.length > 1 ? 's' : ''}. Cobre hoje.`,
      cta: { label: 'Cobrar em Entradas & Saídas', targetTab: 'entradas-saidas' },
    };
  }

  const recebivelParado = atrasadosReceita.filter(t => t.dueDate && daysBetween(t.dueDate, todayStr) >= RECEBIVEL_PARADO_DAYS);
  if (recebivelParado.length > 0) {
    const total = recebivelParado.reduce((s, t) => s + t.amount, 0);
    const totalFmt = formatCurrency(total);
    return {
      tab: 'visao-geral',
      ruleId: 'recebivel-parado',
      facts: { total: totalFmt, count: recebivelParado.length },
      templateFallback: `${totalFmt} de ${recebivelParado.length} cliente${recebivelParado.length > 1 ? 's' : ''} estão atrasados há mais de 30 dias. Esse dinheiro trava seu caixa — cobre antes de dar prazo novo pra outros.`,
      cta: { label: 'Ver atrasados em Entradas & Saídas', targetTab: 'entradas-saidas' },
    };
  }

  const proximos = transactions.filter(t => {
    if (t.status !== 'pendente' && t.status !== 'atrasado') return false;
    if (!t.dueDate) return false;
    return daysUntil(t.dueDate, now) <= 7;
  });

  const atrasados = proximos.filter(t => t.status === 'atrasado');
  if (atrasados.length > 0) {
    const total = atrasados.reduce((sum, t) => sum + t.amount, 0);
    const totalFmt = formatCurrency(total);
    return {
      tab: 'visao-geral',
      ruleId: 'vencimentos-atrasados',
      facts: { total: totalFmt, count: atrasados.length },
      templateFallback: `Você tem ${totalFmt} em ${atrasados.length} lançamento${atrasados.length > 1 ? 's' : ''} já atrasado${atrasados.length > 1 ? 's' : ''}. Regularize antes que vire bola de neve.`,
      cta: { label: 'Ver atrasados em Entradas & Saídas', targetTab: 'entradas-saidas' },
    };
  }

  if (proximos.length > 0) {
    const total = proximos.reduce((sum, t) => sum + t.amount, 0);
    const totalFmt = formatCurrency(total);
    return {
      tab: 'visao-geral',
      ruleId: 'vencimentos-proximos',
      facts: { total: totalFmt, count: proximos.length },
      templateFallback: `Você tem ${totalFmt} a vencer nos próximos 7 dias, em ${proximos.length} lançamento${proximos.length > 1 ? 's' : ''}. Não deixe acumular.`,
      cta: { label: 'Ver vencimentos em Entradas & Saídas', targetTab: 'entradas-saidas' },
    };
  }

  return {
    tab: 'visao-geral',
    ruleId: 'sem-alerta',
    facts: { dias: 7 },
    templateFallback: 'Nenhum vencimento nos próximos 7 dias. Seu financeiro está em dia por enquanto — continue de olho.',
  };
}

const CONCILIACAO_PENDENTE_THRESHOLD = 3;

/**
 * Bancário › catálogo do plano §5, em ordem de severidade:
 * 1. 'conciliacao-pendente' — 3+ itens sem bater entre banco e sistema (o
 *    maior risco de dado sujo: saldo "informado" perde confiabilidade).
 * 2. 'saldo-total' — soma do `balance` das contas não-caixa (o número já é
 *    incrementado atomicamente a cada baixa desde a Fase 3 — deixou de ser
 *    "nunca atualizado", gap g2 do plano mitigado em parte).
 */
export function pickBancarioInsight(bankAccounts: BankAccount[], baldes: ConciliacaoBaldesOverview): ConsultorInsight {
  const contas = bankAccounts.filter(a => a.isActive && a.accountType !== 'caixa');
  const total = contas.reduce((sum, a) => sum + a.balance, 0);
  const totalFmt = formatCurrency(total);

  if (contas.length === 0) {
    return {
      tab: 'bancario',
      ruleId: 'sem-contas',
      facts: { count: 0 },
      templateFallback: 'Nenhuma conta bancária cadastrada ainda. Cadastre suas contas pra acompanhar o saldo real aqui.',
    };
  }

  if (baldes.itensPendentes >= CONCILIACAO_PENDENTE_THRESHOLD) {
    const valorFmt = formatCurrency(baldes.valorEmDuvida);
    return {
      tab: 'bancario',
      ruleId: 'conciliacao-pendente',
      facts: { itens: baldes.itensPendentes, valor: valorFmt },
      templateFallback: `${baldes.itensPendentes} itens ainda não batem entre o banco e o sistema, somando ${valorFmt} em dúvida. Concilie antes que vire bagunça.`,
      cta: { label: 'Ver conciliação em Bancário', targetTab: 'bancario' },
    };
  }

  return {
    tab: 'bancario',
    ruleId: 'saldo-total',
    facts: { total: totalFmt, count: contas.length },
    templateFallback: `Saldo de ${totalFmt} em ${contas.length} conta${contas.length > 1 ? 's' : ''}, conciliação em dia. Continue de olho.`,
  };
}

const CAIXA_ESQUECIDO_HORAS = 20;
const CAIXA_FALTA_THRESHOLD = 20; // R$ — abaixo disso é "arredondamento de troco", não alerta

/**
 * Fluxo de Caixa › catálogo (dinheiro em espécie), em ordem de severidade:
 * 1. 'caixa-esquecido' — sessão aberta há mais de `CAIXA_ESQUECIDO_HORAS`
 *    (provável esquecimento de fechar no fim do expediente anterior).
 * 2. 'falta-no-fechamento' — o último fechamento teve falta relevante
 *    (diferença negativa acima de `CAIXA_FALTA_THRESHOLD`) — dinheiro sumiu
 *    de verdade, vale investigar antes que vire hábito.
 * 3. neutra — saldo em espécie + status do último fechamento (sobra/bateu).
 */
export function pickFluxoCaixaInsight(overview: FluxoCaixaOverview, now: Date = new Date()): ConsultorInsight {
  const esquecida = overview.openSessions.find(s => {
    const opened = new Date(s.openedAt.length <= 10 ? `${s.openedAt}T00:00:00` : s.openedAt);
    return (now.getTime() - opened.getTime()) / (60 * 60 * 1000) > CAIXA_ESQUECIDO_HORAS;
  });
  if (esquecida) {
    const horas = Math.floor((now.getTime() - new Date(esquecida.openedAt.length <= 10 ? `${esquecida.openedAt}T00:00:00` : esquecida.openedAt).getTime()) / (60 * 60 * 1000));
    return {
      tab: 'fluxo-caixa',
      ruleId: 'caixa-esquecido',
      facts: { conta: esquecida.accountLabel, horas: `${horas}h` },
      templateFallback: `O caixa "${esquecida.accountLabel}" está aberto há ${horas}h — parece que esqueceram de fechar. Confira e feche antes de abrir um turno novo.`,
      cta: { label: 'Fechar caixa em Fluxo de Caixa', targetTab: 'fluxo-caixa' },
    };
  }

  const last = overview.lastClosed;
  if (last && last.difference !== undefined && last.difference < -CAIXA_FALTA_THRESHOLD) {
    const faltaFmt = formatCurrency(Math.abs(last.difference));
    return {
      tab: 'fluxo-caixa',
      ruleId: 'falta-no-fechamento',
      facts: { conta: last.accountLabel, falta: faltaFmt },
      templateFallback: `O último fechamento de "${last.accountLabel}" teve falta de ${faltaFmt}. Confira sangrias e trocos antes que vire rotina.`,
      cta: { label: 'Ver fechamentos em Fluxo de Caixa', targetTab: 'fluxo-caixa' },
    };
  }

  const saldoFmt = formatCurrency(overview.saldoTotal);
  if (last) {
    const diffFmt = last.difference !== undefined ? formatCurrency(Math.abs(last.difference)) : null;
    const situacao = last.difference === undefined || Math.abs(last.difference) <= 0.01
      ? 'bateu certinho'
      : last.difference > 0
        ? `teve sobra de ${diffFmt}`
        : `teve falta pequena de ${diffFmt}`;
    return {
      tab: 'fluxo-caixa',
      ruleId: 'caixa-saudavel',
      facts: { saldo: saldoFmt, situacao },
      templateFallback: `${saldoFmt} em espécie agora. O último fechamento ${situacao} — sem alerta.`,
    };
  }

  return {
    tab: 'fluxo-caixa',
    ruleId: 'sem-fechamento',
    facts: { saldo: saldoFmt },
    templateFallback: `${saldoFmt} em espécie agora. Nenhum fechamento de caixa registrado ainda.`,
  };
}

const CATEGORIA_SUBIU_THRESHOLD_PCT = 25;

/**
 * Entradas & Saídas › regra 'categoria-subiu' (plano §5: ">25% vs média" — o
 * limiar do consultor é mais conservador que o badge visual do drill em
 * `resumo-por-categoria.ts`, que já marca anomalia a partir de 15%; a IA só
 * fala quando o desvio é grande o bastante pra valer uma frase). Sem categoria
 * disparando, frase neutra com o total de despesas do mês.
 */
export function pickEntradasSaidasInsight(overview: ResumoPorCategoriaOverview): ConsultorInsight {
  const top = overview.topVariacao;
  if (top && top.variacaoPct > CATEGORIA_SUBIU_THRESHOLD_PCT) {
    const pctFmt = top.variacaoPct.toFixed(0);
    return {
      tab: 'entradas-saidas',
      ruleId: 'categoria-subiu',
      facts: { categoria: top.label, pct: `${pctFmt}%`, valor: formatCurrency(top.total), media: formatCurrency(top.avg5mBefore) },
      templateFallback: `Gasto com ${top.label} subiu ${pctFmt}% vs sua média de ${formatCurrency(top.avg5mBefore)} — este mês soma ${formatCurrency(top.total)}.`,
      cta: { label: `Ver ${top.label} em Entradas & Saídas`, targetTab: 'entradas-saidas' },
    };
  }

  return {
    tab: 'entradas-saidas',
    ruleId: 'categorias-estaveis',
    facts: { total: formatCurrency(overview.totalDespesas), categorias: overview.rows.length },
    templateFallback: overview.rows.length > 0
      ? `${formatCurrency(overview.totalDespesas)} em despesas este mês, em ${overview.rows.length} categoria${overview.rows.length > 1 ? 's' : ''}, sem nenhuma subindo fora do padrão.`
      : 'Nenhuma despesa lançada neste mês ainda.',
  };
}

const PESO_FIXO_ALTO_THRESHOLD_PCT = 60;

/**
 * Recorrentes › lente Contas fixas: regra 'fixo-degrau' (ocorrência >15% acima
 * da média 12m — maior severidade, é dinheiro saindo sem explicação) senão
 * 'peso-fixo-alto' (fixas comem >60% da receita média) senão neutra.
 */
export function pickContasFixasInsight(overview: CompromissosFixosOverview): ConsultorInsight {
  if (overview.degrauRows.length > 0) {
    const row = overview.degrauRows.reduce((max, r) => (r.degrauPct > max.degrauPct ? r : max), overview.degrauRows[0]);
    const pctFmt = row.degrauPct.toFixed(0);
    return {
      tab: 'recorrentes',
      ruleId: 'fixo-degrau',
      facts: { conta: row.label, pct: `${pctFmt}%`, valor: formatCurrency(row.lastPaidAmount ?? 0), media: formatCurrency(row.avg12m) },
      templateFallback: `"${row.label}" veio ${pctFmt}% acima da média dos últimos 12 meses (${formatCurrency(row.lastPaidAmount ?? 0)} vs média ${formatCurrency(row.avg12m)}). Confira se não é reajuste ou erro de leitura.`,
      cta: { label: 'Ver contas fixas em Recorrentes', targetTab: 'recorrentes' },
    };
  }

  if (overview.pesoSobreReceitaPct !== null && overview.pesoSobreReceitaPct > PESO_FIXO_ALTO_THRESHOLD_PCT) {
    const pctFmt = overview.pesoSobreReceitaPct.toFixed(0);
    return {
      tab: 'recorrentes',
      ruleId: 'peso-fixo-alto',
      facts: { pct: `${pctFmt}%`, custo: formatCurrency(overview.custoDeExistir) },
      templateFallback: `Suas contas fixas comem ${pctFmt}% da sua receita média — ${formatCurrency(overview.custoDeExistir)} por mês só pra existir. Reveja contratos antes de assumir custo fixo novo.`,
      cta: { label: 'Ver contas fixas em Recorrentes', targetTab: 'recorrentes' },
    };
  }

  return {
    tab: 'recorrentes',
    ruleId: 'fixas-estaveis',
    facts: { custo: formatCurrency(overview.custoDeExistir), count: overview.count },
    templateFallback: overview.count > 0
      ? `Suas ${overview.count} contas fixas somam ${formatCurrency(overview.custoDeExistir)}/mês, sem degrau nem peso excessivo sobre a receita. Sob controle.`
      : 'Nenhuma conta fixa recorrente cadastrada ainda.',
  };
}

const CHURN_CONCENTRADO_MIN_COUNT = 2;
const CONCENTRACAO_ALTA_THRESHOLD_PCT = 40;

/**
 * Recorrentes › lente Assinaturas: regra 'churn-concentrado' (2+ cancelamentos
 * no mesmo plano/projeto no mês — maior severidade) senão 'concentracao-mrr'
 * (um serviço/plano responde por >40% do MRR — risco de dependência) senão
 * neutra.
 */
export function pickAssinaturasInsight(overview: AssinaturasOverview): ConsultorInsight {
  const churnConcentrado = overview.groups.find(g => g.churnedThisMonthCount >= CHURN_CONCENTRADO_MIN_COUNT);
  if (churnConcentrado) {
    return {
      tab: 'assinaturas',
      ruleId: 'churn-concentrado',
      facts: { servico: churnConcentrado.name, cancelamentos: churnConcentrado.churnedThisMonthCount, valor: formatCurrency(overview.churnMonthValue) },
      templateFallback: `${churnConcentrado.churnedThisMonthCount} cancelamentos este mês vieram do mesmo serviço: ${churnConcentrado.name}. Investigue o que mudou aí antes que vire tendência.`,
      cta: { label: 'Ver detalhe do serviço em Recorrentes', targetTab: 'assinaturas' },
    };
  }

  const top = overview.groups[0];
  if (top && top.pctOfMrr > CONCENTRACAO_ALTA_THRESHOLD_PCT) {
    const pctFmt = top.pctOfMrr.toFixed(0);
    return {
      tab: 'assinaturas',
      ruleId: 'concentracao-mrr',
      facts: { servico: top.name, pct: `${pctFmt}%`, mrr: formatCurrency(overview.mrr) },
      templateFallback: `Sua receita recorrente está concentrada demais — ${top.name} é ${pctFmt}% do MRR. Se ele sair, você perde quase isso de uma vez. Blinde esse contrato antes de pensar em crescer.`,
      cta: { label: 'Ver MRR por serviço em Recorrentes', targetTab: 'assinaturas' },
    };
  }

  return {
    tab: 'assinaturas',
    ruleId: 'assinaturas-saudaveis',
    facts: { mrr: formatCurrency(overview.mrr), ativas: overview.activeCount },
    templateFallback: overview.activeCount > 0
      ? `MRR de ${formatCurrency(overview.mrr)} em ${overview.activeCount} assinatura${overview.activeCount > 1 ? 's' : ''} ativa${overview.activeCount > 1 ? 's' : ''}, sem concentração nem churn preocupante este mês.`
      : 'Nenhuma assinatura ativa ainda.',
  };
}

/** Hash curto e determinístico dos facts — só pra invalidar a queryKey do
 *  client quando os números mudam (não precisa ser criptográfico; o servidor
 *  recalcula seu próprio hash sha256 pra chave de cache/idempotência). */
export function hashFacts(facts: Record<string, string | number>): string {
  const json = JSON.stringify(facts, Object.keys(facts).sort());
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 31 + json.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}
