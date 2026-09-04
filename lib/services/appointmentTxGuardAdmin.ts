/**
 * lib/services/appointmentTxGuardAdmin.ts
 *
 * Versao Admin SDK do guard de conflito de appointment. Diferente do
 * client SDK (lib/services/appointmentTxGuard.ts), o Admin SDK SUPORTA
 * query reads em runTransaction nativo — entao a logica fica mais
 * simples: leitura query DENTRO da tx + check + write, tudo atomico.
 *
 * Quem usa: rotas server-side que criam/editam appointments cross-tenant
 * via API key (ex: /api/v1/appointments). Diferente do AgendaModule
 * (que usa o client SDK em browser do operador), aqui n temos onSnapshot
 * em memoria pra pre-check — a tx eh a UNICA camada de defesa.
 *
 * Ver lib/services/appointmentTxGuard.ts pra contexto da brecha original
 * (race condition em 2 operadores salvando no mesmo slot em <200ms).
 *
 * M06.1: generalizado pra honrar `professionalIds[]` (multi-profissional),
 * não só o campo legado `professionalId`. Antes, um appointment com o
 * profissional em 2ª posição+ do array era invisível tanto à QUERY (só
 * filtrava `professionalId==`) quanto ao CHECK (`checkAppointmentConflict`
 * só recebia 1 id) — dois profissionais podiam ficar duplo-agendados sem
 * nenhum aviso. Fecha de quebra o gap de `!professionalId` pular a tx
 * inteira mesmo com `professionalIds[]` preenchido.
 *
 * Limitação que PERMANECE (documentada, não resolvida aqui): o lock/retry
 * nativo do `runTransaction` protege contra a MESMA operação que já lê essa
 * query — ou seja, duas criações CONCORRENTES continuam serializadas
 * corretamente porque ambas leem/escrevem dentro da mesma transação
 * Firestore (que já detecta e reexecuta em conflito de leitura). O que esta
 * fatia fecha é o BLIND SPOT estático da query/check, não introduz um lock
 * dedicado por profissional secundário — não precisa: a transação em si já
 * serializa qualquer escrita concorrente que bata nos MESMOS documentos lidos.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { checkAppointmentConflict } from '@/lib/services/appointmentConflicts';
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

export interface AdminAppointmentPayload {
  businessId: string;
  professionalId?: string;
  /** Conjunto completo de profissionais (M06.1). Quando presente e não-vazio,
   *  tem prioridade sobre `professionalId` pra fins de conflito/horário. */
  professionalIds?: string[];
  date: string;       // 'YYYY-MM-DD'
  startTime: string;  // 'HH:mm'
  endTime: string;    // 'HH:mm'
  /**
   * Turma (capacity>1): chave canônica da sessão compartilhada. Quando presente,
   * appointments com o MESMO sessionKey são ignorados no check de conflito
   * (são colegas da mesma turma, não competem pelo slot). Ausente = exclusivo,
   * comportamento BIT-A-BIT atual. As VAGAS da turma (capacity) NÃO são contadas
   * aqui — este guard só garante que a turma não colide com OUTRO compromisso do
   * profissional; a contagem de vagas mora no caller (ex: rota de agenda do agente).
   */
  sessionKey?: string;
  [key: string]: unknown;
}

/** `professionalIds[]` (deduplicado) se presente e não-vazio; senão `[professionalId]`; senão `[]`. */
function resolveEffectiveIds(payload: Pick<AdminAppointmentPayload, 'professionalId' | 'professionalIds'>): string[] {
  const ids = payload.professionalIds?.filter(Boolean) ?? [];
  if (ids.length > 0) return [...new Set(ids)];
  return payload.professionalId ? [payload.professionalId] : [];
}

/**
 * Remove da lista os appointments da MESMA turma (mesmo sessionKey) — colegas
 * não conflitam entre si. Sem sessionKey: retorna a lista intacta (exclusivo).
 */
function excludeSameSession(appointments: Appointment[], sessionKey?: string): Appointment[] {
  if (!sessionKey) return appointments;
  return appointments.filter((a) => a.sessionKey !== sessionKey);
}

/** Carrega os members relevantes pro check (working hours) — só os ids
 *  pedidos, não busca todos os users do business. */
async function loadProfessionals(adminDb: Firestore, professionalIds: string[]): Promise<User[]> {
  try {
    const snaps = await Promise.all(professionalIds.map((id) => adminDb.collection('users').doc(id).get()));
    return snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() } as User));
  } catch {
    return [];
  }
}

/**
 * Busca appointments do dia que compartilham QUALQUER um dos profissionais
 * pedidos — 2 queries transacionalmente rastreadas (`tx.get`), mergeadas por
 * doc.id. `in`/`array-contains-any` usam os mesmos índices compostos já
 * declarados pra `==`/`array-contains` (nenhum índice novo necessário).
 * `tx.get(query)` (não `query.get()`) é o que garante que uma escrita
 * concorrente batendo nesses mesmos docs entre a leitura e o commit force a
 * transação a reexecutar — perder isso reintroduziria a race original.
 */
