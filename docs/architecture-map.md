# Mapa Arquitetural — ServicePro

> Fonte densa de referência. CLAUDE.md aponta pra cá quando precisar de detalhe.
> Atualize quando criar/remover módulo. Mantenha tabelas — IA navega melhor.

## Camadas

```
Client (Next.js 15 App Router)
  └─ app/components/features/* ── AuthProvider ── Firestore (client SDK)

Next.js Backend
  ├─ /api/v1/*         Public API (Bearer SaasApiKey, scopes)
  ├─ /api/agent/*      AI Agent contracts (HMAC bidirecional)
  ├─ /api/webhooks/*   Meta WhatsApp Cloud / FB / IG
  ├─ /api/whatsapp/*   Baileys (sessão local in-memory)
  └─ /api/{booking,broadcasts,orders/public,calendar,forms}/*   Públicas

Firebase
  ├─ Auth, Firestore (~40 coleções), Storage
  └─ Rules ~1500 linhas, indexes ~47KB

Python Agent (/agent)
  └─ FastAPI + LangGraph 5 nodes (router→planner→executor↔reflection↔planner→responder)
     OpenAI only. Tools via HTTP HMAC pra Next.js. Memory + circuit breaker em Firestore.

External
  Meta Graph │ Baileys │ Stripe │ SEFAZ │ GCal │ Resend │ AWS │ CF │ Sentry │ Vercel │ Supabase │ GoDaddy
```

## Inventário de módulos

| Módulo | UI principal | Coleções primárias | Side-effects críticos |
|---|---|---|---|
| Vendas / PDV | `app/components/features/pdv/PDVModule.tsx` | sales, products, stockMovements, transactions | deductStock + Transaction + NFC-e + loyalty + giftCard (batch) |
| Pedidos | `app/components/features/orders/OrdersModule.tsx` | deliveryOrders, products, stockMovements | FSM 6 estados; `/api/orders/public` é entrada anônima rate-limited |
| Estoque | `app/components/features/inventory/InventoryModule.tsx` | products (com `components[]` BOM, `modifierGroups`), stockMovements | Catálogo apenas |
| Compras | `app/components/features/purchases/ComprasModule.tsx` | purchaseNotes, products, stockMovements, transactions | XML NF-e fornecedor → match manual → addStock; idempotência via `stockImportedAt` |
| Cardápio | `app/components/features/cardapio/CardapioModule.tsx` | products, menuCategories | — |
| Agenda | `app/components/features/agenda/AgendaModule.tsx` | appointments, services, clients, transactions | conflict-check + commission + loyalty + GCal push + cron reminders |
| Booking público | `app/booking/[slug]/page.tsx` | appointments, conversations, clients | Idempotency hash; cria cliente; NÃO dispara evento CRM (gap) |
| Conversations | `app/components/features/conversations/ConversasModule.tsx` | conversations, conversationMessages, channelConnections | Inbound salva → dispatchInboundToAgent (debounce 5s); audio/image preprocessing |
| Broadcasts | dentro do CRMModule | broadcasts, broadcastMessages, segments | Throttle, sessions, LGPD `consentBasis`, cron `process-scheduled` |
| Birthday Campaigns | dentro do CRMModule | birthdayCampaigns, birthdayCampaignLogs | Cron horário, catch-up 6h, idempotência por (campaign, client, ano) |
| CRM | `app/components/features/crm/CRMModule.tsx` | clients, crmDeals, crmActivities, crmAuditLog, segments | Status FSM 7 estados, segmentação OR/AND |
| Clients | `app/components/features/clients/ClientsModule.tsx` | clients (unificado pós-refactor com crmContacts) | Merge dedup, channelIdentities, aiSummary |
| Notas | `app/components/features/notas/NotasModule.tsx` | notes | scope `personal`/`team`, tags multi-select. Não linka contato (gap) |
| Forms públicos | dentro do CRMModule | formTemplates, formResponses | Submissões anônimas NÃO criam Client (gap G5) |
| Reviews | embutido em ClientDetailPanel | reviews | Sem UI próprio |
| Kanban | `app/components/features/kanban/KanbanModule.tsx` | kanbanBoards, kanbanCards | Visibility all/sectors/members. Sem link com Deals (gap) |
| Financeiro | `app/components/features/financial/FinancialModule.tsx` | transactions, bankAccounts | Reconciliação OFX/CSV; cards Enterprise (canal/setor/ROI/CLV); OCR/PIX/Boleto stub |
| Fiscal | `app/components/features/fiscal/FiscalModule.tsx` | fiscalDocuments | SEFAZ gateway tensorroot.com, PKCS#12, DANFE, SPED |
| Reports | `app/components/features/reports/ReportsModule.tsx` | sales+orders+appointments+transactions+reviews | Agrega in-memory; jsPDF |
| Integrations Enterprise | `app/components/features/integrations/IntegrationsModule.tsx` | businesses.enterprise.integrations | Proxy server-side read-only (Stripe, AWS, CF, GCal, Resend, Sentry, Supabase, Vercel, GoDaddy) |
| Settings | `app/components/features/settings/SettingsModule.tsx` | businesses, users, sectors, inviteCodes | 6 tabs (perfil/empresa/fiscal/usuários/setores/enterprise) |
| Team-Chat | `app/components/features/team-chat/TeamChatPanel.tsx` | teamChats, teamChatMessages, aiChatMessages | Reações, mentions, AI integrado |
| Senhas / Vault | `app/components/features/senhas/SenhasModule.tsx` + `/api/vault/route.ts` | passwordVaultEntries | AES-256-GCM, accessScope `admins`/`specific`, auto-hide 15s |
| Spreadsheets | `app/components/features/spreadsheets/SpreadsheetsModule.tsx` | spreadsheets | Univer (lazy ~300KB), lock cooperativo 90s, debounce 1.5s |
| AI Agent (Py) | `/agent` (FastAPI) | agentRuns, agentCircuits, agentNonces, knowledgeChunks | LangGraph 5 nodes; HMAC bidi; circuit-breaker; RAG = Firestore |

