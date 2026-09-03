import { describe, it, expect } from 'vitest';
import { checkAppointmentConflict } from '@/lib/services/appointmentConflicts';
import type { Appointment, User } from '@/lib/types';

// Factories enxutas — só os campos que a função lê (resto cast pra Any).
const apt = (over: Partial<Appointment>): Appointment => ({
  id: 'a1',
  businessId: 'biz',
  clientId: 'c1',
  clientName: 'Maria',
  serviceId: 's1',
  serviceName: 'Corte',
  professionalId: 'p1',
  date: '2026-05-13',
  startTime: '09:00',
  endTime: '10:00',
  duration: 60,
  status: 'agendado',
  price: 100,
  createdAt: '',
  updatedAt: '',
  ...over,
} as Appointment);

const mem = (over: Partial<User>): User => ({
  id: 'p1',
  uid: 'p1',
  email: '',
  name: 'João Pro',
  role: 'operator',
  businessId: 'biz',
  isActive: true,
  ...over,
} as User);

describe('checkAppointmentConflict', () => {
  it('sem professionalId → sem conflito (qualquer profissional)', () => {
    const r = checkAppointmentConflict({
      appointments: [],
      members: [],
      professionalId: '',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(false);
  });

  it('sem overlap → sem conflito', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ startTime: '08:00', endTime: '09:00' })],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(false);
  });

  it('overlap parcial no início → conflito', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ startTime: '08:30', endTime: '09:30' })],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(true);
    expect(r.message).toContain('Maria');
  });

  it('appointment cancelado → ignora (slot liberado)', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ status: 'cancelado', startTime: '09:00', endTime: '10:00' })],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(false);
  });

  it('excludeId → ignora o próprio appointment (caso edição)', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ id: 'edit-me', startTime: '09:00', endTime: '10:00' })],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
      excludeId: 'edit-me',
    });
    expect(r.hasConflict).toBe(false);
  });

  it('outro profissional no mesmo horário → sem conflito', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ professionalId: 'p2', startTime: '09:00', endTime: '10:00' })],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(false);
  });

  it('outro dia mesmo profissional → sem conflito', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ date: '2026-05-14', startTime: '09:00', endTime: '10:00' })],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(false);
  });

  it('profissional não trabalha nesse dia da semana → conflito', () => {
    // 2026-05-13 é uma quarta-feira (dayOfWeek = 3)
    const r = checkAppointmentConflict({
      appointments: [],
      members: [mem({
        workingHours: {
          0: { enabled: false, start: '09:00', end: '18:00' },
          1: { enabled: true, start: '09:00', end: '18:00' },
          2: { enabled: true, start: '09:00', end: '18:00' },
          3: { enabled: false, start: '09:00', end: '18:00' }, // quarta = off
          4: { enabled: true, start: '09:00', end: '18:00' },
          5: { enabled: true, start: '09:00', end: '18:00' },
          6: { enabled: false, start: '09:00', end: '18:00' },
        },
      })],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(true);
    expect(r.message).toContain('não trabalha');
  });

  it('slot antes do horário de trabalho → conflito', () => {
    const r = checkAppointmentConflict({
      appointments: [],
      members: [mem({
        workingHours: {
          0: { enabled: false, start: '09:00', end: '18:00' },
          1: { enabled: false, start: '09:00', end: '18:00' },
          2: { enabled: false, start: '09:00', end: '18:00' },
          3: { enabled: true, start: '09:00', end: '18:00' },
          4: { enabled: false, start: '09:00', end: '18:00' },
          5: { enabled: false, start: '09:00', end: '18:00' },
          6: { enabled: false, start: '09:00', end: '18:00' },
        },
      })],
      professionalId: 'p1',
      date: '2026-05-13', // quarta
      startTime: '07:00',
      endTime: '08:00',
    });
    expect(r.hasConflict).toBe(true);
    expect(r.message).toContain('horário de trabalho');
  });

  it('slot termina exatamente quando outro começa → sem conflito (back-to-back ok)', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ startTime: '10:00', endTime: '11:00' })],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(false);
  });

  it('professionalIds[] detecta overlap mesmo quando o professionalId legado não bate (M06.1)', () => {
    // Agendamento EXISTENTE só tem o profissional em professionalIds[1] (não
    // é o legado professionalId) — antes da correção isso era invisível.
    const r = checkAppointmentConflict({
      appointments: [apt({
        professionalId: 'p9', // legado aponta pra outro
        professionalIds: ['p9', 'p1'],
        startTime: '09:00',
        endTime: '10:00',
      })],
      members: [mem({})],
      professionalId: 'p1',
      professionalIds: ['p1'],
      date: '2026-05-13',
      startTime: '09:30',
      endTime: '10:30',
    });
    expect(r.hasConflict).toBe(true);
  });

  it('novo agendamento com múltiplos profissionais conflita se QUALQUER um deles já está ocupado', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ professionalId: 'p2', startTime: '09:00', endTime: '10:00' })],
      members: [mem({}), mem({ id: 'p2', uid: 'p2' })],
      professionalId: 'p1',
      professionalIds: ['p1', 'p2'],
      date: '2026-05-13',
      startTime: '09:30',
      endTime: '10:30',
    });
    expect(r.hasConflict).toBe(true);
  });

  it('horário de trabalho é checado para CADA profissional do conjunto, não só o primeiro', () => {
    const r = checkAppointmentConflict({
      appointments: [],
      members: [
        mem({}), // p1 sem workingHours = sempre disponível
        mem({
          id: 'p2', uid: 'p2',
          workingHours: {
            0: { enabled: false, start: '09:00', end: '18:00' },
            1: { enabled: true, start: '09:00', end: '18:00' },
            2: { enabled: true, start: '09:00', end: '18:00' },
            3: { enabled: false, start: '09:00', end: '18:00' }, // quarta = off
            4: { enabled: true, start: '09:00', end: '18:00' },
            5: { enabled: true, start: '09:00', end: '18:00' },
            6: { enabled: false, start: '09:00', end: '18:00' },
          },
        }),
      ],
      professionalId: 'p1',
      professionalIds: ['p1', 'p2'],
      date: '2026-05-13', // quarta — p2 não trabalha
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(true);
    expect(r.message).toContain('não trabalha');
  });

  it('sem professionalIds explícito, comportamento idêntico ao legado (retrocompat)', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({ startTime: '08:30', endTime: '09:30' })],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(r.hasConflict).toBe(true);
  });

  it('M06.3a: bloqueio do profissional recusa agendamento dentro do intervalo', () => {
    const r = checkAppointmentConflict({
      appointments: [],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      blocks: [{
        id: 'b1', businessId: 'biz', professionalId: 'p1',
        startDate: '2026-09-10', endDate: '2026-09-20', status: 'ativo',
        createdBy: 'u1', createdByName: 'Admin', createdAt: '', updatedAt: '',
      }],
    });
    expect(r.hasConflict).toBe(true);
    expect(r.message).toContain('bloqueado');
  });

  it('M06.3a: bloqueio do negócio inteiro (sem professionalId) recusa mesmo sem profissional escolhido', () => {
    const r = checkAppointmentConflict({
      appointments: [],
      members: [],
      professionalId: '',
      date: '2026-09-07',
      startTime: '09:00',
      endTime: '10:00',
      blocks: [{
        id: 'b2', businessId: 'biz',
        startDate: '2026-09-07', endDate: '2026-09-07', reason: 'Feriado', status: 'ativo',
        createdBy: 'u1', createdByName: 'Admin', createdAt: '', updatedAt: '',
      }],
    });
    expect(r.hasConflict).toBe(true);
    expect(r.message).toContain('Feriado');
  });

  it('M06.3a: bloqueio do negócio inteiro NÃO afeta profissional específico fora do escopo do teste (mesmo assim recusa — é o negócio inteiro)', () => {
    const r = checkAppointmentConflict({
      appointments: [],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-09-07',
      startTime: '09:00',
      endTime: '10:00',
      blocks: [{
        id: 'b2', businessId: 'biz',
        startDate: '2026-09-07', endDate: '2026-09-07', status: 'ativo',
        createdBy: 'u1', createdByName: 'Admin', createdAt: '', updatedAt: '',
      }],
    });
    expect(r.hasConflict).toBe(true);
  });

  it('M06.3a: bloqueio de OUTRO profissional não afeta o profissional pedido', () => {
    const r = checkAppointmentConflict({
      appointments: [],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      blocks: [{
        id: 'b3', businessId: 'biz', professionalId: 'p2',
        startDate: '2026-09-10', endDate: '2026-09-20', status: 'ativo',
        createdBy: 'u1', createdByName: 'Admin', createdAt: '', updatedAt: '',
      }],
    });
    expect(r.hasConflict).toBe(false);
  });

  it('M06.3a: bloqueio com janela de horário só recusa overlap real, não o dia inteiro', () => {
    const blocks = [{
      id: 'b4', businessId: 'biz', professionalId: 'p1',
      startDate: '2026-09-15', endDate: '2026-09-15', startTime: '12:00', endTime: '13:00',
      reason: 'Almoço estendido', status: 'ativo' as const,
      createdBy: 'u1', createdByName: 'Admin', createdAt: '', updatedAt: '',
    }];
    const overlapping = checkAppointmentConflict({
      appointments: [], members: [mem({})], professionalId: 'p1',
      date: '2026-09-15', startTime: '12:30', endTime: '13:30', blocks,
    });
    expect(overlapping.hasConflict).toBe(true);

    const notOverlapping = checkAppointmentConflict({
      appointments: [], members: [mem({})], professionalId: 'p1',
      date: '2026-09-15', startTime: '09:00', endTime: '10:00', blocks,
    });
    expect(notOverlapping.hasConflict).toBe(false);
  });

  it('M06.3a: bloqueio cancelado é ignorado', () => {
    const r = checkAppointmentConflict({
      appointments: [], members: [mem({})], professionalId: 'p1',
      date: '2026-09-15', startTime: '09:00', endTime: '10:00',
      blocks: [{
        id: 'b5', businessId: 'biz', professionalId: 'p1',
        startDate: '2026-09-10', endDate: '2026-09-20', status: 'cancelado',
        createdBy: 'u1', createdByName: 'Admin', createdAt: '', updatedAt: '',
      }],
    });
    expect(r.hasConflict).toBe(false);
  });

  it('M06.3a: bloqueio fora do intervalo de data não afeta', () => {
    const r = checkAppointmentConflict({
      appointments: [], members: [mem({})], professionalId: 'p1',
      date: '2026-09-25', startTime: '09:00', endTime: '10:00',
      blocks: [{
        id: 'b6', businessId: 'biz', professionalId: 'p1',
        startDate: '2026-09-10', endDate: '2026-09-20', status: 'ativo',
        createdBy: 'u1', createdByName: 'Admin', createdAt: '', updatedAt: '',
      }],
    });
    expect(r.hasConflict).toBe(false);
  });

  it('translator customizado é usado quando passado', () => {
    const r = checkAppointmentConflict({
      appointments: [apt({})],
      members: [mem({})],
      professionalId: 'p1',
      date: '2026-05-13',
      startTime: '09:00',
      endTime: '10:00',
      t: (key, _fallback) => `[${key}]`,
    });
    expect(r.message).toBe('[agenda.conflictWith]');
  });
});
