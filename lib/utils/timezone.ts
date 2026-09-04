/**
 * lib/utils/timezone.ts
 *
 * Conversão de "data+hora local de um negócio" pra instante UTC correto —
 * M06.5 ("fuso horário por negócio, substituindo o -03:00 fixo").
 *
 * Antes desta fatia, NENHUM utilitário do repo fazia essa conversão nessa
 * direção (wall-clock + fuso → UTC). O que existia (`todayInTz`/`currentHourInTz`
 * em birthdayCampaignRunner.ts/membershipBillingRunner.ts, `todayBR` em
 * appointmentReminderRunner.ts) resolve só a direção oposta (instante →
 * wall-clock), cada um duplicado à mão. Não foram tocados/unificados aqui —
 * fora do escopo desta fatia (que é sobre lembretes de agendamento
 * especificamente); esta função nasce nova, focada no que faltava.
 *
 * Usa `date-fns-tz` (já compatível com o `date-fns` v4 já instalado) em vez
 * de um offset fixo tipo `-03:00`: resolve o fuso pelo banco IANA de
 * verdade, então funciona corretamente pra qualquer negócio, não só Brasil
 * (e continuaria correto mesmo se um país reintroduzisse horário de verão).
 */

import { fromZonedTime } from 'date-fns-tz';

export const DEFAULT_BUSINESS_TIMEZONE = 'America/Sao_Paulo';

/**
 * Converte `date` ('YYYY-MM-DD') + `time` ('HH:mm') — horário de PAREDE no
 * fuso do negócio — pro instante UTC correspondente. Fuso inválido (string
 * que não é um IANA timezone reconhecido) lança — não mascara silenciosamente
 * um dado ruim; o CALLER decide como reagir (ex: fallback pro padrão,
 * pular só aquele item do lote).
 *
 * Checagem explícita do resultado (não só try/catch): `date-fns-tz` lança em
 * Node.js real pra um fuso inválido, mas em ambientes com `Intl` mais
 * permissivo (confirmado: jsdom, usado nos testes) devolve um `Invalid Date`
 * silencioso em vez de lançar — normalizamos os dois casos pro mesmo
 * comportamento (sempre lança), pra não depender de uma particularidade de
 * ambiente.
 */
export function zonedDateTimeToUtc(date: string, time: string, timezone: string): Date {
  let result: Date;
  try {
    result = fromZonedTime(`${date}T${time}:00`, timezone);
  } catch {
    throw new Error(`zonedDateTimeToUtc: timezone inválido "${timezone}"`);
  }
  if (Number.isNaN(result.getTime())) {
    throw new Error(`zonedDateTimeToUtc: timezone inválido "${timezone}"`);
  }
  return result;
}
