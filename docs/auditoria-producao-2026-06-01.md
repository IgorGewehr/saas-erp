# Relatório Executivo — Auditoria ServicePro (Produção)

> Gerado em 2026-06-01 por auditoria multi-agente (67 subagents, 51 findings verificados adversarialmente).
> Severidades: 1×P0 · 13×P1 · 27×P2 · 10×P3.

## 1. Resumo executivo

A plataforma é funcional e respeita a regra mais crítica (R1 — isolamento por `businessId` está intacto em todos os caminhos auditados; nenhum vazamento entre tenants foi encontrado). Porém a saúde de produção tem 5 temas estruturais que limitam escala, confiabilidade financeira e a promessa de "operar tudo pelo cérebro IA":

1. **Custo Firebase descontrolado** — múltiplos `onSnapshot` full-collection sem `limit` sobre as coleções que mais crescem (`transactions`, `conversations`, `clients`, `stockMovements`), replicados em Sidebar (sempre montada) + Dashboard + Financial, todos vivos simultaneamente porque as abas ficam montadas. Em tenant maduro, abrir o app custa dezenas de milhares de reads antes de qualquer interação.
2. **Receita de delivery invisível no Financeiro** — `DeliveryOrder` nunca gera `Transaction` em nenhum dos 4 caminhos de escrita. Para o use case restaurante (canal principal), 100% do faturamento de delivery some do Financeiro, Relatórios e dos summaries do agent.
3. **Regras duras R3/R4/R5 definidas mas não aplicadas** — FSMs existem (`assertTransition*`) mas nenhum write path os invoca; rotas financeiras do agent não têm idempotência; side-effects cross-módulo rodam inline em handlers de UI.
4. **Divergência agent ↔ humano** — vendas/pedidos criados pelo agent não baixam estoque, não geram receita e não são idempotentes, ao contrário dos fluxos PDV/v1.
5. **Monolitos de UI** — ConversasModule (10.9k linhas), SettingsModule (7.7k), FinancialModule (6.6k), CRMModule (5k) concentram lógica de persistência inline, inviabilizando review e elevando risco de regressão (já houve um revert).

Nenhum P0 de segurança/vazamento; o único P0 é de custo (listeners full-collection em `transactions`), que o próprio time já classificou como P0 ao resolver o caso idêntico de `conversations` (commit cc956b8).

---

## 2. Achados priorizados

### P0 — crítico (resolver imediatamente)

**P0.1 — Três `onSnapshot` full-collection simultâneos em `transactions` sem `limit`**
- Arquivos: `Sidebar.tsx:343-365`, `DashboardModule.tsx:157-166`, `FinancialModule.tsx:489-509`
- Impacto: `transactions` é append-only e a coleção mais volumosa (toda venda/comissão/conta gera doc). Sidebar fica sempre montada e Dashboard sempre subscreve → 2 listeners full vivos por padrão; abrir Financial = 3. Tenant com 5k tx ≈ 15k reads só ao abrir o app, antes de qualquer ação. As abas ficam montadas simultaneamente (`page.tsx:153-173` mantém abas inativas montadas, só ocultas), então os listeners de fundo continuam vivos.
- Correção: Sidebar → contador denormalizado em `businesses/{id}` (mesmo padrão de unread do commit cc956b8) OU query com janela `recurrence.nextDueDate` range + índice composto. Dashboard/Financial → janelar por data (`where('dueDate','>=', início do período)`) com `limit`, como `ReportsModule.tsx:948-955` já faz. Compartilhar um único listener via context em vez de 3 cópias.

### P1 — alta (próximas 1–2 sprints)

**P1.1 — DeliveryOrder nunca gera Transaction (receita de delivery invisível)** *(une dois findings da dimensão Integração & Financeiro)*
- Arquivos: `OrdersModule.tsx:1244-1316` (handleStatusChange só seta `deliveredAt` + estoque), `orders/public/route.ts:210-232`, `agent/tools/orders/route.ts:248-258`, `lib/types/index.ts:1725-1772` (sem `transactionId`/`saleId`), `lib/contracts/fsm/deliveryOrder.ts:43-50` (FSM documenta `order.delivered → criar Transaction receita`, mas o evento não existe em `events/index.ts:174-185`). Contraste: PDV cria Transaction com `saleId` em `PDVModule.tsx:790-807`.
- Impacto: faturamento de delivery não entra em `transactions`, summaries do agent, reports nem conciliação. Quebra "Financeiro excelente" no use case restaurante.
- Correção: ao transicionar para `entregue`/`pago`, criar `Transaction {type:'receita', category:'Vendas', deliveryOrderId, clientId, amount:total}` idempotente (guard por `order.transactionId`). Adicionar `transactionId?` em DeliveryOrder e `deliveryOrderId?` em Transaction. Idealmente via `dispatchDomainEvent('deliveryOrder.delivered')` (R5) e alinhar o nome do evento ao FSM.

