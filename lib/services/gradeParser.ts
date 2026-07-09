/**
 * lib/services/gradeParser.ts
 *
 * Converte a "grade de horários" que o dono escreve em texto livre (ex.: no campo
 * businessDescription do agente) em serviços estruturados com `sessions[]`
 * (WeeklySession) — a fonte da verdade que a Agenda usa em agenda_check_availability.
 *
 * Motivação: hoje o dono digita a grade em texto e o agente a regurgita, mas o
 * agendamento real usa Service.sessions[]. Quando sessions[] está vazio, o
 * check_availability cai no fallback contínuo 08:00–18:30 e diverge do texto.
 * Este parser fecha essa lacuna, transformando o texto em grade estruturada.
 *
 * Parser DETERMINÍSTICO e best-effort: sempre gere um preview para revisão humana
 * antes de aplicar. Formato-alvo (estilo academia):
 *
 *   Jiu Jitsu (Adulto): Seg 11h / 14h / 19h30 · Ter 09h · Qua 06h30 / 15h
 *   Boxe: Seg 18h30 · Ter 19h · Qua 18h30 · Qui 19h
 *
 * Linhas sem nome:hora (continuação) anexam ao modalidade anterior.
 */

import type { WeeklySession } from '@/lib/contracts/domain/service';

export interface ParsedGradeModality {
  /** Nome da modalidade exatamente como aparece no texto (ex.: "Jiu Jitsu (Adulto)"). */
  name: string;
  /** Sessões da grade semanal, ordenadas por (weekday, startTime). */
  sessions: WeeklySession[];
}

const DAY_TOKENS: Array<{ re: RegExp; weekday: number }> = [
  { re: /^dom(?:ingo)?$/, weekday: 0 },
  { re: /^seg(?:unda)?(?:-feira)?$/, weekday: 1 },
  { re: /^ter(?:[çc]a)?(?:-feira)?$/, weekday: 2 },
  { re: /^qua(?:rta)?(?:-feira)?$/, weekday: 3 },
  { re: /^qui(?:nta)?(?:-feira)?$/, weekday: 4 },
  { re: /^sex(?:ta)?(?:-feira)?$/, weekday: 5 },
  { re: /^s[áa]b(?:ado)?$/, weekday: 6 },
];

// Captura tokens de dia (com/sem acento, abreviado ou por extenso), com um "."
// opcional depois da abreviação ("Sab.", "Ter.").
const DAY_SCAN =
  /\b(dom(?:ingo)?|seg(?:unda)?|ter(?:[çc]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[áa]b(?:ado)?)\.?/gi;

// Horários: "11h", "19h30", "06h30", "11:30", "9h". Exige o marcador h/: para não
// capturar números soltos de rótulos ("(Corujão)", "Sparring 2").
const TIME_SCAN = /(\d{1,2})\s*(?:h|:)\s*(\d{2})?/g;

function normalizeToken(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.$/, '')
    .trim();
}

function weekdayOf(token: string): number | null {
  const n = token.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.$/, '');
  for (const d of DAY_TOKENS) {
    // Reconstroi acento nos casos "terca/sabado" via classe [áa]/[çc] no regex.
    if (d.re.test(n) || d.re.test(token.toLowerCase())) return d.weekday;
  }
  return null;
}

function toHHMM(hourStr: string, minStr?: string): string | null {
  const h = parseInt(hourStr, 10);
  const m = minStr ? parseInt(minStr, 10) : 0;
  if (Number.isNaN(h) || h < 0 || h > 23) return null;
  if (m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function extractTimes(segment: string): string[] {
  const out: string[] = [];
  TIME_SCAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIME_SCAN.exec(segment)) !== null) {
    const hhmm = toHHMM(m[1], m[2]);
    if (hhmm) out.push(hhmm);
  }
  return out;
}

/**
 * Extrai as sessões de uma parte "de horários" (tudo após o "Nome:").
 * Varre os tokens de dia; cada dia captura os horários até o próximo token de dia.
 */
function parseScheduleSpec(spec: string): WeeklySession[] {
  const sessions: WeeklySession[] = [];
  const matches: Array<{ weekday: number; start: number; end: number }> = [];

  DAY_SCAN.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = DAY_SCAN.exec(spec)) !== null) {
    const wd = weekdayOf(dm[1]);
    if (wd === null) continue;
    matches.push({ weekday: wd, start: dm.index, end: dm.index + dm[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const seg = spec.slice(matches[i].end, i + 1 < matches.length ? matches[i + 1].start : spec.length);
    for (const startTime of extractTimes(seg)) {
      sessions.push({ weekday: matches[i].weekday, startTime });
    }
  }
  return sessions;
}

function dedupeSortSessions(sessions: WeeklySession[]): WeeklySession[] {
  const seen = new Set<string>();
  const out: WeeklySession[] = [];
  for (const s of sessions) {
    const key = `${s.weekday}_${s.startTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  out.sort((a, b) => (a.weekday - b.weekday) || a.startTime.localeCompare(b.startTime));
  return out;
}

/** Uma linha começa uma modalidade quando tem "Nome:" com pelo menos 1 letra antes do ":". */
function splitNameAndSpec(line: string): { name: string; spec: string } | null {
  const cleaned = line.replace(/^[\s•\-*–—]+/, '').trim();
  const colon = cleaned.indexOf(':');
  if (colon <= 0) return null;
  const name = cleaned.slice(0, colon).trim();
  const spec = cleaned.slice(colon + 1).trim();
  // Evita falsos positivos onde ":" é parte de um horário ("Sábado 11:30").
  if (!/[a-zà-ú]/i.test(name)) return null;
  // O nome não pode conter dígitos de horário (senão é uma linha de continuação).
  if (weekdayOf(normalizeToken(name.split(/\s+/)[0])) !== null) return null;
  return { name, spec };
}

/**
 * Parseia um bloco de texto de grade em modalidades estruturadas.
 * Linhas de continuação (sem "Nome:") anexam suas sessões à modalidade anterior.
 */
export function parseGradeText(text: string): ParsedGradeModality[] {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const order: string[] = [];
  const byName = new Map<string, WeeklySession[]>();
  let current: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const parsed = splitNameAndSpec(line);
    if (parsed) {
      current = parsed.name;
      if (!byName.has(current)) {
        byName.set(current, []);
        order.push(current);
      }
      byName.get(current)!.push(...parseScheduleSpec(parsed.spec));
    } else if (current) {
      // Continuação: só anexa se a linha contém dia+horário.
      const cont = parseScheduleSpec(line);
      if (cont.length > 0) byName.get(current)!.push(...cont);
    }
  }

  return order
    .map((name) => ({ name, sessions: dedupeSortSessions(byName.get(name) || []) }))
    .filter((m) => m.sessions.length > 0);
}
