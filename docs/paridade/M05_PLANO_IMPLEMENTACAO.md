# M05 — Plano de implementação de Clientes, CRM e Jornada Comercial

> Análise concluída em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Lente desta rodada: **odontologia** — cliente pagante real, atendimento 1:1, não é organização
> de vendas B2B.
>
> Estado: investigação de abertura concluída em 05/09/2026 (mesmo rigor de M06/M03/M07/M10/M13).
> Nenhum código alterado nesta fatia de investigação — plano + fixes de baixo risco na sequência.

---

## 0. Escopo reivindicado pelo roadmap (citação literal)

> Cadastro unificado, deduplicação, histórico, scoring, origem, pipeline, atividades, segmentos e
> formulários. Integrar cliente com vendas, agenda, conversas, financeiro e fiscal.

## 1. Correções ao que o roadmap presumia

- "Planejado" está errado, como nos outros 5 módulos. Cadastro unificado, dedup, histórico,
  segmentos e formulários já existem em código funcional. O que falta não é "começar" — é
  reconciliar duas máquinas de estado paralelas e podar plumbing morta.
- **"Pipeline" (jornada comercial B2B) já foi deliberadamente descontinuado na UI manual**, não é
  um gap a preencher — decisão já tomada silenciosamente que o roadmap não registrou.
  `ImportLeadModal.tsx:4-8` documenta que os botões "Novo Deal"/"+ Contato" foram removidos do
  header do CRM por serem "pouco usados e duplicarem o cadastro de cliente".
- **Scoring não tem motor nenhum** — é campo de escrita externa (API pública), não uma feature de
  inteligência interna, ao contrário do que o bullet do roadmap sugere.

## 2. O que já existe e funciona (por item do bullet do roadmap)

| Item | Estado | Evidência |
|---|---|---|
| Cadastro unificado | ✅ Real | `Client` (`lib/types/index.ts:2507`) unifica CRM+paciente+fiscal; `CRMContact` é alias deprecated |
| Deduplicação | ✅ Real | `detectDuplicates` (CPF/e-mail/telefone) + merge com reassociação + ignore-list cross-device |
| Histórico | ✅ Real | `ClientTimeline.tsx` — 5 queries paralelas isoladas por `safeQuery` |
| Scoring | 🔴 Sem motor | Ver Gap 1 |
| Origem | ✅ Real | `LeadSource` + `acquisitionOfferId/Product/Label` (Fases 4A/4B) |
| Pipeline | 🟡 Descontinuado na prática | Ver §5 |
| Atividades | ✅ Real | `CRMActivity`, log via `onLogActivity` |
| Segmentos | ✅ Real, **dinâmico** | `evaluateAudienceFilter` recalcula ao vivo no momento do envio — `contactCount`/`lastCalculatedAt` persistidos são só cosmético de snapshot, não afetam o envio real |
| Formulários | ✅ Real | `POST /api/forms/submit` público, rate-limited, sem gate Enterprise (M06.4a) |
| Integração vendas/agenda/conversas/financeiro/fiscal | 🟡 Parcial | Ver Gaps 2-4 |

## 3. Gaps reais encontrados (medidos contra R1-R6)

### Gap 1 — `Client.scores` sem motor de cálculo (alto impacto na automação, baixo isolado)

Único writer é `POST /api/v1/crm/contacts` — aceita `scores` fornecido pelo CALLER EXTERNO, só
faz clamp 0-100, zero cálculo interno. `ScoresSection.tsx`/`HealthBadge.tsx` só renderizam se
`lastCalculatedAt != null` — pra qualquer tenant sem integração externa empurrando scores, a
seção fica **sempre vazia**. A automação `high_churn_risk` (M10.4, idempotência já corrigida
nesta sessão) filtra por `scores.churnRisk >= threshold` — **nunca vai disparar pra odontologia**,
diferente de `client_inactive` que tem sinal real (`lastVisit`).

### Gap 2 — Duas máquinas de estado paralelas descrevendo a mesma jornada, nunca sincronizadas

`Client.status` (`LeadStatus`: novo→contatado→qualificado→proposta→negociação→ganho|perdido) e
`Client.lifecycleStage` (`LifecycleStage`: new_lead→contacted→qualified→proposal→negotiation→
customer|churned) modelam a MESMA progressão com nomenclatura diferente, e nada sincroniza os
dois:
- `status` só muda via drag-and-drop no Kanban (`updateDoc` direto, sem FSM).
- `lifecycleStage` só avança pra `'customer'` via `recordClientPurchaseAdmin/Client`
  (idempotente, bem construído).
- Agente/API permitem `PATCH` em qualquer um independentemente, sem regra de consistência.

Resultado prático: paciente que comprou pode continuar "novo" no Kanban pra sempre se ninguém
arrastar o card; lead arrastado até "ganho" não vira `lifecycleStage='customer'` sozinho.

### Gap 3 — `appointment.trialCompleted` despachado mas sem handler (comentário engana)

