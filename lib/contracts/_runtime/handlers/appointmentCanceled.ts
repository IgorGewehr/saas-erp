/**
 * lib/contracts/_runtime/handlers/appointmentCanceled.ts
 *
 * Handler de `appointment.canceled` — reverte os efeitos aplicados por
 * `handleAppointmentCompleted` quando um appointment sai de `concluido`
 * (ex.: correção de status feita por um manager). Só reverte o que
 * `appointment.completionAppliedAt` confirma ter sido de fato aplicado —
 * evento repetido ou appointment que nunca completou é no-op.
 *
 * Escopo preservado do comportamento anterior (chamadas inline em
 * AgendaModule.tsx): reverte comissão e métricas do cliente. Não reverte
 * fidelidade nem baixa de estoque — essas reversões nunca existiram no
 * caminho client e não são introduzidas aqui (não é regressão).
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { DomainEventOf } from '../../events';
import type { DispatchContext } from '../dispatch';
import type { Appointment } from '@/lib/types';
import { syncClientMetricsAdmin } from '@/lib/services/clientMetricsAdmin';
import { maybeCancelCommissionAdmin } from '@/lib/services/commission';

export async function handleAppointmentCanceled(
  event: DomainEventOf<'appointment.canceled'>,
  ctx: DispatchContext,
): Promise<void> {
  const { db } = ctx;
  const apptRef = db.collection('appointments').doc(event.appointmentId);
  const apptSnap = await apptRef.get();

  if (!apptSnap.exists) {
    console.warn(`[appointment.canceled] appointment ${event.appointmentId} não encontrado — ignorando.`);
    return;
  }
  const appointment = { id: apptSnap.id, ...apptSnap.data() } as Appointment;

  if (appointment.businessId !== event.businessId) {
    console.warn(`[appointment.canceled] businessId do evento não bate com o appointment ${event.appointmentId} — ignorando.`);
    return;
  }
  if (!appointment.completionAppliedAt) {
    return; // nunca teve efeito de conclusão aplicado — nada a reverter
  }

  try {
    await maybeCancelCommissionAdmin(db, appointment.commissionTransactionId);
  } catch (err) {
    console.warn('[appointment.canceled] cancelamento de comissão falhou:', err);
  }

  if (appointment.clientId) {
    try {
      await syncClientMetricsAdmin({
        db,
        clientId: appointment.clientId,
        visitDelta: -1,
        priceDelta: -(appointment.price || 0),
      });
    } catch (err) {
      console.warn('[appointment.canceled] reversão de métricas do cliente falhou:', err);
    }
  }

  await apptRef.update({ completionAppliedAt: FieldValue.delete() });
}