async function fetchDayAppointmentsForProfessionalsTx(
  tx: Transaction,
  adminDb: Firestore,
  businessId: string,
  date: string,
  professionalIds: string[],
): Promise<Appointment[]> {
  const legacyQ = adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('professionalId', 'in', professionalIds)
    .where('date', '==', date);
  const arrayQ = adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('professionalIds', 'array-contains-any', professionalIds)
    .where('date', '==', date);
  const [legacySnap, arraySnap] = await Promise.all([tx.get(legacyQ), tx.get(arrayQ)]);
  const seen = new Set<string>();
  const out: Appointment[] = [];
  for (const doc of [...legacySnap.docs, ...arraySnap.docs]) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      out.push({ id: doc.id, ...doc.data() } as Appointment);
    }
  }
  return out;
}

/**
 * Filtra em memória o que a query não conseguiu (só `startDate <= date` foi
 * pro servidor — Firestore não aceita range em dois campos diferentes na
 * mesma query). Blocos são raros (dúzia/ano por negócio) — filtro em memória
 * é apropriado, mesmo padrão pragmático das auditorias M02/M06.
 */
function filterActiveBlocksForDate(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  date: string,
): ScheduleBlock[] {
  return docs
    .map((d) => ({ id: d.id, ...d.data() } as ScheduleBlock))
    .filter((b) => b.status === 'ativo' && b.endDate >= date);
}

/**
 * Busca bloqueios ativos relevantes: do negócio inteiro (`professionalId`
 * gravado explicitamente como `null` — Firestore só bate `==null` contra
 * valor explícito, não campo ausente) + dos profissionais pedidos. 2 queries
 * (`tx.get`, rastreadas — mesma razão de `fetchDayAppointmentsForProfessionalsTx`).
 */
async function fetchActiveBlocksTx(
  tx: Transaction,
  adminDb: Firestore,
  businessId: string,
  date: string,
  professionalIds: string[],
): Promise<ScheduleBlock[]> {
  const businessWideQuery = adminDb.collection('scheduleBlocks')
    .where('businessId', '==', businessId)
    .where('professionalId', '==', null)
    .where('startDate', '<=', date);
  const queries = [tx.get(businessWideQuery)];
  if (professionalIds.length > 0) {
    queries.push(tx.get(
      adminDb.collection('scheduleBlocks')
        .where('businessId', '==', businessId)
        .where('professionalId', 'in', professionalIds)
        .where('startDate', '<=', date),
    ));
  }
  const snapshots = await Promise.all(queries);
  return filterActiveBlocksForDate(snapshots.flatMap((s) => s.docs), date);
}

/**
 * Intervalo mínimo (minutos) configurado no negócio (M06.3c). `tx.get` num
 * doc ref simples (não query) — mesma consistência transacional dos outros
 * reads deste arquivo, custo mínimo (1 doc por ID, não índice).
 */
async function fetchBusinessBufferMinutesTx(tx: Transaction, adminDb: Firestore, businessId: string): Promise<number> {
  const snap = await tx.get(adminDb.collection('businesses').doc(businessId));
  return (snap.data()?.settings?.appointmentBufferMinutes as number | undefined) ?? 0;
}

/** Mesma busca de {@link fetchActiveBlocksTx}, sem transação — usada no caminho
 *  "sem profissional escolhido" (write direto, fora de tx). */
async function fetchActiveBlocks(
  adminDb: Firestore,
  businessId: string,
  date: string,
  professionalIds: string[],
): Promise<ScheduleBlock[]> {
  const businessWideQuery = adminDb.collection('scheduleBlocks')
    .where('businessId', '==', businessId)
    .where('professionalId', '==', null)
    .where('startDate', '<=', date);
  const queries = [businessWideQuery.get()];
  if (professionalIds.length > 0) {
    queries.push(
      adminDb.collection('scheduleBlocks')
        .where('businessId', '==', businessId)
        .where('professionalId', 'in', professionalIds)
        .where('startDate', '<=', date)
        .get(),
    );
  }
  const snapshots = await Promise.all(queries);
  return filterActiveBlocksForDate(snapshots.flatMap((s) => s.docs), date);
}

/**
 * Cria appointment com re-check atomico via Admin SDK tx. Lanca
 * AppointmentConflictError em race lost.
 *
 * @returns ID do novo doc
 */
