# SDD Roadmap — ServicePro

> Ordem de adoção de contratos. Marque o estado conforme avançar.
> Cada fase tem critério de pronto explícito — sem isso, IA fica adivinhando o que falta.
>
> **Reconciliado em 08/09/2026 (M00)**: este documento estava significativamente desatualizado
> — vários itens marcados "Próximo" (não feito) já tinham sido entregues em fatias anteriores da
> iniciativa de paridade (M06, M07, M09, M11), sem o doc ser atualizado no momento. Reconciliado
> por leitura de código, não por memória — ver cada item abaixo.

## Fase 0 — Infra (prereq) ✅ COMPLETO

- [x] `npm install zod @asteasolutions/zod-to-openapi`
- [x] `tsconfig.json` paths: `"@/contracts/*": ["./lib/contracts/*"]`
- [x] `lib/contracts/README.md` + templates em `_template/`
- [x] `lib/contracts/_runtime/withContract.ts` — wrapper que valida req/res numa route
- [x] `lib/contracts/api/_envelope.ts` — ErrorEnvelope + IdempotencyHeaderSchema compartilhados
- [ ] Script `pnpm contracts:openapi` que gera `docs/openapi.json` (não bloqueante)

## Fase 1 — AI Agent tools (output schemas) ✅ COMPLETO (TS e Python)

**Por que primeiro:** hoje o executor Python recebe `dict` cru nos domínios ainda não portados.
LLM trabalha em cima de output não validado nesses casos. Adicionar schema de output fecha o gap
G6 e dá segurança imediata. ~80 actions distribuídas em 20 domains + 1 send-interactive + 6
endpoints infra.

**Tasks:**
- [x] `lib/contracts/api/agent/_shared.ts` — enums compartilhados + headers HMAC + helpers de envelope
- [x] `lib/contracts/api/agent/{20 domains}.ts` — ParamsSchema + ResponseDataSchema por action
- [x] `lib/contracts/api/agent/send-interactive.ts` (M11, 08/09/2026: registrado em
      `AGENT_TOOL_DOMAINS` e wireado na rota — antes tinha o arquivo de contrato mas não estava
      ligado a nada; literal de action corrigido de `'send'` pra `'send_interactive'`, verificado
      contra `agent/app/tools/client.py`)
- [x] `lib/contracts/api/agent/_routes.ts` — endpoints não-tool (runs, budget, circuit, operator/chat, scheduled/run, memory/admin)
- [x] `lib/contracts/api/agent/index.ts` — barrel + AGENT_TOOLS_REGISTRY com lookup por (domain, action)
- [x] `lib/contracts/_runtime/agentToolValidation.ts` — `parseToolRequest` + `validateToolResponse`
- [x] **TODAS as 21 rotas de tool** (`app/api/agent/tools/*/route.ts`) validam request + response
      — M11 (07/09/2026) estendeu de 4/21 (`agenda`/`financial`/`fiscal`/`reports`) pra 21/21,
      encontrando e corrigindo ~10 divergências reais entre contrato e handler no caminho (ver
      `docs/agente/AGENTE_M11_FIXES.md`). O "PILOTO" original (`agenda`) foi só o primeiro de 21,
      não o único.
- [x] **PYTHON** (`agent/app/tools/contracts/`): **M11.1b concluído em 08/09/2026** — todos os
      20 domínios + `send-interactive` (21 no total) agora têm Pydantic. Os 16 restantes além
      dos 4 originais (`agenda`/`orders`/`clients`/`sales`) foram portados nesta sessão, cada um
      traduzido fielmente do contrato TS já auditado em M11 (não re-derivado independente).
      108 modelos ao todo, todos verificados (`model_json_schema()` resolve sem erro pra cada
      um; round-trip de payload de amostra testado nos casos especiais — `_score` em campos de
      busca, o tool `conversation_send_interactive` de namespace irregular, `purchase-notes`
      com hífen no nome da tool). `get_response_model()` refatorado de uma cadeia if/elif de 21
      ramos pra um dict-of-dicts (`_REGISTRY`), mais fácil de manter.

**Estado:** typecheck TS limpo. Lado TS 100% completo (20 domínios + send-interactive). Lado
Python 100% completo (21/21) — Fase 1 fecha por completo.