**P1.2 — Agent `sales_create` cria Sale sem Transaction, sem baixa de estoque, sem idempotência** *(une os achados de divergência agent↔PDV)*
- Arquivos: `agent/tools/sales/route.ts:117-169` (só `ref.set(sale)`). Comparar com `app/api/v1/sales/route.ts:191-244` que deduz estoque (`deductStockAdmin`) E cria Transaction receita E usa `withIdempotency`. Padrão de idempotência por hash já existe em `agent/tools/agenda/route.ts:446-470`.
- Impacto: vendas da IA inflam estoque (vendeu mas não baixou), somem do Financeiro e duplicam em retry. Inconsistência silenciosa entre dois produtores da mesma entidade.
- Correção: centralizar em `lib/services/sales-server.ts createSaleWithSideEffects` (Sale + Transaction + StockMovements em batch atômico) reutilizado por PDV, v1 e agent. Adicionar `idempotencyKey` determinístico com pré-checagem.

**P1.3 — Módulo Fiscal sem nenhuma tool de agent**
- Arquivos: `lib/contracts/api/agent/index.ts:29-34` (18 domínios, sem `fiscal`), `agent/app/tools/registry.py:1311-1317` (sem `FISCAL_TOOLS`). Capacidade existe via `/api/fiscal/*` (emit/cancel/query/retry/danfe), mas é invisível ao agent.
- Impacto: o módulo regulatório mais sensível (NFC-e/NFe/NFSe) não pode ser emitido/consultado/cancelado pelo cérebro.
- Correção: criar `tools/fiscal/route.ts` (read-first: get/query_status/list; depois emit/cancel) wrapeando `/api/fiscal/*`. Contrato em `lib/contracts/api/agent/fiscal.ts` + registrar no Python. Gate `emit/cancel` em `operator` use_case e role `>= manager`.

**P1.4 — Full-collection `onSnapshot` em `conversations` sem `limit` (4 listeners)** *(une achados de custo + lista sem paginação)*
- Arquivos: `Sidebar.tsx:385-427`, `DashboardModule.tsx:179-200`, `ConversasModule.tsx:7219-7279` (lista principal `orderBy('lastMessageAt') sem limit`), e ainda `TopBar.tsx:157-189` (4º listener, não citado originalmente). Existe contador denormalizado pronto (`unreadCounters/{businessId}`, `lib/services/unreadCounter.ts`, escrito no webhook) mas **nenhum componente de UI o lê**.
- Impacto: conversas crescem indefinidamente; tenant com 2-3k conversas paga milhares de reads ao abrir. O ganho da denormalização (commit cc956b8) está parcialmente anulado.
- Correção: ConversasModule → `limit(50)` + paginação por `lastMessageAt`. Sidebar/TopBar/Dashboard → ler o doc agregado `unreadCounters` (escopos business/byUser) em vez de full-scan. Nota: o read-side já foi revertido uma vez (commit 6fb79c2) porque o `limit(50)` na LISTA quebrava o filtro de não-lidas — o badge especificamente pode ler o agregado com segurança.

**P1.5 — `stockMovements` carregado sem `limit` nem janela**
- Arquivo: `InventoryModule.tsx:2120-2134` (getDocs full, `orderBy('createdAt','desc')`, staleTime 2min mas sem limit). Renderizado integralmente em `MovementHistory`.
- Impacto: coleção de altíssimo throughput; restaurante gera dezenas de movimentos/dia → milhares em meses; abrir a aba Estoque baixa tudo.
- Correção: `limit(100-200)` + "ver mais", ou janelar por `createdAt`. O índice `[businessId, createdAt desc]` já existe.

**P1.6 — `deductStockAdmin` faz read-then-write sem transação (oversell sob concorrência)**
- Arquivos: `lib/services/stock-admin.ts:144-166` (`previousStock` de snapshot pré-carregado, `newStock = previousStock - qty` em memória, `batch.update`), usado por `app/api/v1/sales/route.ts:196`. Mesmo padrão de lost-update no client-side `lib/services/stock.ts:139-145` (PDV). Contraste: `agent/tools/orders/route.ts:207` já usa `FieldValue.increment(-qty)` atomicamente.
- Impacto: duas vendas simultâneas do mesmo SKU leem 10, ambas escrevem 7 → uma dedução perdida. `stockMovements` grava `previousStock/newStock` errados, corrompendo auditoria.
- Correção: trocar `batch.update(currentStock:newStock)` por `FieldValue.increment(-qty)` (fix trivial, padrão já no repo) OU envolver em `runTransaction`.

