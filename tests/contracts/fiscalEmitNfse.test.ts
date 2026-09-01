import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// route.ts (e verifyAuth.ts, number-sequence.ts) fecham sobre o singleton
// global @/lib/config/firebaseAdmin — sem precedente de teste de route.ts
// neste repo. Mock hoisted do módulo inteiro é a única forma de injetar um
// Firestore fake sem tocar produção. Mesmo padrão fake-Firestore usado em
// tests/services/deliveryOrderTransitionAdmin.test.ts, adaptado pra ser
// resetável entre casos (reset() reatribui `documents`, capturado por
// closure — os métodos do db sempre leem a versão atual).
const { fakeDb, resetFakeDb, fakeVerifyIdToken } = vi.hoisted(() => {
  function clone(value: unknown) { return structuredClone(value); }

  let documents = new Map<string, Record<string, unknown>>();
  let autoIdCounter = 0;

  function mergeWithIncrement(current: Record<string, unknown>, patch: Record<string, unknown>) {
    return { ...current, ...patch };
  }

  interface FakeRef {
    id: string;
    _coll: string;
    get: () => Promise<{ id: string; exists: boolean; data: () => Record<string, unknown> | undefined }>;
    update: (data: Record<string, unknown>) => Promise<void>;
    set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
  }

  function snapshot(ref: FakeRef) {
    const data = documents.get(`${ref._coll}/${ref.id}`);
    return { id: ref.id, exists: Boolean(data), data: () => (data ? clone(data) as Record<string, unknown> : undefined) };
  }

  function makeCollection(coll: string) {
    return {
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
          async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
            const path = `${coll}/${docId}`;
            if (opts?.merge) {
              const current = documents.get(path) || {};
              documents.set(path, mergeWithIncrement(current, data));
            } else {
              documents.set(path, clone(data) as Record<string, unknown>);
            }
          },
        };
        return ref;
      },
      async add(data: Record<string, unknown>) {
        const ref = this.doc();
        documents.set(`${ref._coll}/${ref.id}`, clone(data) as Record<string, unknown>);
        return ref;
      },
    };
  }

  const db = {
    collection(coll: string) { return makeCollection(coll); },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const writes: Array<{ kind: 'set' | 'update'; ref: FakeRef; data: Record<string, unknown> }> = [];
      const tx = {
        async get(ref: FakeRef) { return snapshot(ref); },
        set(ref: FakeRef, data: Record<string, unknown>) { writes.push({ kind: 'set', ref, data: clone(data) as Record<string, unknown> }); },
        update(ref: FakeRef, data: Record<string, unknown>) { writes.push({ kind: 'update', ref, data }); },
      };
      const result = await handler(tx);
      for (const w of writes) {
        const path = `${w.ref._coll}/${w.ref.id}`;
        if (w.kind === 'update') {
          const current = documents.get(path);
          if (!current) throw new Error(`Documento ausente: ${path}`);
          documents.set(path, mergeWithIncrement(current, w.data));
        } else {
          documents.set(path, clone(w.data) as Record<string, unknown>);
        }
      }
      return result;
    },
  };

  function reset(initial: Record<string, Record<string, unknown>> = {}) {
    documents = new Map(Object.entries(initial).map(([k, v]) => [k, clone(v) as Record<string, unknown>]));
    autoIdCounter = 0;
  }

  function get(path: string) {
    const data = documents.get(path);
    return data ? clone(data) as Record<string, unknown> : undefined;
  }

  function list(collection: string) {
    const prefix = `${collection}/`;
    return [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, data]) => ({ id: path.slice(prefix.length), data: clone(data) as Record<string, unknown> }));
  }

  return {
    fakeDb: Object.assign(db, { __get: get, __list: list }),
    resetFakeDb: reset,
    fakeVerifyIdToken: vi.fn(async () => ({ uid: 'user-1' })),
  };
});

vi.mock('@/lib/config/firebaseAdmin', () => ({
  adminDb: fakeDb,
  adminAuth: { verifyIdToken: fakeVerifyIdToken },
}));

// emitirNFSe já tem mock mode nativo (SEFAZ_AMBIENTE=mock) — não precisa
// mockar o módulo, só setar a env var antes de cada request.
process.env.SEFAZ_AMBIENTE = 'mock';

const { POST } = await import('@/app/api/fiscal/emit/route');

function get(path: string) { return (fakeDb as unknown as { __get: (p: string) => Record<string, unknown> | undefined }).__get(path); }
function list(collection: string) { return (fakeDb as unknown as { __list: (c: string) => Array<{ id: string; data: Record<string, unknown> }> }).__list(collection); }

