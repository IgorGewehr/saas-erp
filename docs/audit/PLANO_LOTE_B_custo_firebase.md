# Plano Lote B — Custo Firebase (2 itens P0)

> Plano READ-ONLY de execução. Nenhum código foi alterado ao escrever isto.
> Origem: `docs/audit/PRODUCTION_CHECKUP_2026-05-29.md` §2 (geradores #1 e #2).
> Regras duras aplicáveis: R1 (`businessId`), R3 (idempotência), R6 (validação no boundary).

---

## ITEM 1 — Reports: janela de data server-side + agregados denormalizados

### 1.0 O que acontece HOJE (confirmado no código)

`app/components/features/reports/ReportsModule.tsx`:

- `periodRange = getPeriodRange(period)` em **L888**. `period: '7d'|'30d'|'90d'|'mes'|'mes_anterior'|'ano'` (L32). `getPeriodRange` em **L45-77** devolve `{start, end}` como `Date`.
- As **6 queries** (L891-957) baixam a coleção **inteira** por tenant: cada uma é `query(collection(db,X), where('businessId','==',businessId), orderBy('createdAt','desc'))` + `getDocs` — **sem `where(createdAt …)` e sem `limit`**. Coleções: `transactions` (L895), `appointments` (L906), `clients` (L917), `reviews` (L928), `sales` (L940), `orders` (L952).
- O recorte de período só acontece **client-side, depois do download**, via `inPeriod(dateStr,start,end)` (L94-99) dentro de cada Tab (`useMemo`).

### 1.1 DESCOBERTA CRÍTICA — confirmar antes de codar

**(a) Os índices já existem.** Rodei a verificação em `firestore.indexes.json`: as 6 coleções **já têm** índice composto `[businessId ASC, createdAt DESC]` (transactions, appointments, clients, reviews, sales, orders — todas `true`). Um índice equality(`businessId`)+ordered(`createdAt`) **serve** range `>=`/`<=` sobre `createdAt` com `orderBy('createdAt')`. **Conclusão: o filtro server-side por `createdAt` NÃO requer nenhum índice novo.** (A auditoria supôs índices baratos a criar; na prática estão presentes.) → **Não criar índice novo para o caminho `createdAt`.**

**(b) O campo de recorte NÃO é `createdAt` em todas as tabs.** Este é o ponto de risco de mudança de comportamento. O que cada Tab filtra hoje (confirmado L202-834):
- **VendasTab / FinanceiroTab / ComissoesTab** (transactions): `inPeriod(t.paymentDate || t.createdAt, …)` (L208, L647, L812, L832) — recorta por **`paymentDate` com fallback `createdAt`**.
- **AgendaTab** (appointments): `inPeriod(a.date, …)` (L503) — recorta por **`a.date`** (string `YYYY-MM-DD`).
- **ProdutosTab**: `sales` por `s.createdAt` (L326), `orders` por `o.createdAt` (L333), `appointments` por `a.date` (L340).
- **ClientesTab**: `clients` por `c.createdAt` (L741); `appointments` por `a.date` (L748).

Implicação: um filtro server-side cego `where('createdAt' >= start)` **mudaria o resultado** para:
- `transactions`: uma transação com `paymentDate` dentro do período mas `createdAt` antigo (ex: conta lançada mês passado, paga este mês) **sumiria** do relatório. **Regressão financeira.**
- `appointments`: agendamento com `date` no período mas criado antes **sumiria** da Agenda/Produtos.

→ **Não force `createdAt` onde o domínio recorta por outro campo.** O filtro server-side tem de bater no **mesmo campo** que a tab usa, senão diverge.

### 1.2 Estratégia por coleção (alinhar campo server-side ao campo de recorte)

| Coleção | Campo de recorte (UI) | Filtro server-side proposto | Índice necessário |
|---|---|---|---|
| `transactions` | `paymentDate \|\| createdAt` | janela em `createdAt` **alargada** (ver 1.2.1) | já existe `[businessId, createdAt desc]` |
| `appointments` | `date` (string `YYYY-MM-DD`) | `where('date','>=',startStr)` + `where('date','<=',endStr)` + `orderBy('date','desc')` | **novo** `[businessId, date desc]` |
| `clients` | `createdAt` | `where('createdAt','>=',startIso)` + `<= endIso` | já existe |
| `reviews` | `createdAt` | idem | já existe |
| `sales` | `createdAt` | idem | já existe |
| `orders` | `createdAt` | idem | já existe |

**1.2.1 transactions — tratamento especial.** Como o recorte é `paymentDate || createdAt`, o caminho seguro e barato é:
- Opção A (recomendada p/ períodos curtos 7d/30d/90d/mes/mes_anterior): buscar por `createdAt >= start` **e também** uma 2ª query por `paymentDate >= start` (campo existe), unindo client-side por `id` (dedupe por `Map`). Requer índice `[businessId, paymentDate desc]` (novo). Mantém comportamento idêntico ao atual.
- Opção B (mais simples, leve regressão aceitável só se o dono aprovar): filtrar só `createdAt` mas **alargar a janela** (ex: `start - 90d`) para capturar contas pagas com atraso, e manter o `inPeriod(paymentDate||createdAt)` client-side por cima. Reduz reads sem mudar o resultado visível, ao custo de baixar um pouco a mais. **Decisão de produto — default: Opção A.**

**Formato de valor no `where`:** confirmar como `createdAt`/`paymentDate` são gravados (ISO string vs Timestamp). O código atual trata como **string** (`parseLocalDate`, `inPeriod` recebem string). Logo os limites do range devem ser passados como **string ISO** (`start.toISOString()` / `end.toISOString()`) para comparar lexicograficamente com ISO — válido porque ISO-8601 é ordenável como string. Para `appointments.date` (`YYYY-MM-DD`), passar `start`/`end` como `YYYY-MM-DD` (formatar com `getPeriodRange`). **Verificar no boundary antes de codar — se algum doc gravar Timestamp, ajustar para `Timestamp.fromDate`.**

### 1.3 Agregados longos (visão anual) sem baixar tudo

`period === 'ano'` ainda pode trazer o ano inteiro. Duas camadas:

**(i) Curto/médio prazo (parte do Lote B):** o filtro por janela já corta de **O(histórico)** para **O(período)**. Para `ano`, o período é no máximo 12 meses do tenant — aceitável na 1ª fase, e já elimina o pior caso (tenant com 3 anos de dados baixando tudo a cada open).

**(ii) Rollups denormalizados (fase 2, para `ano` e dashboards):** introduzir contadores mensais por coleção:
- **Coleção nova:** `reportRollups/{businessId}_{yyyyMM}` (1 doc por mês por tenant). Doc-id determinístico `${businessId}_${ano}${mes}`.
- **Schema (Zod em `lib/contracts/domain/reportRollup.ts` — R2):**
  ```
  { businessId, period: 'YYYY-MM',
    sales:        { count, grossTotal },
    transactions: { paidCount, paidTotal, commissionTotal },
    appointments: { count, completedCount },
    orders:       { count, total },
    clients:      { newCount },
    reviews:      { count, ratingSum },
    updatedAt }
  ```
- **Quando atualiza:** via `FieldValue.increment` no mesmo ponto server-side que já grava o fato (PDV→sales, financeiro→transactions, agenda→appointments, etc.). Como esses writes ocorrem em pontos distintos, declarar o side-effect como **evento** (R5) `report.factRecorded` e, quando ≥2 produtores existirem, promover a `dispatchDomainEvent`. **Não inline na UI.**
- **Idempotência (R3):** cada incremento amarrado ao id do fato; usar transação que checa um marcador `rollupApplied/{factId}` ou gravar o delta dentro da mesma transação que cria o fato (preferível — atômico, sem dedupe extra).
- Para `ano`, os KPIs agregados leem **12 docs** de rollup em vez de N mil fatos. As tabs de **detalhe/lista** continuam usando a query com janela (lazy, só quando a tab abre).

**Decisão:** Lote B entrega **(i)** (janela server-side) + o **schema e o documento** dos rollups. O *cabeamento* dos incrementos pode ser fase 2 separada para não tocar todos os produtores de fato de uma vez.

### 1.4 Backfill / fallback p/ `createdAt`/`date` faltando em docs antigos

- Risco: doc antigo sem `createdAt` (ou `date`) **não casa** com `where(>= )` e **somem** do relatório.
- **Verificar primeiro** (read-only no Console/script): quantos docs por coleção têm `createdAt == null`. Se ~0, seguir sem backfill.
- **Backfill** (script admin, idempotente): para cada coleção, `where('createdAt','==', null)` → setar `createdAt = updatedAt || <data do doc> || epoch conhecido`. Para `appointments` sem `date`, derivar de `createdAt`. Rodar **antes** do deploy da query filtrada.
- **Fallback de UI:** manter `inPeriod` client-side por cima da janela server-side (defesa em profundidade + recorte fino por `paymentDate`/`date`). Assim, mesmo que a janela server-side seja levemente mais larga, o número exibido continua exato.

### 1.5 Passos numerados — Item 1

1. **Confirmar formato de `createdAt`/`paymentDate`/`date`** (string ISO vs Timestamp) lendo um doc real de cada coleção. (read-only)
2. **Backfill** `createdAt`/`date` nulos (se a contagem do passo 0 justificar). Script admin idempotente.
3. **`firestore.indexes.json`:** adicionar `[businessId ASC, date DESC]` em `appointments`; e (se Opção A em 1.2.1) `[businessId ASC, paymentDate DESC]` em `transactions`. Deploy de índices **antes** do código.
4. **`ReportsModule.tsx` L891-957:** reescrever cada `queryFn` para incluir `where`/`orderBy` no campo certo (tabela 1.2). Incluir `periodRange` no `queryKey` (`['transactions', businessId, period]`) para refetch ao trocar período. Manter `staleTime`. Manter `inPeriod` client-side (1.4).
5. **transactions:** implementar Opção A (2 queries + dedupe por id) ou Opção B (janela alargada) conforme decisão de produto.
6. **(Fase 2, opcional no Lote B)** criar `lib/contracts/domain/reportRollup.ts` (Zod) + rules da coleção `reportRollups` + cabeamento dos incrementos via evento `report.factRecorded`.
7. **Testes** (1.7) + **doc** em `docs/architecture-map.md` (nova coleção `reportRollups`, se entrar).

### 1.6 Impacto esperado — Item 1

- De **O(histórico do tenant)** por open → **O(período selecionado)**. Tenant médio: ~75k reads/open → poucos milhares (7d/30d). Estimado **500k–1M reads/dia/tenant ativo → fração disso**.
- `ano` ainda O(12 meses) na fase 1; O(12 docs) após rollups.

### 1.7 Testes — Item 1

- `__tests__/contracts/reportRollup` (se schema entrar): invariantes (counts ≥ 0, period regex).
- Teste de `getPeriodRange` × formatação de limites (string ISO / `YYYY-MM-DD`).
- Smoke: tenant seed com docs dentro e fora do range → asserir que a query server-side + `inPeriod` devolve exatamente os de dentro, incluindo o caso `paymentDate in-period & createdAt out-of-period` (regressão de 1.1b).
- Caso `createdAt` ausente: doc não some indevidamente após backfill.

### 1.8 Critério de pronto — Item 1

- Cada query envia `where(<campo>, '>=', start)` + `<= end)` no campo que a tab recorta; sem `getDocs` de coleção inteira.
- Números exibidos **idênticos** ao comportamento atual nos 6 períodos (validado por teste de paridade), inclusive transações pagas com atraso.
- `typecheck` + `test` verdes. Sem `any`.

---

## ITEM 2 — Badges de conversa: contador denormalizado + `limit(50)`

### 2.0 O que acontece HOJE (confirmado no código)

Três `onSnapshot` **full-collection** sobre `conversations`, todos re-entregando a cada mensagem (porque `lastMessageAt`/`unreadCount` mudam):

1. **`TopBar.tsx` L149-193** — badge global. `query(conversations, where businessId)` (admin) ou `and(businessId, or(channelOwnerType=='business', channelOwnerId==uid))` (não-admin). No callback soma `unreadCount>0` e guarda `unreadConvIds` (usado em L282-286 para zerar em lote, L515 para abrir a 1ª). **Montado em toda página.**
2. **`Sidebar.tsx` L380-427** — `myAwaitingCount`. `query(conversations, where businessId)` (full), filtra client-side `isActiveRecord` + `unreadCount>0` + `snoozedUntil` + visibilidade. **Montado em toda página.**
3. **`ConversasModule.tsx` L7219-7269** — a **lista** de conversas. Mesma query com `orderBy('lastMessageAt','desc')`, **sem `limit`**. Tem retry com backoff.

Escritas que mexem `unreadCount` (confirmado por grep):
- **Incremento (+1)** server-side nos ingestores de mensagem inbound: `app/api/webhooks/meta/route.ts` L1680 (`:1`)/L1789 (`increment(1)`), `app/api/webhooks/facebook/route.ts` L391/L420, `app/api/whatsapp/baileys-manager.ts` L889/L937/L1016. (Admin SDK / `FieldValue`.)
- **Zeragem (markAsRead)**: `ConversasModule.tsx` L4281, L6552 (`updateDoc unreadCount:0`), L7595 (batch), L8182; `OmnichannelInbox.tsx` L386; `app/api/conversations/[id]/route.ts` L57. Há também **incremento client** "marcar como não lida" em `ConversasModule.tsx` L6587.

### 2.1 Doc denormalizado de contadores

**Decisão de granularidade:** os badges hoje são **por-usuário** (não-admin só conta conversas que ele vê: `channelOwnerType=='business'` OR `channelOwnerId==uid`). Um único `unreadCounters/{businessId}` **não** consegue exprimir o recorte por usuário sem perder fidelidade para operadores. Portanto:

- **Coleção nova:** `unreadCounters/{businessId}` com **mapa por escopo**:
  ```
  {
    businessId,
    business: number,           // soma de unread de conversas channelOwnerType=='business'
    byUser: { [uid]: number },  // soma de unread de conversas channelOwnerId==uid (canais pessoais)
    updatedAt
  }
  ```
  - **Badge admin/founder** = `business + Σ byUser` (vê tudo). Para evitar mapa gigante, manter também `total: number` (todas as conversas do tenant) e usar `total` para admin.
  - **Badge operador** = `business + (byUser[uid] || 0)`.
  - Doc assinado por **1 `onSnapshot`** (1 doc) em vez de N conversas.
- **Schema Zod** em `lib/contracts/domain/unreadCounter.ts` (R2), `z.infer` para o tipo.

> Nota: `byUser` cresce com nº de operadores (dezenas), não com nº de conversas — seguro. Se um dia virar problema, migrar para subdoc `unreadCounters/{businessId}/users/{uid}`.

### 2.2 Onde incrementa / decrementa (idempotência R3)

Tudo **server-side**, na mesma operação que já mexe `conversations.unreadCount`, para ficar atômico:

- **Incremento (+1)** — nos ingestores inbound (meta/facebook/baileys, locais acima). Na **mesma transação/batch** que faz `unreadCount: increment(1)` na conversa, aplicar no contador:
  - se `channelOwnerType=='business'` → `business: increment(1)` e `total: increment(1)`;
  - senão → `byUser.${channelOwnerId}: increment(1)` e `total: increment(1)`.
  - **Idempotência:** o increment do badge tem de seguir a **mesma guarda de dedupe** que já protege a criação da mensagem (webhook deduplica por `wamid`/`externalMessageId`). Aplicar o increment **somente no caminho em que a mensagem é de fato nova** (mesmo `if` que incrementa `unreadCount` na conversa). Não criar um 2º caminho.
- **Decremento (markAsRead)** — perigo: hoje há ~6 pontos que zeram `unreadCount`. Para não somar deltas errados:
  - **Padrão:** ao zerar uma conversa, decrementar o contador pelo valor **que a conversa tinha** (`delta = -prevUnread`), no escopo daquela conversa (`business` ou `byUser[owner]`) e em `total`. Ler `prevUnread` na mesma transação (`runTransaction`) que faz `unreadCount:0` para evitar corrida.
  - Onde o markAsRead é **client** (ConversasModule/OmnichannelInbox), mover a baixa do contador para uma **rota server** idempotente `POST /api/conversations/[id]/read` (já existe `app/api/conversations/[id]/route.ts` que zera — estender para também ajustar o contador na mesma transação). Os clients passam a chamar a rota em vez de `updateDoc` direto. Isso centraliza o decremento e mantém R3.
  - **Idempotência do markAsRead:** como o decremento é `-prevUnread` lido na transação, reexecutar é no-op (já está 0). Seguro.

### 2.3 Lista de conversas com `limit(50)` + paginação

`ConversasModule.tsx` L7219-7269:
- Adicionar `limit(50)` à query (admin e não-admin), mantendo `orderBy('lastMessageAt','desc')`.
- **Paginação por cursor:** guardar `lastVisibleDoc` (último `QueryDocumentSnapshot`); botão/scroll "carregar mais" → `query(..., startAfter(lastVisible), limit(50))` via `getDocs` (one-shot, não snapshot — só as 50 primeiras ficam live).
- **`onSnapshot` só nas 50 primeiras.** Páginas seguintes são `getDocs` (não precisam de tempo real).
- Índices: a query não-admin usa `and(businessId, or(...))` + `orderBy(lastMessageAt)` — **confirmar** se já há índice composto que cobre OR+orderBy+limit; `limit` não muda requisito de índice, então se hoje funciona sem erro, continua. (Verificar no Console / `firestore.indexes.json`.)

### 2.4 Regras Firestore — coleção `unreadCounters` (R1)

Adicionar bloco em `firestore.rules` (espelhar helper `belongsToBusiness` em L26):
```
match /unreadCounters/{businessId} {
  allow read:  if isSignedIn() && belongsToBusiness(businessId);
  allow write: if false;   // só Admin SDK (server) escreve
}
```
- **Read:** qualquer membro autenticado do tenant (badge é leitura). `businessId` é o doc-id → R1 satisfeita.
- **Write:** negado para client; incrementos/decrementos vêm de rotas server (Admin SDK ignora rules). Isso evita que client infle o contador. (Os markAsRead client migram para rota server — ver 2.2.)

### 2.5 Backfill inicial + rollout sem downtime

**Backfill (script admin, idempotente):** para cada `businessId`, varrer `conversations` ativas uma única vez e somar `unreadCount` por escopo (`business`, `byUser[owner]`, `total`); gravar `unreadCounters/{businessId}`. Reexecutável (sobrescreve com `set`).

**Rollout faseado (sem downtime):**
1. Deploy do **schema + rules + escrita** dos contadores (incrementos/decrementos passam a manter o doc), **mantendo os 3 listeners atuais** lendo `conversations`. Contador passa a existir e ficar correto dali pra frente.
2. **Backfill** para popular valores históricos.
3. Trocar **TopBar** e **Sidebar** para assinar `unreadCounters/{businessId}` (1 doc). Manter a query antiga atrás de flag por 1 release para comparar.
4. Aplicar **`limit(50)` + paginação** na lista do ConversasModule.
5. Remover o código de listener full-collection dos badges após validação.

> Atenção a uma regressão de funcionalidade em TopBar: `unreadConvIds` (L148, usado em L282-286 para zerar em lote e L515 para abrir a 1ª conversa) **não existe** num contador agregado. Antes de remover o listener do TopBar, decidir: (a) manter um `getDocs` `where('unreadCount','>',0) limit(20)` sob demanda quando o usuário abre o dropdown (não um snapshot contínuo), ou (b) remover o atalho "abrir 1ª não-lida". **Confirmar com o dono — não remover comportamento sem decisão.** Default: opção (a), one-shot ao abrir o dropdown.

### 2.6 Arquivos a tocar (file:line) e ordem

1. `lib/contracts/domain/unreadCounter.ts` — **novo** schema Zod (R2).
2. `firestore.rules` — bloco `match /unreadCounters/{businessId}` (perto de L657).
3. `app/api/webhooks/meta/route.ts` L1680/L1789, `app/api/webhooks/facebook/route.ts` L391/L420, `app/api/whatsapp/baileys-manager.ts` L889/L937/L1016 — incremento do contador na mesma operação (R3).
4. `app/api/conversations/[id]/route.ts` L57 — estender para decrementar `-prevUnread` em transação; criar/usar como rota canônica de markAsRead.
5. `app/components/features/conversations/ConversasModule.tsx` L4281/L6552/L7595/L8182 e `OmnichannelInbox.tsx` L386 — trocar `updateDoc unreadCount:0` direto pela chamada à rota server (decremento centralizado).
6. Script de **backfill** (em `scripts/` ou tasks admin) — popular `unreadCounters`.
7. `app/components/layout/TopBar.tsx` L149-193 e `Sidebar.tsx` L380-427 — assinar `unreadCounters/{businessId}` (1 doc) em vez do full-collection; resolver `unreadConvIds` via 2.5(a).
8. `ConversasModule.tsx` L7219-7269 — `limit(50)` + cursor (`startAfter`).
9. `docs/architecture-map.md` — registrar coleção `unreadCounters`.

**Ordem de execução:** 1 → 2 → 3 → 4 → 5 (escrita correta + rules) → 6 (backfill) → 7 → 8 (leitura nova) → remover listeners antigos → 9 (doc).

### 2.7 Testes — Item 2

- `__tests__/contracts/unreadCounter` — invariantes (counts ≥ 0).
- Increment idempotente: reentregar mesmo `wamid` não soma 2x (dedupe).
- Decrement: markAsRead duas vezes → contador não fica negativo (no-op na 2ª).
- Paridade: somatório de `conversations.unreadCount` por escopo == valores no contador, após backfill e após N mensagens/markAsReads.
- Lista: `limit(50)` retorna no máx 50; `startAfter` pagina sem buracos/duplicatas.
- R1: read negado para usuário de outro tenant; write negado para client.

### 2.8 Critério de pronto — Item 2

- Badges de TopBar e Sidebar assinam **1 doc** (`unreadCounters/{businessId}`), zero listener full-collection sobre `conversations` para badge.
- Lista do ConversasModule com `limit(50)` + paginação funcional.
- Contador bate com a soma real por escopo (teste de paridade), incremento idempotente, decremento sem negativos.
- Rules: read só do tenant, write só server. `typecheck` + `test` verdes.

---

## Riscos transversais

- **Mudança de comportamento por campo de data errado** (Item 1.1b) — o maior risco. Mitigado mantendo `inPeriod` client-side e alinhando o `where` ao campo certo.
- **Decremento de contador divergente** (Item 2) — múltiplos pontos de markAsRead. Mitigado centralizando o decremento numa rota server transacional.
- **`unreadConvIds` perdido no TopBar** — não remover o atalho sem decisão do dono.
- **Docs antigos sem `createdAt`/`date`/`channelOwnerType`** — backfill antes do deploy; fallback client-side conservador.
