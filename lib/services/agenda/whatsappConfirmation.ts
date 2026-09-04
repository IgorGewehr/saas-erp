/**
 * lib/services/agenda/whatsappConfirmation.ts
 *
 * M06.5a — confirmação leve do paciente via WhatsApp, sem exigir o Agente IA
 * completo. Hoje só tenants com o agente ligado têm QUALQUER reação
 * automática a uma resposta do paciente — o resto nunca recebe nada, mesmo
 * já mandando a pergunta de confirmação (app/api/agent/scheduled/run/route.ts).
 *
 * Não existe vínculo confiável "esta conversa" → "este agendamento":
 * Appointment.conversationId é só proveniência (gravado uma vez, na
 * criação), Conversation.crmContactId é best-effort. A correlação viável é
 * por TELEFONE — e só age quando há exatamente UM candidato inequívoco.
 * Zero ou 2+ candidatos: não faz nada (nunca advinha).
 *
 * Reaproveita o núcleo atômico de transição da M06.2 (transitionAppointmentAdmin)
 * — não reimplementa FSM nem persistência.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { isConfirmationKeyword } from '@/lib/utils/confirmationKeywords';
import { brPhonesMatch } from '@/lib/contracts/_runtime/phone-br';
import { transitionAppointmentAdmin } from '@/lib/services/appointment-server';
import type { Appointment } from '@/lib/types';

const CONFIRMATION_WINDOW_DAYS = 7;

/**
 * Função pura — decide qual (se algum) agendamento uma resposta "confirmo"
 * deve confirmar. Candidato: `status==='agendado'` (um já `'confirmado'` não
 * conta pra ambiguidade — está resolvido), `confirmationRequestedAt` setado
 * (fomos nós que perguntamos), `date >= today`, telefone bate com `phone`.
 *
 * Retorna o único candidato, ou `null` se zero ou mais de um (ambíguo —
 * nunca adivinha qual dos dois agendamentos o paciente quis confirmar).
 */
export function pickAutoConfirmCandidate(
  appointments: Appointment[],
  phone: string,
  today: string,
): Appointment | null {
  const candidates = appointments.filter((a) =>
    a.status === 'agendado' &&
    Boolean(a.confirmationRequestedAt) &&
    a.date >= today &&
    brPhonesMatch(a.clientPhone, phone),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export interface WhatsAppConfirmationResult {
  confirmed: boolean;
  appointmentId?: string;
}

/**
 * Shell: detecta a keyword, busca candidatos na janela de dias à frente
 * (reaproveita o índice composto [businessId,date] já existente — mesmo
 * formato de scheduled/run/route.ts), aplica pickAutoConfirmCandidate e,
 * se houver exatamente um, confirma via transitionAppointmentAdmin.
 *
 * Nunca lança — chamado a partir de webhook, uma falha aqui não pode
 * derrubar a resposta 200 pro provedor (mesmo padrão de resiliência do
 * detector de opt-out).
 */
export async function tryAutoConfirmFromWhatsAppReply(params: {
  db?: Firestore;
  businessId: string;
  phone: string;
  messageText: string;
  now?: Date;
}): Promise<WhatsAppConfirmationResult> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();

  try {
    if (!isConfirmationKeyword(params.messageText)) return { confirmed: false };
    if (!params.businessId || !params.phone) return { confirmed: false };

    const todayStr = now.toISOString().slice(0, 10);
    const endStr = new Date(now.getTime() + CONFIRMATION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const snap = await db.collection('appointments')
      .where('businessId', '==', params.businessId)
      .where('date', '>=', todayStr)
      .where('date', '<=', endStr)
      .get();
    const appointments = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));

    const candidate = pickAutoConfirmCandidate(appointments, params.phone, todayStr);
    if (!candidate) return { confirmed: false };

    await transitionAppointmentAdmin({
      db,
      appointmentId: candidate.id,
      businessId: params.businessId,
      targetStatus: 'confirmado',
      actor: { id: 'system:whatsapp-confirmation', name: 'Confirmação automática (WhatsApp)' },
      now,
    });

    // Best-effort, fora do núcleo de transição — só observabilidade (qual
    // confirmação foi manual vs. automática). Falha aqui não desfaz a
    // transição em si, que já foi confirmada acima.
    try {
      await db.collection('appointments').doc(candidate.id).update({ confirmedVia: 'whatsapp-auto' });
    } catch (err) {
      console.warn('[whatsappConfirmation] gravação de confirmedVia falhou:', err);
    }

    return { confirmed: true, appointmentId: candidate.id };
  } catch (err) {
    console.warn('[whatsappConfirmation] tryAutoConfirmFromWhatsAppReply falhou:', err);
    return { confirmed: false };
  }
}
