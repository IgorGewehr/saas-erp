/**
 * M06.0b — congela em teste o comportamento ATUAL de cada cenário canônico
 * de agendamento (exclusivo, turma, multi-profissional, série recorrente,
 * sem profissional), usando fixtures versionadas (tests/fixtures/m06/*.json)
 * — mesmo padrão de tests/contracts/m02-commercial-baseline.test.ts.
 *
 * Objetivo: ter uma rede de segurança ANTES de qualquer convergência futura
 * (M06.7 — unificar agente/booking público no núcleo). Se um desses testes
 * quebrar depois, é sinal de que o comportamento documentado aqui mudou —
 * merece uma decisão explícita, não uma regressão silenciosa.
 *
 * Cobre só os canais que já passam pelo núcleo compartilhado
 * (checkAppointmentConflict, via Agenda/Conversas/CRM/PDV/API v1 — todos
 * migrados até M06.1). O canal do Agente IA/booking público tem algoritmo
 * PRÓPRIO (app/api/agent/tools/agenda/route.ts), não usa
 * checkAppointmentConflict — caracterizado em prosa, não aqui, porque
 * testá-lo isoladamente exigiria mockar toda a camada HTTP/HMAC da rota
 * (nenhuma rota deste repo tem teste próprio hoje, mesmo padrão já mantido
 * nas fatias M06.5b/c). Ver docs/agenda/AGENDA_M06_0B_CARACTERIZACAO.md.
 */
import { describe, expect, it } from 'vitest';
import { checkAppointmentConflict } from '@/lib/services/appointmentConflicts';
import type { Appointment, User } from '@/lib/types';
import type { ScheduleBlock } from '@/contracts/domain/scheduleBlock';

import exclusiveFixture from '@/tests/fixtures/m06/exclusive-booking.json';
import groupFixture from '@/tests/fixtures/m06/group-session.json';
import multiProfFixture from '@/tests/fixtures/m06/multi-professional.json';
import noProFixture from '@/tests/fixtures/m06/no-professional.json';
import seriesFixture from '@/tests/fixtures/m06/recurring-series.json';

