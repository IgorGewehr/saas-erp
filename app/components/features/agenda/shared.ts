/**
 * lib/components/features/agenda/shared.ts
 *
 * Constantes, tipos e helpers compartilhados pelo módulo Agenda e pelo
 * dialog de agendamento (extraído pra arquivo próprio quando passou a ser
 * usado também pelas Conversas — "Agendar atendimento" direto da
 * conversa). Sem essa extração, AppointmentFormDialog ficaria preso no
 * AgendaModule de 3800+ linhas.
 */

import type { AppointmentStatus } from '@/lib/types';

export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'agendado', label: 'Agendado' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'em_andamento', label: 'Em Andamento' },
  { value: 'concluido', label: 'Concluido' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'nao_compareceu', label: 'Nao Compareceu' },
];

export const DURATION_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1h 30min' },
  { value: 120, label: '2 horas' },
];

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 6; h <= 21; h++) {
    options.push(`${String(h).padStart(2, '0')}:00`);
    options.push(`${String(h).padStart(2, '0')}:30`);
  }
  return options;
}

export const TIME_OPTIONS = generateTimeOptions();

export function addDurationToTime(startTime: string, duration: number): string {
  const totalMinutes = timeToMinutes(startTime) + duration;
  return minutesToTime(totalMinutes);
}

/**
 * Próximo slot prático: arredonda o agora pra cima até o próximo múltiplo
 * de 30min, considerando uma janela mínima de 15min de antecedência (operador
 * não quer agendar pra 30 segundos no futuro). Útil pra pré-preencher o
 * AppointmentFormDialog quando a operação é "agendar agora pra logo mais".
 */
export function nextPracticalSlot(now = new Date()): { date: string; startTime: string } {
  const future = new Date(now.getTime() + 15 * 60 * 1000);
  const minutes = future.getMinutes();
  const rounded = minutes <= 30 ? 30 : 60;
  future.setMinutes(rounded === 60 ? 0 : 30, 0, 0);
  if (rounded === 60) future.setHours(future.getHours() + 1);
  // Confina ao range exposto em TIME_OPTIONS (6h-21:30); se cair fora,
  // ajusta pro próximo dia 09:00.
  const hour = future.getHours();
  if (hour < 6) {
    future.setHours(9, 0, 0, 0);
  } else if (hour > 21 || (hour === 21 && future.getMinutes() > 30)) {
    future.setDate(future.getDate() + 1);
    future.setHours(9, 0, 0, 0);
  }
  const yyyy = future.getFullYear();
  const mm = String(future.getMonth() + 1).padStart(2, '0');
  const dd = String(future.getDate()).padStart(2, '0');
  return {
    date: `${yyyy}-${mm}-${dd}`,
    startTime: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`,
  };
}

export interface AppointmentFormData {
  clientId: string;
  clientName: string;
  clientPhone: string;
  serviceId: string;
  serviceName: string;
  date: string;
  startTime: string;
  duration: number;
  /** Profissional principal — equivalente a professionalIds[0]. Mantido pra
   *  compat com código que ainda lê este campo direto + APIs externas. */
  professionalId: string;
  professionalName: string;
  /** Todos os profissionais atribuídos (1+). Form usa este como source-of-truth
   *  pro multi-select; o handler de save sincroniza professionalId com o [0]. */
  professionalIds: string[];
  professionalNames: string[];
  notes: string;
  status: AppointmentStatus;
  price: number;
  color: string;
  recurrenceFrequency?: RecurrenceFrequency;
  recurrenceOccurrences?: number;
  /** Aula experimental / sessão de aquisição (P2.8). */
  isTrial?: boolean;
  /** Resultado do trial (P2.8) — emitido como evento appointment.trialCompleted
   *  ao concluir. Sem valor → tratado como 'pendente'. */
  trialOutcome?: 'converteu' | 'nao_converteu' | 'pendente';
}
