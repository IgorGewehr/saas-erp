import { describe, expect, it, beforeEach } from 'vitest';
import {
  createScheduleBlockAdmin,
  cancelScheduleBlockAdmin,
  ScheduleBlockError,
} from '@/lib/services/scheduleBlock-admin';

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeAdminDb(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeDoc[]> = {};
  for (const k of Object.keys(initial)) collections[k] = initial[k].map((d) => ({ ...d, data: { ...d.data } }));

  function matchesFilter(actual: unknown, op: string, expected: unknown): boolean {
    if (op === '>=') return (actual as string) >= (expected as string);
    if (op === '<=') return (actual as string) <= (expected as string);
    return actual === expected;
  }

  function makeQuery(name: string, filters: Array<[string, string, unknown]>) {
    return {
      where(field: string, op: string, val: unknown) {
        return makeQuery(name, [...filters, [field, op, val]]);
      },
      async get() {
        const docs = (collections[name] ??= []).filter((d) =>
          filters.every(([f, op, v]) => matchesFilter(d.data[f], op, v)));
        return { docs: docs.map((d) => ({ id: d.id, data: () => ({ ...d.data }) })) };
      },
    };
  }

  let autoId = 0;
  return {
    collection(name: string) {
      return {
        ...makeQuery(name, []),
        doc(id?: string) {
          const docId = id ?? `auto-${++autoId}`;
          return {
            id: docId,
            async set(data: Record<string, unknown>) {
              const list = (collections[name] ??= []);
              const idx = list.findIndex((d) => d.id === docId);
              if (idx >= 0) list[idx].data = data;
              else list.push({ id: docId, data });
            },
            async update(patch: Record<string, unknown>) {
              const list = (collections[name] ??= []);
              const found = list.find((d) => d.id === docId);
              if (!found) throw new Error(`update on non-existing doc ${name}/${docId}`);
              found.data = { ...found.data, ...patch };
            },
            async get() {
              const found = (collections[name] ?? []).find((d) => d.id === docId);
              return { exists: !!found, id: docId, data: () => (found ? { ...found.data } : undefined) };
            },
          };
        },
      };
    },
    collections,
  };
}

const businessId = 'biz-1';
const actor = { id: 'admin-1', name: 'Admin' };

