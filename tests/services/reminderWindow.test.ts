import { describe, it, expect } from 'vitest';
import {
  minutesUntilSlot,
  isWithinReminderWindow,
  reminderLogId,
  claimReminderSlotInTx,
  hasReminderSlotBeenClaimed,
  markReminderSlotClaimed,
} from '@/lib/services/agenda/reminderWindow';

// Fake Admin SDK mínima — mesmo formato de tests/services/appointmentReminderRunner.test.ts.
type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeDb(initial: FakeDoc[] = []) {
  const docs: FakeDoc[] = initial.map((d) => ({ ...d, data: { ...d.data } }));

  const collection = () => ({
    doc(id: string) {
      return {
        id,
        async get() {
          const found = docs.find((d) => d.id === id);
          return { exists: !!found, id, data: () => found?.data };
        },
        async set(data: Record<string, unknown>) {
          const idx = docs.findIndex((d) => d.id === id);
          if (idx >= 0) docs[idx].data = data;
          else docs.push({ id, data });
        },
      };
    },
  });

  const fake = {
    collection,
    async runTransaction(cb: (tx: unknown) => Promise<unknown>) {
      const tx = {
        async get(ref: { get: () => Promise<unknown> }) { return ref.get(); },
        set(ref: { set: (d: Record<string, unknown>) => void }, data: Record<string, unknown>) { ref.set(data); },
      };
      return cb(tx);
    },
    docs,
  };
  return fake as unknown as FirebaseFirestore.Firestore & { docs: FakeDoc[] };
}

describe('minutesUntilSlot', () => {
  it('retorna positivo para horário futuro no fuso do negócio', () => {
    const now = new Date('2026-09-08T12:00:00Z'); // 09:00 em São Paulo (UTC-3)
    const minutes = minutesUntilSlot('2026-09-08', '10:00', 'America/Sao_Paulo', now);
    expect(minutes).toBeCloseTo(60, 5);
  });

  it('retorna negativo para horário passado', () => {
    const now = new Date('2026-09-08T12:00:00Z');
    const minutes = minutesUntilSlot('2026-09-08', '08:00', 'America/Sao_Paulo', now);
    expect(minutes).toBeCloseTo(-60, 5);
  });

  it('lança em timezone inválido', () => {
    expect(() => minutesUntilSlot('2026-09-08', '10:00', 'Not/A_Zone', new Date())).toThrow();
  });
});

describe('isWithinReminderWindow', () => {
  it('true dentro da tolerância', () => {
    expect(isWithinReminderWindow(58, 60, 5)).toBe(true);
    expect(isWithinReminderWindow(65, 60, 5)).toBe(true);
  });

  it('false fora da tolerância', () => {
    expect(isWithinReminderWindow(50, 60, 5)).toBe(false);
    expect(isWithinReminderWindow(66, 60, 5)).toBe(false);
  });

  it('suporta alvo negativo (janela "depois de")', () => {
    // 24h depois do fim, tolerância de 12h — equivalente a hoursAfter em [12,36]
    expect(isWithinReminderWindow(-1440, -1440, 720)).toBe(true);
    expect(isWithinReminderWindow(-720, -1440, 720)).toBe(true); // 12h depois
    expect(isWithinReminderWindow(-2160, -1440, 720)).toBe(true); // 36h depois
    expect(isWithinReminderWindow(-600, -1440, 720)).toBe(false); // 10h depois — cedo demais
  });
});

describe('reminderLogId', () => {
  it('sanitiza caracteres não alfanuméricos do slot', () => {
    expect(reminderLogId('apt1', 'reminder', '2026-09-08', '14:30')).toBe('apt1_reminder_2026-09-08_1430');
  });

  it('reagendar (novo date/time) gera chave diferente', () => {
    const before = reminderLogId('apt1', 'reminder', '2026-09-08', '14:00');
    const after = reminderLogId('apt1', 'reminder', '2026-09-08', '18:00');
    expect(before).not.toBe(after);
  });
});

describe('claimReminderSlotInTx', () => {
  it('primeira reivindicação retorna true e grava o log', async () => {
    const db = makeFakeDb();
    const claimed = await db.runTransaction((tx) =>
      claimReminderSlotInTx(tx as any, db, 'apt1', 'biz1', 'staff_60', '2026-09-08', '14:00'),
    );
    expect(claimed).toBe(true);
    expect(db.docs).toHaveLength(1);
  });

  it('segunda reivindicação do MESMO slot retorna false (idempotente)', async () => {
    const db = makeFakeDb();
    await db.runTransaction((tx) => claimReminderSlotInTx(tx as any, db, 'apt1', 'biz1', 'staff_60', '2026-09-08', '14:00'));
    const second = await db.runTransaction((tx) =>
      claimReminderSlotInTx(tx as any, db, 'apt1', 'biz1', 'staff_60', '2026-09-08', '14:00'),
    );
    expect(second).toBe(false);
  });

  it('reagendamento (slot novo) libera reivindicação de novo', async () => {
    const db = makeFakeDb();
    await db.runTransaction((tx) => claimReminderSlotInTx(tx as any, db, 'apt1', 'biz1', 'staff_60', '2026-09-08', '14:00'));
    const afterReschedule = await db.runTransaction((tx) =>
      claimReminderSlotInTx(tx as any, db, 'apt1', 'biz1', 'staff_60', '2026-09-08', '18:00'),
    );
    expect(afterReschedule).toBe(true);
  });
});

describe('hasReminderSlotBeenClaimed / markReminderSlotClaimed', () => {
  it('não reivindicado por padrão', async () => {
    const db = makeFakeDb();
    const claimed = await hasReminderSlotBeenClaimed(db, 'apt1', 'confirmation', '2026-09-08', '14:00');
    expect(claimed).toBe(false);
  });

  it('marca e depois reporta reivindicado', async () => {
    const db = makeFakeDb();
    await markReminderSlotClaimed(db, 'apt1', 'biz1', 'confirmation', '2026-09-08', '14:00');
    const claimed = await hasReminderSlotBeenClaimed(db, 'apt1', 'confirmation', '2026-09-08', '14:00');
    expect(claimed).toBe(true);
  });

  it('reagendamento (slot novo) não está reivindicado mesmo com o slot antigo marcado', async () => {
    const db = makeFakeDb();
    await markReminderSlotClaimed(db, 'apt1', 'biz1', 'reminder', '2026-09-08', '14:00');
    const claimedForNewSlot = await hasReminderSlotBeenClaimed(db, 'apt1', 'reminder', '2026-09-08', '18:00');
    expect(claimedForNewSlot).toBe(false);
  });
});
