# M08 — Plano de Dashboard, Relatórios e Indicadores

> Análise concluída em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Lente desta rodada: **odontologia** — clínica pequena, sem estoque relevante, sem canal de
> vendas múltiplo.
>
> Estado: investigação de abertura concluída em 05/09/2026 (mesmo rigor de M06/M03/M07/M10/M13/
> M05/M09). M08.1/M08.2/M08.3 concluídos no mesmo dia (fixes de baixo risco, engenharia pura).
> M08.4/M08.5 pendentes de checkpoint com o usuário.

---

## 0. Escopo reivindicado pelo roadmap (citação literal)

> Indicadores confiáveis derivados dos módulos transacionais.
> Vendas, margem, CMV, estoque, financeiro, clientes, agenda, canais e reputação.
> Paginação/exportação e reconciliação dos números com as fontes.

## 1. Correções ao que o roadmap presumia

- "Planejado" está errado, mesmo padrão de todo módulo desta sessão. `ReportsModule.tsx` (1342
  linhas) + uma superfície inteira de agente/analista (`app/api/agent/tools/reports/route.ts`,
  `lib/services/reports.ts`, `lib/contracts/api/agent/reports.ts`) são código maduro, real, já
  fechado como item **P2.11** em `docs/auditoria-producao-2026-06-01.md` — o roadmap nunca
  reconciliou com essa auditoria prévia.
- **CLAUDE.md §5 ("dashboard: KPIs + heatmap presença") está factualmente errado**: o heatmap que
  existe é de VOLUME DE MENSAGEM por dia×hora (`ConversasModule.tsx`), não de presença de equipe,
  e vive em Conversas, não no Dashboard. `DashboardModule.tsx` atual (498 linhas) não tem nenhum
  código de presença/heatmap — é hero de IA + KPIs mini-card.
- **CMV/estoque e "canais" (atribuição de canal)**, ambos citados no bullet do roadmap, estão
  genuinamente ausentes de `ReportsModule.tsx` — não é bug, é ausência nunca sinalizada como
  fora de escopo.
- Dashboard já passou por 1 sprint de performance dedicado (commit `c8fb65f`, 2026-06-01, itens
  P0.1/P1.4/P2.3) — mas só corrigiu 2 de 5 listeners do MESMO arquivo; os outros 3 nunca foram
  catalogados (Gap 3).

## 2. O que já existe e funciona (por item do bullet do roadmap)

- **Indicadores derivados dos módulos transacionais** — real. 6 loaders TanStack Query
  (`transactions`/`appointments`/`clients`/`reviews`/`sales`/`orders`), todos `businessId==` +
  janela de período + `orderBy`, staleTime 5min. R1 respeitado nos 6.
- **Vendas, Financeiro, Agenda** (incl. taxa de no-show — relevante pra clínica), **Clientes**
  (CLV, top 10), **Comissões**, **Avaliações/reputação**, **Produtos & Serviços** (7ª aba, ranking
  cross-fonte com toggle deliberado anti-double-count) — todos com dado real, não mock (grep por
  `DemoDataBanner|mockData|hardcoded|Math.random` = zero hits, diferente do achado do M09 em
  `IntegrationsModule.tsx`).
- **Exportação** — real (`exportPDF()`, jsPDF+autoTable), 6 de 7 abas.
- **Agente/analista** — rota real (`app/api/agent/tools/reports/route.ts`), contratos Zod R2/R6
  compliant, 4 ações read-only — o roadmap nem sabia que isso existe.
- **DashboardModule KPIs** — Agenda hoje, Pedidos ativos, Conversas não lidas (via
  `unreadCounters` denormalizado), CRM leads abertos, Financeiro pendente/atrasado — tudo real.

## 3. Gaps reais encontrados

### Gap 1 — ALTO: "Comissões por profissional" quebrado pra qualquer clínica com 2+ profissionais

`ReportsModule.tsx:869`: agrupa por `t.createdByName || 'Profissional'`. O único produtor real de
transação de comissão (`lib/services/commission.ts:55-69`) nunca seta `createdByName` — seta
`clientId`/`clientName` com o profissional. `createdByName` só é populado em lançamentos MANUAIS
(quem digitou, não o profissional). Efeito: TODA comissão auto-gerada cai no fallback
`'Profissional'` — comissões de todos os dentistas colapsam numa linha só. **Diretamente
relevante pra clínica com 2+ dentistas.**

### Gap 2 — MÉDIO/ALTO: "Total de clientes"/CLV rotulado como total mas na verdade é por período, e diverge do agente pra o mesmo relatório

`ReportsModule.tsx:981-997`: a query de `clients` é janelada por `createdAt` (± período) — "Total
de clientes" e "top clientes por CLV" ficam escopados a clientes CRIADOS no período selecionado,
não o roster inteiro. `lib/services/reports.ts:115-122` (usado pelo agente) afirma explicitamente
no comentário que NÃO filtra `clients` por `createdAt` "igual ao ReportsModule" — afirmação FALSA,
a UI filtra sim. As duas superfícies que o P2.11 foi construído pra manter sincronizadas divergem
exatamente nesta métrica.

### Gap 3 — MÉDIO: 3 listeners `onSnapshot` full-collection sem limite em `DashboardModule.tsx`