Evento é DE FATO despachado e persistido em `domainEvents/{id}`, mas
`lib/contracts/_runtime/handlers/index.ts` só registra handler pra `appointment.completed/
canceled/noShow`. O comentário no código promete avançar `lifecycleStage` (qualified→customer)
em outcome `'converteu'` — isso nunca acontece automaticamente. `broadcast.replied`/
`booking.created` são ainda mais crus (nunca dispatchados em lugar nenhum, R5 fase 1 aceitável).

### Gap 4 — `RelationshipHistory`: 12 subcampos declarados, 11 nunca escritos

Só `noShowCount` tem writer real (`bumpClientNoShowCountAdmin`, M06.3b). Os outros 11
(`firstContactDate, totalAppointments, completedAppointments, ..., servicesContracted, avgTicket`)
não têm writer em lugar nenhum. `CRMModule.tsx` renderiza `servicesContracted?.[0]` como subtítulo
do card Kanban — elemento de UI que nunca aparece pra nenhum cliente real.

### Gap 5 — Bug de shallow-replace em `relationshipHistory` via API pública ✅ Fix de baixo risco

`PUT /api/v1/crm/contacts` grava `relationshipHistory` inteiro por substituição rasa — caller
externo que reenvie o objeto parcialmente apaga `noShowCount` sem querer, silenciosamente. Já
auto-documentado no próprio código como "bug pré-existente, fora do escopo corrigir" — nunca
endereçado. Proporcional de corrigir agora (fix pequeno e cirúrgico).

### Gap 6 — Merge de clientes: campo errado no reassociate de Kanban ✅ Fix de baixo risco

`mergeClients.ts` reassocia `kanbanCards` pelo campo `contactId` — o campo REAL é
`relatedContactId` (`KanbanCard`, `CreateKanbanTaskDialog.tsx`). A query sempre retorna vazio,
sem erro logado — reassociação de tarefas Kanban durante merge é no-op silencioso. Mesma classe
de bug de nome de campo errado já achada em M06.5c (`lastContactAt`/`lastContactDate`).
Achado adicional: `relatedContactId` não é lido em nenhum outro lugar do código — é write-only
hoje (painel que o consumiria nunca foi construído); o bug de merge só importa se esse painel for
construído no futuro.

### Gap 7 — R2: nenhum contrato de domínio Zod pra `Client`/`CRMDeal`/`Segment`

`lib/contracts/domain/` tem 26 arquivos, nenhum pra estas entidades — apesar de `Client` ser
plausivelmente a entidade mais central pro caso de uso odontológico (é o prontuário do
paciente). Existe Zod só na borda do agente (`lib/contracts/api/agent/{crm,clients}.ts`, bem
feitos), não na borda pública v1 nem como contrato de domínio.

### Gap 8 — R6: API v1 de CRM valida com arrays hand-rolled, não Zod

`app/api/v1/crm/contacts/route.ts`/`deals/route.ts` declaram 9 arrays de enum duplicando
`lib/types/index.ts` — mesmo padrão "3 fontes de verdade" já consolidado em M03, aqui ainda não.

### Gap 9 — R3: nenhuma rota POST de CRM aceita `X-Idempotency-Key`

`POST /api/v1/crm/contacts`, `POST /api/v1/crm/deals`, `POST /api/forms/submit` — nenhum
verifica idempotência. `forms/submit` é o mais exposto (público, sem auth, só rate-limit por IP)
— duplo-clique do paciente ou retry de rede cria duas respostas de formulário. **Relevante pra
odontologia**: ficha de anamnese usa este endpoint (M06.4a).

### Gap 10 — R4: `Client.status` sem FSM

Drag-and-drop no Kanban faz `updateDoc` direto, qualquer transição permitida, sem
`assertTransition`. Baixa prioridade dado que "ganho/perdido" tem baixo uso real numa clínica.

## 4. Código morto confirmado

**`CRMDeal` criação/edição manual é 100% inalcançável pela UI.** `DealFormDialog` é renderizado e
`handleSaveDeal` funciona, mas nenhum botão no arquivo abre o dialog pra criar OU editar — foram
removidos deliberadamente (`ImportLeadModal.tsx:4-8`), o dialog/handler ficaram como plumbing
órfã. Único jeito de criar/editar um `CRMDeal` hoje é via agente IA ou API v1. O gráfico de funil
em `MetricsTab` sempre renderiza vazio pra qualquer tenant que não use agente/API pra criar deals.

## 5. O que é decisão de produto, não de engenharia

- **"Jornada comercial" já foi de facto descontinuada na UI manual** (mesmo padrão do B2B pausado
  em M02.6+). Formalizar: (a) remover de vez `DealFormDialog`/`handleSaveDeal`/funil (~200 linhas
  mortas), ou (b) manter como está (agente/API-only) e documentar por quê.
