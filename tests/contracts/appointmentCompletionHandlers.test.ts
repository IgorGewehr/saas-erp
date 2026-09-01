import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { handleAppointmentCompleted } from '@/contracts/_runtime/handlers/appointmentCompleted';
import { handleAppointmentCanceled } from '@/contracts/_runtime/handlers/appointmentCanceled';
import type { DomainEventOf } from '@/contracts/events';

// Mesmo padrão de fake-Firestore usado em tests/services/deliveryOrderTransitionAdmin.test.ts.

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
  add: (data: Record<string, unknown>) => Promise<FakeRef>;
}

function clone<T>(value: T): T { return structuredClone(value); }

// firebase-admin/firestore FieldValue.increment()/.delete() retornam sentinels
// (NumericIncrementTransform{operand}/DeleteTransform{}) que não sobrevivem a
// structuredClone nem a JSON — detecta pelo nome do construtor.
function isIncrement(value: unknown): value is { operand: number } {
  return typeof value === 'object' && value !== null && value.constructor?.name === 'NumericIncrementTransform';
}
function isDelete(value: unknown): boolean {
  return typeof value === 'object' && value !== null && value.constructor?.name === 'DeleteTransform';
}

function mergeWithIncrement(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (isIncrement(value)) {
      merged[key] = Number(current[key] ?? 0) + value.operand;
    } else if (isDelete(value)) {
      delete merged[key];
    } else {
      merged[key] = value;
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
    async add(data: Record<string, unknown>) {
      const ref = this.doc();
      documents.set(`${ref._coll}/${ref.id}`, clone(data));
      return ref;
    },
  });

  type PendingWrite =
    | { kind: 'set'; ref: FakeRef; data: Record<string, unknown> }
    | { kind: 'update'; ref: FakeRef; data: Record<string, unknown> };

  const db = {
    collection(coll: string) { return makeCollection(coll); },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const writes: PendingWrite[] = [];
      const tx = {
        async get(ref: FakeRef) { return snapshot(ref); },
        set(ref: FakeRef, data: Record<string, unknown>) {
          writes.push({ kind: 'set', ref, data: clone(data) });
        },
        update(ref: FakeRef, data: Record<string, unknown>) {
          writes.push({ kind: 'update', ref, data });
        },
      };
      const result = await handler(tx);
      for (const write of writes) {
        const path = `${write.ref._coll}/${write.ref.id}`;
        if (write.kind === 'update') {
          const current = documents.get(path);
          if (!current) throw new Error(`Documento ausente: ${path}`);
          documents.set(path, mergeWithIncrement(current, write.data));
        } else {
          documents.set(path, clone(write.data));
        }
      }
      return result;
    },
  };

  return {
    db: db as unknown as Firestore,
    get(path: string) { const data = documents.get(path); return data ? clone(data) : undefined; },
    list(collection: string) {
      const prefix = `${collection}/`;
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: clone(data) }));
    },
  };
}

const NOW = new Date('2026-09-01T18:00:00.000Z');

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'biz1',
    clientId: 'client-1',
    clientName: 'Paciente Teste',
    serviceId: 'svc-1',
    serviceName: 'Limpeza',
    professionalId: 'pro-1',
    professionalName: 'Dr. Teste',
    date: '2026-09-01',
    startTime: '10:00',
    endTime: '11:00',
    duration: 60,
    status: 'concluido',
    price: 200,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function baseDocuments(overrides: Record<string, Record<string, unknown>> = {}) {
  return {
    'clients/client-1': { businessId: 'biz1', name: 'Paciente Teste', visitCount: 0, totalSpent: 0 },
    'users/pro-1': { businessId: 'biz1', name: 'Dr. Teste', commissionRate: 10 },
    'services/svc-1': { businessId: 'biz1', name: 'Limpeza', duration: 60, price: 200, color: '#000', isActive: true },
    'businesses/biz1': { id: 'biz1', businessId: 'biz1', settings: { loyalty: { isEnabled: true, pointsPerReal: 1, pointValueInCentavos: 10, minPointsToRedeem: 10 } } },
    ...overrides,
  };
}

function completedEvent(overrides: Partial<DomainEventOf<'appointment.completed'>> = {}): DomainEventOf<'appointment.completed'> {
  return {
    type: 'appointment.completed',
    businessId: 'biz1',
    occurredAt: NOW.toISOString(),
    appointmentId: 'appt-1',
    clientId: 'client-1',
    professionalId: 'pro-1',
    serviceId: 'svc-1',
    amount: 200,
    ...overrides,
  };
}

function canceledEvent(overrides: Partial<DomainEventOf<'appointment.canceled'>> = {}): DomainEventOf<'appointment.canceled'> {
  return {
    type: 'appointment.canceled',
    businessId: 'biz1',
    occurredAt: NOW.toISOString(),
    appointmentId: 'appt-1',
    ...overrides,
  };
}

