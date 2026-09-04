import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * M06.9 — "testes concorrentes: dois canais diferentes disputando o mesmo
 * horário". Sem emulador real do Firestore, simular uma corrida de baixo
 * nível (dois `runTransaction` literalmente sobrepostos no tempo) testaria
 * o motor de retry do PRÓPRIO Firestore — garantia dele, documentada, não
 * nossa. O jeito fiel de testar O QUE NOS PERTENCE é modelar o RESULTADO de
 * uma corrida já resolvida: um canal commita primeiro contra um backing
 * store compartilhado; o outro lê o estado fresco (pós-commit, exatamente
 * como aconteceria depois de uma reexecução real de transação) e precisa
 * detectar o conflito corretamente — essa é a garantia que os dois guards
 * (createAppointmentSafe, client SDK, usado por Agenda/CRM/PDV;
 * createAppointmentSafeAdmin, Admin SDK, usado por API v1 e pelo agente
 * desde M06.7) existem pra dar, não importa qual canal chegou primeiro.
 */

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeSharedAppointmentsStore(): { read: () => FakeDoc[]; write: (id: string, data: Record<string, unknown>) => void } {
  const docs: FakeDoc[] = [];
  return {
    read: () => docs,
    write: (id, data) => { docs.push({ id, data }); },
  };
}

let store = makeSharedAppointmentsStore();

// ── Client SDK mock (createAppointmentSafe) — getDocs lê o store ao vivo,
// não um snapshot fixo, pra que o segundo canal veja o write do primeiro. ──
const txGet = vi.fn();
let runTransactionImpl = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ _coll: name })),
  doc: vi.fn((dbOrColl: unknown, path?: string, id?: string) => {
    if (typeof path === 'string' && typeof id === 'string') return { _coll: path, id, path: `${path}/${id}` };
    if (dbOrColl && typeof dbOrColl === 'object' && '_coll' in dbOrColl) {
      const generated = `client-${Math.random().toString(36).slice(2, 9)}`;
      return { _coll: (dbOrColl as { _coll: string })._coll, id: generated, path: `${(dbOrColl as { _coll: string })._coll}/${generated}` };
    }
    return { _coll: 'unknown', id: String(path), path };
  }),
  query: vi.fn((collSentinel: { _coll: string }) => ({ _coll: collSentinel._coll })),
  where: vi.fn((field, op, val) => ({ _where: [field, op, val] })),
  // Uniforme por colecao: 'appointments' le o store compartilhado ao vivo;
  // qualquer outra (scheduleBlocks) volta vazia — bloqueios/buffer não são o
  // que este teste verifica (já cobertos em appointmentTxGuard.test.ts).
  getDocs: vi.fn(async (q: { _coll?: string }) => ({
    docs: q?._coll === 'appointments' ? store.read().map((d) => ({ id: d.id, data: () => d.data })) : [],
  })),
  getDoc: vi.fn(async () => ({ data: () => undefined })), // sem buffer configurado
  runTransaction: vi.fn(async (_db, cb) => runTransactionImpl(cb)),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

import { createAppointmentSafe, AppointmentConflictError as ClientConflictError } from '@/lib/services/appointmentTxGuard';
import { createAppointmentSafeAdmin, AppointmentConflictError as AdminConflictError } from '@/lib/services/appointmentTxGuardAdmin';
import type { User } from '@/lib/types';

const businessId = 'biz-1';
const prof = (id: string): User => ({ id, uid: id, email: '', name: `Prof ${id}`, role: 'operator', businessId, isActive: true } as User);

// ── Admin SDK fake (createAppointmentSafeAdmin) — MESMO backing store. ──────
function makeFakeAdminDb() {
  function matchesFilter(actual: unknown, op: string, expected: unknown): boolean {
    if (op === 'in') return Array.isArray(expected) && expected.includes(actual);
    if (op === 'array-contains-any') return Array.isArray(actual) && Array.isArray(expected) && actual.some((v) => expected.includes(v));
    return actual === expected;
  }
  function makeQuery(name: string, filters: Array<[string, string, unknown]>) {
    return {
      where(field: string, op: string, val: unknown) { return makeQuery(name, [...filters, [field, op, val]]); },
      async get() {
        const source = name === 'appointments' ? store.read() : [];
        const docs = source.filter((d) => filters.every(([f, op, v]) => matchesFilter(d.data[f], op, v)));
        return { size: docs.length, empty: docs.length === 0, docs: docs.map((d) => ({ id: d.id, data: () => d.data, ref: { id: d.id, _coll: name } })) };
      },
    };
  }
  return {
    collection(name: string) {
      return {
        ...makeQuery(name, []),
        doc(id?: string) {
          const docId = id ?? `admin-${Math.random().toString(36).slice(2, 9)}`;
          return {
            id: docId,
            async set(data: Record<string, unknown>) {
              if (name === 'appointments') store.write(docId, data);
            },
            async get() {
              if (name === 'users') return { exists: true, data: () => ({ id: docId, name: `Prof ${docId}`, businessId, role: 'operator', isActive: true }), id: docId };
              return { exists: false, data: () => undefined, id: docId };
            },
          };
        },
      };
    },
    async runTransaction(cb: (tx: unknown) => Promise<unknown>) {
      const tx = {
        async get(refOrQuery: unknown) {
          if (refOrQuery && typeof refOrQuery === 'object' && 'get' in refOrQuery) return (refOrQuery as { get: () => Promise<unknown> }).get();
          return refOrQuery;
        },
        set(ref: { id: string }, data: Record<string, unknown>) {
          return (ref as unknown as { set: (d: Record<string, unknown>) => Promise<void> }).set(data);
        },
      };
      return cb(tx);
    },
  };
}
const fakeAdminDb = makeFakeAdminDb();