## Fase 2 — Vendas / Pedidos / Estoque ✅ SCHEMAS COMPLETOS

**Por que:** Resolve G1+G2+G3 num lugar onde dado errado custa dinheiro.

**Tasks:**
- [x] `domain/sale.ts` — invariantes: `subtotal===sum(items.total)`, `total===subtotal-discount+tip`, `sum(payments)≈total` quando finalizada.
- [x] `domain/order.ts` — Order B2B/condicional. `type=condicional ⇒ conditionalExpiresAt` obrigatório.
- [x] `domain/deliveryOrder.ts` — `total≈subtotal+deliveryFee-discount`, `deliveryType=entrega ⇒ deliveryAddress`, `status=entregue ⇒ deliveredAt`.
- [x] `domain/product.ts` — BOM (`components[]` sem auto-ref, mutex com `maxStock`) + ModifierGroups (`required ⇒ minSelections>=1`).
- [x] `domain/stockMovement.ts` — invariante: `newStock === previousStock ± quantity` por type.
- [x] `domain/purchaseNote.ts` — `importada ⇒ stockImportedAt`; `stockImportedAt ⇒ status=importada` (idempotência).
- [x] `fsm/sale.ts`, `fsm/order.ts`, `fsm/deliveryOrder.ts`, `fsm/purchaseNote.ts` com `assertTransition` + side-effects documentados.
- [x] `api/v1/sales.ts`, `products.ts`, `stock-movements.ts`, `services.ts` — Request/Response + IdempotencyHeader.
- [x] `api/orders/public.ts` — schema do payload anônimo + `clientExpectedTotal` (server recomputa).
- [x] `_runtime/bom.ts` — `expandBomLines()` + `checkBomAvailability()` + `buildProductIndex()` unificados (fecha G4).
- [ ] **Próximo**: refactor `lib/services/stock.ts` e `stock-admin.ts` consumirem `_runtime/bom.ts`.
- [ ] **Próximo**: idempotency middleware (`X-Idempotency-Key` → `idempotencyKeys/{businessId}_{key}`).
- [x] `lib/services/stock.ts` e `stock-admin.ts` consumindo `_runtime/bom.ts` (duplicação removida)
- [x] `lib/contracts/_runtime/idempotency.ts` — `withIdempotency()` com tabela `idempotencyKeys/{businessId}_{key}` TTL 24h
- [x] `app/api/v1/sales/route.ts` — POST validado por `CreateSaleBodySchema` + idempotency-key + invariante cross-field (sum(payments)≈total)

**Critério de pronto:** ✅ pipeline POST `/api/v1/sales` valida via Zod, replay com mesma idempotency-key retorna `_idempotent: true`.

## Fase 3 — Conversations + Webhooks ✅ SCHEMAS COMPLETOS

**Por que:** É a porta de entrada mais usada. Hoje fuzzy phone BR é replicado em ≥2 lugares e webhook Meta pode duplicar mensagem em retry.

**Tasks:**
- [x] `domain/conversation.ts` — invariantes: `connectedVia=baileys ⇒ channelOwnerType=user`; `embedded_signup ⇒ business`; `channelOwnerType=user ⇒ channelOwnerId obrigatório`.
- [x] `domain/conversationMessage.ts` — invariantes: `direction=inbound ⇒ externalMessageId obrigatório` (base da idempotência), `content OR mediaUrl`, `mediaUrl ⇒ mediaType`, `isInternal ⇒ outbound`.
- [x] `domain/channelConnection.ts` — invariantes: `ownerType=user só para baileys`, cada `type` exige seu bloco de credenciais.
- [x] `fsm/conversation.ts` — open ↔ waiting ↔ resolved; reabertura por inbound.
- [x] `api/webhooks/meta.ts` — discriminated union do `object` (whatsapp_business_account | page | instagram); shapes de message/status/contact + header `X-Hub-Signature-256`.
- [x] `_runtime/phone-br.ts` — `canonicalizeBr`, `alternativeBrPhone` (com/sem 9), `brPhoneCandidates` (3 variações), `brPhonesMatch`. Resolve duplicação client/server.
- [x] `_runtime/webhookIdempotency.ts` — `markWebhookSeen()` atômico via `.create()` em `webhookSeen/{businessId}_{externalMessageId}` TTL 24h. **M10.7 (08/09/2026)**: ganhou purga real —
      `app/api/webhooks/cron/purge-seen/route.ts`, cron diário, os docs vencidos nunca eram
      apagados antes disso.
