# M07 — Plano de implementação de Conversas, Canais e Campanhas

> Análise concluída em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Lente desta rodada: **odontologia** — cliente pagante real, uso principal é inbox
> multi-atendente (WhatsApp) com atribuição por setor, não campanhas de marketing pesadas.
>
> Estado: investigação de abertura concluída em 04/09/2026 (mesmo rigor de M06/M03 — ler código
> real antes de planejar). Nenhum código alterado nesta fatia — só investigação e plano.

---

## 0. Correções ao que o roadmap presumia

`docs/ROADMAP_PARIDADE_GESTAO_RAIZ.md` descrevia M07 como "campanhas, inbox, atribuição... segue
não iniciado". **Isso está errado, no mesmo padrão de M06/M04**: o núcleo já existe e em boa
parte já é hardenizado.

- **"Atribuição" não é "não iniciada"** — existe sistema completo: `assignedTo`/
  `assignedToName`/`assignedToSectorId`/`assignmentHistory`, atribuição manual em lote com
  notificação (`ConversasModule.tsx:7656-7680`), **e** regras de roteamento automático
  (`business.settings.routingRules`) que atribuem conversa sem dono a um setor/usuário
  (`ConversasModule.tsx:7077-7135, 3735`).
- **"Setores aplicam-se a Conversations" (CLAUDE.md §4) é só meia verdade** — o filtro é real na
  camada React (`getVisibleConversations`, `ConversasModule.tsx:7730-7753`) mas **não é aplicado
  no servidor**. Ver §2 (gap R1, o achado mais sério desta investigação).
- **"Notas internas" já está embutido em Conversas**, não é só o módulo `notas` standalone —
  contador `internalNotes` + UI dedicada (`ConversasModule.tsx:2320, 3001, 3198, 8634, 8931`).
- **Contrato de domínio + FSM de `Conversation` já existem** (`lib/contracts/domain/
  conversation.ts`, `lib/contracts/fsm/conversation.ts`) — parecem "prontos" no papel. Mas, no
  mesmo padrão exato do FSM de `Transaction` antes do M03.2, `assertTransitionConversation` **tem
  zero chamadores** em todo o repo (grep confirma: só o próprio arquivo do FSM, o do domínio, e
  um doc de roadmap mencionam).
- **Idempotência/consentimento em broadcasts NÃO é o gap** — `app/api/broadcasts/send/route.ts`
  é um dos write-paths mais hardenizados do repo inteiro (transação CAS, filtro de opt-out, gate
  de base legal LGPD, fail-closed se faltar índice composto). A frase genérica do roadmap
  ("consentimento") subestima o quanto disso já está sólido — o gap de consentimento real está
  em outro lugar (campanha de aniversário, ver §2).

## 1. O que já existe e funciona

**Canais/webhooks**
- `app/api/webhooks/meta/route.ts` — handler unificado WhatsApp Cloud + Facebook + Instagram.
  Dedup atômico via `markWebhookSeen` (`lib/contracts/_runtime/webhookIdempotency.ts`, chamado em
  `meta/route.ts:1511`), resolução de `businessId` + isolamento em todo ramo, verificação de
  assinatura HMAC, rate limit com 429 (não descarte silencioso), pipeline de mídia, guards
  cross-transporte (Cloud vs Baileys), fuzzy match de telefone BR, detecção de resposta de bot,
  auto-link de CRM, captura de palavra-chave de opt-out (`isOptOutKeyword`, linha 694), integração
  com a confirmação automática do M06.5a.
- Tracking de entrega é real: `conversationMessages`/`broadcastMessages`/`birthdayCampaignLogs`
  recebem status `sent→delivered→read` dos callbacks de status do Meta (`meta/route.ts:2027-
  2224`), com guards de regressão.
- Webhook de bounce de e-mail existe e funciona: `app/api/webhooks/email-bounce/route.ts` —
  HMAC-verificado, idempotente, atualiza `broadcastMessages`/`Broadcast.stats` corretamente em
  bounce definitivo.

**Inbox/atribuição/setores** — ver §0.