beforeEach(() => {
  store = makeSharedAppointmentsStore();
  txGet.mockReset();
  runTransactionImpl = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: txGet,
      // Distingue lock doc (tem `version` — e também grava `businessId`) de
      // appointment doc de verdade, sem precisar rastrear qual _coll cada
      // ref pertence.
      set: vi.fn((ref: { id: string }, data: Record<string, unknown>) => {
        if ('businessId' in data && !('version' in data)) store.write(ref.id, data);
      }),
      update: vi.fn(),
    };
    txGet.mockResolvedValue({ data: () => ({ version: 0 }) });
    await cb(tx);
  });
});

describe('M06.9 — concorrência entre canais (client SDK x Admin SDK) pelo mesmo slot', () => {
  it('canal manual (client) reserva primeiro; canal do agente (admin) detecta e recusa', async () => {
    const id = await createAppointmentSafe(
      {} as never,
      { businessId, professionalId: 'p1', date: '2026-09-10', startTime: '09:00', endTime: '10:00', status: 'agendado' },
      [prof('p1')],
    );
    expect(typeof id).toBe('string');
    expect(store.read()).toHaveLength(1);

    await expect(
      createAppointmentSafeAdmin(fakeAdminDb as never, {
        businessId, professionalId: 'p1', date: '2026-09-10', startTime: '09:30', endTime: '10:30', status: 'agendado',
      }),
    ).rejects.toBeInstanceOf(AdminConflictError);
    // Segunda tentativa (perdedora da corrida) não escreveu nada.
    expect(store.read()).toHaveLength(1);
  });

  it('canal do agente (admin) reserva primeiro; canal manual (client) detecta e recusa', async () => {
    const id = await createAppointmentSafeAdmin(fakeAdminDb as never, {
      businessId, professionalId: 'p1', date: '2026-09-10', startTime: '09:00', endTime: '10:00', status: 'agendado',
    });
    expect(typeof id).toBe('string');
    expect(store.read()).toHaveLength(1);

    await expect(
      createAppointmentSafe(
        {} as never,
        { businessId, professionalId: 'p1', date: '2026-09-10', startTime: '09:30', endTime: '10:30', status: 'agendado' },
        [prof('p1')],
      ),
    ).rejects.toBeInstanceOf(ClientConflictError);
    expect(store.read()).toHaveLength(1);
  });

  it('multi-profissional cross-canal: profissional em 2ª posição reservado pelo agente bloqueia o canal manual', async () => {
    // Admin (agente/API v1) cria um 1:1 pra p2 às 09:00-10:00.
    await createAppointmentSafeAdmin(fakeAdminDb as never, {
      businessId, professionalId: 'p2', date: '2026-09-10', startTime: '09:00', endTime: '10:00', status: 'agendado',
    });
    expect(store.read()).toHaveLength(1);

    // Canal manual tenta um atendimento com professionalIds=[p1,p2] — p2 (2ª
    // posição) já está ocupado por um canal DIFERENTE; deve conflitar (fecha
    // o blind spot original da M06.1, agora também cross-canal).
    await expect(
      createAppointmentSafe(
        {} as never,
        { businessId, professionalId: 'p1', professionalIds: ['p1', 'p2'], date: '2026-09-10', startTime: '09:30', endTime: '10:30', status: 'agendado' },
        [prof('p1'), prof('p2')],
      ),
    ).rejects.toBeInstanceOf(ClientConflictError);
    expect(store.read()).toHaveLength(1);
  });

  it('canais diferentes em profissionais DIFERENTES não conflitam entre si', async () => {
    await createAppointmentSafeAdmin(fakeAdminDb as never, {
      businessId, professionalId: 'p1', date: '2026-09-10', startTime: '09:00', endTime: '10:00', status: 'agendado',
    });
    const id = await createAppointmentSafe(
      {} as never,
      { businessId, professionalId: 'p2', date: '2026-09-10', startTime: '09:00', endTime: '10:00', status: 'agendado' },
      [prof('p2')],
    );
    expect(typeof id).toBe('string');
    expect(store.read()).toHaveLength(2);
  });
});
