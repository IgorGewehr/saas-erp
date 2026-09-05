# M13 — Plano de Segurança, Desempenho e Preparação para Produção

> Análise concluída em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Lente desta rodada: **odontologia** — cliente pagante real com dado de paciente em produção.
>
> Estado: investigação de abertura concluída em 05/09/2026 (mesmo rigor de M06/M03/M07/M10, mas
> combinada com re-verificação de 3 auditorias pré-existentes). Nenhum código alterado nesta
> fatia — só investigação e plano. **Achado mais sério, não vinha de nenhuma auditoria anterior,
> encontrado fresco nesta rodada**: ver §1.

---

## 0. Correções ao que o roadmap presumia

"Planejado" está errado de novo, mais dramaticamente que em M06/M07/M10. Este módulo já tem **3
auditorias datadas no repositório** (não 1): `docs/audit/PRODUCTION_CHECKUP_2026-05-29.md`,
`docs/audit/PLANO_LOTE_B_custo_firebase.md`, e um terceiro documento maior nunca citado no
roadmap — `docs/auditoria-producao-2026-06-01.md` (67 subagentes, 51 achados: 1×P0/13×P1/27×P2/
10×P3). Um quarto documento, `docs/refatoracao-monolitos.md` (plano de extração de componentes
gigantes, nunca executado), também nunca foi referenciado no M13.

A maioria esmagadora dos achados P0/P1 dessas auditorias **já está corrigida** — não por um
"sprint de segurança" dedicado, mas como efeito colateral do trabalho de feature de M01/M02/M03/
M06/M07 desta e de sessões anteriores. Não existe um backlog único de segurança/produção
análogo ao `docs/roadmap/ROADMAP_FISCAL_BACKLOG.md` — vive espalhado nesses 3-4 documentos, sem
índice central.

## 1. Achado mais sério — não vinha de nenhuma auditoria anterior

**`scripts/wipe-financial.ts`** — script não versionado (`git status` mostra como untracked
durante TODA esta sessão, corretamente excluído de todo commit por disciplina de auditoria
pré-commit) que faz hard-delete de `transactions` + `cashSessions` por `businessId`. **Sem
dry-run, sem confirmação além de um aviso no console, sem soft-delete, sem entrada de
auditoria.** Combinado com o achado abaixo (nenhuma estratégia de backup verificável no repo),
rodar isso contra o `businessId` errado — de um cliente com dado de paciente/financeiro real em
produção — seria **irrecuperável**. Achado novo, não estava em nenhuma das 3 auditorias
anteriores. Ver checkpoint no §5.

**Nenhuma estratégia de backup do Firestore em lugar nenhum do repo.** `firebase.json` só declara
paths de rules/indexes, sem config de export agendado; `docker-compose.yml` sem serviço de
backup; `scripts/` sem script de export/dump. Não dá pra verificar pelo repo se existe Point-in-
Time Recovery ou export agendado configurado fora do código (GCP Console/gcloud) — precisa de
checagem direta, não checagem de código. Combinado com o achado acima, é o gap mais consequente
desta investigação inteira dado que já existe dado real de paciente em produção.

## 2. Auditorias pré-existentes — status re-verificado (não repetir o que já foi feito)

### `PRODUCTION_CHECKUP_2026-05-29.md` (nota 3.5/10 custo Firebase na época)

| Achado | Status re-verificado |
|---|---|
| Reports baixa 6 coleções inteiras | ✅ **Corrigido** — todas as 6 queries agora janeladas por período server-side |
| 3 listeners full-collection em `conversations` | 🟡 **Parcialmente corrigido** — badges migraram pra `unreadCounters`; **a LISTA principal em `ConversasModule.tsx` continua `onSnapshot` sem `.limit()`** (confirmado, admin e non-admin) |
| Sidebar `transactions` full listener | ✅ **Corrigido** — range + `limit(200)`, índice presente |
| `staleTime` 30s + `refetchOnWindowFocus:true` | ✅ **Corrigido** — voltou a 3min / false |
| OffersManagerModal full clients+broadcasts | 🟡 **Mitigado parcialmente** — cap `limit(5000)` explícito, trade-off documentado no código |
| 3 índices compostos faltando (loyaltyTransactions/projects/reconciliationRules) | ✅ **Corrigidos**, presentes em `firestore.indexes.json` |
| `console.log [AUDITORIA]` PII (`OmnichannelInbox.tsx:384`) | ✅ **Moot** — arquivo apagado (M07.5, mesma sessão) |
| Log de token Meta (`webhooks/meta/route.ts`) | ✅ **Corrigido** — só loga `{hasToken: boolean}` |
| Índices órfãos `crmContacts` | 🔴 **Ainda aberto, não verificável pelo repo** — precisa checagem de hit-count no Firebase Console (precondição que a própria auditoria original já pedia) |
| Rule de `teamChats`/`notes` afrouxada (cross-DM no tenant) | 🟡 **Ainda aberto, mas registrado como trade-off aceito** diretamente no comentário do `firestore.rules` |
| Dead imports/state no Settings | ✅ **Corrigido** (limpeza automática já aplicada em commit anterior) |
| `conversationMessages` paga `get(conversation)` por mensagem | 🔴 **Ainda aberto** — multiplicador de custo na coleção mais quente, P2 |

