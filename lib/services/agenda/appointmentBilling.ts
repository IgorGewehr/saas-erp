/**
 * lib/services/agenda/appointmentBilling.ts
 *
 * Mapper PURO (sem SDK) que constrói o payload de prefill do botão "Cobrar"
 * de um atendimento concluído — consumido via sessionStorage pelo
 * FinancialModule (mesmo mecanismo de `pendingOrderPrefill` já usado por
 * ConversasModule → OrdersModule).
 *
 * Sem clientId: o formulário clássico do Financeiro não tem seletor de
 * cliente (só `formClientName` texto livre), então a cobrança usa o nome —
 * mesmo fallback que `appointmentNfse.ts` já documenta pro tomador da NFSe
 * quando o cliente do atendimento não veio de um contato do CRM.
 */

import type { Appointment } from '@/lib/types';

export interface AppointmentBillingPrefill {
  appointmentId: string;
  clientName: string;
  amount: number;
  description: string;
  dueDate: string;
}

export function buildAppointmentBillingPrefill(appointment: Appointment): AppointmentBillingPrefill {
  return {
    appointmentId: appointment.id,
    clientName: appointment.clientName,
    amount: appointment.price,
    description: appointment.serviceName
      ? `${appointment.serviceName} — ${appointment.clientName}`
      : appointment.clientName,
    dueDate: new Date().toISOString().slice(0, 10),
  };
}
