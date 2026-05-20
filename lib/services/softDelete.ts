/**
 * lib/services/softDelete.ts
 *
 * Operations centralizadas pra soft-delete / restore de documentos Firestore.
 * Substitui chamadas `updateDoc(ref, { isActive: false })` ou
 * `updateDoc(ref, { isDeleted: true })` espalhadas pelo codebase por uma API
 * unica e consistente.
 *
 * Quem usa: callers no frontend (operador clica "Excluir"). Cron de purge
 * LGPD usa Admin SDK direto (operacao server-side cross-tenant).
 *
 * Tres regras de design:
 *
 *  1. IDEMPOTENTE — chamar `softDeleteDoc` 2x no mesmo doc nao "redeleta"
 *     com novo timestamp/actor. Se ja tem `deletedAt`, no-op. Evita
 *     sobrescrever audit trail original em duplo-click ou retry.
 *
 *  2. AUDIT TRAIL OBRIGATORIO — sempre grava `deletedBy + deletedByName`.
 *     Caller deve passar `actor`; sem isso lanca erro (vs default vazio que
 *     mascaria deletes anonimos).
 *
 *  3. RESTORE LIMPA OS 3 CAMPOS — usa `deleteField()` pra remover (nao
 *     setar `null` ou `''`). Isso garante que queries futuras via
 *     `where('deletedAt', '==', null)` funcionem corretamente caso a gente
 *     queira mover pra filtros server-side eventualmente.
 *
 * Ver docs/soft-delete-strategy.md §5 Fase 0.
 */

import { updateDoc, deleteField, type DocumentReference } from 'firebase/firestore';

export interface SoftDeleteActor {
  uid: string;
  name: string;
}

interface SoftDeleteSnapshot {
  /** Doc data atual — usado pra checar idempotencia. Caller passa o objeto
   *  ja lido (frontend tipicamente tem em memoria). */
  deletedAt?: string;
}

/**
 * Marca doc como soft-deleted. Idempotente: se ja tem `deletedAt`, no-op.
 *
 * @param ref           DocumentReference do client SDK
 * @param actor         User que disparou o delete (uid + name)
 * @param currentData   Snapshot atual do doc pra checar idempotencia (opcional —
 *                      sem isso, sempre escreve. Passe quando tiver em memoria.)
 * @returns true se escreveu, false se foi no-op por idempotencia
 */
export async function softDeleteDoc(
  ref: DocumentReference,
  actor: SoftDeleteActor,
  currentData?: SoftDeleteSnapshot | null,
): Promise<boolean> {
  if (!actor || !actor.uid) {
    throw new Error('softDeleteDoc: actor.uid obrigatorio (audit trail)');
  }
  if (currentData?.deletedAt) {
    // Ja deletado — preserva audit original.
    return false;
  }
  const now = new Date().toISOString();
  await updateDoc(ref, {
    deletedAt: now,
    deletedBy: actor.uid,
    deletedByName: actor.name || actor.uid,
    updatedAt: now,
  });
  return true;
}

/**
 * Restaura doc soft-deletado limpando os 3 campos de delete. Nao limpa
 * `mergedInto` — merge nao deve ser revertido por restore individual.
 *
 * @param ref DocumentReference do client SDK
 * @returns true sempre (operacao trivial; caller decide se quer retry em erro)
 */
export async function restoreDoc(ref: DocumentReference): Promise<true> {
  const now = new Date().toISOString();
  await updateDoc(ref, {
    deletedAt: deleteField(),
    deletedBy: deleteField(),
    deletedByName: deleteField(),
    updatedAt: now,
  });
  return true;
}

/**
 * Marca doc como cascade-soft-deleted por delete de um pai (containers como
 * `kanbanBoard` → `kanbanCards`). Preserva `cascadeFromParentId` pra que
 * restore do pai consiga restaurar so os filhos cascateados juntos.
 *
 * Diferente do soft-delete normal: nao precisa de actor por filho (o actor
 * do pai cobre tudo). Mas grava actor pro audit trail.
 *
 * @param ref       DocumentReference do filho
 * @param actor     User que disparou o delete (do pai)
 * @param parentId  ID do pai que cascateou — usado pra restore consistente
 */
export async function cascadeSoftDeleteDoc(
  ref: DocumentReference,
  actor: SoftDeleteActor,
  parentId: string,
): Promise<true> {
  if (!actor || !actor.uid) {
    throw new Error('cascadeSoftDeleteDoc: actor.uid obrigatorio');
  }
  if (!parentId) {
    throw new Error('cascadeSoftDeleteDoc: parentId obrigatorio');
  }
  const now = new Date().toISOString();
  await updateDoc(ref, {
    deletedAt: now,
    deletedBy: actor.uid,
    deletedByName: actor.name || actor.uid,
    cascadeFromParentId: parentId,
    updatedAt: now,
  });
  return true;
}
