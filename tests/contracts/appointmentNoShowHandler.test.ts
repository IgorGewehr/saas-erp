import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { handleAppointmentNoShow } from '@/contracts/_runtime/handlers/appointmentNoShow';
import type { DomainEventOf } from '@/contracts/events';

// Mesmo padrão de fake-Firestore de tests/contracts/appointmentCompletionHandlers.test.ts,
// mas com mergeWithIncrement/getPath dot-path-aware — necessário aqui porque
// bumpClientNoShowCountAdmin grava em 'relationshipHistory.noShowCount' (chave
// dot-path, não objeto aninhado, pra não substituir o mapa inteiro em produção).
// O arquivo original nunca precisou disso (seus efeitos são campos flat) —
// corrigido só nesta cópia, não no original.

interface FakeSnapshot {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

interface FakeRef {
  id: string;
  _coll: string;
  get: () => Promise<FakeSnapshot>;
  update: (data: Record<string, unknown>) => Promise<void>;
}

interface FakeCollection {
  doc: (id?: string) => FakeRef;
}

function clone<T>(value: T): T { return structuredClone(value); }

function isIncrement(value: unknown): value is { operand: number } {
  return typeof value === 'object' && value !== null && value.constructor?.name === 'NumericIncrementTransform';
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    return acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined;
  }, obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function mergeWithIncrement(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = clone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (isIncrement(value)) {
      const existing = Number(getPath(merged, key) ?? 0);
      setPath(merged, key, existing + value.operand);
    } else {
      setPath(merged, key, value);
    }
  }
  return merged;
}

let autoIdCounter = 0;

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));

  const snapshot = (ref: FakeRef): FakeSnapshot => {
    const data = documents.get(`${ref._coll}/${ref.id}`);
    return { id: ref.id, exists: Boolean(data), data: () => data ? clone(data) : undefined };
  };
  const makeCollection = (coll: string): FakeCollection => ({
    doc(id?: string): FakeRef {
      const docId = id ?? `auto_${++autoIdCounter}`;
      const ref: FakeRef = {
        id: docId,
        _coll: coll,
        async get() { return snapshot(ref); },
        async update(data: Record<string, unknown>) {
          const path = `${coll}/${docId}`;
          const current = documents.get(path);
          if (!current) throw new Error(`Documento ausente: ${path}`);
          documents.set(path, mergeWithIncrement(current, data));
        },
      };
      return ref;
    },
  });

  const db = { collection(coll: string) { return makeCollection(coll); } };

  return {
    db: db as unknown as Firestore,
    get(path: string) { const data = documents.get(path); return data ? clone(data) : undefined; },
  };
}

const NOW = new Date('2026-09-04T12:00:00.000Z');

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'biz1',
    clientId: 'client-1',
    clientName: 'Paciente Teste',
    serviceId: 'svc-1',
    serviceName: 'Limpeza',
    date: '2026-09-04',
    startTime: '10:00',
    endTime: '11:00',
    duration: 60,
    status: 'nao_compareceu',
    price: 200,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function noShowEvent(overrides: Partial<DomainEventOf<'appointment.noShow'>> = {}): DomainEventOf<'appointment.noShow'> {
  return {
    type: 'appointment.noShow',
    businessId: 'biz1',
    occurredAt: NOW.toISOString(),
    appointmentId: 'appt-1',
    clientId: 'client-1',
    ...overrides,
  };
}

describe('Handler de appointment.noShow', () => {
  it('incrementa noShowCount sem apagar campos irmãos de relationshipHistory', async () => {
    const fake = makeFakeDb({
      'appointments/appt-1': appointment(),
      'clients/client-1': {
        businessId: 'biz1',
        name: 'Paciente Teste',
        relationshipHistory: { totalAppointments: 5, completedAppointments: 4 },
      },
    });

    await handleAppointmentNoShow(noShowEvent(), { db: fake.db });

    const appt = fake.get('appointments/appt-1');
    expect(appt?.noShowAppliedAt).toBeTruthy();

    const client = fake.get('clients/client-1');
    expect((client?.relationshipHistory as Record<string, unknown>)?.noShowCount).toBe(1);
    expect((client?.relationshipHistory as Record<string, unknown>)?.totalAppointments).toBe(5);
    expect((client?.relationshipHistory as Record<string, unknown>)?.completedAppointments).toBe(4);
  });

  it('replay do mesmo evento é idempotente (não duplica o incremento)', async () => {
    const fake = makeFakeDb({
      'appointments/appt-1': appointment(),
      'clients/client-1': { businessId: 'biz1', name: 'Paciente Teste' },
    });

    await handleAppointmentNoShow(noShowEvent(), { db: fake.db });
    await handleAppointmentNoShow(noShowEvent(), { db: fake.db });

    const client = fake.get('clients/client-1');
    expect((client?.relationshipHistory as Record<string, unknown>)?.noShowCount).toBe(1);
  });

  it('ignora evento forjado cujo appointment real NÃO está nao_compareceu', async () => {
    const fake = makeFakeDb({
      'appointments/appt-1': appointment({ status: 'agendado' }),
      'clients/client-1': { businessId: 'biz1', name: 'Paciente Teste' },
    });

    await handleAppointmentNoShow(noShowEvent(), { db: fake.db });

    expect(fake.get('appointments/appt-1')?.noShowAppliedAt).toBeUndefined();
    expect(fake.get('clients/client-1')?.relationshipHistory).toBeUndefined();
  });

  it('ignora evento cujo businessId não bate com o appointment real (tenant)', async () => {
    const fake = makeFakeDb({
      'appointments/appt-1': appointment({ businessId: 'biz2' }),
      'clients/client-1': { businessId: 'biz2', name: 'Paciente Teste' },
    });

    await handleAppointmentNoShow(noShowEvent({ businessId: 'biz1' }), { db: fake.db });

    expect(fake.get('appointments/appt-1')?.noShowAppliedAt).toBeUndefined();
  });

  it('marca noShowAppliedAt mesmo sem clientId, sem quebrar', async () => {
    const fake = makeFakeDb({
      'appointments/appt-1': appointment({ clientId: '' }),
    });

    await expect(handleAppointmentNoShow(noShowEvent({ clientId: undefined }), { db: fake.db })).resolves.not.toThrow();

    expect(fake.get('appointments/appt-1')?.noShowAppliedAt).toBeTruthy();
  });

  it('appointment inexistente é no-op silencioso', async () => {
    const fake = makeFakeDb({});
    await expect(handleAppointmentNoShow(noShowEvent(), { db: fake.db })).resolves.not.toThrow();
  });
});