**Snippets** — feature real, mas vive em `app/components/features/settings/QuickRepliesTab.tsx`
(não em `conversations/` — CLAUDE.md §5 deveria anotar isso), coleção `snippets` filtrada por
`businessId` + `sectorId` opcional, mais API pública v1 completa (`app/api/v1/snippets/route.ts`)
com checagem de posse por documento em PUT/DELETE.

**Campanhas/broadcasts**
- `app/api/broadcasts/send/route.ts`: dedup por destinatário (`normalizeRecipients`, linhas
  170-209), transação CAS bloqueando envio concorrente (`409 CONCURRENT_SEND`, linhas 814-862),
  gate de `consentBasis` LGPD no servidor (linhas 562-571), filtro de `marketingOptOuts`
  **fail-closed** se faltar índice composto (linhas 578-621), pausar/retomar/reenviar, trilha de
  auditoria por sessão (`sessions[]` com `dispatchedBy`/`dispatchedByName`, linhas 1394-1417),
  stats incrementais (UI não fica em 0% até terminar).
- Templates: integração real com Templates aprovados do WhatsApp Business (Meta), mas só leitura
  — `app/api/channels/whatsapp-templates/route.ts` lista templates `APPROVED` via Graph API; não
  existe fluxo de autoria/submissão de template dentro do app (feito direto no Meta Business
  Manager).

**Aniversário**
- `lib/services/birthdayCampaignRunner.ts`: idempotente via claim transacional
  `birthdayCampaignLogs/{campaignId}_{clientId}_{year}` (mesmo padrão já citado no próprio
  CLAUDE.md), janela de catch-up de 6h, notificação de fallback se a execução foi perdida, suporta
  envio via template Cloud ou texto livre Baileys.

**Consentimento (parcial — gap real em §2)**
- `isOptOutKeyword` capturado de resposta do WhatsApp (`meta/route.ts:694-716`),
  `/api/unsubscribe` pra e-mail, e `marketingOptOuts` checado corretamente em **broadcasts** e em
  **automações de CRM** (`app/api/agent/scheduled/run/route.ts:747-753, 973` — rotulado no
  próprio código como "M06.5c", mesma sessão, mesmo achado de bug que se repete abaixo).

## 2. Gaps reais encontrados (medidos contra R1-R6 do CLAUDE.md)

### 2.1 R1 — visibilidade por setor é só de UI, não é fronteira de acesso real (mais sério)

A query que um usuário não-admin roda no Firestore (`ConversasModule.tsx:7257-7276`) filtra só
por `businessId` + `(channelOwnerType=='business' OR channelOwnerId==eu)` — **sem cláusula de
`sectorIds`**. `firestore.rules:104-109` (`canAccessConversationData`) espelha essa MESMA checagem
mais estreita e **não tem noção nenhuma de `sectorIds`/`isPrivate`/`assignedTo`**. Efeito real:
o SDK client de qualquer operador (ou um client modificado) consegue ler toda conversa do
negócio, independente de setor ou da flag `isPrivate` — a restrição por setor descrita em
CLAUDE.md §4 é cosmética. **Pra uma clínica odontológica, isso é exposição real de
confidencialidade de paciente entre setores da equipe, não um bug cosmético.**

### 2.2 R3 — dedup de entrada do Baileys tem corrida, diferente do caminho Cloud

`app/api/whatsapp/baileys-manager.ts:742-752` deduplica via um simples `.where('external
MessageId','==',...).limit(1).get()` (check-then-act) — o mesmo padrão mais fraco já usado pelo
legado `app/api/webhooks/facebook/route.ts:334-341`, **não** o `markWebhookSeen()` atômico que
`meta/route.ts:1511` usa. `docs/sdd-roadmap.md:66` já lista aplicar `markWebhookSeen` em
`facebook/route.ts` como pendente; o Baileys nunca tinha sido nem sinalizado. Como o Baileys é
provavelmente o caminho de WhatsApp principal/gratuito de uma clínica pequena (sem precisar de
verificação Meta Business), este é o gap de dedup mais exposto do módulo.

### 2.3 Consentimento — campanha de aniversário não checa opt-out (achado mais claro e isolado)

