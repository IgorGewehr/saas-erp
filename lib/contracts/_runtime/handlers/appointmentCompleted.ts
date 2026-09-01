/**
 * lib/contracts/_runtime/handlers/appointmentCompleted.ts
 *
 * Handler real de `appointment.completed` — aplica os efeitos que antes
 * viviam inline, triplicados e divergentes, em AgendaModule.tsx (criar já
 * concluído, editar pra concluído, mudança rápida de status).
 *
 * NÃO confia no payload do evento para status/valor: relê o Appointment
 * fresco por `ctx.db` e só aplica efeito se o doc real confirmar
 * `status === 'concluido'` e o `businessId` bater. Isso fecha a superfície
 * de "evento forjado" — antes, qualquer client autenticado podia POSTAR
 * `/api/events/dispatch` com um `appointmentId` real e um `amount`
 * fabricado, e nada revalidava contra o documento de verdade.
 *
 * Idempotência: `appointment.completionAppliedAt` é o CAS. Setado ANTES de
 * rodar os efeitos, então um replay do mesmo evento (retry de rede, dispatch
 * duplicado) não duplica métricas/comissão/fidelidade/baixa de estoque.
 *
 * Cada efeito roda com seu próprio try/catch — falha em um não derruba os
 * outros, mesma resiliência que existia nas chamadas inline (`.catch(err =>
 * console.warn(...))`). O dispatcher (`dispatch.ts`) já isola falhas de
 * handler do caller original; aqui isolamos entre os EFEITOS dentro do
 * mesmo handler.
 */

import type { DomainEventOf } from '../../events';
import type { DispatchContext } from '../dispatch';
import type { Appointment, Service, User } from '@/lib/types';
import { syncClientMetricsAdmin } from '@/lib/services/clientMetricsAdmin';
import { maybeCreateCommissionAdmin } from '@/lib/services/commission';
import { addLoyaltyPointsAdmin, calculateEarnedPoints } from '@/lib/services/loyalty';
import { consumeServiceComponentsAdmin } from '@/lib/services/serviceConsumption';

export async function handleAppointmentCompleted(
  event: DomainEventOf<'appointment.completed'>,
  ctx: DispatchContext,
): Promise<void> {
  const { db } = ctx;
  const apptRef = db.collection('appointments').doc(event.appointmentId);
  const apptSnap = await apptRef.get();

  if (!apptSnap.exists) {
    console.warn(`[appointment.completed] appointment ${event.appointmentId} não encontrado — ignorando.`);
    return;
  }
  const appointment = { id: apptSnap.id, ...apptSnap.data() } as Appointment;

  // Tenant guard + confirmação contra o doc real (fecha o gap de evento forjado).
  if (appointment.businessId !== event.businessId) {
    console.warn(`[appointment.completed] businessId do evento não bate com o appointment ${event.appointmentId} — ignorando.`);
    return;
  }
  if (appointment.status !== 'concluido') {
    console.warn(`[appointment.completed] appointment ${event.appointmentId} não está concluido (status=${appointment.status}) — ignorando efeito.`);
    return;
  }
  if (appointment.completionAppliedAt) {
    return; // já aplicado — idempotência
  }

  const now = new Date().toISOString();
  await apptRef.update({ completionAppliedAt: now });

  const operatorId = event.actorId || 'system';
  const operatorName = event.actorName || 'Sistema';

  // ── Baixa de insumos (BOM de serviço) ──────────────────────────────────
  let service: Service | undefined;
  if (appointment.serviceId) {
    try {
      const svcSnap = await db.collection('services').doc(appointment.serviceId).get();
      if (svcSnap.exists) service = { id: svcSnap.id, ...svcSnap.data() } as Service;
    } catch (err) {
      console.warn('[appointment.completed] leitura de service falhou:', err);
    }
  }
  try {
    await consumeServiceComponentsAdmin(db, {
      service,
      businessId: appointment.businessId,
      operatorId,
      operatorName,
      appointmentId: appointment.id,
    });
  } catch (err) {
    console.warn('[appointment.completed] baixa de estoque falhou:', err);
  }

  // ── Métricas do cliente ─────────────────────────────────────────────────
  if (appointment.clientId) {
    try {
      await syncClientMetricsAdmin({
        db,
        clientId: appointment.clientId,
        visitDelta: 1,
        priceDelta: appointment.price || 0,
        lastVisitDate: appointment.date,
      });
    } catch (err) {
      console.warn('[appointment.completed] sync de métricas do cliente falhou:', err);
    }
  }

  // ── Comissão ──────────────────────────────────────────────────────────
  if (appointment.professionalId) {
    try {
      let professional: User | undefined;
      const userSnap = await db.collection('users').doc(appointment.professionalId).get();
      if (userSnap.exists) professional = { uid: userSnap.id, ...userSnap.data() } as User;
      await maybeCreateCommissionAdmin(db, {
        appointment,
        professional,
        service,
        businessId: appointment.businessId,
      });
    } catch (err) {
      console.warn('[appointment.completed] criação de comissão falhou:', err);
    }
  }

  // ── Fidelidade ────────────────────────────────────────────────────────
  if (appointment.clientId && (appointment.price || 0) > 0) {
    try {
      const businessSnap = await db.collection('businesses').doc(appointment.businessId).get();
      const loyaltyConfig = businessSnap.data()?.settings?.loyalty;
      if (loyaltyConfig?.isEnabled) {
        const earned = calculateEarnedPoints(appointment.price, loyaltyConfig);
        if (earned > 0) {
          await addLoyaltyPointsAdmin(db, {
            businessId: appointment.businessId,
            clientId: appointment.clientId,
            clientName: appointment.clientName || '',
            pointsEarned: earned,
            config: loyaltyConfig,
            sourceId: appointment.id,
            sourceType: 'appointment',
            description: `Atendimento - ${appointment.serviceName || 'Serviço'}`,
          });
        }
      }
    } catch (err) {
      console.warn('[appointment.completed] acúmulo de fidelidade falhou:', err);
    }
  }
}
