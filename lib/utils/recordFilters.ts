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
 * Compatibilidade retroativa: aceita tambem `isActive === false` (legacy
 * clients) e `isDeleted === true` (legacy conversations). Estes formatos
 * antigos sao reconhecidos pra que o filtro funcione durante a janela
 * entre o deploy do refactor e o backfill dos dados. Apos cleanup (Deploy C
 * do padrao dual-write), os checks legados podem ser removidos.
 *
 * Ver docs/soft-delete-strategy.md §5 "Padrao de migracao de dados".
 */

/** Shape minimo aceito pelo filtro. Aceita todos os campos opcionais —
 *  docs legados sem nenhum sao tratados como ativos (default). */
export interface RecordWithSoftDelete {
  deletedAt?: string | null;
  mergedInto?: string | null;
  /** Legado de `clients` — pre-padronizacao do contrato. */
  isActive?: boolean;
  /** Legado de `conversations` — pre-padronizacao do contrato. */
  isDeleted?: boolean;
}

/** True quando o doc deve ser considerado vivo na UI/queries. */
export function isActiveRecord(doc: RecordWithSoftDelete | null | undefined): boolean {
  if (!doc) return false;
  // Strings vazias / nulls explicitos contam como ausencia (defensivo
  // contra docs com `deletedAt: ''` ou `mergedInto: null` por bugs antigos).
  if (typeof doc.deletedAt === 'string' && doc.deletedAt.length > 0) return false;
  if (typeof doc.mergedInto === 'string' && doc.mergedInto.length > 0) return false;
  // Compat legado — remover apos cleanup.
  if (doc.isActive === false) return false;
  if (doc.isDeleted === true) return false;
  return true;
}

/** Filtra um array de docs deixando so os ativos. Conveniencia comum em
 *  modulos que fazem `clientes.filter(isActiveRecord)`. */
export function filterActive<T extends RecordWithSoftDelete>(docs: readonly T[]): T[] {
  return docs.filter(isActiveRecord) as T[];
}
