import { describe, it, expect, beforeEach, vi } from 'vitest';

// Admin SDK helper recebe `adminDb` por argumento, entao podemos injetar
// um fake direto sem precisar mockar o modulo firebase-admin/firestore.
// Pattern igual ao tests/services/dataRetention.test.ts.

import {
  createAppointmentSafeAdmin,
  updateAppointmentSafeAdmin,
  AppointmentConflictError,
} from '@/lib/services/appointmentTxGuardAdmin';
import type { Appointment } from '@/lib/types';

type FakeDoc = { id: string; data: Record<string, unknown> };

interface FakeCollectionState {
  docs: FakeDoc[];
}

function makeFakeAdminDb(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeCollectionState> = {};
  for (const k of Object.keys(initial)) collections[k] = { docs: [...initial[k]] };

  const ensure = (name: string) => {
    if (!collections[name]) collections[name] = { docs: [] };
    return collections[name];
  };

  function makeQuery(name: string, filters: Array<[string, string, unknown]>) {
    return {
      where(field: string, op: string, val: unknown) {
        return makeQuery(name, [...filters, [field, op, val]]);
      },
      async get() {
        const state = ensure(name);
        const docs = state.docs.filter(d => {
          for (const [f, , v] of filters) {
            if (d.data[f] !== v) return false;
          }
          return true;
        });
        return {
          size: docs.length,
          empty: docs.length === 0,
          docs: docs.map(d => ({
            id: d.id,
            data: () => d.data,
            ref: { id: d.id, _coll: name },
          })),
        };
      },
    };
  }

  const fake = {
    collection(name: string) {
      return {
        ...makeQuery(name, []),
        doc(id?: string) {
          const docId = id ?? `auto-${Math.random().toString(36).slice(2, 9)}`;
          return {
            id: docId,
            async set(data: Record<string, unknown>) {
              const state = ensure(name);
              const existing = state.docs.findIndex(d => d.id === docId);
              if (existing >= 0) state.docs[existing].data = data;
              else state.docs.push({ id: docId, data });
            },
            async update(patch: Record<string, unknown>) {
              const state = ensure(name);
              const found = state.docs.find(d => d.id === docId);
              if (!found) throw new Error(`update on non-existing doc ${name}/${docId}`);
              found.data = { ...found.data, ...patch };
            },
            async get() {
              const state = ensure(name);
              const found = state.docs.find(d => d.id === docId);
              return {
                exists: !!found,
                data: () => (found?.data ?? undefined),
                id: docId,
              };
            },
          };
        },
      };
    },
    async runTransaction(cb: (tx: unknown) => Promise<void>) {
      // Fake tx: tx.get aceita doc ref OU query, tx.set/update operam direto.
      // Sem optimistic locking — testes de race sao validados no helper client.
      const tx = {
        async get(refOrQuery: unknown) {
          if (refOrQuery && typeof refOrQuery === 'object' && 'get' in refOrQuery) {
            return (refOrQuery as { get: () => Promise<unknown> }).get();
          }
          return refOrQuery;
        },
        set(ref: { id: string }, data: Record<string, unknown>) {
          // Reusa o ref retornado por collection().doc() que tem .set
          return (ref as unknown as { set: (d: Record<string, unknown>) => Promise<void> }).set(data);
        },
        update(ref: { id: string }, patch: Record<string, unknown>) {
          return (ref as unknown as { update: (p: Record<string, unknown>) => Promise<void> }).update(patch);
        },
      };
      await cb(tx);
    },
  };

  return { fake, collections };
}

const businessId = 'biz-1';

const apt = (over: Partial<Appointment>): Appointment => ({
  id: 'a1',
  businessId,
  clientId: 'c1',
  clientName: 'Maria',
  serviceId: 's1',
  serviceName: 'Corte',
  professionalId: 'p1',
  date: '2026-05-22',
  startTime: '09:00',
  endTime: '10:00',
  duration: 60,
  status: 'agendado',
  price: 100,
  createdAt: '',
  updatedAt: '',
  ...over,
} as Appointment);

