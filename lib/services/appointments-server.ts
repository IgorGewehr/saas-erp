/**
 * Helpers server-side pra queries de appointments que precisam respeitar
 * o schema multi-profissional (campo professionalIds[]).
 *
 * Por que existe: Firestore não tem operador OR nativo entre `==` e
 * `array-contains` no mesmo query. Pra capturar TANTO docs legados
 * (só professionalId) QUANTO novos (professionalIds com 1+ atribuídos),
 * precisamos rodar 2 queries paralelas e mergear por ID.
 *
 * Sem isso, queries server-side veriam só onde X é o profissional PRINCIPAL
 * (legado/[0]) — quem está em segunda+ posição ficaria invisível em /api/v1,
 * google calendar sync, agent tools, etc.
 */

import type { firestore as adminFs } from 'firebase-admin';

/**
 * Roda 2 queries paralelas filtrando por UM OU MAIS profissionais (legado
 * `professionalId` via `in` + novo `professionalIds` via `array-contains-any`)
 * e retorna snapshots únicos por ID.
 *
 * M06.1: generalização de `fetchAppointmentsForProfessional` (que só aceitava
 * 1 id) — usada agora também pelos guards transacionais de conflito
 * (`appointmentTxGuardAdmin.ts`), que antes só filtravam pelo campo legado e
 * ficavam cegos pra agendamentos de profissional secundário em
 * `professionalIds[]`. `in`/`array-contains-any` usam os MESMOS índices
 * compostos já declarados pra `==`/`array-contains` (Firestore trata os dois
 * como equivalentes pra fins de índice) — nenhum índice novo necessário.
 * Limite de 30 ids é do próprio Firestore; um Appointment realista tem no
 * máximo poucas unidades de profissionais, então nunca deve ser atingido —
 * se for, o SDK lança um erro claro em vez de truncar silenciosamente.
 *
 * @param buildBaseQuery callback que constrói a query COM businessId, date
 *   range, status, etc — TUDO menos o filtro do profissional. Chamado 2x.
 *   IMPORTANTE: não inclua orderBy aqui se as 2 queries precisarem do mesmo
 *   sort no resultado mergeado (Firestore retorna ordenado por query, mas
 *   o merge perde a ordem global). Aplique sort em-memória depois.
 * @param professionalIds UIDs dos profissionais a filtrar (união — qualquer
 *   match em qualquer um deles entra no resultado)
 * @returns array de snapshots únicos (dedupe por doc.id)
 */
export async function fetchAppointmentsForProfessionals(
  buildBaseQuery: () => adminFs.Query,
  professionalIds: string[],
): Promise<adminFs.QueryDocumentSnapshot[]> {
  const ids = [...new Set(professionalIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const legacyQ = buildBaseQuery().where('professionalId', 'in', ids);
  const arrayQ = buildBaseQuery().where('professionalIds', 'array-contains-any', ids);
  const [legacySnap, arraySnap] = await Promise.all([legacyQ.get(), arrayQ.get()]);
  const seen = new Set<string>();
  const out: adminFs.QueryDocumentSnapshot[] = [];
  for (const doc of [...legacySnap.docs, ...arraySnap.docs]) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      out.push(doc);
    }
  }
  return out;
}

/** Wrapper de 1 profissional sobre {@link fetchAppointmentsForProfessionals} — mantém os 4 call-sites existentes (calendar, agent/team, v1, agent/agenda) inalterados. */
export async function fetchAppointmentsForProfessional(
  buildBaseQuery: () => adminFs.Query,
  professionalId: string,
): Promise<adminFs.QueryDocumentSnapshot[]> {
  return fetchAppointmentsForProfessionals(buildBaseQuery, [professionalId]);
}
