# Plano de extração dos monolitos (P1.10 / P2.15)

> Documento de planejamento. **Nenhuma mudança de código de produção neste passo.**
> Origem: §8 de `docs/auditoria-producao-2026-06-01.md` (achados P1.10 e P2.15).
> Leitura obrigatória antes de executar qualquer fatia: `CLAUDE.md` §1 (R1–R6) e §6 (convenções).

---

## 0. Princípios transversais (valem para todos os arquivos)

1. **Persistência antes de UI.** Para cada monolito, extrair primeiro os *writes* Firestore
   para `lib/services/{dominio}/` (ou `lib/channels/{canal}/` nas rotas), **sem mudar comportamento**.
   Só depois mover subcomponentes/abas de UI. Isso é o que reduz o risco de regressão e o que a §8
   chama de "extrair primeiro a camada de persistência".

2. **Mover, não reescrever.** Cada passo é um *move* mecânico: recortar o bloco existente, colá-lo
   no arquivo novo, exportar, e importar de volta. A assinatura e o corpo da função extraída devem
   ser idênticos ao original (diff = `git mv` lógico + ajuste de import). Refatoração de
   comportamento é um PR separado e posterior.

3. **R1 é sagrado durante o move.** Todo write extraído já filtra/grava `businessId`. Ao mover para
   um service, **manter `businessId` como parâmetro explícito da função** (não capturá-lo de um
   contexto novo). Nenhuma query/write pode perder o filtro no caminho.

4. **R2/R6 nas bordas que mudarem.** Se um write extraído passa a aceitar um payload que hoje é
   montado inline no componente, declarar/Zod-validar esse payload no service (boundary do service)
   apenas se o service vira reusável por mais de um caller. Para o move 1:1 inicial, preservar os
   tipos existentes (`z.infer` dos contratos já existentes em `lib/contracts/domain/`).

5. **R3/R4 são preservados, não introduzidos.** Esta refatoração **não** corrige idempotência (R3)
   nem FSM (R4) — esses são P1.8/P1.9 e têm sprint próprio. Mover o write para um service **não pode
   apagar** guardas de idempotência/FSM já existentes. Se ao mover você notar ausência de FSM/idem,
   deixe `// TODO(auditoria): P1.x` e siga — não tente consertar no mesmo passo.

6. **Cada fatia é um PR pequeno, mergeável e revertível isoladamente.** Critério de "pronto" por
   fatia: `npm run typecheck` limpo + `npm run test` verde + smoke manual do fluxo tocado.

### A lição do revert `6fb79c2` (ler antes de tocar Conversas)

O commit `6fb79c2` reverteu o *read-side* da denormalização de não-lidas porque:
- `limit(50)` na lista + filtro de não-lidas client-side **escondeu** conversas não-lidas fora das 50 mais recentes;
- lista e mensagens **deixaram de carregar**.
O *write-side* (serviço/contrato/rules/`unreadCounters`) ficou **inerte e inofensivo**.

Consequências diretas para este plano:
- **Não mexer em estratégia de leitura/paginação/filtro durante a extração.** Extração move *writes* e *componentes*; **não** troca `onSnapshot`/`getDocs`/`limit`/ordenação. Otimização de leitura é outro achado (P2.1/P2.3) e outro PR.
- **Write-side pode existir mesmo sem read-side.** Um service novo pode ser fiado no caminho de escrita sem nenhuma mudança de como a UI lê — exatamente como `unreadCounter.ts` ficou inerte. Isso é o padrão seguro: o service entra primeiro, o componente passa a chamá-lo, e a leitura permanece byte-a-byte igual.
- **Filtros derivam de listas client-side hoje.** Em Conversas, filtros operam sobre o array já carregado. Qualquer extração de `filters/` deve continuar recebendo a lista completa como prop — não pode assumir que a busca virou server-side.

### Como validar cada passo (checklist genérico)