describe('Hardening da Agenda — handlers de appointment.completed/canceled', () => {
  it('aplica métricas, comissão e fidelidade uma única vez', async () => {
    const fake = makeFakeDb(baseDocuments({ 'appointments/appt-1': appointment() }));

    await handleAppointmentCompleted(completedEvent(), { db: fake.db });

    const appt = fake.get('appointments/appt-1');
    expect(appt?.completionAppliedAt).toBeTruthy();
    expect(appt?.commissionTransactionId).toBeTruthy();

    const client = fake.get('clients/client-1');
    expect(client?.visitCount).toBe(1);
    expect(client?.totalSpent).toBe(200);
    expect(client?.loyaltyPoints).toBe(200);

    const txs = fake.list('transactions');
    expect(txs).toHaveLength(1);
    expect(txs[0].data).toMatchObject({ type: 'despesa', category: 'Comissoes', amount: 20 });

    expect(fake.list('loyaltyTransactions')).toHaveLength(1);
  });

  it('replay do mesmo evento é idempotente (não duplica efeito)', async () => {
    const fake = makeFakeDb(baseDocuments({ 'appointments/appt-1': appointment() }));

    await handleAppointmentCompleted(completedEvent(), { db: fake.db });
    await handleAppointmentCompleted(completedEvent(), { db: fake.db });

    const client = fake.get('clients/client-1');
    expect(client?.visitCount).toBe(1);
    expect(client?.totalSpent).toBe(200);
    expect(fake.list('transactions')).toHaveLength(1);
    expect(fake.list('loyaltyTransactions')).toHaveLength(1);
  });

  it('ignora evento forjado cujo appointment real NÃO está concluido', async () => {
    const fake = makeFakeDb(baseDocuments({ 'appointments/appt-1': appointment({ status: 'agendado' }) }));

    await handleAppointmentCompleted(completedEvent({ amount: 99999 }), { db: fake.db });

    expect(fake.get('appointments/appt-1')?.completionAppliedAt).toBeUndefined();
    expect(fake.get('clients/client-1')?.visitCount).toBe(0);
    expect(fake.list('transactions')).toHaveLength(0);
    expect(fake.list('loyaltyTransactions')).toHaveLength(0);
  });

  it('ignora evento cujo businessId não bate com o appointment real (tenant)', async () => {
    const fake = makeFakeDb(baseDocuments({ 'appointments/appt-1': appointment({ businessId: 'biz2' }) }));

    await handleAppointmentCompleted(completedEvent({ businessId: 'biz1' }), { db: fake.db });

    expect(fake.get('appointments/appt-1')?.completionAppliedAt).toBeUndefined();
    expect(fake.list('transactions')).toHaveLength(0);
  });

  it('não gera comissão sem taxa aplicável, mas ainda aplica métricas e fidelidade', async () => {
    const fake = makeFakeDb(baseDocuments({
      'appointments/appt-1': appointment(),
      'users/pro-1': { businessId: 'biz1', name: 'Dr. Teste', commissionRate: 0 },
    }));

    await handleAppointmentCompleted(completedEvent(), { db: fake.db });

    expect(fake.list('transactions')).toHaveLength(0);
    expect(fake.get('appointments/appt-1')?.commissionTransactionId).toBeUndefined();
    expect(fake.get('clients/client-1')?.visitCount).toBe(1);
    expect(fake.get('clients/client-1')?.loyaltyPoints).toBe(200);
  });

  it('cancelamento reverte comissão e métricas quando completionAppliedAt estava setado', async () => {
    const fake = makeFakeDb(baseDocuments({ 'appointments/appt-1': appointment() }));
    await handleAppointmentCompleted(completedEvent(), { db: fake.db });

    await handleAppointmentCanceled(canceledEvent(), { db: fake.db });

    const appt = fake.get('appointments/appt-1');
    expect(appt?.completionAppliedAt).toBeUndefined();
    const tx = fake.list('transactions')[0];
    expect(tx.data.status).toBe('cancelado');
    const client = fake.get('clients/client-1');
    expect(client?.visitCount).toBe(0);
    expect(client?.totalSpent).toBe(0);
  });

  it('cancelamento é no-op se completionAppliedAt nunca foi setado', async () => {
    const fake = makeFakeDb(baseDocuments({ 'appointments/appt-1': appointment({ status: 'agendado' }) }));

    await handleAppointmentCanceled(canceledEvent(), { db: fake.db });

    expect(fake.list('transactions')).toHaveLength(0);
    expect(fake.get('clients/client-1')?.visitCount).toBe(0);
  });

  it('cancelamento ignora evento de outro tenant', async () => {
    const fake = makeFakeDb(baseDocuments({ 'appointments/appt-1': appointment({ businessId: 'biz2', completionAppliedAt: NOW.toISOString(), commissionTransactionId: 'tx-1' }) }));

    await handleAppointmentCanceled(canceledEvent({ businessId: 'biz1' }), { db: fake.db });

    expect(fake.get('appointments/appt-1')?.completionAppliedAt).toBeTruthy();
  });
});
