/**
 * lib/services/agenda/reminderWindow.ts
 *
 * Definição ÚNICA de janela e idempotência de lembrete de agendamento,
 * compartilhada entre os dois sistemas que hoje disparam "avisos" a partir de
 * `appointments`:
 *
 *   - `lib/services/appointmentReminderRunner.ts` — notificação in-app pro
 *     PROFISSIONAL (sino, 60/30min antes, cron a cada 5min).
 *   - `app/api/agent/scheduled/run/route.ts` (`processBusiness`) — lembrete/
 *     confirmação/follow-up pro PACIENTE via WhatsApp (cron horário).
 *
 * Antes desta fatia (M06.5), cada um tinha sua própria conta de minutos e sua
 * própria noção de "já avisei". A do profissional já usava uma chave de log
 * por slot (`appointmentId_kind_date_startTime`) — reagendar gera slot novo,
 * então o aviso do horário novo dispara de novo. A do paciente usava um
 * campo boolean direto no Appointment (`reminderSentAt`/
 * `confirmationRequestedAt`/`followUpSentAt`): uma vez true, ficava true pra
 * sempre — se o agendamento fosse reagendado DEPOIS do lembrete já ter
 * disparado pro horário antigo, o paciente NUNCA recebia o lembrete do
 * horário novo (achado real desta fatia, mesma classe de bug silencioso já
 * corrigida outras vezes nesta sessão). Consolidado aqui: os dois passam a
 * usar a MESMA definição de janela (`isWithinReminderWindow`) e a MESMA
 * chave de idempotência por slot (`reminderLogId`), gravada em
 * `appointmentReminderLogs`.
 *
 * Os dois sistemas continuam SEPARADOS (canais, públicos e cadências
 * diferentes — não há ganho em fundi-los num único cron), e cada um mantém
 * seu próprio mecanismo de escrita: o do profissional só grava Firestore, e
 * pode reivindicar o slot dentro da MESMA transação que cria as
 * notificações (`claimReminderSlotInTx`); o do paciente faz uma chamada
 * HTTP externa (envio de WhatsApp) entre checar e confirmar o envio — uma
 * transação não pode envolver I/O externo (o Firestore pode reexecutar o
 * corpo da transação em caso de contenção), então usa o par não-transacional
 * `hasReminderSlotBeenClaimed` / `markReminderSlotClaimed`.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { zonedDateTimeToUtc } from '@/lib/utils/timezone';

/**
 * Minutos entre `now` e o instante (`date`+`time`, horário de parede no fuso
 * do negócio). Positivo = no futuro, negativo = no passado. Usado tanto pra
 * "daqui a quanto tempo começa" (passar `startTime`) quanto "há quanto tempo
 * terminou" (passar `endTime` — o resultado fica bem negativo).
 */
export function minutesUntilSlot(date: string, time: string, timezone: string, now: Date): number {
  const at = zonedDateTimeToUtc(date, time, timezone);
  return (at.getTime() - now.getTime()) / 60_000;
}

/**
 * Janela simétrica em torno de `targetMinutes`: dispara quando `minutesUntil`
 * está a até `toleranceMinutes` de distância do alvo. Pra janelas "depois do
 * fim" (follow-up), passe `targetMinutes` negativo (ex: -1440 = 24h atrás).
 */
export function isWithinReminderWindow(
  minutesUntil: number,
  targetMinutes: number,
  toleranceMinutes: number,
): boolean {
  return Math.abs(minutesUntil - targetMinutes) <= toleranceMinutes;
}

function slotKey(date: string, time: string): string {
  return `${date}_${time}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Chave determinística por (agendamento, tipo de aviso, slot atual). */
export function reminderLogId(appointmentId: string, kind: string, date: string, time: string): string {
  return `${appointmentId}_${kind}_${slotKey(date, time)}`;
}

/**
 * Reivindica o slot DENTRO de uma transação já aberta pelo caller — só grava
 * Firestore (sem I/O externo), então pode compor com outras escritas da
 * mesma transação (ex: as notificações in-app do profissional). Retorna
 * false se este (appointmentId, kind, slot) já foi reivindicado antes —
 * idempotente a reexecuções do cron.
 */
export async function claimReminderSlotInTx(
  tx: Transaction,
  db: Firestore,
  appointmentId: string,
  businessId: string,
  kind: string,
  date: string,
  time: string,
): Promise<boolean> {
  const ref = db.collection('appointmentReminderLogs').doc(reminderLogId(appointmentId, kind, date, time));
  const snap = await tx.get(ref);
  if (snap.exists) return false;
  tx.set(ref, { appointmentId, businessId, kind, date, time, sentAt: new Date().toISOString() });
  return true;
}

/**
 * Par não-transacional pra casos com I/O externo entre checar e confirmar
 * (ex: envio de WhatsApp) — checar antes de enviar, marcar só depois do envio
 * confirmado. Não é atômico contra corrida entre execuções sobrepostas do
 * mesmo cron (mesma característica que o campo boolean anterior já tinha;
 * esta fatia troca a CHAVE por uma sensível a reagendamento, não introduz
 * nem remove proteção de corrida).
 */
export async function hasReminderSlotBeenClaimed(
  db: Firestore,
  appointmentId: string,
  kind: string,
  date: string,
  time: string,
): Promise<boolean> {
  const ref = db.collection('appointmentReminderLogs').doc(reminderLogId(appointmentId, kind, date, time));
  const snap = await ref.get();
  return snap.exists;
}

export async function markReminderSlotClaimed(
  db: Firestore,
  appointmentId: string,
  businessId: string,
  kind: string,
  date: string,
  time: string,
): Promise<void> {
  const ref = db.collection('appointmentReminderLogs').doc(reminderLogId(appointmentId, kind, date, time));
  await ref.set({ appointmentId, businessId, kind, date, time, sentAt: new Date().toISOString() }, { merge: true });
}