- [ ] `npm run typecheck` sem erros novos.
- [ ] `npm run test` verde (e, se a fatia toca contrato, adicionar teste em `__tests__/contracts/`).
- [ ] Diff é majoritariamente *move*: linhas removidas no monolito ≈ linhas adicionadas no arquivo novo + 1 import.
- [ ] Nenhuma query/write perdeu `where('businessId','==', ...)` / `businessId:` (grep no diff).
- [ ] Nenhuma guarda de idempotência/FSM removida (grep por `assertTransition`, `X-Idempotency-Key`, `setDoc(...{ ... }, ... )` determinístico).
- [ ] Smoke manual do fluxo tocado (ver "Smoke por arquivo" abaixo).

---

## 1. `ConversasModule.tsx` (10.910 linhas) — começar por aqui

`export default function ConversasModule()` em `:6353`. ~46 funções/componentes inline (helpers,
dialogs, panels, bubbles), **62 writes Firestore diretos**. É o de maior risco e maior retorno —
e o que já sofreu o revert. **Extrair na ordem abaixo, persistência primeiro.**

### Fase A — `lib/services/conversations/` (writes; sem tocar UI nem leitura)

Criar `lib/services/conversations/` (client-side, `'use client'`-safe, usando o `db` de
`@/lib/config/firebase`, espelhando o estilo dos serviços existentes). Extrair, **uma família de
writes por PR**, mantendo `businessId` como parâmetro:

1. **`messaging.ts`** — escrita de mensagem/otimista + update de `lastMessage`/`updatedAt` na conversa.
   (É o caminho mais sensível: foi o que quebrou no revert. Mover só o *write*; o envio real já vive
   em `app/api/conversations/send` — ver §6.)
2. **`conversationState.ts`** — `markAsRead`, mudança de `status`/`priority`/`assignedTo`, snooze,
   tags (writes em `conversations/{id}`). **Preservar `markAsRead` direto** (o revert voltou para
   markAsRead direto; não reintroduzir o caminho de contador no read-side).
3. **`routing.ts`** — persistência de `RoutingRulesDialog` (`:3702`) e SLA config (`SLASettingsDialog` `:300`).
4. **`csat.ts`** — writes de CSAT (`CSATDashboard` `:3849` é read; localizar o write de envio de pesquisa).
5. **`merge.ts`** — `MergeConversationsDialog` (`:4849`): a operação de merge é multi-doc → mover para
   service e **manter a atomicidade existente** (batch/transaction se já houver).
6. **`linkContact.ts`** — `LinkContactDrawer` (`:5750`): vínculo conversa↔cliente.
7. **`savedViews.ts`** — persistência de views salvas (`SaveViewModal` `:3543`).

Cada PR: recorta o write do componente, expõe função no service, componente passa a `await service.fn(...)`.
**A leitura (`onSnapshot`/`getDocs` da lista e das mensagens) não é tocada nesta fase.**

### Fase B — `components/` (UI pura, props-in/callbacks-out)

Mover para `app/components/features/conversations/components/` (puros, recebem dados via props,
emitem via callbacks; zero Firestore dentro):
- `MessageBubble` (`:2183`), `MessageList` (`:2400`), `QuotedMessagePreview` (`:2049`),
  `MediaAttachment` (`:1877`), `SharedContactsCard` (`:1950`), `MessageStatusIcon` (`:509`),
  `getOutboundBubbleClass` (`:2163`).
- `ThreadHeader` (`:1067`), `ConversationItem`/`ConversationItemBase` (`:553`/`:792`),
  `StatusDot`/`ChannelIcon`/`WhatsAppIcon`/`TransportBadge`.
- `AudioRecorderBar` (`:2584`), `ConversationListSkeleton` (`:5692`).
- Helpers de formatação (`relativeTime`, `fullTime`, `dateSeparatorLabel`, `isSameDay`) → `lib/utils`
  ou `components/conversations/format.ts` (não duplicar com `lib/utils/format.ts`).

### Fase C — `dialogs/`, `panels/`, `filters/`

