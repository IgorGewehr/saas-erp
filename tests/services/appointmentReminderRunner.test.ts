import { describe, it, expect, beforeEach, vi } from 'vitest';

// Fake Admin SDK — mesmo formato de tests/services/appointmentTxGuardAdmin.test.ts
// (query .where() encadeável + doc().get()/.set() + runTransaction simplificada).

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeAdminDb(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeDoc[]> = {};
  for (const k of Object.keys(initial)) collections[k] = initial[k].map((d) => ({ ...d, data: { ...d.data } }));

  function matchesFilter(actual: unknown, op: string, expected: unknown): boolean {
    if (op === 'in') return Array.isArray(expected) && expected.includes(actual);
    return actual === expected;
  }

  function makeQuery(name: string, filters: Array<[string, string, unknown]>) {
    return {
      where(field: string, op: string, val: unknown) {
        return makeQuery(name, [...filters, [field, op, val]]);
      },
      async get() {
        const docs = (collections[name] ?? []).filter((d) => filters.every(([f, op, v]) => matchesFilter(d.data[f], op, v)));
        return { size: docs.length, docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
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
            async get() {
              const found = (collections[name] ?? []).find((d) => d.id === docId);
              return { exists: !!found, id: docId, data: () => found?.data };
            },
            set(data: Record<string, unknown>) {
              const list = (collections[name] ??= []);
              const idx = list.findIndex((d) => d.id === docId);
              if (idx >= 0) list[idx].data = data;
              else list.push({ id: docId, data });
            },
          };
        },
      };
    },
    async runTransaction(cb: (tx: unknown) => Promise<unknown>) {
      const tx = {
        async get(ref: { get: () => Promise<unknown> }) { return ref.get(); },
        set(ref: { set: (d: Record<string, unknown>) => void }, data: Record<string, unknown>) { ref.set(data); },
      };
      return cb(tx);
    },
    collections,
  };
  return fake;
}

const fakeDbHolder: { current: ReturnType<typeof makeFakeAdminDb> } = { current: makeFakeAdminDb() };
vi.mock('@/lib/config/firebaseAdmin', () => ({
  get adminDb() { return fakeDbHolder.current; },
}));

import { runAppointmentReminders } from '@/lib/services/appointmentReminderRunner';
import type { Appointment } from '@/lib/types';

function apt(over: Partial<Appointment> = {}): Record<string, unknown> {
  return {
    id: 'appt-1',
    businessId: 'biz-1',
    clientId: 'c1',
    clientName: 'Maria',
    serviceId: 's1',
    serviceName: 'Limpeza',
    professionalId: 'p1',
    professionalIds: ['p1'],
    professionalNames: ['Dr. Joao'],
    date: '2026-09-10',
    startTime: '10:00',
    endTime: '11:00',
    duration: 60,
    status: 'confirmado',
    price: 200,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('runAppointmentReminders — fuso por negócio (M06.5)', () => {
  beforeEach(() => {
    fakeDbHolder.current = makeFakeAdminDb();
  });

  it('sem timezone configurado no negócio, usa America/Sao_Paulo (comportamento de antes)', async () => {
    // Appointment às 10:00 BR (13:00 UTC) — "now" 30 min antes, em UTC real.
    fakeDbHolder.current = makeFakeAdminDb({
      appointments: [{ id: 'appt-1', data: apt({ startTime: '10:00' }) }],
      businesses: [{ id: 'biz-1', data: { settings: {} } }],
    });
    const now = new Date('2026-09-10T12:30:00.000Z'); // 13:00 UTC - 30min
    const summary = await runAppointmentReminders(now);
    expect(summary.remindersFired).toBe(1);
    expect(summary.notificationsCreated).toBe(1);
  });

  it('com timezone diferente configurado, calcula a janela certa (prova que o fuso é respeitado)', async () => {
    // Tokyo (UTC+9). Appointment 10:00 Tóquio = 01:00 UTC. "now" 30min antes = 00:30 UTC.
    // Se o fuso fosse ignorado (tratado como BR/UTC-3), isso NÃO cairia na janela de 30min.
    fakeDbHolder.current = makeFakeAdminDb({
      appointments: [{ id: 'appt-tokyo', data: apt({ id: 'appt-tokyo', businessId: 'biz-tokyo', startTime: '10:00', date: '2026-09-10' }) }],
      businesses: [{ id: 'biz-tokyo', data: { settings: { timezone: 'Asia/Tokyo' } } }],
    });
    const now = new Date('2026-09-10T00:30:00.000Z');
    const summary = await runAppointmentReminders(now);
    expect(summary.remindersFired).toBe(1);
    expect(summary.notificationsCreated).toBe(1);
  });

  it('timezone inválido num negócio não derruba o cron pros demais', async () => {
    fakeDbHolder.current = makeFakeAdminDb({
      appointments: [
        { id: 'appt-bad', data: apt({ id: 'appt-bad', businessId: 'biz-bad', startTime: '10:00' }) },
        { id: 'appt-ok', data: apt({ id: 'appt-ok', businessId: 'biz-1', startTime: '10:00' }) },
      ],
      businesses: [
        { id: 'biz-bad', data: { settings: { timezone: 'Nao/Existe' } } },
        { id: 'biz-1', data: { settings: {} } },
      ],
    });
    const now = new Date('2026-09-10T12:30:00.000Z'); // 30min antes de 10:00 BR
    const summary = await runAppointmentReminders(now);
    // appt-bad é pulado (fuso inválido), appt-ok ainda dispara normalmente.
    expect(summary.remindersFired).toBe(1);
    expect(summary.notificationsCreated).toBe(1);
  });

  it('ignora appointment fora de qualquer janela (60/30min ±5)', async () => {
    fakeDbHolder.current = makeFakeAdminDb({
      appointments: [{ id: 'appt-1', data: apt({ startTime: '10:00' }) }],
      businesses: [{ id: 'biz-1', data: { settings: {} } }],
    });
    const now = new Date('2026-09-10T10:00:00.000Z'); // 3h antes de 13:00 UTC (10:00 BR)
    const summary = await runAppointmentReminders(now);
    expect(summary.remindersFired).toBe(0);
  });

  it('ignora appointment cancelado/concluido/nao_compareceu', async () => {
    fakeDbHolder.current = makeFakeAdminDb({
      appointments: [{ id: 'appt-1', data: apt({ startTime: '10:00', status: 'cancelado' }) }],
      businesses: [{ id: 'biz-1', data: { settings: {} } }],
    });
    const now = new Date('2026-09-10T12:30:00.000Z');
    const summary = await runAppointmentReminders(now);
    expect(summary.remindersFired).toBe(0);
  });
});
