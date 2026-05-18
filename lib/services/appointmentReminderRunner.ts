/**
 * Appointment Reminder Runner — dispara notificações in-app pros profissionais
 * de agendamentos que estão pra começar.
 *
 * Chamado por cron a cada 5min (ver /api/appointments/run-reminders). Cada
 * execução varre appointments dos próximos ~70min, identifica os que entram
 * nas janelas de 60min e 30min antes, e cria 1 notificação por profissional
 * no sino (TopBar).
 *
 * Idempotência: log composto em `appointmentReminderLogs/{appointmentId}_{minutesBefore}`.
 * Cron rodando múltiplas vezes no mesmo intervalo NÃO duplica notificações.
 *
 * Timezone: assume Brasil/SP (UTC-3, sem DST desde 2019). Generalizar pra
 * outros fusos requer parse do business.settings.timezone via Intl — fora
 * de escopo v1.
 *
 * Multi-prof: cada UID em `professionalIds` recebe sua própria notificação.
 * Se nenhum prof atribuído, skip (appointment "da casa" sem responsável).
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Appointment } from '@/lib/types';
import { getAppointmentProfessionalIds, getAppointmentProfessionalNames } from '@/lib/utils/appointment';

// Offset BR fixo: UTC-3 sem DST desde 2019. Pra outros TZs, usar Intl
// .DateTimeFormat com timeZoneName='longOffset' (mais complexo).
const BR_OFFSET = '-03:00';

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
 * Converte `date + startTime` (locais BR) pra epoch UTC. Aceita formato
 * 'YYYY-MM-DD' + 'HH:mm'. Retorna NaN se inválido.
 */
function appointmentEpochMs(date: string, startTime: string): number {
  return new Date(`${date}T${startTime}:00${BR_OFFSET}`).getTime();
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
  const nowMs = now.getTime();

  // Query global cross-tenant: appointments tem businessId, mas o lembrete é
  // por appt individual (não precisa scan por business primeiro). 1 query
  // varre os ~100-500 appts do dia em todo o SaaS.
  const snap = await adminDb
    .collection('appointments')
    .where('date', 'in', [today, tomorrow])
    .get();

  const results: ReminderResult[] = [];
  let totalNotifs = 0;
  let firedCount = 0;

  for (const docSnap of snap.docs) {
    const apt: Appointment = { ...(docSnap.data() as Appointment), id: docSnap.id };

    if (SKIP_STATUSES.has(apt.status)) continue;

    const aptEpoch = appointmentEpochMs(apt.date, apt.startTime);
    if (!isFinite(aptEpoch)) continue;

    const minutesUntilAppt = (aptEpoch - nowMs) / 60_000;

    // Acha qual janela (60min ou 30min) o appt está. Pode estar em ambas se o
    // cron pegou 2 ciclos do mesmo appt — idempotência do log resolve.
    for (const minutesBefore of REMINDER_WINDOWS) {
      const diff = Math.abs(minutesUntilAppt - minutesBefore);
      if (diff > WINDOW_TOLERANCE_MIN) continue;

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
 * Idempotência via log composto: `appointmentReminderLogs/{aptId}_{minutesBefore}_{date}_{startTime}`.
 * Transaction garante que cron runs paralelos não duplicam notif. O slot
 * (date+startTime) faz parte da chave de propósito: se o appt for reagendado
 * (ex: 14:00 → 18:00), o NOVO horário gera log novo e dispara lembrete pro
 * horário novo. Caso contrário, log antigo bloquearia o lembrete do horário
 * reagendado.
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

  // Chave inclui date+startTime sanitizados pra que reagendamento gere log novo.
  const slotKey = `${apt.date}_${apt.startTime}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const logRef = adminDb.collection('appointmentReminderLogs').doc(`${apt.id}_${minutesBefore}_${slotKey}`);
  const profNames = getAppointmentProfessionalNames(apt);

  try {
    const created = await adminDb.runTransaction(async (tx) => {
      const logSnap = await tx.get(logRef);
      if (logSnap.exists) return 0; // já notificou

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

      tx.set(logRef, {
        appointmentId: apt.id,
        businessId: apt.businessId,
        minutesBefore,
        sentAt: now,
        recipientIds: profIds,
        recipientNames: profNames,
      });

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
