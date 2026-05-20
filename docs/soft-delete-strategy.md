# Soft-Delete Strategy — Aevo

> Documento de governança pra exclusão de dados no sistema.
> Define o **modelo conceitual** (tiers de entidade), **regras de cascade**, e **plano de migração incremental**.
> **Status:** documento de alinhamento. Implementação em fases — não começar antes de validar com o time.

---

## 1. Por que esse documento existe

Auditoria do sistema identificou que apenas 2 coleções (`clients`, `conversations`) implementam soft-delete, e mesmo essas duas usam **field naming divergente** (`isActive=false` vs `isDeleted=true`), **sem audit trail completo**, e **sem UI de restore**. As outras ~15 coleções usam hard-delete direto, sem cascade. Isso cria:

- **Risco de perda acidental** — operador clica errado, dado some sem volta
- **Órfãos em histórico** — hard-delete de produto/serviço quebra referências em vendas antigas
- **Compliance fraco com LGPD** — sem trilha clara de quem deletou o quê e quando

Esse documento define a **estratégia alvo** pro sistema chegar num modelo coerente e seguro.

---

## 2. Estado atual (snapshot — 2026-05-19)

### 2.1 Inventário por entidade

#### Soft-delete (inconsistente)
| Entidade | Field(s) | Filtro | Audit Trail | Restore |
|---|---|---|---|---|
| `clients` | `isActive=false`, `deletedAt`, `deletedBy`, `deletedByName`, `mergedInto` | `isActiveClient()` em `lib/utils/clientFilters.ts` | ✅ completo | ❌ não há UI |
| `conversations` | `isDeleted=true`, `deletedAt` | inline em `ConversasModule.tsx:7127` | ⚠️ falta `deletedBy` | ❌ não há UI |

#### Imutável por rule (correto)
| Entidade | Justificativa |
|---|---|
| `conversationMessages` | Append-only — mensagens são imutáveis |
| `purchaseNotes` | Documento fiscal — imutável por lei |
| `stockMovements` | Ledger de estoque (append-only) |
| `fiscalDocuments` | Legal — NF-e/NFC-e/NFSe |
| `crmAuditLog` | Trilha de auditoria imutável |
| `budgets` | Orçamentos versionados — imutáveis por contrato |
| `dasRecords` | Registros DAS (Simples Nacional) — fiscal |

#### Hard-delete sem cascade (problemático)
`appointments`, `services`, `products`, `sales`, `transactions`, `kanbanBoards`, `kanbanCards`, `kanbanTemplates`, `crmContacts`, `crmDeals`, `crmActivities`*, `broadcasts`, `birthdayCampaigns`, `notes`, `spreadsheets`, `menuCategories`, `channelConnections`*

\* `crmActivities` migra pra Tier 1 (imutável — é log). `channelConnections` migra pra Tier 3 (preserva referências em conversations). Ver §3.

### 2.2 Inconsistências críticas