- `dialogs/`: `SLASettingsDialog`, `IntegrationSettingsDialog` (`:807`), `RoutingRulesDialog`,
  `NewConversationDialog` (`:3939`), `TransferChannelDialog` (`:4631`), `MergeConversationsDialog`,
  `SaveViewModal`. (Cada um já recebe `onClose`/`onSaved` — fronteira limpa; o write já saiu na Fase A.)
- `panels/`: `ConversationAnalyticsPanel` (`:5032`) + `AnalyticsBar`/`DeltaArrow`/`computePeriodStats`,
  `AgentDebugDrawer` (`:6167`), `LinkContactDrawer` (`:5750`) + `ClientResultRow`/`scoreMatch`,
  `CSATDashboard`, `CampaignOriginBadge` (`:966`).
- `filters/`: `AdvancedFilterPanel` (`:3353`), `SavedViewsBar` (`:3498`), `SmartViewsBar` (`:5542`),
  `BatchActionBar` (`:3604`) + `BatchTagInput`, `countActiveFilters`, `matchesSmartView`/`isSnoozed`.
  **Continuam recebendo a lista completa de conversas como prop** (ver lição do revert).

**Meta:** shell `<800` linhas (orquestra estado/seleção e compõe componentes).

### Smoke (Conversas)
Carregar lista (todos os canais), abrir thread, enviar texto/áudio/mídia, marcar como lida,
trocar status/atribuição, aplicar filtro avançado e smart view, transferir canal, merge, link de contato.
Foco: **lista carrega, mensagens carregam, filtro de não-lidas funciona** (os 3 que o revert quebrou).

---

## 2. `webhooks/meta/route.ts` (2.264 linhas) — segundo alvo (P2.15)

Boundary mais sensível (dedup `wamid`, multi-canal). `saveInboundMessage` (`:1434`, ~566 linhas)
atende WhatsApp + Facebook + Instagram no mesmo corpo.

### Ordem
1. **Extrair utilitários de mídia primeiro** (puros, sem branching de canal):
   `downloadAndUploadMedia` (`:97`), `downloadAndUploadAttachment` (`:294`), `convertAudioToM4a` (`:252`),
   `mimeToExtension` (`:215`), `logMediaFailure` (`:67`) → `lib/channels/media-enrichment.ts` já existe;
   consolidar lá (não criar duplicata).
2. **Extrair tokens/contexto:** `getWhatsAppAccessToken` (`:348`), `getDecryptedPageToken` (`:1385`),
   `resolveChannelContext` (`:1134`), `resolveBusinessId` (`:1177`), `fetchSenderProfile` (`:1290`),
   `persistProfilePic` (`:1251`) → `lib/channels/shared/` (resolução de tenant; **R1: `businessId`
   resolvido aqui é a raiz do isolamento — testar com cuidado**).
3. **Decompor `saveInboundMessage` em pipeline por etapa** (não por canal ainda):
   `normalize → dedup(wamid/externalMessageId) → persist → postProcess`. Manter a dedup **exatamente**
   no mesmo ponto (R3 — é o que impede mensagem duplicada). Extrair `extractMessageContent` (`:2201`).
4. **Separar por canal:** `lib/channels/whatsapp/inbound.ts` (de `handleWhatsAppEvent` `:589`),
   `lib/channels/facebook/inbound.ts` (`handleFacebookEvent` `:738`),
   `lib/channels/instagram/inbound.ts` (`handleInstagramEvent` `:939`). A `route.ts` vira **dispatcher
   fino**: `GET` (verify), `POST` (verify assinatura → rate-limit → dispatch por `entry`).
5. Status updates (`updateMessageStatus` `:2000`, `updateBroadcastMessageStatus` `:2102`,
   `updateBirthdayCampaignLogStatus` `:2157`) → `lib/channels/shared/statusUpdates.ts`.

### Cuidados específicos (R3/R1)
- **Não tocar** ordem: verify de assinatura (`verifySignatureFromBuffer` `:499`) → dedup → persist.
  Inverter isso é o risco do achado P2.18, **mas** corrigir P2.18 não é esta tarefa — só **não regredir**.