function seed(overrides: Record<string, Record<string, unknown>> = {}) {
  resetFakeDb({
    'users/user-1': { businessId: 'biz1', role: 'admin', name: 'Dra. Teste' },
    'businesses/biz1': {
      id: 'biz1',
      cnpj: '12345678000199',
      razaoSocial: 'Clinica Teste LTDA',
      nomeFantasia: 'Clinica Teste',
      fiscal: {
        inscricaoMunicipal: '123456',
        // Canoas/RS — já suportado na coverage table, não é o código de SP
        // (evita cair na validação específica de tomador completo de SP).
        ibgeCodigoMunicipio: '4304606',
        taxRegime: 'simples_nacional',
      },
    },
    ...overrides,
  });
}

function nfseBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'nfse',
    businessId: 'biz1',
    valorServicos: 200,
    aliquotaIss: 5,
    discriminacao: 'Limpeza dental',
    tomador: { nome: 'Paciente Teste', cpf: '12345678909' },
    // Certificado inline evita fakear certificate storage/Storage.
    certificado: { pfxBase64: 'ZmFrZQ==', password: 'senha' },
    ...overrides,
  };
}

function postEmit(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/fiscal/emit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer faketoken' },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  seed();
  fakeVerifyIdToken.mockClear();
  fakeVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
});

describe('POST /api/fiscal/emit — NFSe (mock SEFAZ)', () => {
  it('emite com sucesso e persiste em fiscalDocuments', async () => {
    const res = await postEmit(nfseBody());
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    const docs = list('fiscalDocuments');
    expect(docs).toHaveLength(1);
    expect(docs[0].data).toMatchObject({ type: 'nfse', businessId: 'biz1', totalValue: 200 });
  });

  it('com appointmentId: grava writeback fiscalDocumentId/fiscalAccessKey/fiscalStatus no appointment', async () => {
    resetFakeDb({
      'users/user-1': { businessId: 'biz1', role: 'admin', name: 'Dra. Teste' },
      'businesses/biz1': {
        id: 'biz1', cnpj: '12345678000199', razaoSocial: 'Clinica Teste LTDA', nomeFantasia: 'Clinica Teste',
        fiscal: { inscricaoMunicipal: '123456', ibgeCodigoMunicipio: '4304606', taxRegime: 'simples_nacional' },
      },
      'appointments/appt-1': { businessId: 'biz1', status: 'concluido', price: 200, clientName: 'Paciente Teste' },
    });

    const res = await postEmit(nfseBody({ appointmentId: 'appt-1' }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    const appt = get('appointments/appt-1');
    expect(appt?.fiscalDocumentId).toBeTruthy();
    // normalizeFiscalDocumentStatus canoniza pro feminino do FSM (autorizado → autorizada).
    expect(appt?.fiscalStatus).toBe('autorizada');
    expect(appt?.fiscalAccessKey).toBeTruthy();

    const docs = list('fiscalDocuments');
    expect(docs[0].data).toMatchObject({ appointmentId: 'appt-1', sourceType: 'appointment' });
  });

  it('idempotência: replay do mesmo appointmentId não duplica fiscalDocuments (âncora por X-Idempotency-Key derivada)', async () => {
    resetFakeDb({
      'users/user-1': { businessId: 'biz1', role: 'admin', name: 'Dra. Teste' },
      'businesses/biz1': {
        id: 'biz1', cnpj: '12345678000199', razaoSocial: 'Clinica Teste LTDA', nomeFantasia: 'Clinica Teste',
        fiscal: { inscricaoMunicipal: '123456', ibgeCodigoMunicipio: '4304606', taxRegime: 'simples_nacional' },
      },
      'appointments/appt-1': { businessId: 'biz1', status: 'concluido', price: 200, clientName: 'Paciente Teste' },
    });

    const body = nfseBody({ appointmentId: 'appt-1' });
    const first = await postEmit(body);
    expect(first.status).toBe(201);
    expect(list('fiscalDocuments')).toHaveLength(1);

    const replay = await postEmit(body);
    const replayJson = await replay.json();
    expect(replayJson.success).toBe(true);
    // Replay devolve a MESMA resposta gravada (claim 'done') — não cria um
    // segundo fiscalDocument pro mesmo atendimento.
    expect(list('fiscalDocuments')).toHaveLength(1);
  });

  it('rejeita quando inscricaoMunicipal não está configurada', async () => {
    resetFakeDb({
      'users/user-1': { businessId: 'biz1', role: 'admin', name: 'Dra. Teste' },
      'businesses/biz1': {
        id: 'biz1', cnpj: '12345678000199', razaoSocial: 'Clinica Teste LTDA', nomeFantasia: 'Clinica Teste',
        fiscal: { ibgeCodigoMunicipio: '4304606', taxRegime: 'simples_nacional' },
      },
    });
    const res = await postEmit(nfseBody());
    expect(res.status).toBe(400);
    expect(list('fiscalDocuments')).toHaveLength(0);
  });
});
