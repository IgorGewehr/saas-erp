/**
 * Datas "só dia" (AAAA-MM-DD) no fuso LOCAL do dispositivo.
 *
 * `new Date().toISOString()` é UTC: no Brasil, depois das 21h já é "amanhã". Recebimento
 * registrado à noite no tablet precisa levar a data que o vendedor vê no relógio.
 */

export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** "2026-09-18" → "18/09/2026" sem passar por `Date` (que leria como UTC e mostraria o dia anterior). */
export function formatDateOnly(value: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}