describe('createAppointmentSafeAdmin', () => {
  let env: ReturnType<typeof makeFakeAdminDb>;

  beforeEach(() => {
    env = makeFakeAdminDb({
      users: [
        { id: 'p1', data: { id: 'p1', name: 'Joao', businessId, role: 'operator', isActive: true } },
      ],
      appointments: [],
    });
  });

  it('cria appointment sem conflito', async () => {
    const id = await createAppointmentSafeAdmin(env.fake as never, {
      businessId,
      professionalId: 'p1',
      date: '2026-05-22',
      startTime: '09:00',
      endTime: '10:00',
      clientName: 'Maria',
    });
    expect(typeof id).toBe('string');
    expect(env.collections.appointments.docs.length).toBe(1);
    expect(env.collections.appointments.docs[0].data.clientName).toBe('Maria');
  });

  it('rejeita overlap exato com AppointmentConflictError', async () => {
    env.collections.appointments.docs.push({
      id: 'a-old',
      data: apt({ id: 'a-old', startTime: '09:00', endTime: '10:00' }) as unknown as Record<string, unknown>,
    });
    await expect(
      createAppointmentSafeAdmin(env.fake as never, {
        businessId,
        professionalId: 'p1',
        date: '2026-05-22',
        startTime: '09:00',
        endTime: '10:00',
      }),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    // N adicionou novo doc
    expect(env.collections.appointments.docs.length).toBe(1);
  });

  it('rejeita overlap parcial (09:30-10:30 vs 10:00-11:00)', async () => {
    env.collections.appointments.docs.push({
      id: 'a-old',
      data: apt({ id: 'a-old', startTime: '09:30', endTime: '10:30' }) as unknown as Record<string, unknown>,
    });
    await expect(
      createAppointmentSafeAdmin(env.fake as never, {
        businessId,
        professionalId: 'p1',
        date: '2026-05-22',
        startTime: '10:00',
        endTime: '11:00',
      }),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
  });

  it('ignora cancelados', async () => {
    env.collections.appointments.docs.push({
      id: 'a-canc',
      data: apt({ id: 'a-canc', status: 'cancelado', startTime: '09:00', endTime: '10:00' }) as unknown as Record<string, unknown>,
    });
    const id = await createAppointmentSafeAdmin(env.fake as never, {
      businessId,
      professionalId: 'p1',
      date: '2026-05-22',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(typeof id).toBe('string');
  });

  it('isola por tenant — apt de outro businessId n bloqueia', async () => {
    env.collections.appointments.docs.push({
      id: 'a-other',
      data: apt({ id: 'a-other', businessId: 'other-biz' }) as unknown as Record<string, unknown>,
    });
    const id = await createAppointmentSafeAdmin(env.fake as never, {
      businessId,
      professionalId: 'p1',
      date: '2026-05-22',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(typeof id).toBe('string');
  });

  it('sem professionalId — pula tx, write direto', async () => {
    const id = await createAppointmentSafeAdmin(env.fake as never, {
      businessId,
      date: '2026-05-22',
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(typeof id).toBe('string');
    expect(env.collections.appointments.docs.length).toBe(1);
  });

  it('rejeita businessId vazio (R1)', async () => {
    await expect(
      createAppointmentSafeAdmin(env.fake as never, {
        businessId: '',
        professionalId: 'p1',
        date: '2026-05-22',
        startTime: '09:00',
        endTime: '10:00',
      }),
    ).rejects.toThrow(/businessId obrigatorio/);
  });

  it('TURMA: colega de mesma turma (mesmo sessionKey) NAO bloqueia', async () => {
    const key = 'svc1_2026-05-22_09:00_p1';
    env.collections.appointments.docs.push({
      id: 'm1',
      data: apt({ id: 'm1', startTime: '09:00', endTime: '10:00', sessionKey: key, isGroupSession: true }) as unknown as Record<string, unknown>,
    });
    const id = await createAppointmentSafeAdmin(env.fake as never, {
      businessId,
      professionalId: 'p1',
      date: '2026-05-22',
      startTime: '09:00',
      endTime: '10:00',
      sessionKey: key, // mesmo sessionKey -> colega, sem conflito
    });
    expect(typeof id).toBe('string');
    expect(env.collections.appointments.docs.length).toBe(2);
  });

  it('TURMA: appointment de OUTRO sessionKey sobreposto BLOQUEIA (prof dando aula)', async () => {
    env.collections.appointments.docs.push({
      id: 'aula',
      data: apt({ id: 'aula', startTime: '09:00', endTime: '10:00', sessionKey: 'svc1_2026-05-22_09:00_p1', isGroupSession: true }) as unknown as Record<string, unknown>,
    });
    // 1:1 sem sessionKey tentando o mesmo horario do prof -> bloqueia.
    await expect(
      createAppointmentSafeAdmin(env.fake as never, {
        businessId,
        professionalId: 'p1',
        date: '2026-05-22',
        startTime: '09:30',
        endTime: '10:30',
      }),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
  });
});

describe('updateAppointmentSafeAdmin', () => {
  let env: ReturnType<typeof makeFakeAdminDb>;

  beforeEach(() => {
    env = makeFakeAdminDb({
      users: [
        { id: 'p1', data: { id: 'p1', name: 'Joao', businessId, role: 'operator', isActive: true } },
      ],
      appointments: [
        {
          id: 'apt-1',
          data: apt({ id: 'apt-1', professionalId: 'p1', date: '2026-05-22', startTime: '09:00', endTime: '10:00' }) as unknown as Record<string, unknown>,
        },
      ],
    });
  });

  it('atualiza sem conflito (proprio doc excluido)', async () => {
    await updateAppointmentSafeAdmin(env.fake as never, 'apt-1', {
      businessId,
      clientName: 'Maria Atualizada',
    });
    const updated = env.collections.appointments.docs.find(d => d.id === 'apt-1');
    expect(updated?.data.clientName).toBe('Maria Atualizada');
  });

  it('rejeita quando muda horario pra slot ocupado por outro apt', async () => {
    env.collections.appointments.docs.push({
      id: 'apt-2',
      data: apt({ id: 'apt-2', professionalId: 'p1', date: '2026-05-22', startTime: '11:00', endTime: '12:00' }) as unknown as Record<string, unknown>,
    });
    await expect(
      updateAppointmentSafeAdmin(env.fake as never, 'apt-1', {
        businessId,
        startTime: '11:00',
        endTime: '12:00',
      }),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    // apt-1 n foi modificado
    const apt1 = env.collections.appointments.docs.find(d => d.id === 'apt-1');
    expect(apt1?.data.startTime).toBe('09:00');
  });

  it('herda campos do doc existente quando patch e parcial', async () => {
    // Patch so com clientName — date/startTime/professionalId herdados.
    // N deve dar conflito (re-check usa o slot original, que e o proprio doc).
    await updateAppointmentSafeAdmin(env.fake as never, 'apt-1', {
      businessId,
      clientName: 'Patch parcial',
    });
    const updated = env.collections.appointments.docs.find(d => d.id === 'apt-1');
    expect(updated?.data.clientName).toBe('Patch parcial');
    expect(updated?.data.date).toBe('2026-05-22'); // preservou
  });

  it('rejeita appointment de outro businessId (R1)', async () => {
    env.collections.appointments.docs.push({
      id: 'apt-other',
      data: apt({ id: 'apt-other', businessId: 'other-biz' }) as unknown as Record<string, unknown>,
    });
    await expect(
      updateAppointmentSafeAdmin(env.fake as never, 'apt-other', {
        businessId, // tentando passar pelo dono errado
        clientName: 'Hack',
      }),
    ).rejects.toThrow(/belongs to other business/);
  });

  it('rejeita appointmentId inexistente', async () => {
    await expect(
      updateAppointmentSafeAdmin(env.fake as never, 'apt-ghost', {
        businessId,
        clientName: 'X',
      }),
    ).rejects.toThrow(/not found/);
  });
});
