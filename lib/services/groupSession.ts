/**
 * lib/services/groupSession.ts
 *
 * Núcleo PURO da feature de turmas (Service.capacity>1 + sessions[]). Sem
 * Firestore, sem React — só a regra de conflito/vagas. Isola a lógica pra que
 * a rota da agenda (app/api/agent/tools/agenda/route.ts) e os guards de tx
 * compartilhem o MESMO algoritmo, e pra que seja testável sem subir o grafo de
 * imports da rota (firebase-admin, contratos).
 *
 * REGRA DE CONFLITO (design item 3 — retrocompat BIT-A-BIT para exclusivo):
 *
 *  - Serviço exclusivo (capacity ausente/1): NÃO passa por aqui. A rota só
 *    chama estas funções quando isGroupService(service.capacity) é true.
 *  - Appointment da MESMA turma (mesmo sessionKey) → NUNCA conflita (colega).
 *  - Qualquer outro appointment não-cancelado que sobrepõe o intervalo →
 *    BLOQUEIA (1:1 vs turma, turma vs turma de outro horário/serviço, prof
 *    dando aula vs tentativa 1:1).
 *  - Vagas da turma = capacity - count(appts não-cancelados com aquele sessionKey).
 */

import type { Appointment, Service, WeeklySession } from '@/lib/types';
import { effectiveServiceCapacity } from '@/lib/contracts/domain/service';
import { buildSessionKey } from '@/lib/utils/sessionKey';

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface ResolvedSession {
  startTime: string;
  endTime: string;
  duration: number;
  capacity: number;
  professionalId?: string;
  professionalName?: string;
}

/**
 * Sessões da grade semanal de um serviço que caem no dia da semana dado.
 * Resolve duration/capacity herdando do Service quando a sessão não declara.
 */
export function resolveSessionsForDay(service: Service, dayOfWeek: number): ResolvedSession[] {
  if (!service.sessions || service.sessions.length === 0) return [];
  const baseCapacity = effectiveServiceCapacity(service.capacity);
  const baseDuration = service.duration;
  return service.sessions
    .filter((w: WeeklySession) => w.weekday === dayOfWeek)
    .map((w: WeeklySession) => {
      const duration = w.duration && w.duration > 0 ? w.duration : baseDuration;
      // capacity da sessão tem precedência; quando ausente herda a do serviço.
      const capacity = w.capacity && w.capacity >= 1 ? w.capacity : baseCapacity;
      return {
        startTime: w.startTime,
        endTime: addMinutes(w.startTime, duration),
        duration,
        capacity,
        professionalId: w.professionalId,
        professionalName: w.professionalName,
      };
    });
}

/**
 * Conta alunos já reservados (não-cancelados) numa turma identificada por
 * sessionKey, dentro de uma lista de appointments já carregada.
 */
export function countSeatsTaken(appts: Appointment[], sessionKey: string): number {
  return appts.filter((a) => a.status !== 'cancelado' && a.sessionKey === sessionKey).length;
}

/**
 * Retorna o primeiro appointment que BLOQUEIA a reserva candidata, ou undefined
 * se livre. `candidateSessionKey` presente quando a reserva pertence a uma turma:
 * colegas (mesmo sessionKey) são ignorados. Ausente = exclusivo (qualquer
 * sobreposição não-cancelada bloqueia — comportamento atual BIT-A-BIT).
 *
 * O caller é responsável por passar somente appointments do profissional
 * relevante (ou não-atribuídos, que bloqueiam todos).
 */
export function findBlockingAppointment(
  appts: Appointment[],
  startTime: string,
  endTime: string,
  candidateSessionKey?: string,
): Appointment | undefined {
  return appts.find((a) =>
    a.status !== 'cancelado' &&
    !(candidateSessionKey !== undefined && a.sessionKey === candidateSessionKey) &&
    intervalsOverlap(startTime, endTime, a.startTime, a.endTime),
  );
}

export interface GroupSlot {
  startTime: string;
  endTime: string;
  professionalId?: string;
  professionalName?: string;
  capacity: number;
  seatsAvailable: number;
  sessionKey: string;
}

/**
 * Enumera as sessões fixas da grade de um serviço-turma num dia e calcula vagas.
 * Só emite sessões com pelo menos 1 vaga. Quando `professionalId` é passado,
 * filtra sessões cujo professor fixo bate (sessões abertas — sem professionalId
 * — são incluídas e amarradas ao 'any' no sessionKey).
 */
export function buildGroupSlots(
  service: Service,
  date: string,
  dayOfWeek: number,
  professionalId: string | undefined,
  appts: Appointment[],
): GroupSlot[] {
  const sessions = resolveSessionsForDay(service, dayOfWeek);
  const slots: GroupSlot[] = [];

  for (const sess of sessions) {
    if (professionalId && sess.professionalId && sess.professionalId !== professionalId) continue;

    const sessionKey = buildSessionKey({
      serviceId: service.id,
      date,
      startTime: sess.startTime,
      professionalId: sess.professionalId,
    });
    const taken = countSeatsTaken(appts, sessionKey);
    const seatsAvailable = Math.max(0, sess.capacity - taken);
    if (seatsAvailable <= 0) continue;

    slots.push({
      startTime: sess.startTime,
      endTime: sess.endTime,
      professionalId: sess.professionalId,
      professionalName: sess.professionalName,
      capacity: sess.capacity,
      seatsAvailable,
      sessionKey,
    });
  }

  slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return slots;
}
