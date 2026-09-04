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
 *   3. Overlap com outro appointment não-cancelado de QUALQUER profissional
 *      em comum (campo legado `professionalId` OU `professionalIds[]`) no
 *      mesmo dia
 *
 * M06.1: antes só olhava `professionalId` (legado) — um profissional em 2ª
 * posição+ de um atendimento multi-profissional era invisível ao check e
 * podia ser duplo-agendado. `professionalIds` (plural, opcional) resolve
 * isso; passar só `professionalId` (singular) continua funcionando idêntico
 * a antes — retrocompat total com os callers existentes.
 *
 * M06.3a: `blocks` (opcional) — bloqueios de agenda (férias, feriado,
 * indisponibilidade) checados ANTES de tudo, inclusive antes do early-return
 * de "sem profissional escolhido": um bloqueio do NEGÓCIO INTEIRO (sem
 * `professionalId`) vale mesmo pra um agendamento "com qualquer profissional
 * disponível". Omitir `blocks` = nenhum bloqueio considerado (retrocompat).
 *
 * M06.3c: `bufferMinutes` (opcional) — intervalo mínimo exigido entre dois
 * atendimentos consecutivos do mesmo profissional (tempo de limpeza/preparo),
 * aplicado só no Check 2 (overlap entre atendimentos) — bloqueios e horário
 * de trabalho têm seus próprios limites exatos, buffer não se aplica a eles.
 * Omitir/0 = sem intervalo mínimo (retrocompat total com o overlap clássico).
 *
 * Caller passa `t` opcional para internacionalização das mensagens; sem
 * ele, usa strings em pt-BR (default do projeto).
 */

import type { Appointment, User } from '@/lib/types';
import type { ScheduleBlock } from '@/contracts/domain/scheduleBlock';
import { getAppointmentProfessionalIds } from '@/lib/utils/appointment';

/**
 * Cópia intencional de `timeToMinutes` (app/components/features/agenda/shared.ts)
 * — não importar de lá: este arquivo se declara "sem React, sem Firestore" e
 * roda também no Admin SDK server-side, então não deve depender da camada de
 * UI. Não "corrigir" essa duplicação importando de shared.ts.
 */
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export interface ConflictCheckInput {
  appointments: Appointment[];
  members: User[];
  professionalId: string;
  /** Conjunto completo de profissionais do agendamento sendo criado/editado.
   *  Quando ausente, cai pra `[professionalId]` (comportamento legado). */
  professionalIds?: string[];
  date: string;       // 'YYYY-MM-DD'
  startTime: string;  // 'HH:mm'
  endTime: string;    // 'HH:mm'
  /** ID de appointment a ignorar (caso de edição — não conflita consigo mesmo). */
  excludeId?: string;
  /** Bloqueios de agenda relevantes (negócio inteiro + dos profissionais do
   *  conjunto). Quando ausente, nenhum bloqueio é considerado. */
  blocks?: ScheduleBlock[];
  /** Intervalo mínimo (minutos) exigido entre este agendamento e qualquer
   *  outro do mesmo profissional. Ausente/0 = sem intervalo mínimo (só
   *  overlap clássico, comportamento atual). Negativo é tratado como 0. */
  bufferMinutes?: number;
  /** Translator opcional. Recebe key + fallback default. */
  t?: (key: string, fallback: string) => string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  message: string;
}

const defaultT = (_key: string, fallback: string) => fallback;

/** true quando o bloqueio cobre essa data/horário (dia inteiro se sem horário próprio). */
function blockCoversSlot(
  block: Pick<ScheduleBlock, 'startDate' | 'endDate' | 'startTime' | 'endTime'>,
  date: string,
  startTime: string,
  endTime: string,
): boolean {
  if (date < block.startDate || date > block.endDate) return false;
  if (!block.startTime || !block.endTime) return true; // dia inteiro bloqueado
  return !(endTime <= block.startTime || startTime >= block.endTime);
}

export function checkAppointmentConflict(input: ConflictCheckInput): ConflictCheckResult {
  const { appointments, members, professionalId, date, startTime, endTime, excludeId } = input;
  const t = input.t ?? defaultT;

  const effectiveIds = input.professionalIds?.filter(Boolean).length
    ? [...new Set(input.professionalIds.filter(Boolean))]
    : (professionalId ? [professionalId] : []);

  // Check 0: Bloqueios de agenda — negócio inteiro (sem professionalId no
  // bloqueio) vale pra QUALQUER agendamento, mesmo sem profissional
  // escolhido; por profissional só se aplica quando esse profissional está
  // no conjunto do agendamento sendo checado.
  for (const block of input.blocks ?? []) {
    if (block.status !== 'ativo') continue;
    if (block.professionalId && !effectiveIds.includes(block.professionalId)) continue;
    if (!blockCoversSlot(block, date, startTime, endTime)) continue;
    return {
      hasConflict: true,
      message: t(
        'agenda.scheduleBlocked',
        `Horário bloqueado${block.reason ? `: ${block.reason}` : ''} (${block.startDate} a ${block.endDate})`,
      ),
    };
  }

  // Sem profissional escolhido: não há contra o que conflitar (fora de
  // bloqueio do negócio, já checado acima). Operador pode estar agendando
  // "qualquer um disponível" — verificação cai pro fluxo operacional posterior.
  if (effectiveIds.length === 0) return { hasConflict: false, message: '' };

  // Check 1: Working hours — cada profissional do conjunto precisa estar
  // disponível nesse dia/horário (se tiver workingHours cadastrado).
  for (const id of effectiveIds) {
    const professional = members.find((m) => m.id === id);
    if (!professional?.workingHours) continue;
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

  // Check 2: Overlap com appointments existentes que compartilham QUALQUER
  // profissional do conjunto. Status 'cancelado' não conta (slot foi
  // liberado). Overlap test clássico: A não sobrepõe B sse A termina antes
  // de B começar OU A começa depois de B terminar. M06.3c: buffer estende
  // essa janela nos dois lados — exige `buffer` minutos de vão real entre
  // os dois atendimentos, não só ausência de sobreposição.
  const buffer = Math.max(0, input.bufferMinutes ?? 0);
  const candStart = toMinutes(startTime);
  const candEnd = toMinutes(endTime);
  const idSet = new Set(effectiveIds);
  const existing = appointments.filter((a) =>
    getAppointmentProfessionalIds(a).some((id) => idSet.has(id)) &&
    a.date === date &&
    a.status !== 'cancelado' &&
    a.id !== excludeId &&
    !(candEnd + buffer <= toMinutes(a.startTime) || candStart >= toMinutes(a.endTime) + buffer),
  );

  if (existing.length > 0) {
    const other = existing[0];
    // Distingue overlap "de verdade" (conflitaria mesmo com buffer=0) de um
    // conflito que só existe por causa do intervalo mínimo configurado —
    // mensagem mais clara pro operador entender por que um horário livre
    // (sem sobreposição real) foi recusado.
    const trueOverlap = !(candEnd <= toMinutes(other.startTime) || candStart >= toMinutes(other.endTime));
    if (trueOverlap || buffer === 0) {
      return {
        hasConflict: true,
        message: t(
          'agenda.conflictWith',
          `Conflito com ${other.clientName} (${other.startTime} - ${other.endTime})`,
        ),
      };
    }
    return {
      hasConflict: true,
      message: t(
        'agenda.bufferConflict',
        `Intervalo mínimo de ${buffer} min não respeitado — conflita com ${other.clientName} (${other.startTime} - ${other.endTime})`,
      ),
    };
  }

  return { hasConflict: false, message: '' };
}
