/**
 * lib/services/scheduleBlock-admin.ts
 *
 * Criação e cancelamento de bloqueios de agenda (M06.3a), Admin SDK.
 * Sem efeitos colaterais de dinheiro/estoque — não usa o padrão pesado de
 * `transitionXAdmin` (appointment/deliveryOrder); é um CRUD simples com FSM
 * de 2 estados.
 *
 * Criar um bloqueio NÃO cancela agendamentos existentes que caiam no
 * intervalo — decisão deliberada (evita cascata de reversão de comissão/
 * fidelidade sem revisão humana). `createScheduleBlockAdmin` retorna esses
 * agendamentos como aviso; quem criou decide manualmente o que fazer.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { assertTransitionScheduleBlock } from '@/lib/contracts/fsm/scheduleBlock';
import type { CreateScheduleBlockInput, ScheduleBlock } from '@/lib/contracts/domain/scheduleBlock';
import type { Appointment } from '@/lib/types';

export class ScheduleBlockError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleBlockError';
  }
}

export interface ScheduleBlockActor {
  id: string;
  name: string;
}

/**
 * Agendamentos não-cancelados que caem dentro do intervalo/profissional do
 * bloqueio — usa o índice existente `[businessId, date]` (range num único
 * campo, sem o problema de range-em-dois-campos das buscas de bloqueio).
 */
async function findConflictingAppointments(
  db: Firestore,
  businessId: string,
  input: CreateScheduleBlockInput,
): Promise<Appointment[]> {
  const snap = await db.collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '>=', input.startDate)
    .where('date', '<=', input.endDate)
    .get();

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Appointment))
    .filter((a) => {
      if (a.status === 'cancelado') return false;
      if (input.professionalId) {
        const ids = a.professionalIds?.length ? a.professionalIds : (a.professionalId ? [a.professionalId] : []);
        if (!ids.includes(input.professionalId)) return false;
      }
      if (input.startTime && input.endTime) {
        // Bloqueio com janela — só conta overlap real de horário.
        if (a.endTime <= input.startTime || a.startTime >= input.endTime) return false;
      }
      return true;
    });
}

export async function createScheduleBlockAdmin(params: {
  db?: Firestore;
  businessId: string;
  input: CreateScheduleBlockInput;
  professionalName?: string;
  actor: ScheduleBlockActor;
  now?: Date;
}): Promise<{ block: ScheduleBlock; conflictingAppointments: Appointment[] }> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const ref = db.collection('scheduleBlocks').doc();

  // `professionalId: null` explícito (não ausente) — a query de bloqueio
  // do negócio inteiro em appointmentTxGuard*.ts filtra `== null`, que só
  // bate contra valor explícito no Firestore, nunca campo ausente.
  const doc = {
    businessId: params.businessId,
    professionalId: params.input.professionalId ?? null,
    ...(params.input.professionalId && params.professionalName ? { professionalName: params.professionalName } : {}),
    startDate: params.input.startDate,
    endDate: params.input.endDate,
    ...(params.input.startTime ? { startTime: params.input.startTime } : {}),
    ...(params.input.endTime ? { endTime: params.input.endTime } : {}),
    ...(params.input.reason ? { reason: params.input.reason } : {}),
    status: 'ativo' as const,
    createdBy: params.actor.id,
    createdByName: params.actor.name,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await ref.set(doc);

  const conflictingAppointments = await findConflictingAppointments(db, params.businessId, params.input);

  return {
    block: { id: ref.id, ...doc } as ScheduleBlock,
    conflictingAppointments,
  };
}

export async function cancelScheduleBlockAdmin(params: {
  db?: Firestore;
  blockId: string;
  businessId: string;
  actor: ScheduleBlockActor;
  now?: Date;
}): Promise<{ block: ScheduleBlock }> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const ref = db.collection('scheduleBlocks').doc(params.blockId);

  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new ScheduleBlockError('BLOCK_NOT_FOUND', 'Bloqueio não encontrado.');
  }
  const existing = { id: snapshot.id, ...snapshot.data() } as ScheduleBlock;
  if (existing.businessId !== params.businessId) {
    throw new ScheduleBlockError('TENANT_MISMATCH', 'Bloqueio pertence a outro negócio.');
  }
  assertTransitionScheduleBlock(existing.status, 'cancelado');

  await ref.update({
    status: 'cancelado',
    cancelledAt: nowIso,
    cancelledBy: params.actor.id,
    cancelledByName: params.actor.name,
    updatedAt: nowIso,
  });

  const finalSnapshot = await ref.get();
  return { block: { id: finalSnapshot.id, ...finalSnapshot.data() } as ScheduleBlock };
}
