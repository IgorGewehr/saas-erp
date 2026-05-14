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
 * Roda 2 queries paralelas filtrando por profissional (legado professionalId
 * + novo professionalIds array-contains) e retorna snapshots únicos por ID.
 *
 * @param buildBaseQuery callback que constrói a query COM businessId, date
 *   range, status, etc — TUDO menos o filtro do profissional. Chamado 2x.
 *   IMPORTANTE: não inclua orderBy aqui se as 2 queries precisarem do mesmo
 *   sort no resultado mergeado (Firestore retorna ordenado por query, mas
 *   o merge perde a ordem global). Aplique sort em-memória depois.
 * @param professionalId UID do profissional a filtrar
 * @returns array de snapshots únicos (dedupe por doc.id)
 */
export async function fetchAppointmentsForProfessional(
  buildBaseQuery: () => adminFs.Query,
  professionalId: string,
): Promise<adminFs.QueryDocumentSnapshot[]> {
  const legacyQ = buildBaseQuery().where('professionalId', '==', professionalId);
  const arrayQ = buildBaseQuery().where('professionalIds', 'array-contains', professionalId);
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