### `PLANO_LOTE_B_custo_firebase.md`

Ambos os itens planejados foram executados quase exatamente como especificado — Reports
janelado, `unreadCounters` denormalizado + rule + backfill script rodado. **Só a sub-etapa de
paginação da lista (2.3, `limit(50)`+cursor) nunca foi feita** — mesmo gap da tabela acima.

### `docs/auditoria-producao-2026-06-01.md` (51 achados, nunca citado no roadmap)

O único P0 e a maioria dos P1 estão fechados — a maior parte **não** por trabalho dedicado de
segurança, e sim como efeito colateral do núcleo comercial do M02 e do FSM do M03/M06:

- P0.1 (3 listeners `transactions`) — ✅ corrigido.
- P1.1 (DeliveryOrder nunca gera Transaction) — ✅ corrigido (`delivery-order-transition-admin.ts`).
- P1.2 (agente `sales_create` sem estoque/txn/idempotência) — ✅ corrigido via `sales-server.ts`
  centralizado (trabalho do núcleo comercial M02, não um fix de segurança dedicado).
- P1.3 (Fiscal sem tool de agente) — ✅ corrigido, `app/api/agent/tools/fiscal/route.ts` existe.
- P1.4 (4 listeners full-collection `conversations`) — 🟡 parcial, mesmo gap acima.
- P1.5 (`stockMovements` sem limit) — ✅ corrigido, `useInfiniteQuery` cursor-based.
- P1.6 (`deductStockAdmin` oversell) — ✅ corrigido, roda em `runTransaction`.
- P1.7 (agente `orders/create` estoque não-atômico) — ✅ corrigido via `delivery-order-server.ts`.
- P1.8 (rotas financeiras do agente sem idempotência) — 🟡 **parcialmente aberto, já rastreado**:
  dedup só quando o caller manda `idempotencyKey`; parcelamento deliberadamente sem — documentado
  em `docs/financeiro/FINANCEIRO_M03_3_AGENTE_IDEMPOTENCIA.md`.
- P1.9 (status mudado sem FSM) — ✅ **majoritariamente corrigido**: FSM de Transaction aplicado
  até na camada de `firestore.rules` (M03.4); FSM de Appointment no servidor (M06.2); FSM de Sale
  ligado no novo caminho de vendas.
- P1.10/P2.15 (componentes-deus) — 🔴 **não corrigido**, plano existe (`refatoracao-
  monolitos.md`) mas nunca executado, arquivos só cresceram. Débito de manutenibilidade legítimo,
  sem violação de R1-R6 — corretamente fora do escopo de um gate de segurança.
- Promoção de evento R5 pra `appointment.completed` — ✅ corrigido, handler real com CAS de
  idempotência e revalidação contra o doc vivo (fecha um risco de evento forjado que a própria
  auditoria de junho nem sabia sinalizar).

## 3. Gaps reais encontrados (ainda abertos)

1. **`ConversasModule.tsx` lista principal sem paginação** — `onSnapshot` full-collection,
   admin e non-admin. Reverter pra `limit(50)` simples já quebrou o filtro de não-lidas uma vez
   antes (commit `6fb79c2`) — precisa de paginação por cursor de verdade, não um limit ingênuo.
   **P1 de custo, não de segurança.**
2. **`FinancialModule.tsx` (clássico): `financialAuditLog` baixa a coleção inteira** sem
   `where(createdAt...)` nem limit server-side, corta pra 100 só no cliente. V2 já faz certo
   (`useFinancialData.ts`, `limit(AUDIT_LOG_FETCH_LIMIT)`). **Relevante agora**: o clássico é a UI
   PRINCIPAL confirmada em M03.6 (V2 perdeu) — não é módulo descontinuado. **P2 de custo,
   cresce com todo evento de auditoria.**
3. **`firestore.rules`: `conversationMessages` paga `get(conversation)` por mensagem**
   (`parentConversationAccessible()`) — multiplicador de custo na coleção mais quente. P2.
4. **Idempotência do agente em rotas financeiras** — já rastreado, ver M03.3, não repetido aqui.
5. **Índices órfãos `crmContacts`** — precisa checagem de hit-count no Console antes de decidir.

## 4. Observabilidade / backups / runbooks

- **Observabilidade: zero SDK de APM/error-tracking pra aplicação em si** (confirmado, mesmo
  achado do M10) — só existe um proxy read-only de Sentry pro tenant ver o PRÓPRIO projeto Sentry
  dele, não da aplicação. Gap real e estrutural: hoje não existe nenhuma visibilidade de exceção
  não tratada nem alerta em produção.
