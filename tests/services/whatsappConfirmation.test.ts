import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Appointment } from '@/lib/types';

const transitionAppointmentAdminMock = vi.fn().mockResolvedValue({ appointment: {}, dispatched: false });
vi.mock('@/lib/services/appointment-server', () => ({
  transitionAppointmentAdmin: (...args: unknown[]) => transitionAppointmentAdminMock(...args),
}));

import { pickAutoConfirmCandidate, tryAutoConfirmFromWhatsAppReply } from '@/lib/services/agenda/whatsappConfirmation';

const businessId = 'biz-1';

function apt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    businessId,
    clientId: 'c1',
    clientName: 'Maria',
    clientPhone: '11987654321',
    serviceId: 's1',
    serviceName: 'Limpeza',
    date: '2026-09-10',
    startTime: '09:00',
    endTime: '10:00',
    duration: 60,
    status: 'agendado',
    price: 200,
    confirmationRequestedAt: '2026-09-09T12:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as Appointment;
}

describe('pickAutoConfirmCandidate (função pura)', () => {
  const today = '2026-09-10';

  it('confirma quando há exatamente um candidato', () => {
    const result = pickAutoConfirmCandidate([apt()], '5511987654321', today);
    expect(result?.id).toBe('appt-1');
  });

  it('telefone com formato diferente ainda bate (via brPhonesMatch)', () => {
    const result = pickAutoConfirmCandidate(
      [apt({ clientPhone: '(11) 98765-4321' })],
      '+55 11 98765-4321',
      today,
    );
    expect(result?.id).toBe('appt-1');
  });

  it('não age quando não há candidatos', () => {
    expect(pickAutoConfirmCandidate([], '5511987654321', today)).toBeNull();
  });

  it('não age quando há 2+ candidatos ambíguos', () => {
    const result = pickAutoConfirmCandidate(
      [apt({ id: 'a1' }), apt({ id: 'a2', startTime: '11:00', endTime: '12:00' })],
      '5511987654321',
      today,
    );
    expect(result).toBeNull();
  });

  it('ignora agendamento que já está confirmado (não conta pra ambiguidade)', () => {
    const result = pickAutoConfirmCandidate(
      [apt({ id: 'a1', status: 'confirmado' }), apt({ id: 'a2', startTime: '11:00', endTime: '12:00' })],
      '5511987654321',
      today,
    );
    expect(result?.id).toBe('a2');
  });

  it('ignora agendamento sem confirmationRequestedAt (nunca perguntamos)', () => {
    const result = pickAutoConfirmCandidate(
      [apt({ confirmationRequestedAt: undefined })],
      '5511987654321',
      today,
    );
    expect(result).toBeNull();
  });

  it('ignora agendamento de data passada', () => {
    const result = pickAutoConfirmCandidate(
      [apt({ date: '2026-09-01' })],
      '5511987654321',
      today,
    );
    expect(result).toBeNull();
  });

  it('ignora agendamento de telefone diferente', () => {
    const result = pickAutoConfirmCandidate(
      [apt({ clientPhone: '11900000000' })],
      '5511987654321',
      today,
    );
    expect(result).toBeNull();
  });

  it('ignora agendamento cancelado/nao_compareceu', () => {
    const result = pickAutoConfirmCandidate(
      [apt({ status: 'cancelado' })],
      '5511987654321',
      today,
    );
    expect(result).toBeNull();
  });
});

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeAdminDb(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeDoc[]> = {};
  for (const k of Object.keys(initial)) collections[k] = initial[k].map((d) => ({ ...d, data: { ...d.data } }));

  function matchesFilter(actual: unknown, op: string, expected: unknown): boolean {
    if (op === '<=') return (actual as string) <= (expected as string);
    if (op === '>=') return (actual as string) >= (expected as string);
    return actual === expected;
  }

  function makeQuery(name: string, filters: Array<[string, string, unknown]>) {
    return {
      where(field: string, op: string, val: unknown) {
        return makeQuery(name, [...filters, [field, op, val]]);
      },
      async get() {
        const docs = (collections[name] ?? []).filter((d) => filters.every(([f, op, v]) => matchesFilter(d.data[f], op, v)));
        return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
      },
    };
  }

  return {
    collection(name: string) {
      return {
        ...makeQuery(name, []),
        doc(id: string) {
          return {
            async update(patch: Record<string, unknown>) {
              const found = (collections[name] ?? []).find((d) => d.id === id);
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

describe('tryAutoConfirmFromWhatsAppReply (shell)', () => {
  const now = new Date('2026-09-10T08:00:00.000Z');

  beforeEach(() => {
    transitionAppointmentAdminMock.mockClear();
  });

  it('não faz nada quando a mensagem não é uma keyword de confirmação', async () => {
    const db = makeFakeAdminDb({ appointments: [{ id: 'appt-1', data: apt() as unknown as Record<string, unknown> }] });
    const result = await tryAutoConfirmFromWhatsAppReply({
      db: db as never, businessId, phone: '5511987654321', messageText: 'oi tudo bem?', now,
    });
    expect(result.confirmed).toBe(false);
    expect(transitionAppointmentAdminMock).not.toHaveBeenCalled();
  });

  it('confirma o único candidato e grava confirmedVia', async () => {
    const db = makeFakeAdminDb({ appointments: [{ id: 'appt-1', data: apt() as unknown as Record<string, unknown> }] });
    const result = await tryAutoConfirmFromWhatsAppReply({
      db: db as never, businessId, phone: '5511987654321', messageText: 'confirmo', now,
    });
    expect(result).toEqual({ confirmed: true, appointmentId: 'appt-1' });
    expect(transitionAppointmentAdminMock).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt-1', businessId, targetStatus: 'confirmado',
    }));
    const stored = db.collections.appointments.find((d) => d.id === 'appt-1')!.data;
    expect(stored.confirmedVia).toBe('whatsapp-auto');
  });

  it('não age quando há 2+ candidatos ambíguos (não chama transitionAppointmentAdmin)', async () => {
    const db = makeFakeAdminDb({
      appointments: [
        { id: 'a1', data: apt({ id: 'a1' }) as unknown as Record<string, unknown> },
        { id: 'a2', data: apt({ id: 'a2', startTime: '11:00', endTime: '12:00' }) as unknown as Record<string, unknown> },
      ],
    });
    const result = await tryAutoConfirmFromWhatsAppReply({
      db: db as never, businessId, phone: '5511987654321', messageText: 'sim', now,
    });
    expect(result.confirmed).toBe(false);
    expect(transitionAppointmentAdminMock).not.toHaveBeenCalled();
  });

  it('nunca lança — erro interno vira {confirmed:false}', async () => {
    const brokenDb = { collection: () => { throw new Error('boom'); } };
    const result = await tryAutoConfirmFromWhatsAppReply({
      db: brokenDb as never, businessId, phone: '5511987654321', messageText: 'confirmo', now,
    });
    expect(result.confirmed).toBe(false);
  });
});
