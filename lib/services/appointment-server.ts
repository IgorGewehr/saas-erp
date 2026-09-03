/**
 * lib/services/appointment-server.ts
 *
 * Núcleo server-side de agendamento (M06.1/M06.2). Mirror do padrão já usado
 * em `lib/services/delivery-order-transition-admin.ts` (M02.5d).
 *
 * `transitionAppointmentAdmin` fecha o bug real de "conclusão sem efeito":
 * antes, `AgendaModule.tsx` fazia `updateDoc(status)` no browser e, numa
 * chamada SEPARADA depois, disparava o evento que aplica comissão/
 * fidelidade/baixa de insumo/métricas (`fetch('/api/events/dispatch')`). Se
 * o navegador morresse entre as duas, o atendimento ficava `concluido` pra
 * sempre sem nenhum efeito aplicado — e nada varria pra reprocessar. Aqui os
 * dois passos são UMA chamada de servidor: valida a FSM, aplica o patch de
 * status e — na mesma execução — despacha `appointment.completed`/
 * `appointment.canceled` via `dispatchDomainEvent` (já síncrono/aguardado).
 *
 * `createAppointmentAdmin` é um wrapper fino sobre `createAppointmentSafeAdmin`
 * (guard já corrigido pra `professionalIds[]` na M06.1) — usado pela rota
 * `POST /api/appointments`, que substitui os `addDoc` diretos de
 * `ScheduleActionDialog.tsx` (CRM) e `PDVModule.tsx` (retorno/pré-agendamento).
 */

import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { assertTransitionAppointment } from '@/lib/contracts/fsm/appointment';
import { dispatchDomainEvent } from '@/lib/contracts/_runtime/dispatch';
import { createAppointmentSafeAdmin, type AdminAppointmentPayload } from '@/lib/services/appointmentTxGuardAdmin';
import type { Appointment, AppointmentStatus } from '@/lib/types';

export class AppointmentTransitionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppointmentTransitionError';
  }
}

export interface AppointmentTransitionActor {
  id: string;
  name: string;
}

export interface AppointmentTransitionResult {
  appointment: Appointment;
  /** true quando esta chamada disparou appointment.completed/canceled. */
  dispatched: boolean;
}

/**
 * Transição de status server-side. Valida tenant + FSM, aplica o patch e,
 * na MESMA chamada, despacha o evento de conclusão/reversão quando aplicável
 * — eliminando a janela de dois passos separados que existia no client.
 *
 * Os handlers reais (`appointmentCompleted.ts`/`appointmentCanceled.ts`) não
 * mudam: já relêem o documento fresco e já são idempotentes via
 * `completionAppliedAt`. `dispatchDomainEvent` nunca propaga falha de handler
 * pro caller (já loga e persiste em `domainEvents/{id}`) — mesma resiliência
 * que as chamadas `.catch(err => console.warn(...))` do client já tinham.
 */
export async function transitionAppointmentAdmin(params: {
  db?: Firestore;
  appointmentId: string;
  businessId: string;
  targetStatus: AppointmentStatus;
  actor: AppointmentTransitionActor;
  now?: Date;
}): Promise<AppointmentTransitionResult> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const ref = db.collection('appointments').doc(params.appointmentId);

  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new AppointmentTransitionError('APPOINTMENT_NOT_FOUND', 'Agendamento não encontrado.');
  }
  const appointment = { id: snapshot.id, ...snapshot.data() } as Appointment;
  if (appointment.businessId !== params.businessId) {
    throw new AppointmentTransitionError('TENANT_MISMATCH', 'Agendamento pertence a outro negócio.');
  }

  const fromStatus = appointment.status;
  const toStatus = params.targetStatus;
  if (toStatus !== fromStatus) {
    assertTransitionAppointment(fromStatus, toStatus); // throws 'Appointment FSM: ...' em transição inválida
  }

  const patch: Record<string, unknown> = { status: toStatus, updatedAt: nowIso };
  if (toStatus === 'cancelado') {
    patch.cancelledAt = nowIso;
    patch.cancelledBy = params.actor.id;
    patch.cancelledByName = params.actor.name;
  }
  await ref.update(patch);

  const wasDone = fromStatus === 'concluido';
  const isDone = toStatus === 'concluido';
  let dispatched = false;

  if (!wasDone && isDone) {
    await dispatchDomainEvent(db, {
      type: 'appointment.completed',
      businessId: params.businessId,
      occurredAt: nowIso,
      actorType: 'user',
      actorId: params.actor.id,
      actorName: params.actor.name,
      appointmentId: params.appointmentId,
      clientId: appointment.clientId,
      professionalId: appointment.professionalId,
      serviceId: appointment.serviceId,
      amount: appointment.price || 0,
    });
    dispatched = true;
  } else if (wasDone && !isDone) {
    await dispatchDomainEvent(db, {
      type: 'appointment.canceled',
      businessId: params.businessId,
      occurredAt: nowIso,
      actorType: 'user',
      actorId: params.actor.id,
      actorName: params.actor.name,
      appointmentId: params.appointmentId,
    });
    dispatched = true;
  }

  const finalSnapshot = await ref.get();
  return {
    appointment: { id: finalSnapshot.id, ...finalSnapshot.data() } as Appointment,
    dispatched,
  };
}

/**
 * Criação autoritativa server-side (Admin SDK) — thin wrapper sobre
 * `createAppointmentSafeAdmin` (já honra `professionalIds[]`, M06.1). Usado
 * pela rota `POST /api/appointments`.
 */
export async function createAppointmentAdmin(params: {
  db?: Firestore;
  payload: AdminAppointmentPayload;
}): Promise<{ id: string }> {
  const db = params.db ?? adminDb;
  const id = await createAppointmentSafeAdmin(db, params.payload);
  return { id };
}
