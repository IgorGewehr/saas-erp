/**
 * Filtros compartilhados pra coleção `clients`.
 *
 * ClientsModule e CRMModule fazem soft delete pra preservar referências em
 * vendas/conversas/agendamentos antigos. Mas docs soft-deletados NÃO devem
 * aparecer em listas/autocompletes vivos de outros módulos (PDV, Agenda,
 * Conversas, etc). Mesma coisa pra docs absorvidos por merge de duplicatas.
 *
 * Use como `.filter(isActiveClient)` ao carregar `clients` em qualquer módulo
 * que mostre clientes vivos. Comportamento:
 *   - rejeita `deletedAt` presente (soft-deleted via Clientes ou CRM)
 *   - rejeita `isActive === false` (mesmo soft-delete escrito antes do
 *     campo `deletedAt` existir, ou docs explicitamente desativados)
 *   - rejeita `mergedInto` presente (duplicata absorvida pelo merge)
 *   - aceita docs legados sem nenhum desses campos (default = ativo)
 */

import type { Client } from '@/lib/types';

type ClientLike = {
  deletedAt?: string;
  isActive?: boolean;
  mergedInto?: string;
};

export function isActiveClient(c: ClientLike | Client): boolean {
  const x = c as ClientLike;
  if (x.deletedAt) return false;
  if (x.isActive === false) return false;
  if (x.mergedInto) return false;
  return true;
}
