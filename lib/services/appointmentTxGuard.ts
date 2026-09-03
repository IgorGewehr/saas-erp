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
import { countSeatsTaken } from '@/lib/services/groupSession';
import type { ScheduleBlock } from '@/contracts/domain/scheduleBlock';
import type { Appointment, User } from '@/lib/types';

/** Erro tipado pra que o caller diferencie conflito vs falha generica. */
export class AppointmentConflictError extends Error {
  readonly code = 'APPOINTMENT_CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AppointmentConflictError';
  }
}

/**
 * Turma (capacity>1) cheia: todas as vagas da sessão já estão ocupadas por
 * appointments não-cancelados com o mesmo sessionKey. Tipado pra que o caller
 * (UI/agent) diferencie "cheia" de "conflito de horário" e mostre msg própria.
 */
export class SessionFullError extends Error {
  readonly code = 'SESSION_FULL' as const;
  readonly capacity: number;
  constructor(message: string, capacity: number) {
    super(message);
    this.name = 'SessionFullError';
    this.capacity = capacity;
  }
}

export interface AppointmentTxPayload {
  businessId: string;
  professionalId?: string;
  /** Conjunto completo de profissionais (M06.1). Quando presente e não-vazio,
   *  tem prioridade sobre `professionalId` pra fins de conflito/horário. */
  professionalIds?: string[];
  date: string;       // 'YYYY-MM-DD'
  startTime: string;  // 'HH:mm'
  endTime: string;    // 'HH:mm'
  /**
   * Turma (capacity>1): chave canônica da sessão. Quando presente, appointments
   * com o MESMO sessionKey são ignorados no check de conflito (colegas de turma).
   * Ausente = exclusivo, comportamento BIT-A-BIT atual.
   */
  sessionKey?: string;
  /**
   * Capacidade efetiva da turma. Quando presente JUNTO de `sessionKey`, o guard
   * conta vagas DENTRO da tx (count não-cancelados com mesmo sessionKey) e lança
   * SessionFullError se já estiver cheia — fechando a race do "última vaga".
   * Ausente/≤1 = exclusivo, sem contagem.
   */
  capacity?: number;
  /** Restante do payload — passado direto pro tx.set/tx.update. */
  [key: string]: unknown;
}

/** true quando o payload descreve uma reserva de turma com contagem de vagas. */
function isGroupPayload(payload: AppointmentTxPayload): boolean {
  return !!payload.sessionKey && typeof payload.capacity === 'number' && payload.capacity > 1;
}

/** `professionalIds[]` (deduplicado) se presente e não-vazio; senão `[professionalId]`; senão `[]`. */
function resolveEffectiveIds(payload: Pick<AppointmentTxPayload, 'professionalId' | 'professionalIds'>): string[] {
  const ids = payload.professionalIds?.filter(Boolean) ?? [];
  if (ids.length > 0) return [...new Set(ids)];
  return payload.professionalId ? [payload.professionalId] : [];
}

/**
 * Busca appointments do dia que compartilham QUALQUER um dos profissionais
 * pedidos — 2 queries mergeadas por doc.id (mesmo formato Admin de
 * `fetchDayAppointmentsForProfessionalsTx` em appointmentTxGuardAdmin.ts,
 * mas com `getDocs` client SDK — tx client não aceita query reads, então
 * roda fora do `tx.get`, dentro do callback, pra reexecutar fresco em
 * reattempt). `in`/`array-contains-any` usam os mesmos índices compostos já
 * declarados pra `==`/`array-contains`.
 */
async function fetchDayAppointmentsForProfessionalsClient(
  db: Firestore,
  businessId: string,
  date: string,
  professionalIds: string[],
): Promise<Appointment[]> {
  const legacyQ = query(
    collection(db, 'appointments'),
    where('businessId', '==', businessId),
    where('professionalId', 'in', professionalIds),
    where('date', '==', date),
  );
  const arrayQ = query(
    collection(db, 'appointments'),
    where('businessId', '==', businessId),
    where('professionalIds', 'array-contains-any', professionalIds),
    where('date', '==', date),
  );
  const [legacySnap, arraySnap] = await Promise.all([getDocs(legacyQ), getDocs(arrayQ)]);
  const seen = new Set<string>();
  const out: Appointment[] = [];
  for (const d of [...legacySnap.docs, ...arraySnap.docs]) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      out.push({ id: d.id, ...d.data() } as Appointment);
    }
  }
  return out;
}