`appointments` (`:133`), `deliveryOrders` (`:146`), `crmContacts` (`:201`) — só filtro de
`businessId`, sem limit/janela de data, vivos durante toda a vida da aba (que fica montada em
background mesmo escondida, per a auditoria de 2026-06-01). O MESMO arquivo já teve 2 listeners
corrigidos (P0.1/P1.4, `transactions`/`conversations`) — esses 3 nunca foram catalogados.

### Gap 4 — BAIXO/MÉDIO: dimensões prometidas pelo roadmap genuinamente ausentes

Sem aba de CMV/estoque, sem atribuição de canal. Não é bug — ausência nunca sinalizada como fora
de escopo.

### Gap 5 — BAIXO: 1099 linhas de código morto no diretório do Dashboard

`CompactMetricsStrip.tsx`/`AgentConsole.tsx`/`AnalystChatPanel.tsx`/`OperatorChatPanel.tsx` — zero
importadores confirmados, superseded por `AgentHeroInput.tsx`. Mesmo padrão de
`OmnichannelInbox.tsx` (M07)/`IntegrationsModule.tsx` (M09).

### Gap 6 — BAIXO: "Relatórios" sem `minRole` no Sidebar, diferente de "Senhas"

Abas com transações exigem `isManager()` na rule — um operador abrindo Relatórios recebe
permission-denied silencioso (console error, aba em branco), não é vazamento, só UX confusa.

### Gap 7 — BAIXO: sem paginação real, apesar do roadmap citar

Rankings truncam em top 10/20 client-side em vez de paginar.

### Gap 8 — BAIXO: 2 superfícies de DRE não reconciliadas

Aba Financeiro do `ReportsModule` vs. `financial-v2/tabs/RelatoriosTab.tsx` (DRE mensal) — já
inventariado em M03 (decisão V1 vs V2 já tomada, clássico venceu); citado aqui só porque é
exatamente a "reconciliação dos números" que o bullet do M08 pede.

## 4. O que é decisão de produto, não de engenharia

- CMV/estoque e atribuição de canal (Gap 4) valem a pena construir pra odontologia, ou formalizar
  como fora de escopo (mesmo tratamento do B2B/multi-canal já pausado em M02/M03)?
- Vale gate de `minRole` em Relatórios no Sidebar, igual Senhas (Gap 6)?
- Paginação real vale o investimento no volume atual (Gap 7)?

## 5. Fora de escopo deliberado

- Gap 3 (perf dos 3 listeners) — real mas proporcional adiar: mesmo padrão já parcialmente
  corrigido no mesmo arquivo, volume de dado da clínica-piloto ainda pequeno. Empacotar no
  próximo sprint de performance, não tratar como urgente de M08.
- Gap 7 (paginação) — não vale no volume atual.

## 6. Fases

### M08.0 — Baseline (investigação de abertura) ✅ Concluído (05/09/2026)

### M08.1 — Fix agrupamento de comissão por profissional (Gap 1, engenharia pura, alto valor) ✅ Concluído (05/09/2026)

- [x] `ReportsModule.tsx`: agrupar por `clientName`/`clientId` em vez de `createdByName`.

### M08.2 — Fix período de "Total de clientes"/CLV (Gap 2, engenharia pura) ✅ Concluído (05/09/2026)

- [x] Remover o filtro de `createdAt` da query principal de `clients`; computar "novos no
      período" separadamente a partir do array já carregado. Corrigir o comentário enganoso em
      `app/api/agent/tools/reports/route.ts` (não `lib/services/reports.ts` — a função `loadClients`
      que buscava os dados vive na rota do agente; `lib/services/reports.ts` só tem a função pura
      de agregação `topClients`, que já recebia `clients` sem filtro de período).

Detalhes/evidência: `docs/relatorios/RELATORIOS_M08_1_2_FIXES.md`.

### M08.3 — Remover código morto (Gap 5, engenharia pura, custo zero) ✅ Concluído (05/09/2026)

- [x] Apagar `CompactMetricsStrip.tsx`/`AgentConsole.tsx`/`AnalystChatPanel.tsx`/
      `OperatorChatPanel.tsx` (reconfirmado zero importadores antes de apagar — só apareciam em
      docs e num comentário de texto em `TeamChatPanel.tsx`, nenhum `import` real).

### M08.4 — Descope explícito de CMV/canais (checkpoint, Gap 4)

- [ ] Perguntar ao usuário.

### M08.5 — `minRole` em Relatórios (checkpoint, Gap 6)

- [ ] Perguntar ao usuário.

### M08.6 — Testes, homologação e aceite

- [ ] Smoke manual: relatório de comissão com 2+ profissionais mostra linhas separadas (M08.1);
      "Total de clientes" não zera ao trocar pra período curto (M08.2).

## 7. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Corrigir agrupamento de comissão e quebrar algum relatório já em uso | Fix é estritamente mais correto (nunca pior que colapsar tudo numa linha); nenhum caller depende do comportamento quebrado |
| Investir em CMV/canais sem necessidade real | Checkpoint explícito antes (§4), mesmo tratamento do B2B pausado em M02/M03 |

## 8. Ordem de entrega recomendada

1. **M08.1** — fix de comissão (alto valor, clínica com 2+ dentistas).
2. **M08.2** — fix de período de clientes.
3. **M08.3** — remoção de código morto.
4. **M08.4/5** — checkpoints de produto.
5. **M08.6** — aceite.