`lib/services/birthdayCampaignRunner.ts` (`executeCampaign`, linhas 434-602) **nunca checa
`marketingOptOuts`** antes de enviar. É a MESMA classe de bug já encontrada e corrigida duas
vezes nesta sessão em sistemas irmãos — broadcasts (`broadcasts/send/route.ts:578-621`) e
automações de CRM (`agent/scheduled/run/route.ts`, "M06.5c" no próprio comentário do código).
Aniversário é o único caminho de envio automatizado que resta com esse gap já diagnosticado, e
está literalmente nomeado na frase do próprio roadmap ("aniversário, consentimento").

### 2.4 R4 — FSM declarado, aplicado em lugar nenhum

`assertTransitionConversation` (`lib/contracts/fsm/conversation.ts:25`) não tem chamador. A UI de
troca manual de status (`ConversasModule.tsx:3652-3657`) deixa um operador pular direto entre
qualquer um dos 3 status, incluindo transições que o FSM não permite (ex.: `resolved→waiting`,
que `CONVERSATION_TRANSITIONS` não autoriza). `firestore.rules` não tem função de validação de
transição pra `conversations.status` (diferente do que M03.4 já fez pra `transactions`).
`Broadcast` e `BirthdayCampaign` não têm contrato de domínio/FSM nenhum — ainda são interface
solta em `lib/types/index.ts:3683, 3832`; o ciclo de vida de status é só CAS ad-hoc (mas
razoavelmente seguro) embutido no handler da rota.

### 2.5 R6 — contrato de Conversation existe mas nunca é `.parse()`ado

Grep no repo inteiro por `ConversationSchema.parse` não retorna nada — o schema Zod
(`lib/contracts/domain/conversation.ts`) é só declarativo, nunca aplicado em nenhuma fronteira de
webhook/API.

### 2.6 Código morto com risco real se reativado

`app/components/features/crm/OmnichannelInbox.tsx` (939 linhas) é uma segunda UI de Conversas
completa — exportada, mas confirmado por grep no repo inteiro que **não tem nenhum importador/
render** em lugar nenhum. Contém seu próprio `console.log('[AUDITORIA]...')` vazando PII
(sinalizado como ativo em `docs/audit/PRODUCTION_CHECKUP_2026-05-29.md:28,65,96,114`, o que parece
ser uma afirmação obsoleta/incorreta já que o componente é inalcançável). `app/api/webhooks/
facebook/route.ts` duplica `handleFacebookEvent` de `meta/route.ts` com dedup mais fraco e menos
features — não dá pra confirmar por análise estática se ainda é o callback configurado no
dashboard Meta ou se está morto (checagem operacional: Meta App → Webhooks → callback URL — ver
§3).

### 2.7 "Sequências" (nutrição de CRM) não tem motor de execução

`SequenciasTab.tsx` deixa um operador montar sequências multi-etapa com passos `send_whatsapp`/
`send_email` e "matricular" um contato (`handleEnroll`, linhas 244-296). A matrícula pré-cria
todas as etapas futuras como docs `crmActivities` com `scheduledAt` futuro — mas busca no repo
inteiro confirma que **nada faz polling em `crmActivities` pra disparar a mensagem**
(`app/api/v1/crm/activities/route.ts` é CRUD puro; nenhum cron/serviço toca
`crmEnrollments.currentStep` nem dispara a mensagem da etapa). A feature não faz nada além de
agendar uma tarefa que um humano teria que notar e agir manualmente — isso é maior que gap de
hardening, é uma capacidade de automação anunciada sem nenhum backend por trás.

### 2.8 Menor: bounce de e-mail não gera opt-out automático

`email-bounce/route.ts` aceita `bounceType: 'unsubscribe'` no schema do payload mas nunca grava
uma entrada em `marketingOptOuts` pra esse caso, diferente do caminho de palavra-chave do
WhatsApp.

## 3. O que é decisão de produto, não de engenharia

- **Fluxo de autoria/aprovação de template** — hoje só leitura (consome templates já aprovados
  no Meta). Construir submissão dentro do app é integração nova, não hardening; só se justifica
  se a clínica realmente precisar criar templates novos com frequência.
