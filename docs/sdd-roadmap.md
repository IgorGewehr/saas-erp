# SDD Roadmap — ServicePro

> Ordem de adoção de contratos. Marque o estado conforme avançar.
> Cada fase tem critério de pronto explícito — sem isso, IA fica adivinhando o que falta.

## Fase 0 — Infra (prereq) ✅ COMPLETO

- [x] `npm install zod @asteasolutions/zod-to-openapi`
- [x] `tsconfig.json` paths: `"@/contracts/*": ["./lib/contracts/*"]`
- [x] `lib/contracts/README.md` + templates em `_template/`
- [x] `lib/contracts/_runtime/withContract.ts` — wrapper que valida req/res numa route
- [x] `lib/contracts/api/_envelope.ts` — ErrorEnvelope + IdempotencyHeaderSchema compartilhados
- [ ] Script `pnpm contracts:openapi` que gera `docs/openapi.json` (não bloqueante)

## Fase 1 — AI Agent tools (output schemas) ✅ COMPLETO

**Por que primeiro:** hoje o executor Python recebe `dict` cru. LLM trabalha em cima de output não validado. Adicionar schema de output fecha o gap G6 e dá segurança imediata. ~80 actions distribuídas em 17 domains + 1 send-interactive + 6 endpoints infra.

**Tasks:**
- [x] `lib/contracts/api/agent/_shared.ts` — enums compartilhados + headers HMAC + helpers de envelope
- [x] `lib/contracts/api/agent/{17 domains}.ts` — ParamsSchema + ResponseDataSchema por action
- [x] `lib/contracts/api/agent/send-interactive.ts` (formato especial sem `action`)
- [x] `lib/contracts/api/agent/_routes.ts` — endpoints não-tool (runs, budget, circuit, operator/chat, scheduled/run, memory/admin)
- [x] `lib/contracts/api/agent/index.ts` — barrel + AGENT_TOOLS_REGISTRY com lookup por (domain, action)
- [x] `lib/contracts/_runtime/agentToolValidation.ts` — `parseToolRequest` + `validateToolResponse`
- [x] **PILOTO**: `app/api/agent/tools/agenda/route.ts` valida request + response
- [x] **PYTHON**: `agent/app/tools/contracts/{__init__,agenda}.py` — Pydantic models + validação no executor (`client.py:call_tool`)

**Estado:** typecheck limpo. Próximas tools que ganharem Pydantic entram em `agent/app/tools/contracts/{domain}.py` + registry. Codegen Zod→Pydantic é trabalho futuro.

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
- [x] `domain/tableSession.ts` + `fsm/tableSession.ts` — comanda de mesa do salão (`aberta→fechada→paga|cancelada`). Invariantes de fechamento/pagamento; `settle` marca pedidos `entregue` com `settledViaSaleId` (receita única no PDV). Ver `docs/paridade/M02_MESAS_COMANDA.md`.
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
- [x] `_runtime/webhookIdempotency.ts` — `markWebhookSeen()` atômico via `.create()` em `webhookSeen/{businessId}_{externalMessageId}` TTL 24h.
- [ ] **Próximo**: aplicar contratos nas routes `app/api/webhooks/meta/route.ts` e `app/api/webhooks/facebook/route.ts` (substituir fuzzy phone duplicado + adicionar dedup via `markWebhookSeen`).
- [ ] **Próximo**: testes unitários em `__tests__/contracts/phone-br.spec.ts` cobrindo casos surreais BR.

**Critério de pronto (parcial):** schemas + canonicalização BR + helper de dedup prontos; substituição nas routes é incremental.

## Fase 4 — Eventos cross-módulo (fecha G5) ✅ FRAMEWORK COMPLETO

**Por que:** Gaps documentados — Booking IA → CRM, FormResponse → Client, Appointment.completed → commission, Broadcast.replied → Lead status. Hoje são side-effects implícitos em vários lugares ou simplesmente esquecidos.

**Tasks:**
- [x] `events/index.ts` — **10 eventos** declarados via discriminated union: `appointment.completed`, `appointment.canceled`, `booking.created`, `form.submitted`, `broadcast.replied`, `sale.finalized`, `client.created`, `deliveryOrder.confirmed`, `purchase.imported`, `conversation.reopened`. Cada evento documenta no jsdoc quem reage.
- [x] `_runtime/dispatch.ts` — `dispatchDomainEvent()` síncrono. Valida via Zod (fail-fast), persiste em `domainEvents/{id}` com `status: dispatched → processed`, chama handlers em série, agrega resultados por handler. Falha de handler não derruba o caller.
- [x] `_runtime/handlers/index.ts` — `ensureDomainEventHandlers()` idempotente. Chame uma vez no bootstrap (ex: `instrumentation.ts`).
- [x] `_runtime/handlers/appointmentCompleted.ts` — PILOTO. Atualiza métricas do cliente (visitCount, totalSpent, lastVisit). Demais subscribers (commission, loyalty, GCal sync) seguem em `lib/services/*` até migração completa de AgendaModule.
- [ ] **Próximo**: migrar `AgendaModule.tsx:handleSaveAppointment` para emitir `appointment.completed` via dispatch em vez de chamar inline `maybeCreateCommission`, `addLoyaltyPoints`, `syncToGoogleCalendar`. Mover essas chamadas para novos handlers.
- [ ] **Próximo**: chamar `ensureDomainEventHandlers()` em `instrumentation.ts`.
- [ ] **Próximo**: documentar no `architecture-map.md` quem emite e quem reage a cada evento.

**Critério de pronto (parcial):** ✅ framework + piloto prontos. Adoção nos callers é incremental.

## Fase 5 — Demais módulos (em ordem decrescente de risco)

1. **Fiscal** — SEFAZ é o lugar onde estado errado vira problema legal. FSM + idempotency.
2. **CRM (Clients/Deals/Segments)** — agora consome `client.created`/`booking.created` da fase 4.
3. **Broadcasts + Birthday Campaigns** — schema de SendThrottle, LGPD `consentBasis` obrigatório.
4. **Financeiro** — Transaction + reconciliação + (quando habilitar) PIX/Boleto/Open Banking.
5. **Agenda + Services** — appointments, recorrência, conflict detection.
6. **Kanban, Notas, Forms, Reviews, Spreadsheets, Vault** — schemas de domínio + API v1.

## Anti-padrões a evitar enquanto adota

- ❌ Criar contrato Zod e ainda manter interface TS paralela. Use `z.infer`.
- ❌ Validar no client e esquecer no server. Validação obrigatória **no server**, opcional no client (UX).
- ❌ "Vou adicionar contrato depois" em PR de feature nova. Schema vem primeiro.
- ❌ Reusar enum de string solta em vez de importar do schema. Sempre `import { X_STATUSES } from '@/contracts/domain/x'`.

## Métricas para acompanhar

- % de routes em `app/api/v1/*` com contrato → meta 100% até final da Fase 5.
- % de actions de `/api/agent/tools/*` com response schema → meta 100% até fim da Fase 1.
- Tickets de bug categorizados por gap (G1–G6) → cair >50% ao concluir Fase 4.
