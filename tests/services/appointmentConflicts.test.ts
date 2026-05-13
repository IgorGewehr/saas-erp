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