**P1.7 — `orders/create` (agent): dedução de estoque não-atômica com validação, sem StockMovement**
- Arquivos: `agent/tools/orders/route.ts:127-137` (lê stock fora de tx), `:200-215` (batch separado com `increment`, catch só loga "order saved"). Não usa `deductStockAdmin` → nenhum doc em `stockMovements`.
- Impacto: dois pedidos concorrentes super-deduzem; se a 2ª etapa falha, pedido fica salvo sem baixa; sem trilha de auditoria de inventário.
- Correção: validar+deduzir em uma `runTransaction` única e usar `deductStockAdmin` para gerar StockMovement; abortar a criação do pedido em falha.

**P1.8 — Rotas financeiras do agent sem idempotência (R3)**
- Arquivos: `agent/tools/sales/route.ts:117-169`, `agent/tools/financial/route.ts:126-195` (incl. parcelamento via batch com `groupId` aleatório), `agent/tools/orders/route.ts:174-217`. Padrão correto já existe em `agenda/route.ts:445-457` e `purchase-notes`.
- Impacto: write que sucede mas cuja resposta se perde (timeout pós-`set`) faz a IA re-emitir → venda/transação/parcelas/pedido duplicados, com dupla dedução de estoque.
- Correção: aceitar `X-Idempotency-Key` e gravar com ID determinístico (ou coleção de idempotência) antes de criar. Para installments, derivar o `groupId` da chave.

**P1.9 — Status alterado sem FSM em todos os write paths (R4)** *(une os achados de FSM em sales/orders/transactions/appointment)*
- Arquivos: `financial/route.ts:209,237` (`pago`/`cancelado` direto — Transaction sequer tem contrato/FSM), `sales/route.ts:187`, `orders/route.ts:255` (sem guard → `recebido→entregue` pula estados), `OrdersModule.tsx:1248,1286`, `agenda/route.ts:849-892` (`agendado→concluido` direto gera comissão sem atendimento). FSMs existem (`sale.ts:30`, `deliveryOrder.ts:27`) mas grep mostra que `assertTransition*` nunca é importado em `app/`.
- Impacto: transições inválidas passam; comissão indevida; side-effects atrelados a transições (restore de estoque) são bypassados.
- Correção: criar `lib/contracts/fsm/appointment.ts` e `fsm/transaction.ts`; ler status atual e chamar `assertTransition*` antes de cada `updateDoc` no agent tools e nos módulos de UI.

**P1.10 — God-components de UI** *(une os 3 findings de monolito)*
- `ConversasModule.tsx` (10.9k linhas, componente principal ~4.5k, ~46 componentes inline, ~54 writes Firestore diretos) — `:6353` em diante.
- `FinancialModule.tsx` (6.6k, `FinancialModuleBody@262` ~2.3k linhas, 30 writes inline).
- `CRMModule.tsx` (5k, `CampaignsTab@1573` ~2k linhas, 26 writes).
- `SettingsModule.tsx` (7.7k, 8 tabs inline de 600-1000 linhas cada — `ProfileTab@265`...`CanaisTab@6333`, 27 writes + 22 fetch).
- Impacto: review/test/code-splitting inviáveis; alto risco de regressão (commit 6fb79c2 reverteu item que quebrou lista/mensagens/filtro). Writes diretos violam separação UI↔persistência.
- Correção: extrair por subdomínio (components/dialogs/panels/filters; tabs/), mover writes para `lib/services/{conversations,financial}/`. O padrão de extração já existe (ex: `AuditoriaTab.tsx`, `ConciliacaoTab.tsx`). Cada módulo vira orquestrador/shell.

### P2 — média

**P2.1 — Full-collection `onSnapshot`/`getDocs` em `clients` replicado em ≥5 módulos** — `ClientsModule:834`, `PDVModule:303`, `VendasModule:594`, `AgendaModule:1971`, `FinancialModule:576`. `isActive`/sort client-side (decisão documentada de evitar índice composto). PDV+Vendas mantêm 2 listeners vivos não-deduplicados (raw onSnapshot bypassa React Query). Correção: busca server-side por prefixo com `limit` nos selects; paginar ClientsModule; compartilhar um cache React Query.

