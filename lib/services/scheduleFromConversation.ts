/**
 * lib/services/scheduleFromConversation.ts
 *
 * "Agendar atendimento" disparado de dentro de uma conversa. Persiste um
 * único Appointment no Firestore com rastreabilidade da origem
 * (conversationId + channelType) pra que relatórios consigam atribuir o
 * agendamento ao canal/conversa que o gerou.
 *
 * Escopo intencional (MVP):
 *   - Cria 1 Appointment (sem recorrência — recorrência exige conflict
 *     check em série, fluxo só faz sentido no AgendaModule completo)
 *   - Conflict-check atomico via createAppointmentSafe (mesma camada do
 *     AgendaModule — fecha race quando operador do dialog e operador da
 *     agenda salvam no mesmo slot em <200ms)
 *   - SEM atualização de syncClientMetrics nem loyalty (esses só fazem
 *     sentido quando status='concluido'; agendamento da conversa entra
 *     como 'agendado' por padrão)
 *
 * Quem precisa de recorrência/loyalty rigoroso usa o AgendaModule
 * diretamente. O fluxo de conversa é otimizado pra rapidez: "cliente
 * pediu horário, marco agora pra próximo slot".
 *
 * Multi-tenant: payload inclui businessId; rule do Firestore
 * `appointments` exige incomingBelongsToBusiness em create.
 */

import { db } from '@/lib/config/firebase';
import { createAppointmentSafe, AppointmentConflictError } from '@/lib/services/appointmentTxGuard';
import type { Conversation, User } from '@/lib/types';
import { addDurationToTime, type AppointmentFormData } from '@/app/components/features/agenda/shared';

// Re-export pra que callers (ScheduleFromConversationDialog) consigam
// diferenciar conflito vs falha generica sem importar do txGuard direto.
export { AppointmentConflictError };

export interface ScheduleFromConversationParams {
  formData: AppointmentFormData;
  conversation: Conversation;
  businessId: string;
  /** Lista de members do business — usado pelo check de conflito pra
   *  validar working hours do profissional. Opcional: sem ela, o check
   *  ignora working hours mas detecta overlap normalmente. */
  members?: User[];
}

export interface ScheduleFromConversationResult {
  appointmentId: string;
}

/**
 * Mapa canal-da-conversa → channelType do Appointment. Convenções diferem:
 * Appointment.channelType inclui 'whatsapp_baileys' separado, Conversation
 * usa só 'whatsapp' + flag connectedVia.
 */
function resolveAppointmentChannel(conv: Conversation): import('@/lib/types').Appointment['channelType'] {
  if (conv.channel === 'whatsapp') {
    return conv.connectedVia === 'baileys' ? 'whatsapp_baileys' : 'whatsapp';
  }
  if (conv.channel === 'facebook') return 'facebook';
  if (conv.channel === 'instagram') return 'instagram';
  return 'manual';
}

export async function scheduleFromConversation(
  params: ScheduleFromConversationParams,
): Promise<ScheduleFromConversationResult> {
  const { formData, conversation, businessId, members = [] } = params;
  const now = new Date().toISOString();

  // Validações mínimas — UI deveria ter bloqueado mas é defesa em profundidade.
  if (!formData.clientId) throw new Error('clientId é obrigatório para agendar a partir da conversa');
  if (!formData.serviceId) throw new Error('serviceId é obrigatório');
  if (!formData.date || !formData.startTime) throw new Error('data e horário são obrigatórios');
  if (typeof formData.duration !== 'number' || formData.duration <= 0) throw new Error('duração inválida');

  const endTime = addDurationToTime(formData.startTime, formData.duration);

  // Payload Appointment. channelType + conversationId dão a rastreabilidade
  // que os relatórios "agendamentos por canal" consomem.
  const payload: Record<string, unknown> = {
    businessId,
    clientId: formData.clientId,
    clientName: formData.clientName,
    clientPhone: formData.clientPhone || undefined,
    serviceId: formData.serviceId,
    serviceName: formData.serviceName,
    professionalId: formData.professionalId || undefined,
    professionalName: formData.professionalName || undefined,
    date: formData.date,
    startTime: formData.startTime,
    endTime,
    duration: formData.duration,
    status: formData.status,
    price: formData.price,
    notes: formData.notes || undefined,
    color: formData.color,
    channelType: resolveAppointmentChannel(conversation),
    conversationId: conversation.id,
    createdAt: now,
    updatedAt: now,
  };

  // stripEmpty: remove keys com undefined pra não poluir o doc no Firestore.
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  // createAppointmentSafe envolve o write em runTransaction + day lock,
  // fechando a race window de ~100-200ms onde 2 operadores (ex: um aqui
  // no dialog da conversa, outro no AgendaModule) podiam ambos salvar
  // no mesmo slot. Em conflito, lanca AppointmentConflictError que o
  // caller traduz pro toast/snackbar do dialog.
  const id = await createAppointmentSafe(
    db,
    {
      businessId,
      professionalId: formData.professionalId || undefined,
      date: formData.date,
      startTime: formData.startTime,
      endTime,
      ...payload,
    },
    members,
  );
  return { appointmentId: id };
}