- **Sequências de CRM** — a feature é desejada de verdade pra um cliente de clínica única? Se
  sim, precisa de um motor de execução real (não trivial: cron + avanço de etapa em
  `crmEnrollments` + checagem de opt-out + dedup). Se a necessidade real da clínica é só "mensagem
  de aniversário" + "lembrete de atendimento" (ambos já cobertos em outro lugar), Sequências pode
  nem valer a pena terminar.
- **`OmnichannelInbox.tsx` e `app/api/webhooks/facebook/route.ts`** — apagar código morto/legado
  costuma ser seguro, mas confirmar que `facebook/route.ts` está realmente inativo exige checar a
  configuração ao vivo do Webhook no Meta App Dashboard — checagem operacional, não algo
  inferível só pelo código-fonte.
- **Bounce de e-mail → opt-out automático quando `bounceType==='unsubscribe'`** — decisão de
  produto pequena sobre se isso deve registrar em `marketingOptOuts` silenciosamente ou exigir
  revisão manual.

## 4. Fora de escopo deliberado (mesma categoria do PIX/Boleto em M03)

- **Motor de execução de Sequências** (§2.7/§3) — não construído nesta rodada por padrão;
  reavaliar só se o usuário confirmar que quer a feature.
- **Autoria de template WhatsApp dentro do app** — decisão de produto (§3), não perseguida por
  padrão.
- **Disposição de `OmnichannelInbox.tsx`/`facebook/route.ts` legado** — precisa de checagem
  operacional externa antes de decidir apagar; documentado, não resolvido nesta rodada.

## 5. Fases

### M07.0 — Baseline (investigação de abertura) ✅ Concluído (04/09/2026)

Feito via agente de investigação dedicado (mesmo rigor de M06.0/M03.0) — achados em §0-§3 acima.
Nenhum código de auditoria automatizada (`lib/services/m07-*-audit.ts`) construído nesta fase:
diferente de M03 (13 caminhos de escrita divergentes precisando de medição quantitativa), os
gaps aqui são estruturais/binários (FSM sem chamador, dedup ausente, regra de acesso faltando) —
não há "quanto do dado já viola a regra" pra medir, é "a regra existe ou não".

### M07.1 — Consentimento no aniversário (LGPD, mesma classe de bug já corrigida 2x) ✅ Concluído (04/09/2026)

- [x] `lib/services/birthdayCampaignRunner.ts`: adicionada checagem de `marketingOptOuts` antes
      de enviar, mesmo padrão de `agent/scheduled/run/route.ts:747-753` (M06.5c). Lida uma vez
      por business (mesmo racional de já ler `clients` uma vez), reusada por todas as campanhas
      devidas do tenant no tick. Fail-closed (pula o business no tick) se faltar índice
      composto, fail-open com warning em erro transiente — mesma política de
      `broadcasts/send/route.ts`. Novo campo `RunResult.skippedOptOut` pra observabilidade.
      Achado de duplicação documentado, não resolvido: é a 3ª implementação independente da
      mesma query de opt-out no repo — não extraída pra helper compartilhado (requisitos de
      volume diferentes entre broadcasts e este/automações). Sem teste novo (mesma convenção já
      usada nesta sessão pra serviços cron com integração pesada de Admin SDK/Meta Graph/Baileys
      sem teste dedicado prévio). `tsc --noEmit` limpo, suíte 1063/79 sem regressão. Doc:
      `docs/conversas/CONVERSAS_M07_1_CONSENTIMENTO_ANIVERSARIO.md`.

### M07.2 — Dedup atômico no Baileys (R3, maior exposição real) ✅ Concluído (04/09/2026)

- [x] `app/api/whatsapp/baileys-manager.ts:742-752`: trocado o dedup check-then-act por
      `markWebhookSeen()` atômico, mesmo mecanismo já usado por `meta/route.ts:1511` — sem lógica
      nova, reuso direto. Limitação preexistente documentada, não corrigida: `messageId` cai num
      fallback `wa_${Date.now()}` (instável entre retries) quando o Baileys não fornece
      `key.id` — já era assim antes, não é regressão. `tsc --noEmit` limpo, suíte sem regressão.
      Doc: `docs/conversas/CONVERSAS_M07_2_DEDUP_BAILEYS.md`.