- A dedup por `wamid`/`externalMessageId` é a única proteção contra reentrega da Meta. Ao mover o
  persist para o service, a chave de dedup **acompanha o write** (não fica órfã na route).
- Cada canal preserva sua resolução de `businessId` (R1).

### Smoke (webhook Meta)
Replay de payload real de cada canal (WhatsApp texto/mídia/áudio/status, FB, IG), confirmar:
1 mensagem persistida (não duplicada em reentrega do mesmo `wamid`), mídia no Storage, profile pic,
status update propagado. Usar payloads de `__tests__`/fixtures se existirem; senão, capturar de log.

---

## 3. `conversations/send/route.ts` (1.391 linhas) — par do webhook (P2.15)

`POST` (`:163`, ~473 linhas) + senders por canal já são funções separadas no arquivo:
`sendWhatsAppBaileys` (`:636`), `sendWhatsApp` (`:849`), `sendFacebookMessenger` (`:951`),
`sendInstagram` (`:1203`), `convertAudio` (`:1025`), `prepareAudioForChannel` (`:1180`),
`needsAudioConversion` (`:1164`), `saveAgentMessage` (`:1287`), `updateMessageAfterSend` (`:1337`),
`handleMetaApiError` (`:83`).

### Ordem
1. **Áudio compartilhado:** `convertAudio`/`prepareAudioForChannel`/`needsAudioConversion` →
   `lib/channels/shared/audio.ts` (reuso com o inbound do webhook).
2. **Senders por canal:** mover cada `send*` para `lib/channels/{whatsapp,facebook,instagram}/outbound.ts`.
   `sendWhatsAppBaileys` → `lib/channels/whatsapp/outbound.ts` (ao lado de `sendWhatsApp`, Cloud API).
3. **Persistência pós-envio:** `saveAgentMessage` + `updateMessageAfterSend` →
   `lib/channels/shared/outboundPersist.ts` (espelha o que será o persist do inbound — manter R1).
4. **`route.ts` vira dispatcher:** valida payload no boundary (R6), resolve canal, chama
   `outbound[channel].send(...)`, persiste. `handleMetaApiError` → `lib/channels/shared/metaErrors.ts`.

### Cuidados
- O envio é **idempotente por natureza do caller** (UI bloqueia duplo-clique), mas se houver chave/dedup
  no save, preservá-la (R3). Não introduzir nova idempotência aqui (fora de escopo).
- Manter contrato de `Request`/`Response` da rota idêntico (clients da UI dependem do shape).

### Smoke (send)
Enviar por cada canal (WhatsApp Cloud, WhatsApp Baileys, FB, IG), texto + áudio (conversão),
confirmar mensagem persistida com status correto e tratamento de erro Meta inalterado.

---

## 4. `SettingsModule.tsx` (7.746 linhas) — extração de abas (padrão já existente)

A pasta `settings/` **já tem o padrão** (`AuditoriaTab.tsx`, `QuickRepliesTab.tsx`,
`BusinessChannelsSection.tsx`, etc.). 8+ tabs inline + **28 writes**.

### Ordem (uma aba por PR, da menos arriscada para a mais)
1. `ProfileTab` (`:265`) + seções de calendário `GoogleCalendarSection` (`:890`) / `AppleCalendarSection` (`:988`).
2. `SectorsTab` (`:4914`), `ModoSistemaTab` (`:4750`).
3. `EmpresaTab` (`:1213`), `UsersTab` (`:2904`).
4. `AgenteTab` (`:3939`), `EnterpriseTab` (`:5389`).
5. `FiscalTab` (`:1933`) — mais sensível (certificado/sequência fiscal); por último.
6. `CanaisTab` (`:6333`) — já apoia em `BusinessChannelsSection`/`WhatsAppProfileSection`; consolidar.

