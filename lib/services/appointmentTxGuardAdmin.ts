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
 */

import type { Firestore } from 'firebase-admin/firestore';
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

export interface AdminAppointmentPayload {
  businessId: string;
  professionalId?: string;
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

/**
 * Remove da lista os appointments da MESMA turma (mesmo sessionKey) — colegas
 * não conflitam entre si. Sem sessionKey: retorna a lista intacta (exclusivo).
 */
function excludeSameSession(appointments: Appointment[], sessionKey?: string): Appointment[] {
  if (!sessionKey) return appointments;
  return appointments.filter((a) => a.sessionKey !== sessionKey);
}

/** Carrega so o member relevante pro check (working hours). N busca todos
 *  os users do business — overhead desnecessario quando so 1 prof importa. */
async function loadProfessional(adminDb: Firestore, professionalId: string): Promise<User[]> {
  try {
    const snap = await adminDb.collection('users').doc(professionalId).get();
    if (!snap.exists) return [];
    return [{ id: snap.id, ...snap.data() } as User];
  } catch {
    return [];
  }
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
  const { businessId, professionalId, date, startTime, endTime } = payload;
  if (!businessId) throw new Error('createAppointmentSafeAdmin: businessId obrigatorio (R1)');

  const newDocRef = adminDb.collection('appointments').doc();

  // Sem profissional escolhido: pula tx, write direto. Caso raro.
  if (!professionalId) {
    await newDocRef.set(payload);
    return newDocRef.id;
  }

  const members = await loadProfessional(adminDb, professionalId);

  await adminDb.runTransaction(async (tx) => {
    // Admin SDK aceita query reads em tx nativamente — diferente do client.
    const q = adminDb
      .collection('appointments')
      .where('businessId', '==', businessId)
      .where('professionalId', '==', professionalId)
      .where('date', '==', date);
    const snap = await tx.get(q);
    const appointments = excludeSameSession(
      snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment)),
      payload.sessionKey,
    );

    const result = checkAppointmentConflict({
      appointments,
      members,
      professionalId,
      date,
      startTime,
      endTime,
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
  const finalProfessionalId = (patch.professionalId ?? existing.professionalId) as string | undefined;
  const finalDate = (patch.date ?? existing.date) as string;
  const finalStartTime = (patch.startTime ?? existing.startTime) as string;
  const finalEndTime = (patch.endTime ?? existing.endTime) as string;
  const finalSessionKey = (patch.sessionKey ?? existing.sessionKey) as string | undefined;

  // Sem prof: pula re-check.
  if (!finalProfessionalId) {
    await targetRef.update(patch);
    return;
  }

  const members = await loadProfessional(adminDb, finalProfessionalId);

  await adminDb.runTransaction(async (tx) => {
    const q = adminDb
      .collection('appointments')
      .where('businessId', '==', businessId)
      .where('professionalId', '==', finalProfessionalId)
      .where('date', '==', finalDate);
    const snap = await tx.get(q);
    const appointments = excludeSameSession(
      snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment)),
      finalSessionKey,
    );

    const result = checkAppointmentConflict({
      appointments,
      members,
      professionalId: finalProfessionalId,
      date: finalDate,
      startTime: finalStartTime,
      endTime: finalEndTime,
      excludeId: appointmentId,
    });
    if (result.hasConflict) {
      throw new AppointmentConflictError(result.message);
    }

    tx.update(targetRef, patch);
  });
}
