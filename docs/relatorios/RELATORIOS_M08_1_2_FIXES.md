# M08 — Fixes de comissão/clientes, código morto, CMV/estoque e minRole

> Concluído em: 05/09/2026
>
> Plano de origem: `docs/paridade/M08_PLANO_IMPLEMENTACAO.md`

## M08.1 — Comissão por profissional agrupava tudo em "Profissional"

`ReportsModule.tsx` (`ComissoesTab`) agrupava as transações de comissão por
`t.createdByName || 'Profissional'`. Nenhum dos dois produtores reais de
comissão (`maybeCreateCommission`/`maybeCreateCommissionAdmin`, em
`lib/services/commission.ts`, usados também por
`lib/contracts/_runtime/handlers/appointmentCompleted.ts`) grava
`createdByName` — esse campo só é populado em lançamentos financeiros manuais
(quem digitou, não o profissional). Os dois produtores gravam
`clientId`/`clientName` com o profissional.

Efeito real: em qualquer clínica com 2+ dentistas, toda comissão
auto-gerada colapsava no fallback `'Profissional'` — o relatório não
distinguia profissionais.

**Fix**: agrupar por `clientId` (chave estável) exibindo `clientName`, com
fallback textual apenas quando ambos estão ausentes.

## M08.2 — "Total de clientes"/CLV rotulado como total mas na prática por período

A query de `clients` em `ReportsModule.tsx` (`ClientesTab`) era janelada por
`createdAt` (± período selecionado). "Total de clientes" e "Top CLV" ficavam
escopados a clientes CRIADOS no período, não ao roster inteiro — em um
período curto, "Total de clientes" podia zerar mesmo com uma base de
clientes grande e antiga.

O componente consumidor (`ClientesTab`) já estava correto: computa
`newInPeriod` filtrando client-side (`inPeriod(createdAt, ...)`) assumindo
que `clients` é o roster completo. O bug estava só na query, não no
componente.

A superfície do agente (`app/api/agent/tools/reports/route.ts`,
`loadClients`) já nunca filtrava por `createdAt` — mas seu comentário
afirmava (incorretamente, antes deste fix) que isso era "igual ao
ReportsModule". As duas superfícies, que o P2.11 (auditoria de 2026-06-01)
foi construído para manter sincronizadas, divergiam exatamente nesta
métrica.

**Fix**: removida a janela de `createdAt` da query de `clients` em
`ReportsModule.tsx` (agora busca o roster inteiro, igual ao agente).
Comentário de `loadClients` reescrito para não afirmar uma paridade
histórica que era falsa — agora descreve o comportamento correto e cita
que a UI foi alinhada a ele em M08.2.

## M08.3 — Remoção de código morto no diretório do Dashboard

`CompactMetricsStrip.tsx`, `AgentConsole.tsx`, `AnalystChatPanel.tsx` e
`OperatorChatPanel.tsx` (juntos, ~1099 linhas) não tinham nenhum importador
real — superseded por `AgentHeroInput.tsx`. Reconfirmado (grep em todo o
repo, excluindo `node_modules`) que as únicas ocorrências dos 4 nomes eram
nos docs de investigação e um comentário de texto em `TeamChatPanel.tsx`
("suggestions do AgentConsole no Dashboard"), nenhum `import`. Apagados.

## M08.4 — Nova aba "CMV & Estoque"

O roadmap prometia CMV/estoque e atribuição de canal nos relatórios; nenhum
dos dois existia. Perguntado ao usuário, a decisão foi **construir CMV/estoque**
(não descopar).

Nova aba `CmvEstoqueTab` em `ReportsModule.tsx`:

- **CMV do período** — soma de `costTotal` das `stockMovements` tipo `'saida'`
  com `sourceType` `'sale'`/`'order'` (exclui ajustes/perdas manuais, que são
  custo de quebra, não custo de venda). É o único dado de custo HISTÓRICO no
  sistema — `Product.costPrice` reflete o custo ATUAL (média móvel), não o
  vigente no momento de cada venda passada.
- **Margem bruta (produtos)** — receita de produtos vendidos (exclui itens de
  serviço, que não têm CMV neste sistema) menos o CMV do período.
- **Valor em estoque** / **produtos com estoque baixo** — mesma fórmula já
  usada em `InventoryModule.tsx` (`stats.totalValue`/`isLowStock`),
  reimplementada localmente em vez de importada (evitar acoplar o bundle de
  Relatórios ao de Inventory), mas mantida numericamente idêntica de
  propósito — para não repetir a divergência de duas superfícies que o
  Gap 2/M08.2 encontrou.
- **CMV por produto** — ranking (mesmo padrão `RankRow`/chave estável de
  `ProdutosTab`) dos produtos com maior custo de saída no período.

**Atribuição de canal** (a outra metade do Gap 4) não foi construída nesta
fatia — hoje só existe 1 canal de venda ativo (PDV local via terminal), sem
nenhum tenant com canal múltiplo real pra validar a feature contra; mesmo
tratamento dado a outros itens B2B/multi-canal pausados em M02/M03.

Sem novo índice composto necessário: a query de `stockMovements` reaproveita
o índice `[businessId, type, createdAt desc]` já existente em
`firestore.indexes.json`; a query de `products` é uma igualdade simples por
`businessId` (sem `orderBy`), que não exige índice composto no Firestore.

## M08.5 — `minRole` em Relatórios

"Relatórios" não tinha `minRole` no Sidebar (diferente de "Senhas", que
exige admin) — um operador que abria Relatórios recebia permission-denied
silencioso do Firestore (não vazava dado, só UX confusa: console error, aba
em branco). Perguntado ao usuário, a decisão foi adicionar o gate.

**Fix**: `Sidebar.tsx` — `minRole: 'manager'` no item "Relatórios", alinhado
à regra real do Firestore (`transactions` exige `isManager()` pra leitura,
confirmado em `firestore.rules:691-695`).

## Arquivos alterados

- `app/components/features/reports/ReportsModule.tsx`
  - `ComissoesTab`: `byProfessional` agrupa por `clientId`/`clientName`.
  - `ClientesTab`/query `clients`: sem filtro de `createdAt`; `queryKey`
    mudou de `['clients', businessId, period]` para `['clients', businessId]`.
  - Nova aba `CmvEstoqueTab` + queries `stockMovements`/`products`.
- `app/api/agent/tools/reports/route.ts`: comentário de `loadClients`
  corrigido.
- `app/components/layout/Sidebar.tsx`: `minRole: 'manager'` em "Relatórios".
- Removidos: `app/components/features/dashboard/CompactMetricsStrip.tsx`,
  `AgentConsole.tsx`, `AnalystChatPanel.tsx`, `OperatorChatPanel.tsx`.

## Verificação

- `npm run typecheck` — sem erros novos, em cada fatia (M08.1–M08.5).
- `npm run test` — sem regressão, em cada fatia (1071 testes / 80 arquivos).
- Sem migração de dado necessária (fixes e nova aba são só de
  leitura/agregação sobre coleções já existentes).
- Smoke manual não executado nesta rodada (mesma ressalva de sempre).

## Fora de escopo desta fatia

- Gap 3 (3 listeners `onSnapshot` sem limite no Dashboard) e Gap 7
  (paginação) — descopados deliberadamente (§5 do plano): proporcional
  adiar dado o volume atual.
- Gap 4 — metade "atribuição de canal" não construída (ver M08.4 acima).
- Gap 8 (2 superfícies de DRE não reconciliadas) — já coberto pela decisão
  V1/V2 de M03.6.