## Dependências cruzadas mais importantes

```
PDV ──► stock.deductStock ──► products + stockMovements + transactions (batch)
PDV ──► /api/fiscal/emit ──► fiscalDocuments + SEFAZ
Order pública ──► validação preço server (tol 0.01) ──► stock.deductStock
Compra (NF-e XML) ──► match manual ──► stock.addStock (idempotente via stockImportedAt)
Appointment 'concluido' ──► commission Transaction + loyalty + GCal push
Booking IA ──► /api/booking/chat ──► agent.process ──► tool agenda.book ──► appointment (idempotency hash)
Webhook Meta ──► conversation upsert (fuzzy phone BR) ──► dispatchInboundToAgent (debounce 5s) ──► agent ──► send-interactive
Broadcast send ──► throttle + sessions ──► broadcastMessages + upsertConversationFromCampaign
Cron horário birthday ──► targetMmDdInTz + idempotência (campaign, client, ano) ──► detectAndNotifyMissedRun se atrasou >6h
```

## Padrões de gaps de contrato (recorrentes em todos os módulos)

| # | Padrão | Onde dói mais | Sintoma |
|---|---|---|---|
| G1 | Routes sem validação formal (Zod) | `/api/v1/*`, `/api/orders/public`, `/api/forms/submit`, `/api/agent/tools/*` | If-statements ad-hoc, payload errado passa silenciosamente |
| G2 | Status `string` largo sem FSM | Sale, Order, Appointment, Conversation, FiscalDoc, Broadcast | Transições inválidas possíveis |
| G3 | Sem idempotency-key | `/api/v1/sales`, `/api/v1/appointments`, broadcast send | Retry HTTP duplica registro + side-effects |
| G4 | Lógica duplicada client↔server | stock.ts vs stock-admin.ts, BOM expansion, validação de modifiers, fuzzy phone BR | Divergência silenciosa |
| G5 | Eventos cross-módulo não formalizados | Booking IA não notifica CRM; FormResponse não cria Client; Birthday confirmação não atualiza Appointment | Auditoria furada, dados órfãos |
| G6 | Tools do agente sem output schema | `/api/agent/tools/*` | LLM trabalha em cima de dict cru; falhas silenciosas no executor |

## Coleções Firestore (resumo)

