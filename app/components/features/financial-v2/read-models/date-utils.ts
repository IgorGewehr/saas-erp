/**
 * date-utils.ts — helpers de data LOCAIS (YYYY-MM-DD) compartilhados pelos
 * read-models do santo-graal (disponivel-retirada, projecao-caixa,
 * resultado-do-mes, vencimentos-proximos, consultor-rules). Sempre usa
 * componentes locais de Date (nunca `toISOString`, que é UTC e desloca o dia
 * perto da meia-noite em fusos como o do Brasil) — evita o "dia errado" perto
 * da virada.
 */

export function parseYmdLocal(dateStr: string): Date {
  const raw = dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`;
  return new Date(raw);
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Meia-noite local de hoje (ou da data passada) — base pra qualquer horizonte. */
export function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Dias inteiros de `fromStr` até `toStr` (positivo se `toStr` é depois). */
export function daysBetween(fromStr: string, toStr: string): number {
  const a = parseYmdLocal(fromStr).getTime();
  const b = parseYmdLocal(toStr).getTime();
  return Math.round((b - a) / 86_400_000);
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });

/** "18/07" — dd/mm compacto, usado nos rótulos de eixo da linha do tempo. */
export function shortDayLabel(dateStr: string): string {
  const d = parseYmdLocal(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "sáb 18/07" — dia da semana curto + dd/mm, sem a pontuação do Intl (ex: "sáb."). */
export function weekdayDayLabel(dateStr: string): string {
  const d = parseYmdLocal(dateStr);
  const weekday = WEEKDAY_FORMATTER.format(d).replace(/\.$/, '');
  return `${weekday} ${shortDayLabel(dateStr)}`;
}

/** 'YYYY-MM' de uma data qualquer — a chave de período usada em toda parte do
 *  financial-v2 (PeriodContext, resultado-do-mes, resumo-por-categoria). Retorna
 *  null pra string inválida/vazia em vez de lançar (dueDate é opcional em Transaction). */
export function monthKeyOf(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const d = parseYmdLocal(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Desloca 'YYYY-MM' por N meses (negativo = passado). */
export function shiftMonthKey(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const SHORT_MONTH_FORMATTER = new Intl.DateTimeFormat('pt-BR', { month: 'short' });

/** "jul" — rótulo curto de mês pt-BR a partir de 'YYYY-MM', pra eixo dos gráficos de coluna. */
export function shortMonthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const label = SHORT_MONTH_FORMATTER.format(new Date(y, m - 1, 1)).replace(/\.$/, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
