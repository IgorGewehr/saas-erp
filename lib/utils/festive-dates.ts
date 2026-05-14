/**
 * Cálculo de datas festivas brasileiras — fixas e móveis.
 *
 * Usado pelo cron de campanhas recorrentes (recurrenceType='fixed_date')
 * pra resolver presets como "Dia das Mães" no calendário do ano atual,
 * em vez de exigir que o operador atualize MM-DD manualmente todo ano.
 *
 * Funções puras, zero dependências, ano-agnósticas.
 *
 * Referências de cálculo:
 *  - Easter (Páscoa): Anonymous Gregorian Algorithm (Meeus/Jones/Butcher) —
 *    válido pra anos 1583+. Domingo, sempre entre 22/03 e 25/04.
 *  - Carnaval: terça-feira gorda = Páscoa - 47 dias.
 *  - Sexta-feira Santa: Páscoa - 2 dias.
 *  - Corpus Christi: Páscoa + 60 dias (sempre quinta-feira).
 *  - Dia das Mães: 2° domingo de maio (BR).
 *  - Dia dos Pais: 2° domingo de agosto (BR).
 *  - Black Friday: 4ª sexta-feira de novembro (segue padrão US — sex
 *    depois da quinta de Thanksgiving, que cai na 4ª quinta de novembro).
 */

export type FestivePresetKey =
  | 'easter'
  | 'good_friday'
  | 'carnaval'
  | 'corpus_christi'
  | 'mothers_day'
  | 'fathers_day'
  | 'black_friday';

export interface FestivePresetInfo {
  key: FestivePresetKey;
  /** Label legível pro operador (exibido no combobox e no card). */
  label: string;
  /** Pequena descrição extra (ex: regra de cálculo) — útil em tooltip. */
  description?: string;
}

export const MOVABLE_PRESETS: FestivePresetInfo[] = [
  { key: 'easter',         label: 'Páscoa',              description: 'Domingo de Páscoa (Meeus). Varia entre 22/03 e 25/04.' },
  { key: 'good_friday',    label: 'Sexta-feira Santa',   description: 'Páscoa - 2 dias.' },
  { key: 'carnaval',       label: 'Carnaval (terça)',    description: 'Terça-feira de Carnaval. Páscoa - 47 dias.' },
  { key: 'corpus_christi', label: 'Corpus Christi',      description: 'Quinta-feira. Páscoa + 60 dias.' },
  { key: 'mothers_day',    label: 'Dia das Mães',        description: '2° domingo de maio.' },
  { key: 'fathers_day',    label: 'Dia dos Pais',        description: '2° domingo de agosto.' },
  { key: 'black_friday',   label: 'Black Friday',        description: '4ª sexta-feira de novembro.' },
];

/**
 * Domingo de Páscoa pelo algoritmo Gregoriano anônimo (Meeus/Jones/Butcher).
 * Retorna { month: 1-12, day: 1-31 } pro ano dado.
 */
function easterMonthDay(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Retorna a data N° (nth, 1-5) ocorrência de um weekday em um mês.
 *  weekday: 0=domingo, 6=sábado (compatível com Date.getDay).
 *  Se a N° ocorrência não existir no mês (ex: 5° domingo em fev), retorna null. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): { month: number; day: number } | null {
  // Date(year, month-1, 1).getDay() = dia da semana do dia 1
  const firstDow = new Date(year, month - 1, 1).getDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  // Verifica se ainda está dentro do mês (Date overflow ajustaria mês — não queremos)
  const candidate = new Date(year, month - 1, day);
  if (candidate.getMonth() !== month - 1) return null;
  return { month, day };
}

/** Soma `days` ao { month, day } no ano dado e retorna o novo { month, day }.
 *  Usa Date pra absorver overflow (ex: 28/02 + 1 dia = 01/03; com leap-year correto). */
function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * Resolve a data (MM-DD) de um preset móvel pro ano fornecido.
 *
 * @param preset chave do preset (ver MOVABLE_PRESETS)
 * @param year ano de referência
 * @returns string MM-DD (zero-padded) ou null se preset desconhecido
 *
 * Edge case: Páscoa em 2038 cai em 25/04 — fora do mês de maio. Dia das Mães
 * em 2024 cai em 12/05 (2° domingo). Cálculos são determinísticos e estáveis.
 */
export function resolvePresetMmDd(preset: FestivePresetKey, year: number): string | null {
  const easter = easterMonthDay(year);

  let resolved: { month: number; day: number } | null = null;

  switch (preset) {
    case 'easter':
      resolved = easter;
      break;
    case 'good_friday': {
      const r = addDays(year, easter.month, easter.day, -2);
      resolved = { month: r.month, day: r.day };
      break;
    }
    case 'carnaval': {
      const r = addDays(year, easter.month, easter.day, -47);
      resolved = { month: r.month, day: r.day };
      break;
    }
    case 'corpus_christi': {
      const r = addDays(year, easter.month, easter.day, 60);
      resolved = { month: r.month, day: r.day };
      break;
    }
    case 'mothers_day':
      resolved = nthWeekdayOfMonth(year, 5, 0 /* domingo */, 2);
      break;
    case 'fathers_day':
      resolved = nthWeekdayOfMonth(year, 8, 0 /* domingo */, 2);
      break;
    case 'black_friday':
      resolved = nthWeekdayOfMonth(year, 11, 5 /* sexta */, 4);
      break;
    default:
      return null;
  }

  if (!resolved) return null;
  return `${String(resolved.month).padStart(2, '0')}-${String(resolved.day).padStart(2, '0')}`;
}

/** Helper: dado um preset móvel e a data atual, retorna a próxima ocorrência
 *  como Date. Se a data deste ano já passou, retorna a do próximo ano.
 *  Útil pra mostrar "Próxima ocorrência: DD/MM/YYYY" na UI. */
export function nextOccurrenceOfPreset(preset: FestivePresetKey, now: Date): Date | null {
  const currentYear = now.getFullYear();
  const mmDd = resolvePresetMmDd(preset, currentYear);
  if (!mmDd) return null;
  const [m, d] = mmDd.split('-').map(Number);
  const thisYearDate = new Date(currentYear, m - 1, d);
  if (thisYearDate >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    return thisYearDate;
  }
  const nextMmDd = resolvePresetMmDd(preset, currentYear + 1);
  if (!nextMmDd) return null;
  const [nm, nd] = nextMmDd.split('-').map(Number);
  return new Date(currentYear + 1, nm - 1, nd);
}
