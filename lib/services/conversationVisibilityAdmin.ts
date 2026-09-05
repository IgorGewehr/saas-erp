/**
 * lib/services/conversationVisibilityAdmin.ts
 *
 * M07.3: variante Admin SDK de `conversationVisibility.ts` — busca os
 * setores necessários via Firestore Admin e delega o cálculo pra
 * `computeVisibleToUserIds`. Separado do arquivo puro pra não puxar
 * `firebase-admin` em código que também é importado por componentes
 * client (`ConversasModule.tsx` usa a versão pura + `useAuth().sectors`,
 * já carregado em memória — não precisa buscar nada).
 */

import type { Firestore } from 'firebase-admin/firestore';
import { computeVisibleToUserIds, type SectorMembersLookup } from '@/lib/services/conversationVisibility';

export interface ResolveVisibleToUserIdsAdminInput {
  sectorIds?: string[];
  isPrivate?: boolean;
  assignedTo?: string;
}

/**
 * Busca só os setores referenciados em `sectorIds` (tipicamente 0-1) e
 * calcula `visibleToUserIds`. Setor referenciado que não existe mais é
 * ignorado (mesma filosofia conservadora do lado puro).
 */
export async function resolveVisibleToUserIdsAdmin(
  db: Firestore,
  input: ResolveVisibleToUserIdsAdminInput,
): Promise<string[] | null> {
  const sectorIds = input.sectorIds ?? [];
  const sectorsById = new Map<string, SectorMembersLookup>();
  if (sectorIds.length > 0) {
    const snaps = await Promise.all(sectorIds.map((id) => db.collection('sectors').doc(id).get()));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() as { memberIds?: string[] } | undefined;
      sectorsById.set(snap.id, { memberIds: data?.memberIds ?? [] });
    }
  }
  return computeVisibleToUserIds({
    sectorIds: input.sectorIds,
    isPrivate: input.isPrivate,
    assignedTo: input.assignedTo,
    sectorsById,
  });
}
