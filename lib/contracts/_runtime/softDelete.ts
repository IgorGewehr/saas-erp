/**
 * lib/contracts/_runtime/softDelete.ts
 *
 * Contrato compartilhado pra soft-delete em todas as entidades Tier 3 do
 * sistema. Substitui os field-namings divergentes anteriores (`isActive=false`,
 * `isDeleted=true`) por um shape unico:
 *
 *   {
 *     deletedAt:    ISO timestamp,
 *     deletedBy:    user uid,
 *     deletedByName: nome do user no momento do delete,
 *     mergedInto:   id do doc primary (so quando o delete ocorreu via merge),
 *     cascadeFromParentId: id do pai que disparou cascade soft (containers),
 *   }
 *
 * Schema Zod permite validar payloads em qualquer fronteira (R6 — validacao
 * no boundary). Interface TypeScript e derivada via z.infer pra evitar
 * declaracao paralela (R2 — SDD).
 *
 * Quem usa:
 *   - lib/utils/recordFilters.ts (isActiveRecord)
 *   - lib/services/softDelete.ts (softDeleteDoc / restoreDoc)
 *   - Tipos de dominio em lib/types/index.ts que extendem entidades Tier 3
 *
 * Ver docs/soft-delete-strategy.md pra contexto.
 */

import { z } from 'zod';

/** Schema de campos de soft-delete. Todos opcionais — docs ativos nao tem
 *  nenhum deles. Ausencia de `deletedAt` AND `mergedInto` = doc vivo. */
export const SoftDeletableSchema = z.object({
  /** ISO timestamp do momento do soft-delete. Marcador primario de delete. */
  deletedAt: z.string().datetime().optional(),
  /** UID do user que disparou o delete. Audit trail. */
  deletedBy: z.string().min(1).optional(),
  /** Nome denormalizado do user no momento — sobrevive a rename do user. */
  deletedByName: z.string().optional(),
  /** ID do doc primary num merge. Quando set, este doc e duplicata absorvida.
   *  Semanticamente diferente de `deletedAt`: merged ainda existe pra
   *  preservar referencias historicas, nao deve ser "restaurado". */
  mergedInto: z.string().optional(),
  /** Quando set, este doc foi soft-deletado por cascade do pai (`kanbanCards`
   *  cascateados por `kanbanBoard`). Restore do pai deve restaurar filhos
   *  com mesmo valor. Sem esse campo, restore individual e indistinguivel
   *  de docs deletados antes do cascade. */
  cascadeFromParentId: z.string().optional(),
});

export type SoftDeletable = z.infer<typeof SoftDeletableSchema>;

/** Type guard: true se o doc tem ALGUM campo de soft-delete preenchido.
 *  Aceita tanto deletedAt (string) quanto mergedInto (string). cascadeFrom
 *  isolado sem deletedAt e estado invalido — registrar mas tratar como ativo
 *  pra evitar zombie hide. */
export function hasSoftDeleteFields(doc: unknown): doc is SoftDeletable {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as SoftDeletable;
  return !!(d.deletedAt || d.mergedInto);
}