- [x] `app/api/webhooks/meta/route.ts` usa `markWebhookSeen` (dedup real por `wamid`/`mid`) —
      confirmado por leitura de código (08/09/2026), este item estava marcado "Próximo" mas já
      tinha sido feito numa fatia anterior (provavelmente M07).
- [ ] `app/api/webhooks/facebook/route.ts` **ainda não confirmado** se usa `markWebhookSeen` —
      este arquivo é candidato a código morto (M07 achou zero evidência de uso real, aguardando
      o usuário confirmar no Meta App Dashboard antes de tocar nele — ver
      `docs/paridade/M07_PLANO_IMPLEMENTACAO.md`). Não mexer até essa confirmação.
- [x] **Feito em 08/09/2026**: `tests/contracts/phone-br.test.ts` (23 testes) — cobre
      `digitsOnly`/`canonicalizeBr`/`alternativeBrPhone`/`brPhoneCandidates`/`brPhonesMatch`
      isoladamente, incluindo o comportamento conhecido do fallback de últimos-8-dígitos (2
      números com DDD diferente mas mesmo número local dão MATCH — documentado no teste, não é
      bug).

**Critério de pronto:** ✅ `markWebhookSeen` aplicado nos 2 canais WhatsApp reais — Cloud API
(`app/api/webhooks/meta/route.ts`) e Baileys (`app/api/whatsapp/baileys-manager.ts`, M07.2,
substituiu um check-then-act com race condition). Só falta Facebook/Instagram, condicionado à
confirmação de que a rota é realmente usada (ver acima).

## Fase 4 — Eventos cross-módulo (fecha G5) ✅ COMPLETO (reconciliado 08/09/2026)

**Por que:** Gaps documentados — Booking IA → CRM, FormResponse → Client, Appointment.completed → commission, Broadcast.replied → Lead status. Hoje são side-effects implícitos em vários lugares ou simplesmente esquecidos.

**Tasks:**
- [x] `events/index.ts` — **10 eventos** declarados via discriminated union: `appointment.completed`, `appointment.canceled`, `booking.created`, `form.submitted`, `broadcast.replied`, `sale.finalized`, `client.created`, `deliveryOrder.confirmed`, `purchase.imported`, `conversation.reopened`. Cada evento documenta no jsdoc quem reage.
- [x] `_runtime/dispatch.ts` — `dispatchDomainEvent()` síncrono. Valida via Zod (fail-fast), persiste em `domainEvents/{id}` com `status: dispatched → processed`, chama handlers em série, agrega resultados por handler. Falha de handler não derruba o caller.
- [x] `_runtime/handlers/index.ts` — `ensureDomainEventHandlers()` idempotente. **Confirmado chamado** em `instrumentation.ts` (e também, defensivamente, em `app/api/appointments/[id]/transition/route.ts` e `app/api/events/dispatch/route.ts`) — este item estava marcado "Próximo" mas já tinha sido feito.
- [x] `_runtime/handlers/appointmentCompleted.ts` — não é mais só o piloto de métricas: hoje
      também cria comissão (`maybeCreateCommissionAdmin`) e credita fidelidade
      (`addLoyaltyPointsAdmin`), migrados de `AgendaModule.tsx` na fatia M06.2 desta sessão
      (`docs/agenda/AGENDA_HARDENING_EFEITOS_SERVIDOR.md`). **GCal sync deliberadamente ficou
      client-side** — não é side-effect de completar um atendimento, é sync de CRUD do
      agendamento em si (create/update/delete, `AgendaModule.tsx` chama `syncToGoogleCalendar`
      diretamente nesses 3 pontos), lifecycle diferente do evento `appointment.completed`. Não é
      lacuna, é modelagem correta — o doc antigo agrupava os 3 incorretamente como se fossem o
      mesmo tipo de efeito.