**P2.2 — `sales` carregado sem `limit` no PDV** — `PDVModule.tsx:323-335` (getDocs full). *Nota: a narrativa de "refetch on focus" foi refutada — `QueryProvider` define staleTime 3min e `refetchOnWindowFocus:false`; é full-read 1x por mount, não amplificação por foco.* Correção: `limit(50)` ou janela hoje/7d.

**P2.3 — Badge de não-lidas faz full-scan ignorando `unreadCount` denormalizado** — `Sidebar.tsx:393-416`, `DashboardModule.tsx:191-196`. Anula parte do ganho da denormalização. Correção: agregado por user/business lido em 1 doc.

**P2.4 — Índice composto ausente força full-scan de recorrências** — `Sidebar.tsx:334-359` + `firestore.indexes.json` (sem índice em `recurrence.nextDueDate`). Justificativa no comentário ("link de índice exige clique manual") é factualmente errada: o repo já deploya índices via `firestore.indexes.json`. Correção: declarar o índice e converter para query server-side com range + `limit`.

**P2.5 — Service não declara insumos consumidos (sem BOM)** — `lib/types/index.ts:970-1019` (sem `components[]` como Product:1493). PDV só baixa itens com `productId` (`PDVModule.tsx:755`); Appointment concluído não deduz nada além de comissão. Afeta salão (tintura) e academia. Correção: `Service.consumedComponents[]` + dedução via `appointment.completed` reusando `expandBomLines` (`lib/contracts/_runtime/bom.ts`).

**P2.6 — Modifiers do cardápio não consomem estoque** — `index.ts:1536,1565` (sem `productId`/SKU). Correção: `linkedProductId`+`consumeQty` em ProductModifierOption, expandir no `stockBucket`. *Nota: o caminho público `orders/public/route.ts` não deduz estoque algum (nem base nem BOM) — gap mais amplo que só modifiers.*

**P2.7 — BOM expande só 1 nível** — `agent/tools/orders/route.ts:105-118`. Combos aninhados (Combo→X-Burger→ingredientes) debitam o nível intermediário, não as folhas. *É decisão de design documentada (`bom.ts:45`), não bug acidental.* Correção: expansão recursiva com proteção de ciclo, ou reforçar invariante.

**P2.8 — Aula experimental (academia) não existe no modelo** — sem `isTrial`/`trialOutcome` em Appointment, sem FSM de conversão, sem evento. Funil de aquisição invisível ao CRM/agent. Correção: flag `isTrial`+`trialOutcome` (contrato Zod) + evento `appointment.trialCompleted → lifecycleStage`.

**P2.9 — Membership (mensalidade academia) é tipo solto** — `index.ts:4040-4069` sem contrato Zod/FSM/billing runner. `usesThisCycle`/`nextBillingDate` nunca avançam; `bookGroupAppointment` (`agenda/route.ts:613-715`) não consulta plano. `MembershipsTab.tsx:114` admite "controle manual". Recorrência da academia é 100% manual. Correção: contrato+FSM, billing runner idempotente por `{clientMembershipId}_{cycle}`, checar limite no booking.

**P2.10 — Rastreabilidade por ID incompleta** *(une CRMDeal/Appointment↔Sale/FK do cliente)*:
- CRMDeal ganho não referencia Sale/Appointment/Order que o concretizou (`index.ts:2277-2297`, `closeDeal` em `crm/route.ts:252-271` só recebe `won/reason`). ROI por deal não navegável.
- Appointment cobrado no PDV não vincula à Sale (`index.ts:905/1061`, PDV não passa `appointmentId`). Reconciliação agenda↔caixa é manual.
- FK do cliente tem 3 nomes (`clientId`/`contactId`/`crmContactId`) para a mesma entidade (CRMContact é alias de Client, `index.ts:2195`); Transaction grava os dois. Agent join cross-módulo exige tradução mental.
- Correção: padronizar `clientId`; adicionar `dealId?`/`appointmentId?` nas entidades de receita; normalizar no boundary do agent.

**P2.11 — Módulo Relatórios sem tool de agent** — `tools/reports` inexistente; só há `summary_today/month` pontuais. Analyst não consegue cruzamento (faturamento por serviço × profissional). Correção: `tools/reports/route.ts` read-only (`revenue_by_period`, `sales_by_product`, `appointments_by_professional`, `top_clients`).