Cada aba vira `settings/{Nome}Tab.tsx`. **Writes da aba** (ex.: salvar perfil, empresa, setor) →
extrair para `lib/services/settings/` **se** o write for não-trivial (multi-doc) ou reusado;
para um `updateDoc` simples e local, mover junto com a aba é aceitável (o ganho de service isolado
é menor). **R1:** todo write de settings grava sob `businesses/{id}` ou `users/{uid}` com `businessId`.

### Cuidado específico (`getMemberDisplayStatus` — P2.14)
`SettingsModule:2883` redefine `getMemberDisplayStatus`. Ao extrair `UsersTab`, **não copiar** a
duplicata — apontar para a futura `lib/utils/presence.ts` (P2.14). Se `presence.ts` ainda não existir
no momento da fatia, deixar `// TODO(auditoria): P2.14 usar lib/utils/presence.ts` e manter a cópia
local sem alterá-la.

**Meta:** shell de navegação `<300` linhas (tabs + roteamento de aba).

### Smoke (Settings)
Abrir cada aba extraída, salvar uma alteração (perfil, empresa, setor, usuário, fiscal, canal),
recarregar e confirmar persistência. Dark mode em cada aba.

---

## 5. `FinancialModule.tsx` (6.605 linhas) — `*Content` → tabs + writes

`FinancialModuleBody` (`:262`, ~2.3k linhas) compõe os `*Content`. **31 writes**.
A pasta já tem `ConciliacaoTab.tsx`, `ProjetosTab.tsx`, `RecurrenceDetailDialog.tsx`.

### Ordem
1. **Writes → `lib/services/financial/`** (persistência primeiro):
   - `transactions.ts` — create/update/delete de Transaction (de `TransactionsContent` `:4043`).
     **R4/P1.9:** Transaction muda `status` (`pago`/`cancelado`) sem FSM hoje. **Não introduzir FSM
     aqui** (é P1.9); só mover o write. Deixar `// TODO(auditoria): P1.9 fsm/transaction.ts`.
   - `commissions.ts` (de `CommissionsContent` `:4782`).
   - `bankAccounts.ts` (de `BankAccountsContent` `:5158`).
   - `recurrence.ts` — **consolidar com P2.14**: `computeNextDueDate`/`adjustForBusinessDay` estão
     duplicados/divergentes entre `FinancialModule:204-261` e `RecurrenceDetailDialog`. Ao extrair
     `RecurringContent` (`:5341`), criar `lib/services/recurrence.ts` como **fonte única** (com
     `BR_HOLIDAYS`) — mas isso é P2.14: se o escopo da fatia for só o move, deixar
     `// TODO(auditoria): P2.14` e mover a cópia atual sem unificar.
2. **`*Content` → `financial/tabs/`:** `OverviewContent` (`:2618`), `TransactionsContent`,
   `CommissionsContent`, `BankAccountsContent`, `RecurringContent`. Cada um recebe dados via props,
   chama os services da etapa 1.
3. **Quebrar `FinancialModuleBody`** no shell que carrega/seleciona aba e distribui dados.

### Cuidado (P0/listeners)
`FinancialModule:576` tem listener full em `clients` e janela de `transactions` (P2.1/P0). **Não
mexer na estratégia de leitura** durante a extração — mover o componente preservando o `onSnapshot`
como está. Otimização de leitura é outro achado.

**Meta:** `FinancialModuleBody` deixa de ter ~2.3k linhas; cada tab `<800`.

### Smoke (Financial)
Criar/editar/cancelar transação, ver comissões, conta bancária, criar recorrência e verificar
próxima data (cuidado com divergência de feriado — confirmar que persistida == projetada),
overview com KPIs. CurrencyToggle.

---

## 6. `CRMModule.tsx` (5.036 linhas) — tabs + FormDialogs

`CampaignsTab` (`:1573`, ~2k linhas), `SegmentsTab` (`:1031`), `MetricsTab` (`:517`), e os
FormDialogs (`ContactFormDialog` `:150`, `DealFormDialog` `:335`, `ActivityFormDialog` `:403`,
`DeleteConfirmDialog` `:496`). **28 writes**. Pasta já rica em componentes extraídos.