describe('M06.0b — fixtures dos cenários canônicos de agendamento', () => {
  it('caracteriza agendamento exclusivo: conflita com o mesmo profissional, não com outro', () => {
    const members = exclusiveFixture.members as User[];
    const existing = exclusiveFixture.existingAppointments as Appointment[];

    const sameProf = checkAppointmentConflict({
      appointments: existing,
      members,
      professionalId: exclusiveFixture.candidateOverlappingSameProfessional.professionalId,
      date: exclusiveFixture.candidateOverlappingSameProfessional.date,
      startTime: exclusiveFixture.candidateOverlappingSameProfessional.startTime,
      endTime: exclusiveFixture.candidateOverlappingSameProfessional.endTime,
    });
    expect(sameProf.hasConflict).toBe(true);

    const otherProf = checkAppointmentConflict({
      appointments: existing,
      members,
      professionalId: exclusiveFixture.candidateSameSlotOtherProfessional.professionalId,
      date: exclusiveFixture.candidateSameSlotOtherProfessional.date,
      startTime: exclusiveFixture.candidateSameSlotOtherProfessional.startTime,
      endTime: exclusiveFixture.candidateSameSlotOtherProfessional.endTime,
    });
    expect(otherProf.hasConflict).toBe(false);
  });

  it('caracteriza turma: a função pura NÃO sabe de sessionKey — exclusão de colegas é responsabilidade do CALLER', () => {
    const members = groupFixture.members as User[];
    const colleague = groupFixture.existingAppointmentsSameSessionOnly as Appointment[];

    // Sem filtrar colegas (simula esquecer de chamar excludeSameSession no
    // caller): a função pura VÊ o colega como um appointment comum e
    // acusaria conflito — documentando que a responsabilidade de excluir
    // colegas de turma é de quem chama, não desta função.
    const withoutExclusion = checkAppointmentConflict({
      appointments: colleague,
      members,
      professionalId: groupFixture.candidateNewStudentSameSession.professionalId,
      date: groupFixture.candidateNewStudentSameSession.date,
      startTime: groupFixture.candidateNewStudentSameSession.startTime,
      endTime: groupFixture.candidateNewStudentSameSession.endTime,
    });
    expect(withoutExclusion.hasConflict).toBe(true);

    // Com colegas já excluídos pelo caller (lista vazia, mesmo efeito de
    // excludeSameSession ter filtrado tudo): novo aluno na mesma sessão não
    // conflita.
    const afterExclusion = checkAppointmentConflict({
      appointments: groupFixture.existingAppointmentsAfterExcludingSameSession as Appointment[],
      members,
      professionalId: groupFixture.candidateNewStudentSameSession.professionalId,
      date: groupFixture.candidateNewStudentSameSession.date,
      startTime: groupFixture.candidateNewStudentSameSession.startTime,
      endTime: groupFixture.candidateNewStudentSameSession.endTime,
    });
    expect(afterExclusion.hasConflict).toBe(false);

    // Um candidato de OUTRO serviço, sobrepondo o mesmo profissional, ainda
    // conflita com o colega da turma — colega só deixa de conflitar com
    // quem é da MESMA sessão, não com qualquer outra coisa do profissional.
    const otherServiceOverlap = checkAppointmentConflict({
      appointments: colleague,
      members,
      professionalId: groupFixture.candidateOtherServiceSameProfessionalOverlapping.professionalId,
      date: groupFixture.candidateOtherServiceSameProfessionalOverlapping.date,
      startTime: groupFixture.candidateOtherServiceSameProfessionalOverlapping.startTime,
      endTime: groupFixture.candidateOtherServiceSameProfessionalOverlapping.endTime,
    });
    expect(otherServiceOverlap.hasConflict).toBe(true);
  });

  it('caracteriza multi-profissional (M06.1): conflita mesmo quando o profissional só aparece na 2ª posição do array', () => {
    const existing = [multiProfFixture.existingAppointmentOnlyInArraySecondPosition as Appointment];
    const candidate = multiProfFixture.candidateNewMultiProfessional;

    const result = checkAppointmentConflict({
      appointments: existing,
      members: [],
      professionalId: candidate.professionalId,
      professionalIds: candidate.professionalIds,
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
    });
    expect(result.hasConflict).toBe(true);
  });

  it('caracteriza "sem profissional": não conflita com appointment de outro profissional, mas RESPEITA bloqueio do negócio inteiro', () => {
    const existing = noProFixture.existingAppointments as Appointment[];
    const candidate = noProFixture.candidateNoProfessional;

    const withoutBlock = checkAppointmentConflict({
      appointments: existing,
      members: [],
      professionalId: candidate.professionalId,
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
    });
    expect(withoutBlock.hasConflict).toBe(false);

    const withBusinessWideBlock = checkAppointmentConflict({
      appointments: existing,
      members: [],
      professionalId: candidate.professionalId,
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      blocks: [noProFixture.businessWideBlockActive as ScheduleBlock],
    });
    expect(withBusinessWideBlock.hasConflict).toBe(true);
  });

  it('caracteriza série recorrente: cada ocorrência é checada INDEPENDENTE — sem lock/atomicidade especial pra série', () => {
    const members = seriesFixture.members as User[];
    const occurrences = seriesFixture.existingSeriesOccurrences as Appointment[];

    // Overlap com UMA ocorrência específica da série conflita normalmente
    // (tratada como um appointment comum, sem nenhum tratamento especial
    // por pertencer a uma série).
    const overlapping = checkAppointmentConflict({
      appointments: occurrences,
      members,
      professionalId: seriesFixture.candidateOverlappingOneOccurrence.professionalId,
      date: seriesFixture.candidateOverlappingOneOccurrence.date,
      startTime: seriesFixture.candidateOverlappingOneOccurrence.startTime,
      endTime: seriesFixture.candidateOverlappingOneOccurrence.endTime,
    });
    expect(overlapping.hasConflict).toBe(true);

    // Uma semana sem ocorrência da série: livre, mesmo sendo o "mesmo"
    // horário semanal — a série não reserva o slot indefinidamente, só as
    // datas que realmente têm um Appointment gravado.
    const unoccupiedWeek = checkAppointmentConflict({
      appointments: occurrences,
      members,
      professionalId: seriesFixture.candidateOnUnoccupiedWeek.professionalId,
      date: seriesFixture.candidateOnUnoccupiedWeek.date,
      startTime: seriesFixture.candidateOnUnoccupiedWeek.startTime,
      endTime: seriesFixture.candidateOnUnoccupiedWeek.endTime,
    });
    expect(unoccupiedWeek.hasConflict).toBe(false);
  });
});
