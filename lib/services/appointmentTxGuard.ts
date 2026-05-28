/**
 * lib/services/appointmentTxGuard.ts
 *
 * Wrappers atomicos sobre criar/editar appointments. Eliminam a race
 * condition entre o check de conflito (em memoria, snapshot local) e o
 * write (addDoc/updateDoc) — janela de ~100-200ms onde 2 operadores
 * podiam salvar no mesmo slot e ambos persistiam, gerando overlap.
 *
 * Estrategia — "day lock + optimistic version bump":
 *
 *   Firestore client SDK n suporta query reads em runTransaction (so doc
 *   reads). Pra contornar, mantemos 1 doc-lock por professionalId+date
 *   em `appointmentDayLocks/{businessId}_{profId}_{YYYYMMDD}` com um
 *   campo `version` que bumpa em CADA write (create/edit/cancel).
 *
 *   A tx:
 *     1. tx.get(lockRef) — leitura RASTREADA pela tx. Se outro write no
 *        mesmo prof+dia ocorrer entre nosso get e commit, Firestore
 *        ABORTA nossa tx e reexecuta a callback (ate 5x).
 *     2. getDocs(query) DENTRO do callback — leitura fora da tx, mas
 *        roda de novo a cada reattempt, trazendo dado fresco.
 *     3. checkAppointmentConflict puro com a lista lida.
 *     4. tx.set(lockRef, { version: v+1 }) — bump pra invalidar txs
 *        concorrentes que ja leram a version anterior.
 *     5. tx.set/update(appointmentRef, payload).
 *
 *   Resultado: 2 operadores em <200ms — um sucede, o outro reexecuta
 *   ve o doc novo no getDocs e detecta conflito → AppointmentConflictError.
 *
 * Limitacoes conhecidas:
 *   - Recurrence series: continua usando writeBatch pre-validado em
 *     AgendaModule. Bumpar lock por N dias dentro de tx degradaria
 *     performance demais.
 *   - Hard-delete legado (n via cancelado): n bumpa lock. Hoje appointments
 *     n sao hard-deleted (tier 2 status-driven), entao n e issue real.
 *   - Drag&drop / move externo: precisaria usar o mesmo helper. TODO.
 *   - Sector visibility: o getDocs DENTRO da tx busca TODOS apt do
 *     business pro mesmo prof+date INDEPENDENTE de setor — fecha brecha
 *     onde operador A (setor 1) n via slot ocupado por operador B
 *     (setor 2) e agendava em cima.
 */

import {
  collection,
  doc,
  query,
  where,
  getDocs,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import { checkAppointmentConflict } from '@/lib/services/appointmentConflicts';
import type { Appointment, User } from '@/lib/types';

/** Erro tipado pra que o caller diferencie conflito vs falha generica. */
export class AppointmentConflictError extends Error {
  readonly code = 'APPOINTMENT_CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AppointmentConflictError';
  }
}

export interface AppointmentTxPayload {
  businessId: string;
  professionalId?: string;
  date: string;       // 'YYYY-MM-DD'
  startTime: string;  // 'HH:mm'
  endTime: string;    // 'HH:mm'
  /**
   * Turma (capacity>1): chave canônica da sessão. Quando presente, appointments
   * com o MESMO sessionKey são ignorados no check de conflito (colegas de turma).
   * Ausente = exclusivo, comportamento BIT-A-BIT atual. A contagem de vagas
   * (capacity) é responsabilidade do caller, não deste guard.
   */
  sessionKey?: string;
  /** Restante do payload — passado direto pro tx.set/tx.update. */
  [key: string]: unknown;
}

/**
 * Remove da lista os appointments da MESMA turma (mesmo sessionKey) — colegas
 * não conflitam. Sem sessionKey: lista intacta (exclusivo).
 */
function excludeSameSession(appointments: Appointment[], sessionKey?: string): Appointment[] {
  if (!sessionKey) return appointments;
  return appointments.filter((a) => a.sessionKey !== sessionKey);
}

/** Path determinístico do lock doc — 1 por prof+data. */
function dayLockRef(db: Firestore, businessId: string, professionalId: string, date: string) {
  const compactDate = date.replace(/-/g, '');
  return doc(db, 'appointmentDayLocks', `${businessId}_${professionalId}_${compactDate}`);
}

/**
 * Cria um novo appointment com re-check atomico de conflito.
 * Lanca AppointmentConflictError se outro operador salvou no mesmo slot
 * entre o ultimo render e o commit (race window eliminada).
 *
 * @returns ID do novo doc
 */