### Ordem
1. **Writes → `lib/services/crm/`** (persistência primeiro): create/update/delete de
   contact/deal/activity, e os writes de campanha de `CampaignsTab`. **R1** em cada (`businessId`).
   **R4:** `closeDeal` muda status de deal — se houver FSM de deal, preservar; se não, não introduzir
   (deixar `// TODO(auditoria)` se notar ausência). Não tocar P2.10 (FKs de resultado) aqui.
2. **FormDialogs → `crm/dialogs/`:** `ContactFormDialog`, `DealFormDialog`, `ActivityFormDialog`,
   `DeleteConfirmDialog` (genérico — candidato a `shared/`).
3. **Tabs → arquivos próprios:** `MetricsTab` (puro, só leitura/derivação — baixo risco, fazer primeiro),
   `SegmentsTab`, depois `CampaignsTab` (o maior; quebrar em sub-blocos de criação/listagem/detalhe,
   apoiando nos dialogs já existentes `BroadcastDetailDialog`, `BirthdayCampaignDialog`).
4. **Shell de abas** orquestra navegação e dados compartilhados.

**Meta:** `CampaignsTab` deixa de ter ~2k linhas; shell `<400`.

### Smoke (CRM)
CRUD de contato/deal/activity, mover deal no pipeline, criar segmento, criar/enviar campanha
(broadcast/aniversário), métricas. Filtro por setor (`userSectorIds`).

---

## 7. Sequenciamento global recomendado

Alinhado à §9 (Sprint 5+: "começar por ConversasModule e webhooks/meta, extraindo writes para
`lib/services/` antes da UI"):

| Ordem | Alvo | Por quê primeiro |
|---|---|---|
| 1 | `webhooks/meta` + `conversations/send` (Fase persistência → canais) | Backend, sem UI; senders já são funções separadas → menor risco; cria `lib/channels/{wa,fb,ig}/{inbound,outbound}.ts` que vira base. |
| 2 | `ConversasModule` Fase A (writes → `lib/services/conversations/`) | Maior risco (revert) → write-side primeiro, leitura intocada. |
| 3 | `ConversasModule` Fases B/C (componentes/dialogs/panels/filters) | Só depois que os writes saíram. |
| 4 | `SettingsModule` (abas, padrão já existe) | Baixo acoplamento entre abas; fácil de fatiar. |
| 5 | `FinancialModule` (writes → tabs) | Toca dinheiro; cuidado com listeners e P1.9/P2.14 (não corrigir, só não regredir). |
| 6 | `CRMModule` (writes → dialogs → tabs) | Pasta já tem muitos componentes; menor monolito restante. |

**Regra de ouro:** nunca misturar, no mesmo PR, "mover write para service" com "otimizar leitura"
ou "corrigir FSM/idempotência". Cada um é um achado distinto e um PR distinto. Misturar foi o que
produziu o revert `6fb79c2`.

---

## 8. O que esta refatoração NÃO faz (fora de escopo, têm achado próprio)

- **Não** otimiza leitura/paginação/filtro (P2.1, P2.2, P2.3, P2.4).
- **Não** introduz idempotência onde falta (P1.8, P2.12, P2.17 — R3).
- **Não** introduz FSM onde falta (P1.9 — R4); só preserva o que existe.
- **Não** corrige descarte silencioso do webhook (P2.18) nem dedup — só **não regride** a ordem verify→dedup→persist.
- **Não** unifica `getMemberDisplayStatus`/recorrência (P2.14) por conta própria; aponta para o
  futuro `lib/utils/presence.ts` / `lib/services/recurrence.ts` e deixa `// TODO(auditoria): P2.14`
  quando esses ainda não existirem.
- **Não** adiciona FKs de resultado entre módulos (P2.10).

Cada um desses, se cruzado durante o move, recebe um `// TODO(auditoria): Px.y <descrição>` e a fatia
segue como move puro.
