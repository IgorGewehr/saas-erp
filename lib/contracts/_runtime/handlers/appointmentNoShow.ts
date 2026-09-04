/**
 * lib/contracts/_runtime/handlers/appointmentNoShow.ts
 *
 * Handler real de `appointment.noShow` — fecha o gap "marcar não gera
 * medida nenhuma" (M06.3, P1.9): antes, transicionar um agendamento pra
 * `nao_compareceu` só gravava o status, sem nenhum efeito.
 *
 * NÃO confia no payload do evento: relê o Appointment fresco por `ctx.db` e
 * só aplica efeito se o doc real confirmar `status === 'nao_compareceu'` e o
 * `businessId` bater — mesma superfície fechada que `appointmentCompleted.ts`
 * já fecha contra evento forjado.
 *
 * Idempotência: `appointment.noShowAppliedAt` é o CAS, setado ANTES do
 * efeito. Diferente de `completionAppliedAt`, nunca é revertido —
 * `nao_compareceu` é terminal de verdade na FSM (transição vazia, sem
 * caminho de volta), então não existe handler de "reversão" simétrico.
 */

import type { DomainEventOf } from '../../events';
import type { DispatchContext } from '../dispatch';
import type { Appointment } from '@/lib/types';
import { bumpClientNoShowCountAdmin } from '@/lib/services/clientMetricsAdmin';

export async function handleAppointmentNoShow(
  event: DomainEventOf<'appointment.noShow'>,
  ctx: DispatchContext,
): Promise<void> {
  const { db } = ctx;
  const apptRef = db.collection('appointments').doc(event.appointmentId);
  const apptSnap = await apptRef.get();

  if (!apptSnap.exists) {
    console.warn(`[appointment.noShow] appointment ${event.appointmentId} não encontrado — ignorando.`);
    return;
  }
  const appointment = { id: apptSnap.id, ...apptSnap.data() } as Appointment;

  if (appointment.businessId !== event.businessId) {
    console.warn(`[appointment.noShow] businessId do evento não bate com o appointment ${event.appointmentId} — ignorando.`);
    return;
  }
  if (appointment.status !== 'nao_compareceu') {
    console.warn(`[appointment.noShow] appointment ${event.appointmentId} não está nao_compareceu (status=${appointment.status}) — ignorando efeito.`);
    return;
  }
  if (appointment.noShowAppliedAt) {
    return; // já aplicado — idempotência
  }

  const now = new Date().toISOString();
  await apptRef.update({ noShowAppliedAt: now });

  if (appointment.clientId) {
    try {
      await bumpClientNoShowCountAdmin({ db, clientId: appointment.clientId });
    } catch (err) {
      console.warn('[appointment.noShow] incremento de noShowCount falhou:', err);
    }
  }
}
