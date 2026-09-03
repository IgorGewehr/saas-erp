import { describe, expect, it } from 'vitest';
import type { firestore as adminFs } from 'firebase-admin';
import {
  fetchAppointmentsForProfessional,
  fetchAppointmentsForProfessionals,
} from '@/lib/services/appointments-server';

interface FakeDoc {
  id: string;
  data: () => Record<string, unknown>;
}

interface FakeFilter {
  field: string;
  op: string;
  value: unknown;
}

function matches(data: Record<string, unknown>, filter: FakeFilter): boolean {
  const value = data[filter.field];
  if (filter.op === 'in') return Array.isArray(filter.value) && (filter.value as unknown[]).includes(value);
  if (filter.op === 'array-contains-any') {
    return Array.isArray(value) && Array.isArray(filter.value)
      && value.some((item) => (filter.value as unknown[]).includes(item));
  }
  if (filter.op === '==') return value === filter.value;
  if (filter.op === 'array-contains') return Array.isArray(value) && value.includes(filter.value);
  throw new Error(`fake query: operador não suportado ${filter.op}`);
}

/** Query fake mínima — só o suficiente pra exercitar where().get() encadeado. */
function makeFakeQuery(allDocs: FakeDoc[], filters: FakeFilter[] = []): adminFs.Query {
  const query = {
    where: (field: string, op: string, value: unknown) =>
      makeFakeQuery(allDocs, [...filters, { field, op, value }]),
    async get() {
      return { docs: allDocs.filter((doc) => filters.every((f) => matches(doc.data(), f))) };
    },
  };
  return query as unknown as adminFs.Query;
}

function doc(id: string, data: Record<string, unknown>): FakeDoc {
  return { id, data: () => data };
}

describe('fetchAppointmentsForProfessionals', () => {
  it('encontra por professionalId legado E por professionalIds[] simultaneamente', () => {
    const docs = [
      doc('legacy-match', { professionalId: 'p1' }),
      doc('array-match', { professionalId: 'p9', professionalIds: ['p9', 'p2'] }),
      doc('no-match', { professionalId: 'p9', professionalIds: ['p9'] }),
    ];
    return fetchAppointmentsForProfessionals(() => makeFakeQuery(docs), ['p1', 'p2']).then((result) => {
      expect(result.map((d) => d.id).sort()).toEqual(['array-match', 'legacy-match']);
    });
  });

  it('deduplica quando o mesmo doc bate nas duas queries', async () => {
    const docs = [doc('both', { professionalId: 'p1', professionalIds: ['p1', 'p2'] })];
    const result = await fetchAppointmentsForProfessionals(() => makeFakeQuery(docs), ['p1']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('both');
  });

  it('retorna vazio sem consultar quando a lista de ids está vazia', async () => {
    const docs = [doc('irrelevant', { professionalId: 'p1' })];
    const result = await fetchAppointmentsForProfessionals(() => makeFakeQuery(docs), []);
    expect(result).toEqual([]);
  });

  it('ignora ids vazios/duplicados na lista de entrada', async () => {
    const docs = [doc('p1-doc', { professionalId: 'p1' })];
    const result = await fetchAppointmentsForProfessionals(() => makeFakeQuery(docs), ['p1', '', 'p1']);
    expect(result.map((d) => d.id)).toEqual(['p1-doc']);
  });

  it('fetchAppointmentsForProfessional (singular) continua funcionando como antes', async () => {
    const docs = [
      doc('legacy', { professionalId: 'p1' }),
      doc('array', { professionalIds: ['p1'] }),
      doc('other', { professionalId: 'p2' }),
    ];
    const result = await fetchAppointmentsForProfessional(() => makeFakeQuery(docs), 'p1');
    expect(result.map((d) => d.id).sort()).toEqual(['array', 'legacy']);
  });
});
