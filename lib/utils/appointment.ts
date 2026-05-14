/**
 * Helpers de leitura/escrita pro Appointment com suporte a múltiplos
 * profissionais (campo `professionalIds`) E retrocompat com docs legados
 * que só tem `professionalId` (single).
 *
 * Regra fundamental: ao LER, use `getAppointmentProfessionalIds(apt)` —
 * unifica os 2 cenários. Ao ESCREVER, popule SEMPRE `professionalIds` E
 * mantenha `professionalId` legado preenchido com o primeiro do array
 * (pra APIs externas e queries server-side antigas continuarem funcionando).
 */

import type { Appointment } from '@/lib/types';

/**
 * Retorna a lista canônica de UIDs de profissionais atribuídos.
 *  - Se `professionalIds` existir (novo schema), retorna ele (filtrando vazios).
 *  - Senão, se `professionalId` existir (doc legado), retorna [professionalId].
 *  - Senão, retorna [] (appt sem profissional, ex: agendamento global da casa).
 */
export function getAppointmentProfessionalIds(
  apt: Pick<Appointment, 'professionalId' | 'professionalIds'>,
): string[] {
  if (apt.professionalIds && apt.professionalIds.length > 0) {
    return apt.professionalIds.filter(id => !!id);
  }
  if (apt.professionalId) return [apt.professionalId];
  return [];
}

/** Mesma lógica pra nomes denormalizados — útil pra display sem lookup. */
export function getAppointmentProfessionalNames(
  apt: Pick<Appointment, 'professionalName' | 'professionalNames'>,
): string[] {
  if (apt.professionalNames && apt.professionalNames.length > 0) {
    return apt.professionalNames.filter(n => !!n);
  }
  if (apt.professionalName) return [apt.professionalName];
  return [];
}

/**
 * True se o appointment tem o profissional X atribuído. Útil em filtros
 * de "minha agenda" (oneself) e checks de conflito por profissional.
 * Tratamento defensivo: apt sem nenhum profissional retorna false (não
 * "todos podem" — pra slot global, caller deve ter outro caminho).
 */
export function isAppointmentAssignedTo(
  apt: Pick<Appointment, 'professionalId' | 'professionalIds'>,
  professionalId: string,
): boolean {
  if (!professionalId) return false;
  return getAppointmentProfessionalIds(apt).includes(professionalId);
}

/**
 * Retorna { professionalIds, professionalNames, professionalId, professionalName }
 * pronto pra spread no payload de createDoc/updateDoc.
 *
 * Mantém os campos legados (`professionalId`, `professionalName`) sincronizados
 * com o primeiro elemento do array — necessário pra:
 *  - APIs externas (v1) que ainda leem professionalId
 *  - Queries Firestore server-side antigas (rotas /api/agent/*) sem array-contains
 *
 * Aceita arrays paralelos (ids[i] ↔ names[i]); se names estiver curto, completa
 * com vazias mas garante consistência (length === ids.length).
 */
export function buildProfessionalsPayload(
  professionalIds: string[],
  membersById: Map<string, { name: string }>,
): {
  professionalId: string;
  professionalName: string;
  professionalIds: string[];
  professionalNames: string[];
} {
  const cleanIds = professionalIds.filter(Boolean);
  const names = cleanIds.map(id => membersById.get(id)?.name ?? '');
  return {
    // Legado: 1° do array (ou vazio se nenhum atribuído)
    professionalId: cleanIds[0] ?? '',
    professionalName: names[0] ?? '',
    // Novo: lista completa
    professionalIds: cleanIds,
    professionalNames: names,
  };
}