### M07.3 — Visibilidade por setor de verdade no servidor (R1, achado mais sério) ✅ Concluído (05/09/2026)

- [x] **Reconsiderado 2x com o usuário durante a investigação** (ver
      `docs/conversas/CONVERSAS_M07_3_VISIBILIDADE_SETOR.md` §2-3): uma query `list` em tempo
      real só é aceita pelo Firestore se a regra puder ser provada só pelos `where()` da própria
      query — cruzar `sectorIds` com o perfil do usuário via `get()` não é provável desse jeito e
      arriscava rejeitar (quebrar) a tela de Conversas inteira pra não-admins. Solução escolhida
      pelo usuário: denormalizar o resultado já resolvido — novo campo
      `Conversation.visibleToUserIds: string[] | null` (`lib/services/
      conversationVisibility.ts`, testado isoladamente, 8 casos), mantido em sincronia em TODO
      write-path que muda sectorIds/isPrivate/assignedTo (criação em 4 pontos, roteamento
      automático, atribuição manual, transfer-channel, API v1, e cascata quando a composição de
      um setor muda em Configurações→Setores). Query da tela de Conversas virou 2 listeners
      mesclados client-side pra non-admin (admin sem mudança); `firestore.rules` ganhou
      `canAccessConversationSector` usando o padrão canônico `uid in array` (sem `get()`
      cruzado). 5 índices compostos novos. Backfill:
      `scripts/backfill-conversation-visible-to.ts` (não executado contra dado real nesta
      sessão — recomendado rodar `--dry-run` primeiro). **Limitação honesta**: não validado via
      emulador (Java ausente); maior risco desta sessão inteira — recomendado testar em
      homologação antes de confiar 100%.

### M07.4 — Aplicar o FSM de Conversation (R4) ✅ Concluído (05/09/2026)

- [x] `canTransitionConversation` chamado nos 4 write-paths reais que mudam `Conversation.status`
      (não só 1 como o plano original supunha): `ConversasModule.tsx` (`updateConversationStatus`
      — status fresco via `getDoc`; `handleBatchStatus` — usa estado local, pula item inválido
      sem abortar o lote), `app/api/agent/tools/conversations/route.ts:setStatus` (agente de IA),
      `app/api/v1/conversations/route.ts` PUT (API pública, retorna 409 em transição inválida,
      mesma convenção do M03.3 pra `Transaction`).
- [x] `firestore.rules`: nova `isValidConversationTransition(from,to)` (espelha
      `CONVERSATION_TRANSITIONS` manualmente), encadeada em `allow update` — última linha de
      defesa. Confirmado que nenhum write-path de M07.3 (sectorIds/isPrivate/assignedTo/
      visibleToUserIds) toca `status`, então a regra nova é transparente pra eles (`from==to`).
- [ ] ~~Aplicar `ConversationSchema.parse()` na fronteira de pelo menos um write path real~~ —
      **analisado, deliberadamente adiado**: `ConversationSchema` tem campos com constraint mais
      estrito que dado de produção pode ter (ex.: `contactAvatarUrl: z.string().url()` — uma URL
      de avatar do Meta que não valide faria `.parse()` derrubar a ingestão do webhook). Sem
      acesso a dado real pra confirmar conformidade antes, risco desproporcional ao ganho desta
      fatia. Ver `docs/conversas/CONVERSAS_M07_4_FSM.md` §3.

### M07.5 — Código morto/legado ✅ Decidido e parcialmente executado (05/09/2026)

- [x] `OmnichannelInbox.tsx` — **decisão do usuário: remover agora** (confirmado morto, sem
      dependência operacional). Arquivo apagado.
- [ ] `app/api/webhooks/facebook/route.ts` — **decisão do usuário: vai verificar no Meta App
      Dashboard e avisa antes de mexer.** Nenhum código tocado, aguardando confirmação
      operacional que só o usuário pode fazer.

### M07.6 — Sequências de CRM ✅ Decidido (05/09/2026)

- [x] **Decisão do usuário: não construir motor de execução agora** — dormente até sinal real de
      demanda, mesma categoria do PIX/Boleto do M03. Nenhum código alterado.

