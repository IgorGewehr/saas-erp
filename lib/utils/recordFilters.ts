/**
 * lib/utils/recordFilters.ts
 *
 * Helper centralizado pra classificar se um doc Firestore esta "ativo" do
 * ponto de vista de soft-delete/merge. Substitui logica inline que cada
 * modulo reescrevia (ex: `!c.isDeleted` em conversations,
 * `c.isActive !== false && !c.mergedInto && !c.deletedAt` em clients) por
 * uma unica fonte de verdade.
 *
 * REGRA: doc e ATIVO quando nao tem `deletedAt` nem `mergedInto`.
 *
 * Deploy C concluido (2026-05-22): writes de clients/services nao gravam
 * mais isActive=false; conversations nao grava mais isDeleted=true. Os
 * backfills (rodados em 2026-05-22) migraram todos os legados pra deletedAt.
 * Os ramos legados de detecao foram removidos — qualquer doc residual com
 * isActive=false sem deletedAt sera tratado como ativo (caso edge improvavel).
 *
 * Ver docs/soft-delete-strategy.md §5 "Padrao de migracao de dados".
 */

/** Shape minimo aceito pelo filtro. */
export interface RecordWithSoftDelete {
  deletedAt?: string | null;
  mergedInto?: string | null;
}

/** True quando o doc deve ser considerado vivo na UI/queries. */
export function isActiveRecord(doc: RecordWithSoftDelete | null | undefined): boolean {
  if (!doc) return false;
  // Strings vazias / nulls explicitos contam como ausencia (defensivo
  // contra docs com `deletedAt: ''` ou `mergedInto: null` por bugs antigos).
  if (typeof doc.deletedAt === 'string' && doc.deletedAt.length > 0) return false;
  if (typeof doc.mergedInto === 'string' && doc.mergedInto.length > 0) return false;
  return true;
}

/** Filtra um array de docs deixando so os ativos. Conveniencia comum em
 *  modulos que fazem `clientes.filter(isActiveRecord)`. */
export function filterActive<T extends RecordWithSoftDelete>(docs: readonly T[]): T[] {
  return docs.filter(isActiveRecord) as T[];
}
