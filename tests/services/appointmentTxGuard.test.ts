import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase/firestore ANTES de importar o modulo testado — runTransaction
// e helpers viram mocks controlaveis. tests/setup.ts ja mocka funcoes base,
// mas precisamos sobrescrever runTransaction com logica de simulacao tx +
// getDocs com docs configuraveis.

const txGet = vi.fn();
const txSet = vi.fn();
const txUpdate = vi.fn();
const docsResolver = vi.fn(() => [] as Array<{ id: string; data: () => Record<string, unknown> }>);
let runTransactionImpl = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ _coll: name })),
  doc: vi.fn((dbOrColl: unknown, path: string, id?: string) => {
    // Detecta forma: doc(coll) — auto ID; doc(db, 'col', 'id') — explicit
    if (typeof path === 'string' && typeof id === 'string') {
      return { _coll: path, id, path: `${path}/${id}` };
    }
    if (dbOrColl && typeof dbOrColl === 'object' && '_coll' in dbOrColl) {
      const generated = `auto-${Math.random().toString(36).slice(2, 9)}`;
      return { _coll: (dbOrColl as { _coll: string })._coll, id: generated, path: `${(dbOrColl as { _coll: string })._coll}/${generated}` };
    }
    return { _coll: 'unknown', id: String(path), path };
  }),
  query: vi.fn((...args) => ({ _query: args })),
  where: vi.fn((field, op, val) => ({ _where: [field, op, val] })),
  getDocs: vi.fn(async () => ({ docs: docsResolver() })),
  runTransaction: vi.fn(async (_db, cb) => runTransactionImpl(cb)),
  // Mocks pros fallbacks de import dinamico (sem professionalId)
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

import {
  createAppointmentSafe,
  updateAppointmentSafe,
  AppointmentConflictError,
} from '@/lib/services/appointmentTxGuard';
import type { Appointment, User } from '@/lib/types';

const fakeDb = {} as never;
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

const prof: User = { id: 'p1', uid: 'p1', email: '', name: 'Joao', role: 'operator', businessId, isActive: true } as User;

beforeEach(() => {
  txGet.mockReset();
  txSet.mockReset();
  txUpdate.mockReset();
  docsResolver.mockReset().mockReturnValue([]);
  runTransactionImpl = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = { get: txGet, set: txSet, update: txUpdate };
    txGet.mockResolvedValue({ data: () => ({ version: 0 }) });
    await cb(tx);
  });
});