**P2.12 — Comissão no PDV não idempotente nem linkada** — `PDVModule.tsx:855-880` (addDoc avulso pós-commit, sem chave nem `commissionTransactionId` na Sale; diferente de Appointment). *Caminho de duplicação estreito (sem retry automático, guard de UI), mas viola R3.* Correção: gravar comissão dentro do batch com ID determinístico de `saleRef.id`.

**P2.13 — Side-effects cross-módulo inline em handlers de UI (R5)** *(une PDV+Agenda)*:
- `PDVModule.confirmSale` (`:708-989`): venda+itens+estoque+Transaction (batch atômico) + loyalty/gift/NFC-e inline. *Nota: o nome correto é `confirmSale` (não `handleFinalizeSale`); a consistência crítica está no batch atômico — só loyalty/comissão/fiscal são pós-commit com try/catch.*
- `AgendaModule` (`:2258-2427`): commission/loyalty/metrics/GCal inline nos ramos create E edit (duplicado), com `.catch(console.warn)` silencioso. Evento `appointment.completed` é só auditoria (`handlers/appointmentCompleted.ts` é no-op).
- Correção: promover `sale.finalized`/`appointment.completed` a `dispatchDomainEvent()` com subscribers em `lib/services`. *R5 permite começar como documentação até existirem 2+ subscribers — promoção é dívida arquitetural reconhecida, não bug.*

**P2.14 — Duplicação de lógica** *(une 3 findings)*: `getMemberDisplayStatus` redefinido em 3 arquivos sem fonte canônica (`SettingsModule:2883`, `TeamChatPanel:21`, `OverviewTab:142` com `any`); `computeNextDueDate`/`adjustForBusinessDay` duplicados entre `FinancialModule:204-261` e `RecurrenceDetailDialog:50-237` — **com divergência real**: o dialog não checa feriados (não tem `BR_HOLIDAYS`), projetando datas em feriados diferentes das persistidas. Correção: extrair para `lib/utils/presence.ts` e `lib/services/recurrence.ts` com testes.

**P2.15 — Rotas backend gigantes** — `webhooks/meta/route.ts` (2.257 linhas, `saveInboundMessage` ~558 linhas para 3 canais), `conversations/send/route.ts` (1.391, POST ~473 linhas). Boundary mais sensível (dedup wamid, multi-canal). Correção: extrair por canal para `lib/channels/{whatsapp,facebook,instagram}/{inbound,outbound}.ts`; route vira dispatcher fino.

**P2.16 — Appointment status sem FSM permite pular para `concluido` gerando comissão** — coberto em P1.9 (mesma raiz, severidade do achado individual P2).

**P2.17 — `orders/public` sem idempotência (R3)** — `orders/public/route.ts:38,201,232` (só rate-limit por IP). Retry/double-tap em rede móvel → pedido duplicado, cozinha prepara 2x, dupla dedução de estoque downstream. Correção: `X-Idempotency-Key` (uuid por carrinho) via `withIdempotency` ou dedup por `(businessId, phone, hash(items), janela)`.

**P2.18 — Webhook Meta descarta eventos sob rate-limit por IP (200 OK)** — `webhooks/meta/route.ts:527-531` (`webhook:${clientIp}`, 200/min, retorna 200 e descarta). Meta entrega de IPs fixos → limite agrega TODOS os tenants; Meta não faz retry em 200. Drop ocorre antes da verificação de assinatura e do DLQ → perda silenciosa de mensagens sob carga. Correção: não rate-limitar por IP (ou elevar muito); se exceder, retornar 429/500 para a Meta re-entregar (dedup por wamid já protege).

### P3 — baixa

- **P3.1** — Sale não armazena `transactionId` (vínculo só reverso por `saleId`); `Conversation` não guarda IDs das entidades que originou. Inconsistência de denormalização vs Appointment; queries reversas funcionam. (`PDVModule:803`, `index.ts:1061/2349`)
- **P3.2** — Agent não escreve em team/business/settings (provisionar usuário/setor/canal). Lacuna de capacidade de onboarding/admin; omissão parcialmente deliberada por segurança. (`team/route.ts:1-21`, `business/route.ts:22`)
- **P3.3** — `business_get_context` é tool morta (route+contrato sem consumidor; contexto vem no payload `operator/chat/route.ts:140-156`). Limpeza/drift. (`registry.py:1311-1317`)
- **P3.4** — Modo analyst depende de heurística de prefixo `_is_read_only_tool` (`registry.py:1271`, `suf in name` = substring). Hoje zero tools de escrita vazam; risco latente. Correção: flag `x-mutates` no schema + teste.
- **P3.5** — `NoShowPolicy` é tipo morto, não enforced no booking (`index.ts:4073-4080`). Marcar `nao_compareceu` não gera taxa/retém depósito.
- **P3.6** — Transaction sem contrato Zod/`.parse()` na route do agent (R2/R6). *Existe contrato Zod em `lib/contracts/api/agent/financial.ts` mas a route não chama `parseToolRequest` como a agenda faz — gap de fiação de 1-2 linhas.*
- **P3.7** — Parser CSV de extrato remove TODOS os pontos (`reconciliation.ts:121-127`); valores em formato US (`1234.56`) viram 100x. Caso de borda num produto pt-BR. Correção: detectar separador decimal pelo último símbolo.
- **P3.8** — Rate-limit in-memory (`lib/utils/rateLimit.ts:15`) zera no restart. *Deploy atual é instância única (docker-compose sem replicas) → a parte "multiplica por réplicas" não se aplica; resíduo real é só reset-on-restart do limite anti-ban de broadcast.*