### M07.7 — Bounce de e-mail → opt-out automático ✅ Concluído (05/09/2026)

- [x] **Decisão do usuário: registrar automaticamente**, por consistência com WhatsApp
      (palavra-chave) e link de descadastro. `app/api/webhooks/email-bounce/route.ts`:
      `bounceType==='unsubscribe'` agora grava `MarketingOptOut` (`source:'bounce'`, valor do
      enum que já existia sem nenhum escritor). Doc:
      `docs/conversas/CONVERSAS_M07_5_6_7_CHECKPOINTS.md`.

### M07.8 — Testes, homologação e aceite

- [ ] Cobertura de teste pros itens corrigidos em M07.1-M07.4 (nenhum tem teste dedicado hoje
      além do que já existe pros arquivos tocados).
- [ ] Smoke manual: mensagem de aniversário respeitando opt-out; duas mensagens Baileys
      idênticas não duplicam; operador de setor A não lê conversa de setor B; transição de
      status inválida é rejeitada pelo FSM.

## 6. Critérios para marcar M07 como concluído

- [ ] `birthdayCampaignRunner.ts` respeita `marketingOptOuts` (fecha o gap de LGPD nomeado no
      próprio roadmap).
- [ ] Dedup de entrada do Baileys é atômico, mesmo padrão do Cloud.
- [ ] Visibilidade por setor de conversa é aplicada no servidor (`firestore.rules`), não só na UI.
- [ ] FSM de `Conversation` tem pelo menos um chamador real (write path manual de status).
- [ ] Decisões de produto pendentes (§3) registradas com a resposta do usuário, não deixadas
      silenciosamente em aberto.

## 7. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Endurecer `firestore.rules` de conversas e travar acesso legítimo de um operador/admin real | Auditoria prévia (ler regra atual + query client-side) antes de mudar; testar contra os papéis reais (admin, operador de setor) antes de aplicar |
| Corrigir dedup do Baileys e quebrar o fluxo de sessão ativa de um tenant em produção | `markWebhookSeen` já é padrão comprovado em produção via `meta/route.ts` — não é mecanismo novo, é reuso |
| Investir em Sequências/template authoring sem demanda real | Deliberadamente fora de escopo (§4), dormente até sinal real, mesmo tratamento do PIX/Boleto do M03 |
| Apagar `OmnichannelInbox.tsx`/`facebook/route.ts` sem confirmar que estão realmente mortos | Checagem operacional (Meta App Dashboard) pedida ao usuário antes de qualquer remoção |

## 8. Dependências e relação com outros módulos

- **M06 (Agenda):** confirmação automática via WhatsApp (M06.5a), fuso horário (M06.5b) e
  reengajamento (M06.5c) já tocam os mesmos arquivos de webhook (`meta/route.ts`,
  `baileys-manager.ts`) que este módulo hardeniza mais — nenhuma mudança aqui deve regredir essas
  três fatias.
- **M04 (Fiscal):** nenhuma relação direta.
- **M03 (Financeiro):** nenhuma relação direta.
- **M10 (Automações):** `crmEnrollments`/Sequências (M07.6, se ativado) seria candidato natural a
  padronizar junto de M10 quando esse módulo abrir formalmente — mesma observação já registrada
  pra `membershipBillingRunner.ts` em M03.

## 9. Ordem de entrega recomendada

1. **M07.1** — consentimento no aniversário (LGPD, menor risco, maior urgência legal, gap já
   diagnosticado 2x antes — não depende de nenhuma decisão de produto).
2. **M07.2** — dedup atômico no Baileys (reuso de mecanismo comprovado, sem decisão de produto).
3. **M07.3** — visibilidade por setor no servidor (achado mais sério de confidencialidade,
   precisa de auditoria prévia cuidadosa antes de endurecer).
4. **M07.4** — aplicar FSM de Conversation (fecha R4/R6 pro domínio já contratado).
5. **M07.5/M07.6/M07.7** — checkpoints de decisão de produto (código morto, Sequências, bounce
   → opt-out), apresentados ao usuário quando chegar a vez, não decididos sozinho.
6. **M07.8** — aceite.
