/**
 * lib/services/appointmentConflicts.ts
 *
 * Checagem pura de conflitos de agenda. Sem React, sem Firestore — recebe
 * appointments + members + parâmetros e devolve hasConflict + mensagem.
 * Extraída da lógica embarcada no AgendaModule.tsx pra que:
 *   - AgendaModule continue usando inline (sem mudar nada lá)
 *   - ScheduleFromConversationDialog (Conversas) e qualquer outro fluxo
 *     de agendamento futuro tenha um único algoritmo, sem drift.
 *
 * Regras (na ordem de prioridade):
 *   1. Profissional não trabalha no dia da semana escolhido
 *   2. Slot fora do horário de trabalho do profissional
 *   3. Overlap com outro appointment não-cancelado do mesmo professionalId
 *      no mesmo dia
 *
 * Caller passa `t` opcional para internacionalização das mensagens; sem
 * ele, usa strings em pt-BR (default do projeto).
 */

import type { Appointment, User } from '@/lib/types';

export interface ConflictCheckInput {
  appointments: Appointment[];
  members: User[];
  professionalId: string;
  date: string;       // 'YYYY-MM-DD'
  startTime: string;  // 'HH:mm'
  endTime: string;    // 'HH:mm'
  /** ID de appointment a ignorar (caso de edição — não conflita consigo mesmo). */
  excludeId?: string;
  /** Translator opcional. Recebe key + fallback default. */
  t?: (key: string, fallback: string) => string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  message: string;
}

const defaultT = (_key: string, fallback: string) => fallback;

export function checkAppointmentConflict(input: ConflictCheckInput): ConflictCheckResult {
  const { appointments, members, professionalId, date, startTime, endTime, excludeId } = input;
  const t = input.t ?? defaultT;

  // Sem profissional escolhido: não há contra o que conflitar. Operador pode
  // estar agendando "qualquer um disponível" — verificação cai pro fluxo
  // operacional posterior.
  if (!professionalId) return { hasConflict: false, message: '' };

  const professional = members.find((m) => m.id === professionalId);

  // Check 1: Working hours (se o profissional cadastrou)
  if (professional?.workingHours) {
    // `new Date(date + 'T12:00:00')` força midday no fuso local — evita
    // bug clássico de TZ que joga o dia anterior em fusos negativos.
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const daySchedule = professional.workingHours[dayOfWeek];
    if (!daySchedule?.enabled) {
      return {
        hasConflict: true,
        message: t('agenda.doesNotWorkThisDay', `${professional.name} não trabalha neste dia`),
      };
    }
    if (startTime < daySchedule.start || endTime > daySchedule.end) {
      return {
        hasConflict: true,
        message: t(
          'agenda.outsideWorkingHours',
          `Fora do horário de trabalho (${daySchedule.start} - ${daySchedule.end})`,
        ),
      };
    }
  }

  // Check 2: Overlap com appointments existentes. Status 'cancelado' não
  // conta (slot foi liberado). Overlap test clássico: A não sobrepõe B sse
  // A termina antes de B começar OU A começa depois de B terminar.
  const existing = appointments.filter((a) =>
    a.professionalId === professionalId &&
    a.date === date &&
    a.status !== 'cancelado' &&
    a.id !== excludeId &&
    !(endTime <= a.startTime || startTime >= a.endTime),
  );

  if (existing.length > 0) {
    const other = existing[0];
    return {
      hasConflict: true,
      message: t(
        'agenda.conflictWith',
        `Conflito com ${other.clientName} (${other.startTime} - ${other.endTime})`,
      ),
    };
  }

  return { hasConflict: false, message: '' };
}
