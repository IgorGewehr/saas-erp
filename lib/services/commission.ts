/**
 * Commission service — automatic professional commission tracking.
 *
 * Flow:
 *  1. When an Appointment is marked 'concluido', call maybeCreateCommission.
 *     It creates a despesa Transaction (category: 'Comissoes') and links it back
 *     to the appointment via commissionTransactionId (idempotency key).
 *
 *  2. If the appointment moves away from 'concluido' (e.g. back to em_andamento),
 *     call maybeCancelCommission to cancel the pending commission.
 *
 * Commission rate resolution order (highest priority first):
 *  1. Service.commissionRate  — per-service override
 *  2. User.commissionRate     — professional default
 *  3. 0 (no commission)
 */

import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { Appointment, User, Service } from '@/lib/types';

/**
 * Creates a commission Transaction when an appointment is marked concluido.
 * Returns the transaction ID, or null if no commission applies.
 * Idempotent: skips creation if appointment.commissionTransactionId is already set.
 */
export async function maybeCreateCommission(params: {
  appointment: Appointment;
  professional: User | undefined;
  service: Service | undefined;
  businessId: string;
}): Promise<string | null> {
  const { appointment, professional, service, businessId } = params;

  // Idempotency check — commission already created for this appointment
  if (appointment.commissionTransactionId) return appointment.commissionTransactionId;

  // Need a professional to pay a commission
  if (!professional) return null;

  // Resolve commission rate: service-level takes precedence over user-level
  const rate =
    (service?.commissionRate != null && service.commissionRate > 0)
      ? service.commissionRate
      : (professional.commissionRate ?? 0);

  if (rate <= 0) return null;
  if (!appointment.price || appointment.price <= 0) return null;

  const commissionAmount = Math.round((appointment.price * rate) / 100 * 100) / 100;
  const now = new Date().toISOString();

  // Create the commission as a despesa (expense for the business — payment to professional)
  const txRef = await addDoc(collection(db, 'transactions'), {
    businessId,
    type: 'despesa',
    category: 'Comissoes',
    description: `Comissão — ${appointment.professionalName || professional.name} — ${appointment.serviceName}`,
    amount: commissionAmount,
    dueDate: appointment.date,
    status: 'pendente',
    clientId: professional.uid,
    clientName: appointment.professionalName || professional.name,
    appointmentId: appointment.id,
    notes: `Taxa: ${rate}% sobre R$ ${appointment.price.toFixed(2)}`,
    createdAt: now,
    updatedAt: now,
  });

  // Link commission back to appointment for idempotency on subsequent calls
  await updateDoc(doc(db, 'appointments', appointment.id), {
    commissionTransactionId: txRef.id,
    updatedAt: now,
  });

  return txRef.id;
}

/**
 * Cancels an active commission transaction (when appointment moves away from concluido).
 * Safe to call even if commissionTransactionId is undefined.
 */
export async function maybeCancelCommission(commissionTransactionId: string | undefined): Promise<void> {
  if (!commissionTransactionId) return;
  await updateDoc(doc(db, 'transactions', commissionTransactionId), {
    status: 'cancelado',
    updatedAt: new Date().toISOString(),
  });
}