- **Backups: totalmente não endereçado no repo** — ver §1, o gap mais consequente.
- **Runbooks: nenhum.** Nenhum documento de deploy/incident-response/rollback em `docs/`.
  Conhecimento operacional espalhado em comentários de código.
- **Testes de carga/concorrência**: nenhuma infra de load-test (k6/artillery). Consistente com o
  padrão já estabelecido nesta sessão: bugs de concorrência reais (estoque, agendamento
  cross-canal) foram achados por leitura cuidadosa de código, não por teste de carga automatizado
  — abordagem que está funcionando, não precisa de infra nova pra continuar funcionando.

## 5. O que é decisão de produto/operação, não de engenharia pura

- **`scripts/wipe-financial.ts`**: apagar, proteger com flag de confirmação, ou manter como
  ferramenta de emergência deliberada? Precisa da decisão do usuário antes de decidir se ele
  entra no repo ou é descartado.
- **Backup/PITR do Firestore**: configurar agora ou depois? É config de infraestrutura fora do
  repo (GCP Console/gcloud), exige o acesso do usuário — não é uma mudança de código.
- **Sentry/APM**: vale configurar agora (barato, alto sinal com 1-2 tenants pagantes e dado real
  de paciente) ou adiar?
- **Paginação da lista de Conversas**: exige desenho próprio (cursor + preservar o filtro de
  não-lidas que já quebrou uma vez) — vale como fatia própria, não "limpeza geral do M13".
- **Índices órfãos `crmContacts` / stub `testConnection()`**: mesma checagem de Console/decisão
  de produto que a auditoria original já tinha sinalizado, ainda pendente.

## 6. Fora de escopo deliberado (pode esperar mais tenants)

- Paginação da lista de Conversas e do `financialAuditLog` clássico — cresce com volume, imaterial
  no volume atual (1-2 tenants).
- `conversationMessages` `get()` por mensagem, índices órfãos `crmContacts`, cap de 5000 do
  OffersManagerModal — todos P2 de custo, imateriais na escala atual.
- Refatoração de componentes-deus (`docs/refatoracao-monolitos.md`) — débito de manutenibilidade
  puro, sem violação de regra dura, continuar adiando não bloqueia nada específico.
- Infra de load-testing (k6/artillery) — não compensa construir até haver um 2º/3º tenant real
  pra modelar carga concorrente realista; a investigação manual já está funcionando.

## 7. Fases

### M13.0 — Baseline (investigação + re-auditoria) ✅ Concluído (05/09/2026)

### M13.1 — `scripts/wipe-financial.ts` (checkpoint)

- [ ] Perguntar ao usuário: apagar, proteger, ou manter como ferramenta de emergência?

### M13.2 — Backup/PITR do Firestore (checkpoint, ação fora do repo)

- [ ] Perguntar ao usuário se quer verificar/configurar agora (ação de GCP Console/gcloud, fora
      do escopo de mudança de código deste repo).

### M13.3 — Observabilidade (checkpoint)

- [ ] Perguntar se vale configurar Sentry (ou equivalente) agora pra aplicação em si.

### M13.4 — Paginação de Conversas (engenharia, escopo próprio se priorizado)

- [ ] Cursor pagination na lista principal, preservando o filtro de não-lidas (não repetir o
      erro do commit `6fb79c2`). Só perseguir se priorizado — ver §6.

### M13.5 — Testes, homologação e aceite

- [ ] Confirmar checkpoints M13.1-M13.3 resolvidos ou deliberadamente adiados com justificativa.

## 8. Critérios para marcar M13 como concluído

- [ ] `scripts/wipe-financial.ts` tem disposição decidida (não fica órfão e sem dono).
- [ ] Backup/PITR do Firestore confirmado configurado, ou decisão de adiar registrada.
- [ ] Decisão sobre Sentry/APM registrada.
- [ ] Gaps de paginação (§3) resolvidos ou deliberadamente adiados com justificativa (§6).

## 9. Riscos e controles

| Risco | Controle planejado |
|---|---|
| `scripts/wipe-financial.ts` rodar contra o `businessId` errado sem backup pra recuperar | Checkpoint explícito antes de decidir o destino do script; backup é pré-requisito lógico |
| Investir em load-testing/observability pesada sem necessidade real no volume atual | Escopo restrito ao que é genuinamente urgente com dado real de paciente em produção (§5), resto adiado com justificativa (§6) |

## 10. Ordem de entrega recomendada

1. **M13.1** — checkpoint `wipe-financial.ts` (mais urgente, resolve o achado mais sério).
2. **M13.2** — checkpoint backup/PITR (mais urgente, ação fora do repo).
3. **M13.3** — checkpoint Sentry/APM.
4. **M13.4** — paginação de Conversas, só se priorizada.
5. **M13.5** — aceite.
