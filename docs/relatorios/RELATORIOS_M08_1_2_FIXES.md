# M08.1/M08.2/M08.3 — Fixes de comissão, período de clientes e remoção de código morto

> Concluído em: 05/09/2026
>
> Plano de origem: `docs/paridade/M08_PLANO_IMPLEMENTACAO.md` (Gap 1 e Gap 2)

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

## Arquivos alterados

- `app/components/features/reports/ReportsModule.tsx`
  - `ComissoesTab`: `byProfessional` agrupa por `clientId`/`clientName`.
  - `ClientesTab`/query `clients`: sem filtro de `createdAt`; `queryKey`
    mudou de `['clients', businessId, period]` para `['clients', businessId]`.
- `app/api/agent/tools/reports/route.ts`: comentário de `loadClients`
  corrigido.
- Removidos: `app/components/features/dashboard/CompactMetricsStrip.tsx`,
  `AgentConsole.tsx`, `AnalystChatPanel.tsx`, `OperatorChatPanel.tsx`.

## Verificação

- `npm run typecheck` — sem erros novos.
- `npm run test` — sem regressão.
- Sem migração de dado necessária (fix é só de leitura/agregação).

## Fora de escopo desta fatia

Gaps 3, 4, 6, 7, 8 do plano M08 (listeners sem limite, CMV/canais,
`minRole` no Sidebar, paginação, DRE não reconciliado) — Gap 3 e Gap 7
descopados deliberadamente (§5 do plano); Gap 4 e Gap 6 pendentes de
checkpoint com o usuário (M08.4/M08.5); Gap 8 já coberto pela decisão
V1/V2 de M03.6.