1. **Field naming divergente** — `clients` usa `isActive=false + deletedAt`, `conversations` usa `isDeleted=true + deletedAt`.
2. **Sem restore em lugar nenhum** — mesmo o soft-delete existente não oferece UI de "lixeira".
3. **Audit trail parcial** — `clients` grava `deletedBy/Name`, `conversations` só grava `deletedAt` (sem quem).
4. **Cascade só no merge** — `reassociateRelatedDocs()` em [mergeClients.ts:24](../app/components/features/clients/shared/mergeClients.ts#L24) reatribui filhos no merge de clientes; **nenhum outro fluxo cascade**.
5. **Hard-delete cria órfãos** — deletar product não limpa SaleItems históricos, deletar appointment não atualiza relatórios financeiros, etc.
6. **Filtros só client-side** — nenhuma query Firestore filtra `where('deletedAt', '==', null)`. Funciona mas é menos seguro.
7. **Lógica de filtro duplicada (não usa helper canônico)** — [`lib/utils/clientFilters.ts:26`](../lib/utils/clientFilters.ts#L26) define `isActiveClient(c)` checando 3 condições (`deletedAt`, `isActive === false`, `mergedInto`). Mas [`ConversasModule.tsx:5805`](../app/components/features/conversations/ConversasModule.tsx#L5805) reimplementa a lógica inline pra detectar duplicata de cliente (`!existing.mergedInto && !existing.deletedAt`), esquecendo o ramo `isActive === false`. Resultado: clientes desativados com flag legada (`isActive=false` sem `deletedAt`) escapam do dedup. Padrão correto seria importar e usar `isActiveClient()`.

---

## 3. Modelo alvo — 4 tiers de entidade

A regra de exclusão depende do **papel da entidade** no sistema. Não é one-size-fits-all.

### Tier 1 — Imutável (append-only ledger)

**Comportamento:** `allow delete: if false` na rule do Firestore. Nunca deletar.

**Critério de inclusão:**
- Logs (auditoria, eventos)
- Documentos fiscais (NF-e, NFC-e, NFSe)
- Mensagens (registros de comunicação)
- Ledgers contábeis/de estoque

**Entidades nesse tier:**
- `conversationMessages` ✅
- `purchaseNotes` ✅
- `stockMovements` ✅
- `fiscalDocuments` ✅
- `crmAuditLog` ✅
- `budgets` ✅
- `dasRecords` ✅
- `crmActivities` — **migrar** (hoje hard-delete, mas é log de eventos do CRM. Validar com o time se há caso real de delete legítimo antes de migrar)

**Já implementado corretamente** exceto `crmActivities`. Sem mudanças nas demais.

---

### Tier 2 — Status-driven (não deletar, mudar status)

**Comportamento:** entidade nunca é deletada. "Excluir" vira **mudança de status** (enum). UI mostra cancelados separados ou filtrados.

**Critério de inclusão:**
- Registros transacionais que têm ciclo de vida natural
- Citados por outros docs (reports, comissões, estoque) — órfãos quebrariam consistência
- Têm valor histórico mesmo após "fim"

**Entidades nesse tier (target):**
| Entidade | Status sugerido pra "delete" |
|---|---|
| `appointments` | `cancelled` / `no_show` |
| `sales` | `cancelled` / `refunded` |
| `transactions` | `cancelled` (já tem `paid`/`overdue`) |
| `broadcasts` | `archived` (após enviado) |
| `deliveryOrders` | `cancelled` |

**Hoje:** essas coleções permitem hard-delete via rule.
**Mudança necessária:** remover `allow delete` da rule, adicionar status enum na FSM da entidade (ou estender o existente), e refatorar UI pra usar "Cancelar" em vez de "Excluir".

**Princípio:** "Deletar venda" não faz sentido contábil — você **cancela** uma venda. Mesmo pra agendamentos: cancelar preserva o slot de tempo, comissão, histórico.

---

### Tier 3 — Soft-delete com restore

**Comportamento:** marca `deletedAt + deletedBy + deletedByName`. UI esconde por padrão. Lixeira em Settings permite restore por 30 dias. Após 30d, cron faz purge real (hard-delete + cascade).

**Critério de inclusão:**
- Entidades de **identidade** que operadores acidentalmente deletam
- Restore é valioso (perda = trabalho/relacionamento)
- Tem referências históricas mas o orfanato é tolerável com placeholder na UI ("[Excluído]")

**Entidades nesse tier (target):**
| Entidade | Status atual |
|---|---|
| `clients` | Já soft (refatorar pra contrato unificado) |
| `conversations` | Já soft (refatorar pra contrato unificado) |
| `kanbanBoards` | Hard hoje — migrar (deletar board = perder TODO o trabalho) |
| `services` | Hard hoje — migrar (referenciado por appointments históricos) |
| `spreadsheets` | Validar atual (parece soft, mas inconsistente) |
| `notes` | Opcional (baixo custo, mas leve) |
| `channelConnections` | Hard hoje — migrar. Conversas guardam `channelConnectionId` denormalizado; deletar conexão quebra resolução de transporte em mensagens históricas. Soft permite reconectar canal sem perder vínculo. |

---

### Tier 4 — Hard-delete sem dó

**Comportamento:** Firestore `deleteDoc()` direto. UI confirma uma vez, deleta, sem reversão.

**Critério de inclusão:**
- **Configuração** (recriar é trivial)
- Sem referências históricas relevantes
- Vida útil curta ou volátil por design

**Entidades nesse tier:**
| Entidade | Justificativa |
|---|---|
| `snippets` / `quickReplies` | Recriar é trivial |
| `segments` (CRM) | É só um filtro salvo |
| `recipientLists` | Configuração |
| `automations` / regras | Configuração |
| `forms` (templates) | Configuração |
| `kanbanTemplates` | Reusables, fácil recriar |
| `menuCategories` | Configuração de cardápio |

**`crmActivities`** foi movido pra **Tier 1** (logs de eventos não deveriam deletar — ver §3 Tier 1).

---

## 4. Regras de cascade

### 4.1 Quando soft-delete o pai → **deixar os filhos vivos com placeholder**

**Default.** Filhos continuam existindo, UI mostra `[Cliente excluído]` / `[Produto removido]`. Restore do pai re-conecta tudo automaticamente.

**Exemplo:** soft-delete cliente Maria → agendamentos antigos dela aparecem em relatórios como "Cliente: [excluído]". Restore Maria → agendamentos voltam a mostrar nome dela.

### 4.2 Exceção: containers → **cascade soft-delete dos filhos**

Quando filho **não faz sentido sem o pai**, soft-delete também os filhos.

| Pai | Filhos que recebem cascade soft |
|---|---|
| `kanbanBoard` | `kanbanCards` daquele board |
| `kanbanTemplate` | cards-template (se Tier 3) |

**Importante:** é cascade **soft**, não hard. Restore do pai precisa restaurar filhos junto. Salvar `cascadeFromParentId` nos filhos pra restore reverter consistente.

### 4.3 Merge (já implementado pra clients)

Merge é **reassignment**, não delete. Helper centralizado: [`reassociateRelatedDocs()` em `mergeClients.ts:24`](../app/components/features/clients/shared/mergeClients.ts#L24).

Reatribui filhos pro pai primary:
- `conversations.crmContactId`
- `appointments.clientId`
- `sales.clientId`
- `transactions.clientId / contactId`
- `crmDeals.contactId`
- `crmActivities.contactId`
- `kanbanCards.contactId`
- `loyaltyHistory.clientId`

**Padrão a replicar:** se for implementar merge pra outras entidades (ex: produtos duplicados), seguir esse modelo — helper centralizado, transactional, com rollback se algum step falhar.

### 4.4 LGPD purge → **hard-delete real com cascade ou anonimização**

Distinto do soft-delete normal. Operação explícita, admin-only, irreversível.

**Quando:**
- Cliente solicita "direito ao esquecimento"
- Cron mensal de retenção (após 30 dias na lixeira)

**O que faz:**
- Hard-delete do registro
- Cascade de hard-delete OU anonimização nos filhos (depende da regra):
  - Filhos em Tier 1 (imutável): anonimiza PII (`clientName: "[anonimizado]"`)
  - Filhos em Tier 2/3: anonimiza referência (`clientId: null`, mantém histórico financeiro)
  - Filhos em Tier 4: hard-delete cascade

**Implementação:** endpoint dedicado `/api/admin/purge` ou service `lib/services/dataRetention.ts`. Não confundir com delete normal.

> ⚠ **R1 (multi-tenant) crítico aqui:** o purge endpoint **DEVE** validar que o `businessId` do alvo bate com o `businessId` do user autenticado. Sem isso, um admin de um tenant poderia purgar dados de outro via path manipulation. Use `verifyAuth(req, businessId)` antes de qualquer operação. Cron de retenção: itera `businesses` e roda purge per-tenant, nunca cross-tenant numa query única.

---

## 5. Plano de migração incremental

**Princípio:** não fazer big-bang. Migrar entidade por entidade conforme o módulo for tocado em features futuras. Cada migração é commit independente, testável isoladamente.

### Fase 0 — Infra compartilhada (~4-5h, incluindo testes)

**Bloqueante das outras fases.** Cria os primitives.

- [ ] **Helper centralizado** `lib/utils/recordFilters.ts`
  - `isActiveRecord(doc: { deletedAt?: string; mergedInto?: string }): boolean` — true se `!deletedAt && !mergedInto`
  - `withSoftDelete<T>(snapshot)` — filtra array de docs
  - Todo módulo importa, ninguém reescreve regra
- [ ] **Tipo unificado** em `lib/contracts/_runtime/softDelete.ts`
  - `SoftDeletable` interface: `{ deletedAt?: string; deletedBy?: string; deletedByName?: string; mergedInto?: string }`
  - Schema Zod compartilhado
- [ ] **Helper de delete** `lib/services/softDelete.ts`
  - `softDeleteDoc(ref, user)` → `updateDoc(ref, { deletedAt: ISO, deletedBy: uid, deletedByName: name })`
  - `restoreDoc(ref)` → `updateDoc(ref, { deletedAt: deleteField(), deletedBy: deleteField(), deletedByName: deleteField() })`
- [ ] **Testes unitários** `tests/utils/softDelete.test.ts` + `tests/utils/recordFilters.test.ts`
  - `isActiveRecord`: aceita ausência de campos, rejeita `deletedAt` presente, rejeita `mergedInto` presente, aceita docs legados sem nenhum dos campos
  - `softDeleteDoc`: idempotência (chamar 2x não duplica audit), preserva `updatedAt`
  - `restoreDoc`: limpa os 3 campos atomicamente
  - Edge case: `deletedAt: ''` (string vazia) deve tratar como "não deletado"

### Fase 1 — Padronizar contrato em `clients` (~1h)

- [ ] Remover `isActive` field — só `deletedAt` decide se está deletado
  - Migration: script backfill `if (!isActive && !deletedAt) → deletedAt = updatedAt`
  - UI: usar `isActiveRecord(client)` no lugar de `client.isActive !== false`
- [ ] `isActiveClient()` em `lib/utils/clientFilters.ts` vira wrapper de `isActiveRecord`
- [ ] Testar: clientes soft-deletados continuam fora dos pickers/listagens

### Fase 2 — Padronizar contrato em `conversations` (~1h)

- [ ] Renomear `isDeleted: true` → `deletedAt: ISO` (mesma lógica)
- [ ] Adicionar `deletedBy + deletedByName`
- [ ] Migration: backfill `if (isDeleted) → deletedAt = updatedAt`
- [ ] Corrigir lookup de duplicatas em `ConversasModule.tsx:5805` pra usar `isActiveRecord`

### Fase 3 — UI "Lixeira" em Settings → Auditoria (~3h)

- [ ] Nova aba `Settings → Auditoria → Lixeira`
- [ ] Lista paginada de docs soft-deletados nas últimas 30d
- [ ] Filtro por coleção (Clientes / Conversas / Boards / Serviços)
- [ ] Action: **Restaurar** (admin/founder only — ROLE_HIERARCHY check)
- [ ] Action: **Purgar permanentemente** (founder only — LGPD)
- [ ] Audit log de quem restaurou/purgou (entry em `crmAuditLog`)

### Fase 4 — Tier 3 expansion (~4h, faseado)

Adicionar soft-delete em entidades de alto risco:

- [ ] `kanbanBoards` (+ cascade soft pra `kanbanCards`)
- [ ] `services` (referenciado por appointments históricos)
- [ ] `spreadsheets` (validar atual)

Cada uma é um PR independente. Modelo: adicionar `deletedAt + deletedBy + deletedByName` na rule, mudar UI de "Excluir" pra `softDeleteDoc`, validar que pickers/listagens filtram.

### Fase 5 — Tier 2 migration (~16-25h, faseado por entidade)

Migrar de hard-delete pra status-driven. **Mais arriscado** — touches reports/comissões/estoque/fiscal. Cada entidade é commit/PR isolado.

> ⚠ **Estimativa realista:** o ~6h original subestima. `appointments` sozinho tem 5+ side-effects cross-módulo (comissões via [commission.ts](../lib/services/commission.ts), loyalty, GCal sync, conversation outbound, financial transaction). Cada lugar precisa decidir como filtrar `status === 'cancelled'`. Realista por entidade: `appointments` 4-6h, `sales` 3-5h (mexe em fiscal + stockMovements), `transactions` 2-3h, `broadcasts` 2h, `deliveryOrders` 2h.

- [ ] `appointments` → adicionar status `cancelled`/`no_show`, remover `allow delete` da rule, UI "Cancelar" em vez de "Excluir"
- [ ] `sales` → status `cancelled`/`refunded`, mesma estrutura
- [ ] `transactions` → status `cancelled`
- [ ] `broadcasts` → status `archived`
- [ ] `deliveryOrders` → status `cancelled`

Pra cada uma:
1. Adicionar status na FSM (`lib/contracts/fsm/{entity}.ts`)
2. Migration: backfill docs antigos (hard-deletados não existem mais, OK)
3. Remover `allow delete` da rule
4. Refatorar UI (botão "Excluir" → "Cancelar")
5. Reports/exports: filtrar `status !== 'cancelled'` por default, oferecer toggle "incluir cancelados"

### Padrão de migração de dados (aplicável a Fases 1, 2, 4 e 5)

Sempre que mudar o **shape** de um campo existente (ex: `isActive=false` → `deletedAt: ISO`, ou `isDeleted: true` → `deletedAt: ISO`), seguir o **padrão dual-write em 3 deploys** pra evitar janela de inconsistência:

**Deploy A — Backwards-compat read**
- Código novo lê AMBOS os formatos (`!doc.deletedAt && doc.isActive !== false` ou `!doc.isDeleted && !doc.deletedAt`)
- Continua escrevendo no formato VELHO (zero risco)
- Deploy estável por pelo menos 24h

**Backfill script**
- `scripts/backfill-{entity}-soft-delete.ts`
- Idempotente — skipa docs já migrados
- `--dry-run` primeiro pra contar quantos
- Rodar fora de horário de pico (~3 AM) pra reduzir contenção

**Deploy B — Write novo formato**
- Código passa a escrever APENAS o formato novo (`deletedAt`)
- Continua LENDO ambos (cobre docs antigos que escaparam do backfill por race)
- Pode rodar backfill de novo se necessário

**Deploy C — Cleanup**
- Remove leitura do formato velho
- Adiciona migration final (campo legado vira `null` ou é removido via FieldValue.delete)
- Documenta no migrações de schema

**Anti-pattern:** Big bang (Deploy único que muda tudo) — qualquer falha durante deploy gradual deixa parte dos containers escrevendo no formato velho enquanto outros leem só o novo. Resultado: docs aparecem "vivos" pra alguns usuários e "deletados" pra outros até estabilizar.

### Fase 6 — Cron de purge LGPD (~2h)

- [ ] Service `lib/services/dataRetention.ts` com `purgeExpiredSoftDeletes()`
- [ ] Endpoint `/api/data-retention/run` com auth `Bearer CRON_SECRET`
- [ ] Cron diário no [docker-compose.yml](../docker-compose.yml) (3 AM, baixo tráfego)
- [ ] Cobre Tier 3 com `deletedAt < (now - 30d)`
- [ ] Anonimização PII em Tier 1 cascade
- [ ] Log de purge em `crmAuditLog`

**Opcional/depois:**
- [ ] Endpoint manual `/api/admin/purge-client/:id` pra LGPD direito-ao-esquecimento por demanda

---

## 6. O que NÃO fazer

Anti-padrões a evitar:

- ❌ **Cascade hard-delete em soft-deletes** — quebra restore (filhos somem antes do pai restaurar)
- ❌ **Soft-delete em tudo** — adiciona complexidade em 100% das queries pra resolver problema que só existe em ~30% das entidades
- ❌ **Filtros server-side via Firestore** (`where('deletedAt', '==', null)`) — exige índice composto em toda coleção querida. Não vale pro tamanho atual (centenas de docs/tenant). Reservar pra quando algum tenant passar de ~5k docs.
- ❌ **Renomear tudo de uma vez** — migração de dados existentes é cara. Fazer incrementalmente quando tocar no módulo.
- ❌ **Misturar `deleted` e `archived`** semanticamente — soft-delete é "operador errou, quero restaurar", archived é "entidade concluiu ciclo, manter histórico". Um é Tier 3, outro é Tier 2.
- ❌ **Confiar só em UI confirmation** pra prevenir delete acidental — confirmation modal ajuda, mas soft-delete + lixeira é a rede de segurança real.

---

## 7. Referências de mercado

Convergência clara nos ERPs/CRMs SaaS:

| Sistema | Padrão |
|---|---|
| **Stripe** | Customers soft (`deleted: true`); charges imutáveis; refunds são records |
| **HubSpot** | Contatos soft, recycle bin 90 dias |
| **Shopify** | Products archived, orders never deleted |
| **Pipedrive** | Soft-delete com 30 dias na lixeira |
| **Salesforce** | Recycle bin 15 dias, depois purge |
| **Notion** | Trash 30 dias, depois purge cron |

Todos convergem em: **transações nunca deletam, identidades têm restore, config hard-delete**.

---

## 8. LGPD — checklist de compliance

| Requisito LGPD | Como o sistema atende (target) |
|---|---|
| Direito ao acesso | Export atual já cobre (`Settings → Exportar dados`) |
| Direito à retificação | UI de edição em cada módulo |
| Direito à eliminação | Endpoint `/api/admin/purge-client/:id` (Fase 6+) |
| Direito à portabilidade | Export JSON/CSV (existente) |
| Retenção limitada | Cron 30d em soft-deletes (Fase 6) |
| Trilha de auditoria | `crmAuditLog` + `deletedBy/At` em todos Tier 3 |

---

## 9. Glossário

- **Soft-delete**: marca registro como deletado via field (`deletedAt`), mantém doc no Firestore. UI esconde, restore possível.
- **Hard-delete**: `deleteDoc()` real do Firestore. Irreversível.
- **Cascade**: ação propaga pra docs relacionados (filhos).
- **Purge**: hard-delete real de um soft-delete. Operação explícita pós-retenção.
- **Merge**: reassign de filhos pra um doc primary, marca duplicate como `mergedInto` (não é delete).
- **Status-driven**: entidade nunca deleta; "fim de vida" vira mudança de enum (`cancelled`, `archived`).

---

## 10. Histórico

| Data | Versão | Mudança |
|---|---|---|
| 2026-05-19 | 1.0 | Documento inicial — modelo conceitual + plano de migração |
| 2026-05-19 | 1.1 | Auditoria contra código real. Inventário Tier 1 completo (`budgets`, `dasRecords`). `crmActivities` movido pra Tier 1. `channelConnections` adicionado a Tier 3. §2.2 item 7 reescrito (era descrição imprecisa do bug). Nova seção "Padrão de migração de dados" (dual-write 3 deploys). Estimativas Fase 0 e Fase 5 corrigidas. Nota explícita de R1 (businessId) em LGPD purge. Checklist de testes em Fase 0. |