---

## 3. Integração entre rotas & IDs

**Diagnóstico atual.** O isolamento por `businessId` é universal (R1 sólido). Mas a rastreabilidade por ID entre módulos da sidebar é parcial e assimétrica:

- **Bem conectado:** Appointment→Transaction de comissão (par bidirecional `commissionTransactionId`↔`appointmentId`); Sale→Transaction (uni, via `saleId`); todas as entidades→Conversation (uni, via `conversationId`).
- **Desconectado:**
  - DeliveryOrder ↔ Financeiro: **inexistente** (P1.1) — o elo mais grave.
  - CRMDeal ganho → Sale/Appointment/Order que o realizou: **inexistente** (P2.10) — ROI por deal incalculável.
  - Appointment ↔ Sale (atendimento↔cobrança): **inexistente** (P2.10) — reconciliação agenda/caixa manual.
  - Conversation → entidades geradas: só reverso (P3.1).
  - Sale → Transaction: só reverso (P3.1).
- **Inconsistência de nomenclatura:** FK do cliente tem 3 nomes (`clientId`/`contactId`/`crmContactId`) para a mesma entidade Client (P2.10) — fonte de bugs de join no agent.

**Roadmap para rastreabilidade/automação completas:**
1. Padronizar `clientId` em todo o sistema; normalizar entrada do agent no boundary.
2. Adicionar FKs de resultado: `deliveryOrderId`/`appointmentId`/`dealId` em `Transaction`; `transactionId` em `Sale`/`DeliveryOrder`; `dealId` em `Sale`/`Appointment`/`DeliveryOrder`.
3. Promover os eventos de domínio (`sale.finalized`, `appointment.completed`, `deliveryOrder.delivered`) a `dispatchDomainEvent()` reais, com subscribers que escrevem os elos bidirecionais — assim a trilha por ID nasce automaticamente em vez de exigir denormalização manual.
4. Expor `list_related` no tool `conversations` (queries reversas por `conversationId`) para contexto omnichannel completo.

---

## 4. /agent como cérebro

**Cobertura atual.** 18 domínios expostos (`AGENT_TOOL_DOMAINS`), cobrindo agenda, orders, sales, financial, crm, inventory, clients, conversations, etc. Modos `operator` (read+write) e `analyst` (read-only). Mas a cobertura tem buracos e inconsistências:

- **Módulos sem nenhuma tool:** Fiscal (P1.3 — o mais grave, núcleo legal), Reports (P2.11 — limita o analyst como BI), Spreadsheets (P2, baixa prioridade).
- **Camada admin ausente:** team/business/settings são só-leitura (P3.2) — agent não provisiona equipe/setor/canal.
- **Tool morta:** `business_get_context` (P3.3).
- **Garantia read-only frágil:** heurística de nome no analyst (P3.4).
- **Divergência crítica de comportamento:** tools de escrita (sales/orders) não espelham os side-effects do caminho humano (P1.2, P1.7) e não têm idempotência (P1.8) nem FSM (P1.9).

**Conjunto mínimo para operação global pelo dashboard:**
1. `tools/fiscal` read-first (get/query_status/list → emit/cancel role-gated `>= manager`).
2. `tools/reports` read-only (revenue_by_period, sales_by_product, appointments_by_professional, top_clients) reusando a agregação do ReportsModule.
3. **Pré-requisito transversal:** centralizar os side-effects (estoque+receita+idempotência+FSM) num serviço único reusado por PDV/v1/agent — sem isso, qualquer tool de escrita continua divergindo do fluxo humano.
4. Contratos Zod por boundary com `parseToolRequest` chamado em TODAS as rotas (hoje só agenda/financial têm contrato; financial nem chama o parser — P3.6).
5. Flag `x-mutates` explícita no schema para o gating do analyst (P3.4).
6. (Fase 2) `tools/team` write (create_sector/invite_user) role-gated `>= admin`; manter saasApiKeys/vault fora.