/** Filtra em memória o que a query não pôde (só `startDate<=date` foi pro
 *  servidor) — mesmo padrão pragmático do lado Admin. */
function filterActiveBlocksForDate(
  docs: Array<{ id: string; data: () => unknown }>,
  date: string,
): ScheduleBlock[] {
  return docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as ScheduleBlock))
    .filter((b) => b.status === 'ativo' && b.endDate >= date);
}

/**
 * Busca bloqueios ativos relevantes (negócio inteiro + profissionais
 * pedidos) — mesma lógica de `fetchActiveBlocksTx` em
 * appointmentTxGuardAdmin.ts, com `getDocs` client SDK.
 */
async function fetchActiveBlocksClient(
  db: Firestore,
  businessId: string,
  date: string,
  professionalIds: string[],
): Promise<ScheduleBlock[]> {
  const queries = [
    getDocs(query(
      collection(db, 'scheduleBlocks'),
      where('businessId', '==', businessId),
      where('professionalId', '==', null),
      where('startDate', '<=', date),
    )),
  ];
  if (professionalIds.length > 0) {
    queries.push(getDocs(query(
      collection(db, 'scheduleBlocks'),
      where('businessId', '==', businessId),
      where('professionalId', 'in', professionalIds),
      where('startDate', '<=', date),
    )));
  }
  const snapshots = await Promise.all(queries);
  return filterActiveBlocksForDate(snapshots.flatMap((s) => s.docs), date);
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
 * Lock por SESSÃO (turma) — usado pra turmas SEM profissional fixo ('any'),
 * onde o dayLock (chaveado por prof) não existe. Serializa as reservas da MESMA
 * sessão pra que a contagem de vagas seja consistente sob concorrência (2
 * recepcionistas preenchendo a última vaga: um sucede, o outro reexecuta a tx,
 * relê o doc novo, conta cheia → SessionFullError). sessionKey já é único por
 * serviço+data+horário, então identifica a turma globalmente.
 */
function sessionLockRef(db: Firestore, businessId: string, sessionKey: string) {
  return doc(db, 'appointmentSessionLocks', `${businessId}_${sessionKey}`);
}

/**
 * Conta vagas de uma turma DENTRO da tx e lança SessionFullError se cheia.
 * `excludeId` ignora o próprio doc (edição que não muda de sessão). Só conta
 * quando o payload é de turma (isGroupPayload) — exclusivo é no-op.
 */
function assertSeatsAvailable(
  payload: AppointmentTxPayload,
  dayAppointments: Appointment[],
  excludeId?: string,
): void {
  if (!isGroupPayload(payload)) return;
  const others = excludeId ? dayAppointments.filter((a) => a.id !== excludeId) : dayAppointments;
  const taken = countSeatsTaken(others, payload.sessionKey!);
  if (taken >= payload.capacity!) {
    throw new SessionFullError(
      `Turma cheia (${payload.capacity}/${payload.capacity} vagas ocupadas).`,
      payload.capacity!,
    );
  }
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
  const { businessId, date, startTime, endTime } = payload;
  if (!businessId) throw new Error('createAppointmentSafe: businessId obrigatorio (R1)');

  const newDocRef = doc(collection(db, 'appointments'));
  const effectiveIds = resolveEffectiveIds(payload);

  // Sem NENHUM profissional escolhido (slot "da casa" / turma aberta 'any').
  if (effectiveIds.length === 0) {
    // Bloqueio do negócio inteiro (feriado/fechamento) vale mesmo sem
    // profissional escolhido. Não-transacional — bloqueio é raro/admin-
    // gerenciado, não alvo de corrida real (mesmo racional do lado Admin).
    const businessBlocks = await fetchActiveBlocksClient(db, businessId, date, []);
    const blockCheck = checkAppointmentConflict({
      appointments: [], members, professionalId: '', date, startTime, endTime, blocks: businessBlocks, t,
    });
    if (blockCheck.hasConflict) throw new AppointmentConflictError(blockCheck.message);

    // Turma aberta: ainda precisa de contagem de vagas atômica. Serializa via
    // session-lock (chaveado por sessionKey, já que não há prof). Sem isso, 2
    // operadores estouravam a capacidade da última vaga.
    if (isGroupPayload(payload)) {
      const lockRef = sessionLockRef(db, businessId, payload.sessionKey!);
      await runTransaction(db, async (tx) => {
        const lockSnap = await tx.get(lockRef);
        const currentVersion = (lockSnap.data()?.version as number | undefined) ?? 0;

        // Query por dia (índice businessId+date existente); a contagem filtra
        // por sessionKey em memória via countSeatsTaken.
        const q = query(
          collection(db, 'appointments'),
          where('businessId', '==', businessId),
          where('date', '==', date),
        );
        const snap = await getDocs(q);
        const dayAppts = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
        assertSeatsAvailable(payload, dayAppts);

        tx.set(lockRef, {
          businessId,
          sessionKey: payload.sessionKey,
          version: currentVersion + 1,
          updatedAt: new Date().toISOString(),
        });
        tx.set(newDocRef, payload);
      });
      return newDocRef.id;
    }
    // Exclusivo sem prof: write simples (comportamento BIT-A-BIT atual). Caso
    // raro; n bloqueia ningem em slot pq n ha "dono" do horario.
    const { setDoc } = await import('firebase/firestore');
    await setDoc(newDocRef, payload);
    return newDocRef.id;
  }

  // Day-lock só do profissional PRIMÁRIO (effectiveIds[0]) — limitação
  // documentada: a QUERY abaixo já enxerga conflito em qualquer profissional
  // do conjunto (fecha o blind spot estático), mas a serialização atômica
  // via lock/retry continua garantida só pro primário. Duas reservas
  // concorrentes (<200ms) pra um profissional secundário não têm essa MESMA
  // garantia de retry — caso real de conflito em profissional secundário
  // fica pra quando houver demanda (M06.3+).
  const primaryId = effectiveIds[0];
  const lockRef = dayLockRef(db, businessId, primaryId, date);

  await runTransaction(db, async (tx) => {
    // 1. tx.get(lockRef) — leitura rastreada. Qualquer write no lockRef
    //    entre aqui e o commit forca reexecucao da callback.
    const lockSnap = await tx.get(lockRef);
    const currentVersion = (lockSnap.data()?.version as number | undefined) ?? 0;

    // 2. getDocs fora da tx mas dentro do callback — re-roda na reattempt
    //    com dado fresco. Necessario pq tx Firestore client n aceita
    //    query reads (so doc reads). Generalizado (M06.1) pra enxergar
    //    QUALQUER profissional do conjunto, não só o primário. M06.3a:
    //    busca bloqueios de agenda junto.
    const [dayAppts, blocks] = await Promise.all([
      fetchDayAppointmentsForProfessionalsClient(db, businessId, date, effectiveIds),
      fetchActiveBlocksClient(db, businessId, date, effectiveIds),
    ]);
    const appointments = excludeSameSession(dayAppts, payload.sessionKey);

    // 3. Check overlap puro (colegas da mesma turma já foram excluídos acima).
    const result = checkAppointmentConflict({
      appointments,
      members,
      professionalId: primaryId,
      professionalIds: effectiveIds,
      date,
      startTime,
      endTime,
      blocks,
      t,
    });
    if (result.hasConflict) {
      throw new AppointmentConflictError(result.message);
    }

    // 3b. Turma: conta vagas sobre a lista COMPLETA do dia (colegas incluídos).
    //     Como o dayLock serializa prof+data, a contagem é consistente.
    assertSeatsAvailable(payload, dayAppts);

    // 4. Bump lock — invalida txs concorrentes que ja leram version antiga.
    tx.set(lockRef, {
      businessId,
      professionalId: primaryId,
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
  const { businessId, date, startTime, endTime } = payload;
  if (!businessId) throw new Error('updateAppointmentSafe: businessId obrigatorio (R1)');
  if (!appointmentId) throw new Error('updateAppointmentSafe: appointmentId obrigatorio');

  const targetRef = doc(db, 'appointments', appointmentId);
  const effectiveIds = resolveEffectiveIds(payload);

  // Sem NENHUM profissional novo: pula tx (raro em edits, mas defensivo),
  // mas ainda checa bloqueio do negócio inteiro pra essa data.
  if (effectiveIds.length === 0) {
    const businessBlocks = await fetchActiveBlocksClient(db, businessId, date, []);
    const blockCheck = checkAppointmentConflict({
      appointments: [], members, professionalId: '', date, startTime, endTime, excludeId: appointmentId, blocks: businessBlocks, t,
    });
    if (blockCheck.hasConflict) throw new AppointmentConflictError(blockCheck.message);

    // Turma aberta ('any'): valida vagas no destino via session-lock, excluindo
    // o próprio doc. Espelha o caminho de create pra mover de turma com
    // segurança de capacidade.
    if (isGroupPayload(payload)) {
      const lockRef = sessionLockRef(db, businessId, payload.sessionKey!);
      await runTransaction(db, async (tx) => {
        const lockSnap = await tx.get(lockRef);
        const currentVersion = (lockSnap.data()?.version as number | undefined) ?? 0;
        const q = query(
          collection(db, 'appointments'),
          where('businessId', '==', businessId),
          where('date', '==', date),
        );
        const snap = await getDocs(q);
        const dayAppts = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
        assertSeatsAvailable(payload, dayAppts, appointmentId);
        tx.set(lockRef, {
          businessId,
          sessionKey: payload.sessionKey,
          version: currentVersion + 1,
          updatedAt: new Date().toISOString(),
        });
        tx.update(targetRef, payload);
      });
      return;
    }
    const { updateDoc } = await import('firebase/firestore');
    await updateDoc(targetRef, payload);
    return;
  }

  // Lock só do profissional PRIMÁRIO — mesma limitação documentada em
  // createAppointmentSafe.
  const primaryId = effectiveIds[0];
  const destLockRef = dayLockRef(db, businessId, primaryId, date);
  // Origem so se houve mudanca real (prof OU date diferentes) — senao seria
  // bumpar o mesmo lock 2x na mesma tx (no-op redundante).
  const movedProf = previous?.professionalId && previous.professionalId !== primaryId;
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

    // 2. getDocs no destino (conjunto de profissionais + date novos). M06.3a:
    //    busca bloqueios de agenda junto.
    const [dayAppts, blocks] = await Promise.all([
      fetchDayAppointmentsForProfessionalsClient(db, businessId, date, effectiveIds),
      fetchActiveBlocksClient(db, businessId, date, effectiveIds),
    ]);
    const appointments = excludeSameSession(dayAppts, payload.sessionKey);

    // 3. Check overlap, ignorando o proprio doc.
    const result = checkAppointmentConflict({
      appointments,
      members,
      professionalId: primaryId,
      professionalIds: effectiveIds,
      date,
      startTime,
      endTime,
      excludeId: appointmentId,
      blocks,
      t,
    });
    if (result.hasConflict) {
      throw new AppointmentConflictError(result.message);
    }

    // 3b. Turma: re-valida vagas no destino, excluindo o próprio doc (mover um
    //     aluno pra outra sessão não pode estourar a capacidade da nova turma).
    assertSeatsAvailable(payload, dayAppts, appointmentId);

    // 4. Bump destino sempre.
    tx.set(destLockRef, {
      businessId,
      professionalId: primaryId,
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
