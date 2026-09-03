/**
 * lib/services/agenda/schedulingEligibility.ts
 *
 * Regras PURAS (sem SDK) de elegibilidade pro sweep de lembretes/confirmação/
 * follow-up de agendamentos (`app/api/agent/scheduled/run/route.ts`).
 *
 * Extraído do route pra ser testável sem mockar Firestore — e pra route
 * handlers do App Router não ganharem exports extras além dos métodos HTTP.
 *
 * Bug corrigido aqui: um negócio `useCase='servicos'` que nunca abriu
 * Configurações → Agente IA → "Lembretes automáticos" tem `settings.aiAgent.agenda`
 * ausente no Firestore — mas a UI (SettingsModule.tsx AgenteTab) já mostra os
 * 3 toggles LIGADOS por padrão antes do primeiro save. Sem este fallback, o
 * negócio ficava silenciosamente fora do sweep (ou, dentro dele, mudo) mesmo
 * parecendo "tudo ligado" na tela — e a seção anuncia explicitamente "funciona
 * independente do Agente IA", então o fallback não pode exigir `aiAgent.enabled`.
 */

import type { Business } from '@/lib/types';

export type AgendaSchedulingConfig = NonNullable<NonNullable<Business['settings']>['aiAgent']>['agenda'];

const DEFAULT_AGENDA_CONFIG: AgendaSchedulingConfig = {
  sendReminder: true,
  reminderHoursBefore: 24,
  confirmationBeforeAppointment: true,
  followUpAfter: false,
};

/**
 * Config efetiva de lembretes pra este negócio, ou `undefined` se nenhum
 * lembrete deve ser processado (useCase não é 'servicos' e nada foi salvo).
 */
export function resolveAgendaSchedulingConfig(business: Business): AgendaSchedulingConfig | undefined {
  const saved = business.settings?.aiAgent?.agenda;
  if (saved) return saved;
  if (business.settings?.useCase === 'servicos') return DEFAULT_AGENDA_CONFIG;
  return undefined;
}

/** Um negócio entra no sweep se tiver config de agenda efetiva OU o agente completo ligado (reengajamento/outros fluxos). */
export function isRelevantForScheduling(business: Business): boolean {
  const agenda = resolveAgendaSchedulingConfig(business);
  const hasReminders = Boolean(agenda?.sendReminder || agenda?.confirmationBeforeAppointment || agenda?.followUpAfter);
  const hasAgent = Boolean(business.settings?.aiAgent?.enabled);
  return hasReminders || hasAgent;
}
