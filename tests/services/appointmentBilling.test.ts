import { describe, expect, it } from 'vitest';
import { buildAppointmentBillingPrefill } from '@/lib/services/agenda/appointmentBilling';
import type { Appointment } from '@/lib/types';

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    businessId: 'biz1',
    clientId: '',
    clientName: 'Maria Silva',
    serviceName: 'Limpeza',
    date: '2026-09-01',
    startTime: '09:00',
    endTime: '09:30',
    duration: 30,
    status: 'concluido',
    price: 150,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Appointment;
}

describe('buildAppointmentBillingPrefill', () => {
  it('combina serviceName e clientName na descrição', () => {
    const prefill = buildAppointmentBillingPrefill(appointment());
    expect(prefill.description).toBe('Limpeza — Maria Silva');
  });

  it('cai pro clientName sozinho quando não há serviceName', () => {
    const prefill = buildAppointmentBillingPrefill(appointment({ serviceName: '' }));
    expect(prefill.description).toBe('Maria Silva');
  });

  it('repassa o valor do atendimento sem transformação', () => {
    const prefill = buildAppointmentBillingPrefill(appointment({ price: 320.5 }));
    expect(prefill.amount).toBe(320.5);
  });

  it('usa a data de hoje como vencimento padrão', () => {
    const prefill = buildAppointmentBillingPrefill(appointment());
    const today = new Date().toISOString().slice(0, 10);
    expect(prefill.dueDate).toBe(today);
  });

  it('repassa o id do atendimento pra permitir o writeback', () => {
    const prefill = buildAppointmentBillingPrefill(appointment({ id: 'appt-42' }));
    expect(prefill.appointmentId).toBe('appt-42');
  });
});