---

## 5. Fit dos 3 use cases

| Use case | O que já serve | O que falta |
|---|---|---|
| **Salão (1:1)** | Appointment 1:1, comissão por profissional (bidirecional), loyalty, GCal | Service sem BOM → insumos (tintura) não baixam estoque (P2.5); Appointment↔Sale sem FK (P2.10); NoShowPolicy inerte (P3.5); FSM de Appointment ausente (P1.9) |
| **Academia (aula + luta/capacidade)** | Turma/capacidade JÁ modelada (`capacity`/`sessionKey`/`bookGroupAppointment`/group session) — o lado não-1:1 funciona | Aula experimental não existe (P2.8); Membership/mensalidade é tipo solto sem billing/FSM/enforcement (P2.9); limite de aulas por ciclo não validado no booking |
| **Restaurante (cardápio + estoque)** | Cardápio público, pedido anônimo, BOM 1 nível, dedução de estoque no agent | **Receita de delivery invisível no Financeiro (P1.1)** — gap central; modifiers não consomem estoque (P2.6); BOM não recursivo para combos (P2.7); `orders/public` sem dedução de estoque nem idempotência (P2.6/P2.17); oversell sob concorrência (P1.6/P1.7) |

**Resumo do modelo:** academia (capacidade) é a melhor coberta na mecânica de booking, mas a pior na recorrência financeira (membership manual). Restaurante tem o pior gap financeiro (delivery↔Transaction). Salão precisa de BOM em Service e enforcement de no-show.

---

## 6. Financeiro

**Riscos:**
1. **Subnotificação de receita** — delivery (P1.1) e vendas do agent (P1.2) não geram Transaction. DRE/fluxo de caixa/conciliação subestimam o faturamento real.
2. **Duplicidade de lançamento** — ausência de idempotência (P1.8, P2.12, P2.17) permite Transactions/parcelas/comissões duplicadas em retry.
3. **Status sem FSM** — Transaction não tem contrato nem FSM (P1.9, P3.6); comissão indevida por `agendado→concluido` (P1.9).
4. **Corrupção de valor na conciliação** — parser CSV (P3.7) multiplica por 100 valores em formato não-pt-BR.
5. **Divergência de projeção de recorrência** — `computeNextDueDate` duplicado diverge em feriados (P2.14).

**Melhorias prioritárias:**
- Serviço único `createSaleWithSideEffects` / handler de `deliveryOrder.delivered` criando Transaction idempotente (resolve P1.1, P1.2, P2.12 de uma vez).
- Contrato Zod + FSM para Transaction (`pendente→pago/atrasado/cancelado`).
- Idempotência em todas as rotas POST financeiras.
- Extrair `lib/services/recurrence.ts` com testes; corrigir detecção de separador decimal.

---

## 7. Custo Firebase — top otimizações por ROI

| # | Otimização | ROI |
|---|---|---|
| 1 | **Eliminar os 3 listeners full-collection em `transactions`** (P0.1) — contador denormalizado na Sidebar + janela por data no Dashboard/Financial | **Altíssimo** — coleção mais volumosa, 2-3 listeners vivos por sessão; corta o maior bloco da fatura |
| 2 | **Badge de não-lidas via `unreadCounters` já existente** (P1.4/P2.3) — infra pronta, só falta wirear no Sidebar/TopBar/Dashboard | **Alto** — elimina 4 full-scans de `conversations`; baixo esforço |
| 3 | **`limit` + paginação na lista de Conversas** (P1.4) | **Alto** — lista cresce indefinidamente |
| 4 | **`limit`/janela em `stockMovements` e `sales`** (P1.5, P2.2) | **Médio-alto** — coleções de alto throughput |
| 5 | **Busca server-side por prefixo nos selects de `clients` + cache único** (P2.1) | **Médio** — replicado em 5 módulos |
| 6 | **Índice composto `recurrence.nextDueDate` + query com range** (P2.4) | **Médio** — converte full-scan em leitura de poucos docs |

Padrão recomendado transversal: nenhum `onSnapshot`/`getDocs` de coleção que cresce sem `limit` ou janela de data; reusar um listener compartilhado via context em vez de cópias por módulo; sempre que possível, ler contador denormalizado (1 doc) em vez de agregar N docs no client.

---

