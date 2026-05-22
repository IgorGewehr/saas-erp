import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  purgeExpiredSoftDeletes,
  purgeAllBusinesses,
  DEFAULT_RETENTION_DAYS,
} from '@/lib/services/dataRetention';

// ---------------------------------------------------------------------------
// Fake Firestore Admin — registra todas as ops pra inspecao.
// purgeExpiredSoftDeletes recebe adminDb por argumento, entao podemos
// injetar um fake sem mexer no setup global do vitest (que mocka so o client
// SDK firebase/firestore, n o admin).
// ---------------------------------------------------------------------------
type FakeDoc = { id: string; data: Record<string, unknown> };

interface FakeCollectionState {
  docs: FakeDoc[];
}

function makeFakeFirestore(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeCollectionState> = {};
  for (const k of Object.keys(initial)) collections[k] = { docs: [...initial[k]] };

  const ensure = (name: string) => {
    if (!collections[name]) collections[name] = { docs: [] };
    return collections[name];
  };

  const deleted: Array<{ collection: string; id: string }> = [];
  const recursiveDeletes: Array<{ collection: string; id: string }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const batchCommits: number[] = [];

  function makeQuery(name: string, filters: Array<[string, string, unknown]>) {
    return {
      where(field: string, op: string, val: unknown) {
        return makeQuery(name, [...filters, [field, op, val]]);
      },
      limit(_n: number) {
        return makeQuery(name, filters);
      },
      async get() {
        const state = ensure(name);
        const docs = state.docs.filter(d => {
          for (const [f, op, v] of filters) {
            const dv = d.data[f];
            if (op === '==' && dv !== v) return false;
            if (op === '<=') {
              // Firestore: docs sem o campo n batem range queries.
              if (typeof dv !== 'string' || typeof v !== 'string') return false;
              if (dv > v) return false;
            }
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
        doc(id: string) {
          return {
            id,
            _coll: name,
            async delete() {
              const state = ensure(name);
              const before = state.docs.length;
              state.docs = state.docs.filter(d => d.id !== id);
              if (state.docs.length < before) deleted.push({ collection: name, id });
            },
          };
        },
        async add(data: Record<string, unknown>) {
          if (name === 'crmAuditLog') audits.push(data);
          const newId = `auto-${Math.random().toString(36).slice(2, 9)}`;
          ensure(name).docs.push({ id: newId, data });
          return { id: newId };
        },
      };
    },
    async recursiveDelete(ref: { id: string; _coll: string }) {
      const state = ensure(ref._coll);
      state.docs = state.docs.filter(d => d.id !== ref.id);
      recursiveDeletes.push({ collection: ref._coll, id: ref.id });
    },
    batch() {
      const ops: Array<() => void> = [];
      return {
        delete(ref: { id: string; _coll: string }) {
          ops.push(() => {
            const state = ensure(ref._coll);
            const before = state.docs.length;
            state.docs = state.docs.filter(d => d.id !== ref.id);
            if (state.docs.length < before) deleted.push({ collection: ref._coll, id: ref.id });
          });
        },
        async commit() {
          for (const op of ops) op();
          batchCommits.push(ops.length);
        },
      };
    },
  };

  return { fake, collections, deleted, recursiveDeletes, audits, batchCommits };
}

const businessId = 'biz-1';

function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('purgeExpiredSoftDeletes', () => {
  let env: ReturnType<typeof makeFakeFirestore>;

  beforeEach(() => {
    env = makeFakeFirestore({
      clients: [
        { id: 'c-old', data: { businessId, deletedAt: daysAgoISO(60), name: 'Maria' } },
        { id: 'c-recent', data: { businessId, deletedAt: daysAgoISO(10), name: 'Joao' } },
        { id: 'c-active', data: { businessId, name: 'Ana' } }, // sem deletedAt
        { id: 'c-other-tenant', data: { businessId: 'biz-2', deletedAt: daysAgoISO(60), name: 'Outro' } },
      ],
      conversations: [
        { id: 'conv-old', data: { businessId, deletedAt: daysAgoISO(45), contactName: 'X' } },
      ],
      kanbanBoards: [
        { id: 'board-old', data: { businessId, deletedAt: daysAgoISO(40), name: 'Vendas Q1' } },
      ],
      kanbanCards: [
        { id: 'card-cascade-1', data: { businessId, cascadeFromParentId: 'board-old', title: 'A' } },
        { id: 'card-cascade-2', data: { businessId, cascadeFromParentId: 'board-old', title: 'B' } },
        { id: 'card-individual', data: { businessId, deletedAt: daysAgoISO(60), title: 'C' } },
      ],
      services: [
        { id: 'svc-old', data: { businessId, deletedAt: daysAgoISO(35), name: 'Corte' } },
      ],
      channelConnections: [
        { id: 'cc-old', data: { businessId, deletedAt: daysAgoISO(60), name: 'WA Meta' } },
      ],
    });
  });

  it('purga so docs do tenant correto (R1)', async () => {
    const result = await purgeExpiredSoftDeletes(
      env.fake as never,
      businessId,
    );
    // c-other-tenant n deve sumir do estado
    expect(env.collections.clients.docs.find(d => d.id === 'c-other-tenant')).toBeDefined();
    // c-old (do tenant correto, > 30d) deve ter sumido
    expect(env.collections.clients.docs.find(d => d.id === 'c-old')).toBeUndefined();
    expect(result.businessId).toBe(businessId);
  });

  it('preserva docs com deletedAt dentro da janela de 30d', async () => {
    await purgeExpiredSoftDeletes(env.fake as never, businessId);
    // c-recent (10d) deve continuar
    expect(env.collections.clients.docs.find(d => d.id === 'c-recent')).toBeDefined();
  });

  it('preserva docs ativos (sem deletedAt)', async () => {
    await purgeExpiredSoftDeletes(env.fake as never, businessId);
    expect(env.collections.clients.docs.find(d => d.id === 'c-active')).toBeDefined();
  });

  it('dryRun n escreve nada', async () => {
    const before = env.collections.clients.docs.length;
    const result = await purgeExpiredSoftDeletes(env.fake as never, businessId, {
      dryRun: true,
    });
    expect(env.collections.clients.docs.length).toBe(before);
    expect(env.deleted.length).toBe(0);
    expect(env.audits.length).toBe(0);
    // mas o counter de candidatos/purged deve estar populado
    const clientsResult = result.collections.find(c => c.collection === 'clients');
    expect(clientsResult?.candidates).toBe(1);
    expect(clientsResult?.purged).toBe(1);
  });

  it('conversations usa recursiveDelete pra incluir subcolecao messages', async () => {
    await purgeExpiredSoftDeletes(env.fake as never, businessId);
    expect(env.recursiveDeletes.find(d => d.collection === 'conversations' && d.id === 'conv-old')).toBeDefined();
  });

  it('kanbanBoards faz cascade hard-delete dos cards via cascadeFromParentId', async () => {
    const result = await purgeExpiredSoftDeletes(env.fake as never, businessId);
    // Os 2 cards cascateados sumiram
    expect(env.collections.kanbanCards.docs.find(d => d.id === 'card-cascade-1')).toBeUndefined();
    expect(env.collections.kanbanCards.docs.find(d => d.id === 'card-cascade-2')).toBeUndefined();
    // Card individual (n cascateado) continua — purge dele e responsabilidade
    // do retention da propria colecao kanbanCards (n Tier 3 ainda)
    expect(env.collections.kanbanCards.docs.find(d => d.id === 'card-individual')).toBeDefined();
    const boardResult = result.collections.find(c => c.collection === 'kanbanBoards');
    expect(boardResult?.purged).toBe(1);
    expect(boardResult?.cascaded).toBe(2);
  });

  it('grava audit log com action lgpd-purge por doc purgado', async () => {
    await purgeExpiredSoftDeletes(env.fake as never, businessId);
    const purges = env.audits.filter(a => a.action === 'lgpd-purge');
    // 1 client + 1 conversation + 1 board + 1 service + 1 channelConnection
    expect(purges.length).toBe(5);
    // userId/userName padrao 'system'/'cron-data-retention'
    for (const audit of purges) {
      expect(audit.userId).toBe('system');
      expect(audit.userName).toBe('cron-data-retention');
      expect(audit.businessId).toBe(businessId);
      expect(typeof audit.details).toBe('string');
    }
  });

  it('agrega stats por colecao no resultado', async () => {
    const result = await purgeExpiredSoftDeletes(env.fake as never, businessId);
    expect(result.totalPurged).toBe(5); // 1 por colecao
    expect(result.totalCascaded).toBe(2); // 2 cards do board
    expect(result.totalErrors).toBe(0);
  });

  it('retentionDays customizado expande a janela', async () => {
    // Janela de 7d — c-recent (10d) tb deve cair junto com c-old (60d)
    await purgeExpiredSoftDeletes(env.fake as never, businessId, {
      retentionDays: 7,
    });
    expect(env.collections.clients.docs.find(d => d.id === 'c-recent')).toBeUndefined();
    expect(env.collections.clients.docs.find(d => d.id === 'c-old')).toBeUndefined();
    // c-active continua
    expect(env.collections.clients.docs.find(d => d.id === 'c-active')).toBeDefined();
  });

  it('rejeita businessId vazio (R1 defensivo)', async () => {
    await expect(
      purgeExpiredSoftDeletes(env.fake as never, ''),
    ).rejects.toThrow(/businessId obrigatorio/);
  });

  it('cutoff calculado e exposto no resultado pra debug', async () => {
    const result = await purgeExpiredSoftDeletes(env.fake as never, businessId);
    expect(typeof result.cutoff).toBe('string');
    expect(new Date(result.cutoff).getTime()).toBeGreaterThan(0);
    // Cutoff ~ now - 30d
    const expectedMs = Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const actualMs = new Date(result.cutoff).getTime();
    expect(Math.abs(actualMs - expectedMs)).toBeLessThan(10_000); // < 10s skew
  });
});

describe('purgeAllBusinesses', () => {
  it('itera businesses e agrega stats per-tenant', async () => {
    const env = makeFakeFirestore({
      businesses: [
        { id: 'biz-a', data: { name: 'Empresa A' } },
        { id: 'biz-b', data: { name: 'Empresa B' } },
      ],
      clients: [
        { id: 'c-a-old', data: { businessId: 'biz-a', deletedAt: daysAgoISO(60), name: 'Maria' } },
        { id: 'c-b-old', data: { businessId: 'biz-b', deletedAt: daysAgoISO(60), name: 'Joao' } },
      ],
    });

    const result = await purgeAllBusinesses(env.fake as never);
    expect(result.businessesProcessed).toBe(2);
    expect(result.totalPurged).toBe(2); // 1 por business
    expect(result.runs.length).toBe(2);
    // Verifica que cada run e per-business
    expect(result.runs.map(r => r.businessId).sort()).toEqual(['biz-a', 'biz-b']);
  });

  it('continua processando se um business falhar (resiliencia)', async () => {
    const env = makeFakeFirestore({
      businesses: [
        { id: 'biz-ok', data: {} },
        { id: 'biz-fail', data: {} },
      ],
      clients: [
        { id: 'c-ok', data: { businessId: 'biz-ok', deletedAt: daysAgoISO(60), name: 'OK' } },
      ],
    });

    // Monkey-patch pra fazer biz-fail explodir no get
    const originalCollection = env.fake.collection;
    const spy = vi.spyOn(env.fake, 'collection').mockImplementation((name: string) => {
      const real = originalCollection.call(env.fake, name);
      const wrapped = {
        ...real,
        where(field: string, op: string, val: unknown) {
          if (name === 'clients' && val === 'biz-fail') {
            const errQ = {
              where: () => errQ,
              limit: () => errQ,
              get: () => Promise.reject(new Error('simulated failure')),
            };
            return errQ;
          }
          return real.where(field, op, val);
        },
      };
      return wrapped as never;
    });

    const result = await purgeAllBusinesses(env.fake as never);
    spy.mockRestore();

    expect(result.businessesProcessed).toBe(2);
    // biz-ok purgou 1, biz-fail errou
    expect(result.totalPurged).toBe(1);
    expect(result.totalErrors).toBeGreaterThan(0);
  });
});
