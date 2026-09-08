/**
 * Appointment Reminder Runner — dispara notificações in-app pros profissionais
 * de agendamentos que estão pra começar.
 *
 * Chamado por cron a cada 5min (ver /api/appointments/run-reminders). Cada
 * execução varre appointments dos próximos ~70min, identifica os que entram
 * nas janelas de 60min e 30min antes, e cria 1 notificação por profissional
 * no sino (TopBar).
 *
 * Idempotência: log composto em `appointmentReminderLogs/{appointmentId}_{kind}_{slot}`
 * (definição compartilhada com o lembrete de paciente via WhatsApp — ver
 * `lib/services/agenda/reminderWindow.ts`). Cron rodando múltiplas vezes no
 * mesmo intervalo NÃO duplica notificações; reagendar o appointment libera
 * um lembrete novo pro slot novo.
 *
 * Timezone (M06.5): fuso por negócio via `business.settings.timezone`
 * (default `America/Sao_Paulo` quando ausente — mesmo comportamento de
 * antes pra quem não configurou nada). A query é cross-tenant (1 scan pro
 * SaaS inteiro, ver comentário abaixo), então os negócios distintos do lote
 * são resolvidos em lote (`fetchTimezonesByBusiness`) em vez de 1 leitura
 * por agendamento.
 *
 * Multi-prof: cada UID em `professionalIds` recebe sua própria notificação.
 * Se nenhum prof atribuído, skip (appointment "da casa" sem responsável).
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Appointment } from '@/lib/types';
import { getAppointmentProfessionalIds } from '@/lib/utils/appointment';
import { DEFAULT_BUSINESS_TIMEZONE } from '@/lib/utils/timezone';
import { minutesUntilSlot, isWithinReminderWindow, claimReminderSlotInTx } from '@/lib/services/agenda/reminderWindow';

// Janelas de lembrete: ANTES de cada slot, em minutos. Cron roda a cada 5min,
// então cada appt vai cair numa janela ±5min em torno do alvo.
const REMINDER_WINDOWS: number[] = [60, 30];

// Margem de tolerância em torno do alvo. Com cron de 5min, ±5min cobre toda
// a janela sem duplicar (idempotência por log faz o resto).
const WINDOW_TOLERANCE_MIN = 5;

// Status que NÃO devem receber lembrete (já fechados ou não vão acontecer)
const SKIP_STATUSES = new Set(['cancelado', 'nao_compareceu', 'concluido']);

interface ReminderResult {
  appointmentId: string;
  minutesBefore: number;
  notificationsCreated: number;
  skipped: boolean;
  skipReason?: string;
}

export interface ReminderSummary {
  ranAt: string;
  appointmentsScanned: number;
  remindersFired: number;
  notificationsCreated: number;
  results: ReminderResult[];
}

/**
 * Busca o fuso configurado de cada negócio distinto do lote (batch — 1
 * leitura por businessId, não por appointment). Ausente/não configurado =
 * cai pro default (mesmo comportamento de antes desta fatia).
 */
async function fetchTimezonesByBusiness(businessIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(businessIds.map(async (id) => {
    try {
      const snap = await adminDb.collection('businesses').doc(id).get();
      const tz = snap.data()?.settings?.timezone;
      if (typeof tz === 'string' && tz) map.set(id, tz);
    } catch (err) {
      console.warn(`[appointmentReminder] falha ao buscar fuso do negócio ${id}:`, err);
    }
  }));
  return map;
}

/** Hoje em formato YYYY-MM-DD no fuso BR. */
function todayBR(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(now); // en-CA → YYYY-MM-DD direto
}

/** Soma 1 dia ao YYYY-MM-DD (string). Usado pra cobrir cruzamento de meia-noite
 *  (cron 23:50 BR vendo appt 00:30 do dia seguinte). */
