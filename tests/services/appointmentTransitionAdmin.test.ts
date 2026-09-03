import { describe, expect, it, vi, beforeEach } from 'vitest';

// dispatchDomainEvent já tem sua própria suíte indireta via
// appointmentCompletionHandlers.test.ts (8 casos) — aqui mockamos por
// completo. O objetivo deste arquivo é provar que transitionAppointmentAdmin
// DELEGA certo (tipo de evento, quando dispara e quando não dispara) e
// aplica o patch de status/FSM/tenant corretamente — não re-testar os
// handlers em si.
const dispatchDomainEventMock = vi.fn().mockResolvedValue({ eventId: 'evt-1', handlers: [] });
vi.mock('@/lib/contracts/_runtime/dispatch', () => ({
  dispatchDomainEvent: (...args: unknown[]) => dispatchDomainEventMock(...args),
}));

import {
  transitionAppointmentAdmin,
  AppointmentTransitionError,
} from '@/lib/services/appointment-server';
import type { Appointment } from '@/lib/types';

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeDb(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeDoc[]> = {};
  for (const k of Object.keys(initial)) collections[k] = initial[k].map((d) => ({ ...d, data: { ...d.data } }));

  return {
    collection(name: string) {
      const docs = (collections[name] ??= []);
      return {
        doc(id: string) {
          return {
            id,
            async get() {
              const found = docs.find((d) => d.id === id);
              return { exists: !!found, id, data: () => (found ? { ...found.data } : undefined) };
            },
            async update(patch: Record<string, unknown>) {
              const found = docs.find((d) => d.id === id);
              if (!found) throw new Error(`update on non-existing doc ${name}/${id}`);
              found.data = { ...found.data, ...patch };
            },
          };
        },
      };
    },
    collections,
  };
}

const businessId = 'biz-1';

function apt(over: Partial<Appointment> = {}): Record<string, unknown> {
  return {
    id: 'appt-1',
    businessId,
    clientId: 'c1',
    clientName: 'Maria',
    serviceId: 's1',
    serviceName: 'Limpeza',
    professionalId: 'p1',
    date: '2026-05-22',
    startTime: '09:00',
    endTime: '10:00',
    duration: 60,
    status: 'confirmado',
    price: 150,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...over,
  };
}

const actor = { id: 'user-1', name: 'Recepção' };

describe('transitionAppointmentAdmin', () => {
  beforeEach(() => {
    dispatchDomainEventMock.mockClear();
  });

  it('confirmado → em_andamento: aplica o patch e NÃO despacha nenhum evento', async () => {
    const env = makeFakeDb({ appointments: [{ id: 'appt-1', data: apt({ status: 'confirmado' }) }] });
    const result = await transitionAppointmentAdmin({
      db: env as never, appointmentId: 'appt-1', businessId, targetStatus: 'em_andamento', actor,
    });
    expect(result.appointment.status).toBe('em_andamento');
    expect(result.dispatched).toBe(false);
    expect(dispatchDomainEventMock).not.toHaveBeenCalled();
  });

  it('confirmado → concluido: despacha appointment.completed com os campos certos', async () => {
    const env = makeFakeDb({ appointments: [{ id: 'appt-1', data: apt({ status: 'confirmado' }) }] });
    const result = await transitionAppointmentAdmin({
      db: env as never, appointmentId: 'appt-1', businessId, targetStatus: 'concluido', actor,
    });
    expect(result.appointment.status).toBe('concluido');
    expect(result.dispatched).toBe(true);
    expect(dispatchDomainEventMock).toHaveBeenCalledTimes(1);
    const [, event] = dispatchDomainEventMock.mock.calls[0];
    expect(event).toMatchObject({
      type: 'appointment.completed',
      businessId,
      appointmentId: 'appt-1',
      clientId: 'c1',
      professionalId: 'p1',
      serviceId: 's1',
      amount: 150,
      actorType: 'user',
      actorId: 'user-1',
      actorName: 'Recepção',
    });
  });

  it('concluido → cancelado: despacha appointment.canceled (reversão)', async () => {
    const env = makeFakeDb({ appointments: [{ id: 'appt-1', data: apt({ status: 'concluido', completionAppliedAt: '2026-05-02T00:00:00.000Z' }) }] });
    const result = await transitionAppointmentAdmin({
      db: env as never, appointmentId: 'appt-1', businessId, targetStatus: 'cancelado', actor,
    });
    expect(result.appointment.status).toBe('cancelado');
    expect(result.dispatched).toBe(true);
    const [, event] = dispatchDomainEventMock.mock.calls[0];
    expect(event).toMatchObject({ type: 'appointment.canceled', businessId, appointmentId: 'appt-1' });
  });

  it('cancelado grava cancelledAt/cancelledBy/cancelledByName', async () => {
    const env = makeFakeDb({ appointments: [{ id: 'appt-1', data: apt({ status: 'agendado' }) }] });
    await transitionAppointmentAdmin({
      db: env as never, appointmentId: 'appt-1', businessId, targetStatus: 'cancelado', actor,
    });
    const stored = env.collections.appointments.find((d) => d.id === 'appt-1')!.data;
    expect(stored.cancelledAt).toBeTruthy();
    expect(stored.cancelledBy).toBe('user-1');
    expect(stored.cancelledByName).toBe('Recepção');
  });

  it('transição inválida rejeita com erro FSM e não escreve nada', async () => {
    const env = makeFakeDb({ appointments: [{ id: 'appt-1', data: apt({ status: 'agendado' }) }] });
    await expect(
      transitionAppointmentAdmin({ db: env as never, appointmentId: 'appt-1', businessId, targetStatus: 'concluido', actor }),
    ).rejects.toThrow(/Appointment FSM:/);
    const stored = env.collections.appointments.find((d) => d.id === 'appt-1')!.data;
    expect(stored.status).toBe('agendado');
    expect(dispatchDomainEventMock).not.toHaveBeenCalled();
  });

  it('no-op quando targetStatus já é o status atual — sem FSM, sem dispatch', async () => {
    const env = makeFakeDb({ appointments: [{ id: 'appt-1', data: apt({ status: 'confirmado' }) }] });
    const result = await transitionAppointmentAdmin({
      db: env as never, appointmentId: 'appt-1', businessId, targetStatus: 'confirmado', actor,
    });
    expect(result.appointment.status).toBe('confirmado');
    expect(dispatchDomainEventMock).not.toHaveBeenCalled();
  });

  it('agendamento de outro tenant rejeita com TENANT_MISMATCH', async () => {
    const env = makeFakeDb({ appointments: [{ id: 'appt-1', data: apt({ businessId: 'other-biz' }) }] });
    await expect(
      transitionAppointmentAdmin({ db: env as never, appointmentId: 'appt-1', businessId, targetStatus: 'concluido', actor }),
    ).rejects.toThrow(AppointmentTransitionError);
    expect(dispatchDomainEventMock).not.toHaveBeenCalled();
  });

  it('agendamento inexistente rejeita com APPOINTMENT_NOT_FOUND', async () => {
    const env = makeFakeDb({ appointments: [] });
    await expect(
      transitionAppointmentAdmin({ db: env as never, appointmentId: 'ghost', businessId, targetStatus: 'concluido', actor }),
    ).rejects.toThrow(AppointmentTransitionError);
  });
});