export async function createAppointmentSafeAdmin(
  adminDb: Firestore,
  payload: AdminAppointmentPayload,
): Promise<string> {
  const { businessId, date, startTime, endTime } = payload;
  if (!businessId) throw new Error('createAppointmentSafeAdmin: businessId obrigatorio (R1)');

  const newDocRef = adminDb.collection('appointments').doc();
  const effectiveIds = resolveEffectiveIds(payload);

  // Sem NENHUM profissional escolhido (nem legado, nem professionalIds[]):
  // pula a tx de conflito, mas AINDA checa bloqueio do negócio inteiro (ex.:
  // feriado) — isso vale mesmo sem profissional selecionado. Não-transacional
  // (bloqueio é raro e admin-gerenciado, não alvo de corrida real).
  if (effectiveIds.length === 0) {
    const blocks = await fetchActiveBlocks(adminDb, businessId, date, []);
    const result = checkAppointmentConflict({ appointments: [], members: [], professionalId: '', date, startTime, endTime, blocks });
    if (result.hasConflict) throw new AppointmentConflictError(result.message);
    await newDocRef.set(payload);
    return newDocRef.id;
  }

  const members = await loadProfessionals(adminDb, effectiveIds);

  await adminDb.runTransaction(async (tx) => {
    const [dayAppointments, blocks, bufferMinutes] = await Promise.all([
      fetchDayAppointmentsForProfessionalsTx(tx, adminDb, businessId, date, effectiveIds),
      fetchActiveBlocksTx(tx, adminDb, businessId, date, effectiveIds),
      fetchBusinessBufferMinutesTx(tx, adminDb, businessId),
    ]);
    const appointments = excludeSameSession(dayAppointments, payload.sessionKey);

    const result = checkAppointmentConflict({
      appointments,
      members,
      professionalId: effectiveIds[0],
      professionalIds: effectiveIds,
      date,
      startTime,
      endTime,
      blocks,
      bufferMinutes,
    });
    if (result.hasConflict) {
      throw new AppointmentConflictError(result.message);
    }

    tx.set(newDocRef, payload);
  });

  return newDocRef.id;
}

/**
 * Atualiza appointment com re-check atomico via Admin SDK tx. Aceita patch
 * parcial — re-le o doc atual dentro da tx pra resolver campos ausentes
 * (date/startTime/endTime/professionalId herdam do existente quando n
 * passados no patch).
 */
export async function updateAppointmentSafeAdmin(
  adminDb: Firestore,
  appointmentId: string,
  patch: Partial<AdminAppointmentPayload> & { businessId: string },
): Promise<void> {
  const { businessId } = patch;
  if (!businessId) throw new Error('updateAppointmentSafeAdmin: businessId obrigatorio (R1)');
  if (!appointmentId) throw new Error('updateAppointmentSafeAdmin: appointmentId obrigatorio');

  const targetRef = adminDb.collection('appointments').doc(appointmentId);

  // Pre-fetch pro lookup do member (fora da tx — leitura de outra colecao
  // n entra na atomicidade do check). Nao queremos transactionar `users` —
  // overhead sem ganho.
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new Error('updateAppointmentSafeAdmin: appointment not found');
  const existing = targetSnap.data() as Appointment;
  if (existing.businessId !== businessId) {
    throw new Error('updateAppointmentSafeAdmin: appointment belongs to other business');
  }

  // Resolve campos finais herdando do existente quando n vem no patch.
  const finalDate = (patch.date ?? existing.date) as string;
  const finalStartTime = (patch.startTime ?? existing.startTime) as string;
  const finalEndTime = (patch.endTime ?? existing.endTime) as string;
  const finalSessionKey = (patch.sessionKey ?? existing.sessionKey) as string | undefined;
  const finalEffectiveIds = resolveEffectiveIds({
    professionalId: (patch.professionalId ?? existing.professionalId) as string | undefined,
    professionalIds: (patch.professionalIds ?? existing.professionalIds) as string[] | undefined,
  });

  // Sem NENHUM profissional (nem legado, nem array): pula re-check de
  // overlap, mas ainda checa bloqueio do negócio inteiro pra essa data.
  if (finalEffectiveIds.length === 0) {
    const blocks = await fetchActiveBlocks(adminDb, businessId, finalDate, []);
    const result = checkAppointmentConflict({ appointments: [], members: [], professionalId: '', date: finalDate, startTime: finalStartTime, endTime: finalEndTime, excludeId: appointmentId, blocks });
    if (result.hasConflict) throw new AppointmentConflictError(result.message);
    await targetRef.update(patch);
    return;
  }

  const members = await loadProfessionals(adminDb, finalEffectiveIds);

  await adminDb.runTransaction(async (tx) => {
    const [dayAppointments, blocks, bufferMinutes] = await Promise.all([
      fetchDayAppointmentsForProfessionalsTx(tx, adminDb, businessId, finalDate, finalEffectiveIds),
      fetchActiveBlocksTx(tx, adminDb, businessId, finalDate, finalEffectiveIds),
      fetchBusinessBufferMinutesTx(tx, adminDb, businessId),
    ]);
    const appointments = excludeSameSession(dayAppointments, finalSessionKey);

    const result = checkAppointmentConflict({
      appointments,
      members,
      professionalId: finalEffectiveIds[0],
      professionalIds: finalEffectiveIds,
      date: finalDate,
      startTime: finalStartTime,
      endTime: finalEndTime,
      excludeId: appointmentId,
      blocks,
      bufferMinutes,
    });
    if (result.hasConflict) {
      throw new AppointmentConflictError(result.message);
    }

    tx.update(targetRef, patch);
  });
}