- **Unificar `status`/`lifecycleStage` é decisão de produto**: historicamente coexistem porque
  servem públicos diferentes (`status` = pipeline visual do CRM; `lifecycleStage` = trigger de
  automação). Cabe ao usuário decidir se a odontologia precisa de um "Kanban de vendas" separado
  do "estágio de vida do paciente", ou se um dos dois deveria ser aposentado.
- **`Client.scores`**: vale motor de cálculo real (ex.: derivar `churnRisk` de `lastVisit`/
  frequência, como já existe pro `client_inactive`) ou aceitar como campo dormente até integração
  externa real alimentá-lo?

## 6. Fora de escopo deliberado (B2B/enterprise-sales, mesmo tratamento do M02.6+)

- `CRMDeal`/pipeline de vendas completo — já descontinuado na prática, não reviver pra clínica 1:1.
- Contratos Zod formais pra Client/CRMDeal na v1 pública (Gaps 7/8) — baixo risco de exploração
  hoje (uso interno/parceiro, não input de massa não-confiável); fazer quando M05 for tocado de
  verdade por feature nova, não como projeto isolado.
- FSM de `LeadStatus` (Gap 10) — pipeline já é baixa prioridade, não vale FSM formal pra conceito
  já deprioritizado pela própria equipe.

## 7. Fases

### M05.0 — Baseline (investigação de abertura) ✅ Concluído (05/09/2026)

### M05.1 — Fix shallow-replace em `relationshipHistory` (Gap 5, engenharia pura) ✅ Concluído (05/09/2026)

- [x] `PUT /api/v1/crm/contacts`: mescla `relationshipHistory` com o valor atual antes de gravar,
      em vez de substituir inteiro. Doc: `docs/crm/CRM_M05_1_2_3_FIXES.md`.

### M05.2 — Fix campo errado no merge de Kanban (Gap 6, engenharia pura) ✅ Concluído (05/09/2026)

- [x] `mergeClients.ts`: `contactId` → `relatedContactId` no reassociate de `kanbanCards`.

### M05.3 — Idempotência em `forms/submit` (Gap 9 parcial, engenharia pura, relevante pra clínica) ✅ Concluído (05/09/2026)

- [x] `POST /api/forms/submit` aceita `X-Idempotency-Key` opcional (doc ID determinístico +
      `.create()`). `app/forms/[formId]/page.tsx` (página real que o paciente usa) gera a chave
      1x por carregamento e reenvia em qualquer retry manual pós-erro.

### M05.4 — Scores: motor de cálculo ✅ Decidido (05/09/2026)

- [x] **Decisão do usuário: não por agora.** Fica dormente até sinal real de necessidade, mesmo
      tratamento do PIX/Boleto/Sequências. Documentado diretamente no tipo (`ContactScores`,
      `lib/types/index.ts`).

### M05.5 — Unificação status/lifecycleStage ✅ Decidido (05/09/2026)

- [x] **Decisão do usuário: manter os dois separados, documentar o motivo.** Sem mudança de
      código — comentário adicionado em `Client.status`/`Client.lifecycleStage`
      (`lib/types/index.ts`) deixando explícito que são campos independentes por design, não
      sincronizados, servindo públicos diferentes (Kanban visual vs. trigger de automação).

### M05.6 — Destino do pipeline de vendas morto ✅ Decidido (05/09/2026)

- [x] **Decisão do usuário: manter como está (agente/API-only), documentar.** `DealFormDialog`/
      `handleSaveDeal`/funil permanecem no código, sem remoção. Comentário adicionado em
      `ImportLeadModal.tsx` confirmando que é decisão de produto definitiva, não código morto por
      descuido.

### M05.7 — Testes, homologação e aceite

- [ ] Smoke manual: merge de clientes com tarefa Kanban vinculada reassocia corretamente (M05.2);
      `PUT` de contato via API não apaga `noShowCount` de um cliente com faltas registradas
      (M05.1).

## 8. Critérios para marcar M05 como concluído

- [x] Bugs de baixo risco corrigidos (M05.1/2/3).
- [x] Decisões de produto (M05.4/5/6) registradas com a resposta do usuário, não deixadas em aberto.

## 9. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Corrigir `relationshipHistory` e quebrar algum caller externo que dependia do shallow-replace | Merge é estritamente mais seguro que replace pra qualquer caller bem-intencionado; nenhum caller real identificado que dependa do comportamento de apagar campos |
| Investir em motor de scores ou unificação de status sem necessidade real da clínica | Checkpoint explícito antes de qualquer um dos dois (§5) |

## 10. Ordem de entrega recomendada

1. **M05.1/2/3** ✅ — fixes de baixo risco, sem decisão de produto, valor real pra odontologia
   (ficha de anamnese usa `forms/submit`).
2. **M05.4/5/6** ✅ — checkpoints de produto, todos decididos (dormente/documentar/manter).
3. **M05.7** — aceite (precisa de tenant real/navegador).

**M05 fica, ao fim deste arco, só com M05.7 (aceite) em aberto.**
