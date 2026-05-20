/**
 * Filtros compartilhados pra coleção `clients`.
 *
 * ClientsModule e CRMModule fazem soft delete pra preservar referências em
 * vendas/conversas/agendamentos antigos. Mas docs soft-deletados NÃO devem
 * aparecer em listas/autocompletes vivos de outros módulos (PDV, Agenda,
 * Conversas, etc). Mesma coisa pra docs absorvidos por merge de duplicatas.
 *
 * Esta função e um WRAPPER fino sobre `isActiveRecord` (lib/utils/recordFilters)
 * — toda logica de "registro ativo" vive la, centralizada. Mantemos o nome
 * `isActiveClient` como alias semantico pra que callers (~15 modulos) nao
 * precisem atualizar o import.
 *
 * Compatibilidade: `isActiveRecord` aceita formato novo (`deletedAt`) E legado
 * (`isActive=false`) — clientes antigos pré-padronizacao do contrato (Fase 1
 * do plano de soft-delete) continuam ocultos enquanto o backfill nao roda.
 * Ver docs/soft-delete-strategy.md §5 "Padrao de migracao de dados".
 */

import type { Client } from '@/lib/types';
import { isActiveRecord, type RecordWithSoftDelete } from '@/lib/utils/recordFilters';

export function isActiveClient(c: RecordWithSoftDelete | Client): boolean {
  return isActiveRecord(c as RecordWithSoftDelete);
}