- [x] `_runtime/handlers/appointmentCanceled.ts` / `appointmentNoShow.ts` — também entregues em
      M06 (reversão de comissão/métricas ao cancelar um `concluido`; incremento de
      `Client.relationshipHistory.noShowCount` ao marcar falta).
- [ ] **Ainda não feito**: documentar no `architecture-map.md` quem emite e quem reage a cada
      evento — os 10 eventos e handlers existem e funcionam, mas não há uma tabela central
      resumindo emissor→evento→handler(s) fora do jsdoc de `events/index.ts`. Cosmético/
      navegabilidade, não um gap funcional.

**Critério de pronto:** ✅ framework completo, 4 handlers reais em produção (client metrics,
comissão, fidelidade, no-show), `ensureDomainEventHandlers()` chamado no bootstrap. Só falta a
tabela-resumo de documentação.

## Fase 5 — Demais módulos (em ordem decrescente de risco)

**Reconciliado em 08/09/2026** — a maior parte desta fase avançou como efeito colateral do
trabalho de hardening da iniciativa de paridade (M03/M06/M07), não como um esforço SDD dedicado
— confirmado lendo `lib/contracts/domain/`/`fsm/` diretamente, não assumindo pelo nome do módulo.

1. **Fiscal** — 🟡 parcial: `fsm/fiscalDocument.ts` existe e está em uso real (emissão/
   cancelamento com FSM). Sem `domain/fiscalDocument.ts` Zod formal ainda (schema de request/
   response vive em `lib/contracts/api/agent/fiscal.ts` e nas rotas, não centralizado como
   domínio próprio).
2. **CRM (Clients/Deals/Segments)** — 🔴 ainda não iniciado no nível de contrato formal (sem
   `domain/client.ts`/`deal.ts`/`segment.ts`). As features funcionam (M05 confirmou cadastro
   unificado, dedup, segmentos dinâmicos, tudo real), só não tem Zod schema de domínio ainda.
   `client.created`/`booking.created` (Fase 4) são consumidos via `lib/services/`, não via um
   contrato de domínio de Client.
3. **Broadcasts + Birthday Campaigns** — 🟡 parcial: LGPD `consentBasis`/opt-out são **de fato
   obrigatórios e enforced** (confirmado por M07 e M10.4/M10.5 — CAS transacional, fail-closed,
   automações CRM e `sendFinancialNotifications` também passaram a checar opt-out nesta sessão),
   mas sem um `domain/broadcast.ts` Zod formal centralizando isso — a garantia vive espalhada em
   `lib/services/`, não num contrato único.
4. **Financeiro** — ✅ feito: `domain/transaction.ts` (M03.1, invariantes de parcelamento) +
   `fsm/transaction.ts` (M03.2/M03.4, aplicado até em `firestore.rules`). PIX/Boleto/Open
   Banking continuam 100% stub, deliberadamente fora de escopo até sinal de demanda real.
5. **Agenda + Services** — ✅ feito: `domain/appointment.ts` + `domain/service.ts` +
   `domain/scheduleBlock.ts` + `fsm/appointment.ts`, todos em uso real desde M06 (núcleo
   transacional, conflict detection com bloqueios/buffer, FSM aplicado no servidor).
6. **Kanban, Notas, Forms, Reviews, Spreadsheets, Vault** — 🔴 ainda não iniciado — sem
   `domain/*` nem `fsm/*` pra nenhum desses. Features funcionam (confirmado em M09), só sem
   contrato formal.

## Anti-padrões a evitar enquanto adota

- ❌ Criar contrato Zod e ainda manter interface TS paralela. Use `z.infer`.
- ❌ Validar no client e esquecer no server. Validação obrigatória **no server**, opcional no client (UX).
- ❌ "Vou adicionar contrato depois" em PR de feature nova. Schema vem primeiro.
- ❌ Reusar enum de string solta em vez de importar do schema. Sempre `import { X_STATUSES } from '@/contracts/domain/x'`.

## Métricas para acompanhar

- % de routes em `app/api/v1/*` com contrato → meta 100% até final da Fase 5.
- % de actions de `/api/agent/tools/*` com response schema → meta 100% até fim da Fase 1.
- Tickets de bug categorizados por gap (G1–G6) → cair >50% ao concluir Fase 4.