## 8. Monolitos a quebrar

| Arquivo | Linhas | Plano |
|---|---|---|
| `ConversasModule.tsx` | 10.9k | Quebrar em `components/` (MessageBubble, MessageList, Composer, ThreadHeader), `dialogs/` (SLA, Routing, CSAT, NewConversation, Transfer, Merge), `panels/` (Analytics, AgentDebug, LinkContact), `filters/`. Extrair ~54 writes para `lib/services/conversations/`. Shell <800 linhas. |
| `SettingsModule.tsx` | 7.7k | Seguir padrão já existente na pasta: extrair `ProfileTab`...`CanaisTab` (8 tabs) para arquivos próprios. Shell de navegação <300 linhas. |
| `FinancialModule.tsx` | 6.6k | Extrair cada `*Content` para `financial/tabs/`; quebrar `FinancialModuleBody` (~2.3k); writes para `lib/services/financial/`. |
| `CRMModule.tsx` | 5k | Extrair `CampaignsTab` (~2k), `SegmentsTab`, `MetricsTab` e os FormDialogs. Shell de abas. |
| `webhooks/meta/route.ts` | 2.3k | Extrair por canal `lib/channels/{wa,fb,ig}/inbound.ts`; decompor `saveInboundMessage` em normalize→dedup→persist→postProcess. |
| `conversations/send/route.ts` | 1.4k | Senders por canal em `lib/channels/{...}/outbound.ts`; route vira dispatcher. |

Princípio: extrair primeiro a camada de persistência (writes → `lib/services/`), depois os subcomponentes de UI. Isso reduz risco de regressão (cf. revert 6fb79c2) e habilita testes isolados.

---

## 9. Plano de ação sugerido (sprints)

**Sprint 1 — Parar a sangria de custo e receita (P0 + gaps financeiros centrais)**
- P0.1: matar os 3 listeners full em `transactions` (denormalização Sidebar + janela Dashboard/Financial).
- P1.4/P2.3: wirear `unreadCounters` nos badges (infra já pronta) + `limit` na lista de Conversas.
- P1.1: DeliveryOrder→Transaction idempotente (destrava o Financeiro do restaurante).
- P1.5/P2.2: `limit` em `stockMovements` e `sales`.

**Sprint 2 — Consistência de escrita (regras duras + agent↔humano)**
- Criar `lib/services/sales-server.ts createSaleWithSideEffects` (estoque+receita+idempotência) → corrige P1.2, P1.7, P1.8, P2.12 de uma vez.
- P1.6: `FieldValue.increment` em `deductStockAdmin`/`stock.ts` (fix trivial, alto impacto).
- P1.9: criar `fsm/appointment.ts` + `fsm/transaction.ts` e aplicar `assertTransition` em todos os write paths.
- Promover `sale.finalized`/`appointment.completed`/`deliveryOrder.delivered` a `dispatchDomainEvent()` (P2.13) — base para os elos por ID.

**Sprint 3 — Agent como cérebro + integração de IDs**
- P1.3: `tools/fiscal` (read-first, gate). P2.11: `tools/reports`.
- P2.10: padronizar `clientId`, adicionar FKs de resultado (deal/appointment/sale/order↔transaction).
- P3.4/P3.6: flag `x-mutates` + `parseToolRequest` em todas as rotas do agent.

**Sprint 4 — Fit dos use cases + robustez de boundary**
- P2.5: BOM em Service (salão). P2.8/P2.9: aula experimental + Membership billing (academia). P2.6/P2.7: modifiers + BOM recursivo (restaurante).
- P2.17/P2.18: idempotência em `orders/public`; corrigir descarte silencioso do webhook Meta.

**Sprint 5+ — Dívida estrutural (contínuo)**
- P1.10/P2.15: quebrar os god-modules (começar por ConversasModule e webhooks/meta, extraindo writes para `lib/services/` antes da UI).
- P2.14/P3.7: extrair `presence.ts`/`recurrence.ts` com testes; corrigir parser CSV.
- P3 restantes (admin tools, business_get_context, NoShowPolicy, rate-limit persistente) conforme capacidade.

**Sequenciamento lógico:** Sprint 1 corta custo e o gap financeiro mais visível; Sprint 2 cria o serviço único que é pré-requisito de quase tudo (qualquer tool de escrita ou novo elo por ID depende dele); Sprints 3-4 dependem dessa base para expor capacidades ao agent sem reintroduzir divergência; Sprint 5+ é refatoração de dívida que pode correr em paralelo desde que os writes migrem para `lib/services/` primeiro.