| Coleção | Filter obrigatório | Doc ID | Notas |
|---|---|---|---|
| users | — (lookup por uid) | uid | inclui isOnline, lastSeenAt, userStatus, sectorIds |
| businesses | — (lookup) | `{uid}_biz` ou gerado | settings, fiscal, enterprise, channels |
| inviteCodes | businessId | o próprio código 6-char | charset sem ambíguos |
| clients | businessId | auto | unificado pós-refactor (era crmContacts) |
| crmDeals, crmActivities, crmAuditLog | businessId | auto | |
| appointments | businessId | auto | googleCalendarEventId, idempotencyKey |
| sales | businessId | auto | status, items, payments, fiscalDocId |
| deliveryOrders | businessId | auto | stockDeductedAt |
| products | businessId | auto | components[], modifierGroups |
| stockMovements | businessId | auto | saleId, purchaseId, orderId |
| purchaseNotes | businessId | auto | stockImportedAt (idempotência) |
| transactions | businessId | auto | sectorId, channelType, contactId, campaignId |
| fiscalDocuments | businessId | auto | status 6 estados |
| conversations | businessId | auto | channelConnectionId, contactExternalId |
| conversationMessages | businessId | auto | externalMessageId, direction, status |
| channelConnections | businessId | auto | type, ownerType, ownerId, isPrimary |
| broadcasts | businessId | auto | consentBasis (LGPD), sessions |
| broadcastMessages | businessId + broadcastId | auto | sessionIndex |
| birthdayCampaigns | businessId | auto | sendAtHour, tz, catchUp |
| birthdayCampaignLogs | businessId | `{campaignId}_{clientId}_{year}` | idempotência |
| segments | businessId | auto | filterGroups (OR de AND) |
| kanbanBoards, kanbanCards | businessId | auto | visibility, sectorIds |
| services | businessId | auto | soft-delete via isActive+deletedAt |
| sectors | businessId | auto | memberIds, leaderId |
| snippets | businessId | auto | sectorId opcional |
| notes | businessId | auto | scope personal/team |
| formTemplates, formResponses | businessId | auto | |
| reviews | businessId | auto | |
| spreadsheets | businessId | auto | currentEditorId, editingExpiresAt |
| passwordVaultEntries | businessId | auto | encryptedPassword AES-256-GCM |
| saasApiKeys | businessId | auto | keyHash SHA-256 |
| agentRuns | — (global) | auto | nodes, tools, tokens, cost |
| agentCircuits | businessId | doc por businessId | breaker state |
| agentNonces | global | hash da signature | replay protection TTL 6min |
| knowledgeChunks | businessId | contentHash | RAG embeddings |
| unreadCounters | businessId (doc-id) | businessId | Contador denormalizado de não-lidas por escopo (`business`, `byUser[uid]`, `total`). Lido por 1 onSnapshot nos badges (TopBar/Sidebar) em vez de listener full-collection sobre `conversations`. **Escrita só server (Admin SDK)** via `lib/services/unreadCounter.ts`: incremento +1 nos ingestores inbound (webhooks meta/facebook, baileys), decremento `-prevUnread` no markAsRead transacional (`/api/conversations/[id]`). Rules: read se membro do tenant, write `if false`. Backfill: `scripts/backfill-unread-counters.ts`. Ver `docs/audit/PLANO_LOTE_B_custo_firebase.md` §2 e `lib/contracts/domain/unreadCounter.ts`. |

## AI Agent — detalhes que CLAUDE.md não cobre

- **Entrypoint**: `/agent/main.py` (FastAPI), endpoint `POST /process`.
- **5 nodes LangGraph**: router (intent) → planner (tool selection) → executor (HTTP HMAC) ↔ reflection (destructive check) ↔ planner → responder (polish em business tone).
- **Cap**: `AGENT_MAX_ITERATIONS=8`.
- **Tools dispatcher**: `agent/app/tools/client.py` mapeia nome → `/api/agent/tools/{domain}`. Cada domain expõe múltiplas `action`s.
- **Auth HMAC**: `${timestamp}.${businessId}.${rawBody}` HMAC-SHA256 com `AGENT_SHARED_SECRET`. Skew ±5min. Replay protection via `agentNonces`.
- **Circuit breaker**: 5 falhas consecutivas → open 5min → half-open probe.
- **RAG**: fontes `products`, `services`, `snippets`, `business_desc`, `policy`. Indexado em `knowledgeChunks` em Firestore (não vector DB externo).
- **Inbound flow**: webhook Meta/Baileys → `dispatchInboundToAgent` (debounce 5s, marca `_agentPendingDispatch`) → typing indicator → POST HMAC pra `AGENT_SERVICE_URL/process` → executor chama tools → `send_final_message`.

## Padrões de loading / animação (do CLAUDE.md antigo, ainda válidos)

- `AnimatePresence mode="wait"` em `app/app/layout.tsx`, `key={activePage}`.
- `NavProgress` (barra vermelha topo).
- `Suspense` lazy-loaded por módulo em `app/app/page.tsx`.
- `FULL_HEIGHT_PAGES = {'Agenda', 'PDV', 'Kanban', 'Conversas'}` → spinner; resto → skeleton stagger.
- NUNCA `filter: blur` em exit (instabilidade). OK no enter.

## Vars de ambiente críticas

```env
# Firebase (sem isso → demo mode)
NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID

# Meta Embedded Signup
NEXT_PUBLIC_META_APP_ID, META_APP_SECRET, META_CONFIG_ID

# AI Agent
AGENT_SERVICE_URL, AGENT_SHARED_SECRET, AGENT_MAX_ITERATIONS

# Crons
CRON_SECRET   (broadcasts/process-scheduled, birthday-campaigns/run, agent/scheduled)

# SEFAZ
SEFAZ_API_URL, SEFAZ_API_KEY, SEFAZ_AMBIENTE (mock|homolog|prod)

# Vault encryption (reusa Meta token secret)
META_TOKEN_ENCRYPTION_KEY
```
