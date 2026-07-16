/**
 * date-utils.ts — helpers de data compartilhados pelos dois eixos do read-model
 * de Assinaturas (membership/project). Puro, sem dependência de domínio.
 */

export function parseYmd(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const raw = dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function parsePeriod(period: string): { year: number; month: number } {
  const [y, m] = period.split('-').map(Number);
  return { year: y, month: m };
}

export function endOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0, 23, 59, 59, 999);
}

export function startOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function monthsBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
}

export function todayYmd(now: Date): string {
  return now.toISOString().slice(0, 10);
}