export async function createAppointmentSafe(
  db: Firestore,
  payload: AppointmentTxPayload,
  members: User[],
  t?: (key: string, fallback: string) => string,
): Promise<string> {
  const { businessId, professionalId, date, startTime, endTime } = payload;
  if (!businessId) throw new Error('createAppointmentSafe: businessId obrigatorio (R1)');

  const newDocRef = doc(collection(db, 'appointments'));

  // Sem profissional escolhido: pula tx, faz write simples. Caso raro,
  // n bloqueia ningem em slot pq n ha "dono" do horario.
  if (!professionalId) {
    const { setDoc } = await import('firebase/firestore');
    await setDoc(newDocRef, payload);
    return newDocRef.id;
  }

  const lockRef = dayLockRef(db, businessId, professionalId, date);

  await runTransaction(db, async (tx) => {
    // 1. tx.get(lockRef) — leitura rastreada. Qualquer write no lockRef
    //    entre aqui e o commit forca reexecucao da callback.
    const lockSnap = await tx.get(lockRef);
    const currentVersion = (lockSnap.data()?.version as number | undefined) ?? 0;

    // 2. getDocs fora da tx mas dentro do callback — re-roda na reattempt
    //    com dado fresco. Necessario pq tx Firestore client n aceita
    //    query reads (so doc reads).
    const q = query(
      collection(db, 'appointments'),
      where('businessId', '==', businessId),
      where('professionalId', '==', professionalId),
      where('date', '==', date),
    );
    const snap = await getDocs(q);
    const appointments = excludeSameSession(
      snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment)),
      payload.sessionKey,
    );

    // 3. Check overlap puro.
    const result = checkAppointmentConflict({
      appointments,
      members,
      professionalId,
      date,
      startTime,
      endTime,
      t,
    });
    if (result.hasConflict) {
      throw new AppointmentConflictError(result.message);
    }

    // 4. Bump lock — invalida txs concorrentes que ja leram version antiga.
    tx.set(lockRef, {
      businessId,
      professionalId,
      date,
      version: currentVersion + 1,
      updatedAt: new Date().toISOString(),
    });

    // 5. Cria o appointment.
    tx.set(newDocRef, payload);
  });

  return newDocRef.id;
}

/**
 * Atualiza um appointment existente com re-check atomico de conflito.
 * Cobre tambem mudanca de profissional/data — bumpa AMBOS os locks (origem
 * e destino) pra evitar race em movimentacoes cross-day/cross-prof.
 */
export async function updateAppointmentSafe(
  db: Firestore,
  appointmentId: string,
  payload: AppointmentTxPayload,
  members: User[],
  /** Snapshot do doc antes da edicao — usado pra bumpar tb o lock antigo
   *  quando o operador moveu o apt pra outro prof ou outra data. Opcional:
   *  sem isso, so bumpa o lock destino (correto pra edicoes que n movem). */
  previous?: { professionalId?: string; date?: string },
  t?: (key: string, fallback: string) => string,
): Promise<void> {
  const { businessId, professionalId, date, startTime, endTime } = payload;
  if (!businessId) throw new Error('updateAppointmentSafe: businessId obrigatorio (R1)');
  if (!appointmentId) throw new Error('updateAppointmentSafe: appointmentId obrigatorio');

  const targetRef = doc(db, 'appointments', appointmentId);

  // Sem profissional novo: pula tx (raro em edits, mas defensivo).
  if (!professionalId) {
    const { updateDoc } = await import('firebase/firestore');
    await updateDoc(targetRef, payload);
    return;
  }

  const destLockRef = dayLockRef(db, businessId, professionalId, date);
  // Origem so se houve mudanca real (prof OU date diferentes) — senao seria
  // bumpar o mesmo lock 2x na mesma tx (no-op redundante).
  const movedProf = previous?.professionalId && previous.professionalId !== professionalId;
  const movedDate = previous?.date && previous.date !== date;
  const origLockRef = (movedProf || movedDate) && previous?.professionalId && previous?.date
    ? dayLockRef(db, businessId, previous.professionalId, previous.date)
    : null;

  await runTransaction(db, async (tx) => {
    // 1. tx.get nos locks (destino + origem se houve move).
    const destSnap = await tx.get(destLockRef);
    const destVersion = (destSnap.data()?.version as number | undefined) ?? 0;

    let origVersion = 0;
    if (origLockRef) {
      const origSnap = await tx.get(origLockRef);
      origVersion = (origSnap.data()?.version as number | undefined) ?? 0;
    }

    // 2. getDocs no destino (prof+date novo).
    const q = query(
      collection(db, 'appointments'),
      where('businessId', '==', businessId),
      where('professionalId', '==', professionalId),
      where('date', '==', date),
    );
    const snap = await getDocs(q);
    const appointments = excludeSameSession(
      snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment)),
      payload.sessionKey,
    );

    // 3. Check overlap, ignorando o proprio doc.
    const result = checkAppointmentConflict({
      appointments,
      members,
      professionalId,
      date,
      startTime,
      endTime,
      excludeId: appointmentId,
      t,
    });
    if (result.hasConflict) {
      throw new AppointmentConflictError(result.message);
    }

    // 4. Bump destino sempre.
    tx.set(destLockRef, {
      businessId,
      professionalId,
      date,
      version: destVersion + 1,
      updatedAt: new Date().toISOString(),
    });

    // 5. Bump origem se moveu (invalida txs concorrentes naquele slot tb).
    if (origLockRef && previous?.professionalId && previous?.date) {
      tx.set(origLockRef, {
        businessId,
        professionalId: previous.professionalId,
        date: previous.date,
        version: origVersion + 1,
        updatedAt: new Date().toISOString(),
      });
    }

    // 6. Update appointment.
    tx.update(targetRef, payload);
  });
}