function addDay(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Roda os lembretes pra todos os agendamentos do dia + dia seguinte (cobre
 * janela noturna). Idempotente.
 */
export async function runAppointmentReminders(now: Date = new Date()): Promise<ReminderSummary> {
  const today = todayBR(now);
  const tomorrow = addDay(today);

  // Query global cross-tenant: appointments tem businessId, mas o lembrete é
  // por appt individual (não precisa scan por business primeiro). 1 query
  // varre os ~100-500 appts do dia em todo o SaaS.
  const snap = await adminDb
    .collection('appointments')
    .where('date', 'in', [today, tomorrow])
    .get();

  const appts = snap.docs.map((d) => ({ ...(d.data() as Appointment), id: d.id }));
  const businessIds = [...new Set(appts.map((a) => a.businessId).filter(Boolean))];
  const timezoneByBusiness = await fetchTimezonesByBusiness(businessIds);

  const results: ReminderResult[] = [];
  let totalNotifs = 0;
  let firedCount = 0;

  for (const apt of appts) {
    if (SKIP_STATUSES.has(apt.status)) continue;

    const timezone = timezoneByBusiness.get(apt.businessId) || DEFAULT_BUSINESS_TIMEZONE;
    let minutesUntilAppt: number;
    try {
      minutesUntilAppt = minutesUntilSlot(apt.date, apt.startTime, timezone, now);
    } catch (err) {
      console.warn(`[appointmentReminder] data/fuso inválido pro appointment ${apt.id}:`, err);
      continue;
    }

    // Acha qual janela (60min ou 30min) o appt está. Pode estar em ambas se o
    // cron pegou 2 ciclos do mesmo appt — idempotência do log resolve.
    for (const minutesBefore of REMINDER_WINDOWS) {
      if (!isWithinReminderWindow(minutesUntilAppt, minutesBefore, WINDOW_TOLERANCE_MIN)) continue;

      firedCount++;
      const result = await tryNotifyAppointment(apt, minutesBefore);
      totalNotifs += result.notificationsCreated;
      results.push(result);
    }
  }

  return {
    ranAt: new Date().toISOString(),
    appointmentsScanned: snap.size,
    remindersFired: firedCount,
    notificationsCreated: totalNotifs,
    results,
  };
}

/**
 * Idempotência via a definição compartilhada de `reminderWindow.ts` — chave
 * por (appointmentId, kind, slot=date+startTime). Reagendar gera slot novo e
 * libera o lembrete pro horário novo; a claim roda na MESMA transação que
 * cria as notificações (só Firestore, sem I/O externo, seguro pra tx).
 */
async function tryNotifyAppointment(
  apt: Appointment,
  minutesBefore: number,
): Promise<ReminderResult> {
  const profIds = getAppointmentProfessionalIds(apt);
  if (profIds.length === 0) {
    return {
      appointmentId: apt.id,
      minutesBefore,
      notificationsCreated: 0,
      skipped: true,
      skipReason: 'no professionals assigned',
    };
  }

  const kind = `staff_${minutesBefore}`;

  try {
    const created = await adminDb.runTransaction(async (tx) => {
      const claimed = await claimReminderSlotInTx(tx, adminDb, apt.id, apt.businessId, kind, apt.date, apt.startTime);
      if (!claimed) return 0; // já notificou pra este slot

      // Cria 1 notification doc por profissional. Em batch via tx (limitado a
      // 500 writes — appts não passam disso).
      const now = new Date().toISOString();
      const title = minutesBefore === 60
        ? `Agendamento em 1h: ${apt.clientName}`
        : `Agendamento em 30min: ${apt.clientName}`;
      const body = `${apt.serviceName} às ${apt.startTime}${apt.notes ? ` — ${apt.notes.slice(0, 80)}` : ''}`;

      for (const userId of profIds) {
        const notifRef = adminDb.collection('notifications').doc();
        tx.set(notifRef, {
          businessId: apt.businessId,
          userId,
          type: 'appointment_reminder',
          title,
          body,
          link: 'Agenda',
          relatedId: apt.id,
          isRead: false,
          createdAt: now,
        });
      }

      return profIds.length;
    });

    return {
      appointmentId: apt.id,
      minutesBefore,
      notificationsCreated: created,
      skipped: created === 0,
      skipReason: created === 0 ? 'already notified' : undefined,
    };
  } catch (err) {
    console.error(`[appointmentReminder] tx failed for ${apt.id}/${minutesBefore}:`, err);
    return {
      appointmentId: apt.id,
      minutesBefore,
      notificationsCreated: 0,
      skipped: true,
      skipReason: err instanceof Error ? err.message : 'unknown',
    };
  }
}