describe('createAppointmentSafe', () => {
  it('cria appointment sem conflito — bumpa lock e tx.set', async () => {
    docsResolver.mockReturnValue([]); // dia vazio
    const id = await createAppointmentSafe(
      fakeDb,
      { businessId, professionalId: 'p1', date: '2026-05-22', startTime: '09:00', endTime: '10:00' },
      [prof],
    );
    expect(typeof id).toBe('string');
    // Lock + appointment = 2 tx.set
    expect(txSet).toHaveBeenCalledTimes(2);
    // Primeiro set e o lockRef com version bumpada (0+1=1)
    const lockCall = txSet.mock.calls.find(c => (c[1] as Record<string, unknown>).version !== undefined);
    expect(lockCall).toBeDefined();
    expect((lockCall![1] as Record<string, unknown>).version).toBe(1);
  });

  it('rejeita com AppointmentConflictError quando ha overlap', async () => {
    docsResolver.mockReturnValue([
      { id: 'a-old', data: () => apt({ id: 'a-old', startTime: '09:30', endTime: '10:30' }) },
    ]);
    await expect(
      createAppointmentSafe(
        fakeDb,
        { businessId, professionalId: 'p1', date: '2026-05-22', startTime: '09:00', endTime: '10:00' },
        [prof],
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    // N escreveu nada
    expect(txSet).not.toHaveBeenCalled();
  });

  it('bumpa version corretamente quando lock ja existia', async () => {
    docsResolver.mockReturnValue([]);
    runTransactionImpl = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = { get: txGet, set: txSet, update: txUpdate };
      txGet.mockResolvedValue({ data: () => ({ version: 7 }) });
      await cb(tx);
    });
    await createAppointmentSafe(
      fakeDb,
      { businessId, professionalId: 'p1', date: '2026-05-22', startTime: '11:00', endTime: '12:00' },
      [prof],
    );
    const lockCall = txSet.mock.calls.find(c => (c[1] as Record<string, unknown>).version !== undefined);
    expect((lockCall![1] as Record<string, unknown>).version).toBe(8);
  });

  it('rejeita businessId vazio (R1)', async () => {
    await expect(
      createAppointmentSafe(
        fakeDb,
        { businessId: '', professionalId: 'p1', date: '2026-05-22', startTime: '09:00', endTime: '10:00' },
        [prof],
      ),
    ).rejects.toThrow(/businessId obrigatorio/);
  });

  it('sem professionalId — pula tx e faz write direto (caso raro)', async () => {
    const id = await createAppointmentSafe(
      fakeDb,
      { businessId, date: '2026-05-22', startTime: '09:00', endTime: '10:00' },
      [prof],
    );
    expect(typeof id).toBe('string');
    // Tx n rodou
    expect(txSet).not.toHaveBeenCalled();
  });

  it('ignora appointments cancelados no check', async () => {
    docsResolver.mockReturnValue([
      { id: 'a-canc', data: () => apt({ id: 'a-canc', status: 'cancelado', startTime: '09:00', endTime: '10:00' }) },
    ]);
    // Mesmo slot exato — mas cancelado, nao bloqueia
    const id = await createAppointmentSafe(
      fakeDb,
      { businessId, professionalId: 'p1', date: '2026-05-22', startTime: '09:00', endTime: '10:00' },
      [prof],
    );
    expect(typeof id).toBe('string');
  });

  it('detecta overlap parcial (10:30-11:30 conflita com 11:00-12:00)', async () => {
    docsResolver.mockReturnValue([
      { id: 'a-x', data: () => apt({ id: 'a-x', startTime: '10:30', endTime: '11:30' }) },
    ]);
    await expect(
      createAppointmentSafe(
        fakeDb,
        { businessId, professionalId: 'p1', date: '2026-05-22', startTime: '11:00', endTime: '12:00' },
        [prof],
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
  });
});

describe('updateAppointmentSafe', () => {
  it('atualiza sem conflito quando excludeId casa com o proprio apt', async () => {
    docsResolver.mockReturnValue([
      { id: 'apt-self', data: () => apt({ id: 'apt-self', startTime: '09:00', endTime: '10:00' }) },
    ]);
    await updateAppointmentSafe(
      fakeDb,
      'apt-self',
      { businessId, professionalId: 'p1', date: '2026-05-22', startTime: '09:00', endTime: '10:00' },
      [prof],
      { professionalId: 'p1', date: '2026-05-22' },
    );
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txSet).toHaveBeenCalledTimes(1); // so o destLock (n moveu)
  });

  it('bumpa AMBOS os locks quando muda profissional', async () => {
    docsResolver.mockReturnValue([]);
    await updateAppointmentSafe(
      fakeDb,
      'apt-1',
      { businessId, professionalId: 'p2', date: '2026-05-22', startTime: '09:00', endTime: '10:00' },
      [prof, { ...prof, id: 'p2' } as User],
      { professionalId: 'p1', date: '2026-05-22' },
    );
    // destLock (p2) + origLock (p1) = 2 sets
    expect(txSet).toHaveBeenCalledTimes(2);
  });

  it('bumpa AMBOS os locks quando muda data', async () => {
    docsResolver.mockReturnValue([]);
    await updateAppointmentSafe(
      fakeDb,
      'apt-1',
      { businessId, professionalId: 'p1', date: '2026-05-23', startTime: '09:00', endTime: '10:00' },
      [prof],
      { professionalId: 'p1', date: '2026-05-22' },
    );
    expect(txSet).toHaveBeenCalledTimes(2);
  });

  it('rejeita com AppointmentConflictError quando overlap em destino', async () => {
    docsResolver.mockReturnValue([
      { id: 'a-other', data: () => apt({ id: 'a-other', startTime: '10:30', endTime: '11:30' }) },
    ]);
    await expect(
      updateAppointmentSafe(
        fakeDb,
        'apt-self',
        { businessId, professionalId: 'p1', date: '2026-05-22', startTime: '11:00', endTime: '12:00' },
        [prof],
        { professionalId: 'p1', date: '2026-05-22' },
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('rejeita appointmentId vazio', async () => {
    await expect(
      updateAppointmentSafe(
        fakeDb,
        '',
        { businessId, professionalId: 'p1', date: '2026-05-22', startTime: '09:00', endTime: '10:00' },
        [prof],
      ),
    ).rejects.toThrow(/appointmentId obrigatorio/);
  });
});