describe('createScheduleBlockAdmin', () => {
  let env: ReturnType<typeof makeFakeAdminDb>;

  beforeEach(() => {
    env = makeFakeAdminDb({ appointments: [] });
  });

  it('cria bloqueio do negócio inteiro (professionalId null)', async () => {
    const { block, conflictingAppointments } = await createScheduleBlockAdmin({
      db: env as never, businessId,
      input: { startDate: '2026-09-07', endDate: '2026-09-07' },
      actor,
    });
    expect(block.professionalId).toBeNull();
    expect(block.status).toBe('ativo');
    expect(conflictingAppointments).toEqual([]);
  });

  it('cria bloqueio de um profissional com nome denormalizado', async () => {
    const { block } = await createScheduleBlockAdmin({
      db: env as never, businessId,
      input: { professionalId: 'p1', startDate: '2026-09-10', endDate: '2026-09-20', reason: 'Férias' },
      professionalName: 'Dr. Silva',
      actor,
    });
    expect(block.professionalId).toBe('p1');
    expect(block.professionalName).toBe('Dr. Silva');
    expect(block.reason).toBe('Férias');
  });

  it('retorna agendamentos existentes que caem no intervalo/profissional bloqueado, sem cancelá-los', async () => {
    env.collections.appointments = [
      { id: 'a1', data: { businessId, professionalId: 'p1', date: '2026-09-15', startTime: '09:00', endTime: '10:00', status: 'agendado', clientName: 'Maria' } },
      { id: 'a2', data: { businessId, professionalId: 'p2', date: '2026-09-15', startTime: '09:00', endTime: '10:00', status: 'agendado', clientName: 'Outro Prof' } },
      { id: 'a3', data: { businessId, professionalId: 'p1', date: '2026-09-15', startTime: '09:00', endTime: '10:00', status: 'cancelado', clientName: 'Cancelado' } },
      { id: 'a4', data: { businessId, professionalId: 'p1', date: '2026-10-01', startTime: '09:00', endTime: '10:00', status: 'agendado', clientName: 'Fora do intervalo' } },
    ];
    const { conflictingAppointments } = await createScheduleBlockAdmin({
      db: env as never, businessId,
      input: { professionalId: 'p1', startDate: '2026-09-10', endDate: '2026-09-20' },
      actor,
    });
    expect(conflictingAppointments.map((a) => a.id)).toEqual(['a1']);
    // Não cancela nada — só avisa.
    const stored = env.collections.appointments.find((d) => d.id === 'a1')!.data;
    expect(stored.status).toBe('agendado');
  });

  it('bloqueio com janela de horário só conta overlap real de horário', async () => {
    env.collections.appointments = [
      { id: 'a1', data: { businessId, professionalId: 'p1', date: '2026-09-15', startTime: '09:00', endTime: '10:00', status: 'agendado', clientName: 'Manhã' } },
      { id: 'a2', data: { businessId, professionalId: 'p1', date: '2026-09-15', startTime: '12:30', endTime: '13:30', status: 'agendado', clientName: 'Almoço' } },
    ];
    const { conflictingAppointments } = await createScheduleBlockAdmin({
      db: env as never, businessId,
      input: { professionalId: 'p1', startDate: '2026-09-15', endDate: '2026-09-15', startTime: '12:00', endTime: '13:00' },
      actor,
    });
    expect(conflictingAppointments.map((a) => a.id)).toEqual(['a2']);
  });
});

describe('cancelScheduleBlockAdmin', () => {
  let env: ReturnType<typeof makeFakeAdminDb>;

  beforeEach(() => {
    env = makeFakeAdminDb({
      scheduleBlocks: [
        { id: 'block-1', data: { businessId, professionalId: 'p1', startDate: '2026-09-10', endDate: '2026-09-20', status: 'ativo', createdBy: 'a', createdByName: 'a', createdAt: '', updatedAt: '' } },
        { id: 'block-cancelled', data: { businessId, professionalId: 'p1', startDate: '2026-09-10', endDate: '2026-09-20', status: 'cancelado', createdBy: 'a', createdByName: 'a', createdAt: '', updatedAt: '' } },
        { id: 'block-other-biz', data: { businessId: 'other-biz', startDate: '2026-09-10', endDate: '2026-09-20', status: 'ativo', createdBy: 'a', createdByName: 'a', createdAt: '', updatedAt: '' } },
      ],
    });
  });

  it('cancela um bloqueio ativo e grava os campos de auditoria', async () => {
    const { block } = await cancelScheduleBlockAdmin({ db: env as never, blockId: 'block-1', businessId, actor });
    expect(block.status).toBe('cancelado');
    expect(block.cancelledBy).toBe('admin-1');
    expect(block.cancelledByName).toBe('Admin');
    expect(block.cancelledAt).toBeTruthy();
  });

  it('rejeita cancelar um bloqueio já cancelado (FSM)', async () => {
    await expect(
      cancelScheduleBlockAdmin({ db: env as never, blockId: 'block-cancelled', businessId, actor }),
    ).rejects.toThrow(/ScheduleBlock FSM/);
  });

  it('rejeita bloqueio de outro tenant', async () => {
    await expect(
      cancelScheduleBlockAdmin({ db: env as never, blockId: 'block-other-biz', businessId, actor }),
    ).rejects.toBeInstanceOf(ScheduleBlockError);
  });

  it('rejeita bloqueio inexistente', async () => {
    await expect(
      cancelScheduleBlockAdmin({ db: env as never, blockId: 'ghost', businessId, actor }),
    ).rejects.toBeInstanceOf(ScheduleBlockError);
  });
});
