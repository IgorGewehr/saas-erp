# ServicePro — Guia para IA e humanos

> **Leia tudo antes de modificar código.**
> Este é o documento de governança. Detalhes técnicos estão em `docs/architecture-map.md`.
> Contratos vivem em `lib/contracts/`. Roadmap SDD em `docs/sdd-roadmap.md`.

---

## 1. Regras duras (não-negociáveis)

Estas 6 regras se aplicam a **todo** PR, toda feature, toda IA.

### R1 — Multi-tenant: `businessId` é sagrado
Todo documento gravado no Firestore inclui `businessId: business.id`. Toda query filtra `where('businessId','==', business.id)`. Sem exceção. Sem isso, dados vazam entre tenants.

```typescript
// ✅ CORRETO
const q = query(collection(db,'x'), where('businessId','==',business.id), orderBy('createdAt','desc'));

// ❌ ERRADO
const q = query(collection(db,'x'));
```

### R2 — SDD: contrato antes de implementação
Antes de criar uma entidade, route ou evento, **declare o contrato em `lib/contracts/`**. Sem schema → não passa em review. Detalhes em `lib/contracts/README.md`.

- Nova entidade → `lib/contracts/domain/{entity}.ts` (Zod + invariantes)
- Nova route → `lib/contracts/api/{...}/{recurso}.ts` (Request + Response)
- Novo status com transições → `lib/contracts/fsm/{entity}.ts`
- Novo side-effect cross-módulo → `lib/contracts/events/index.ts`

O tipo TS é **derivado** com `z.infer`. Nunca redeclare interface paralela.

### R3 — Idempotência é parte do contrato
Toda rota POST que cria recurso aceita `X-Idempotency-Key`. Toda task agendada (cron) verifica idempotência antes de agir (ex: `birthdayCampaignLogs/{campaignId}_{clientId}_{year}`). Toda webhook deduplica por `externalMessageId`/`wamid`.

### R4 — Status string + FSM
Campo `status: string` sem FSM é proibido para novas entidades. Use enum + `lib/contracts/fsm/`. Chame `assertTransition(from,to)` antes de `updateDoc`. Para entidades existentes, migre quando tocar.

### R5 — Side-effects cross-módulo viram eventos
Se mudança em A dispara mudança em B (ex: `appointment.completed` → cria commission Transaction), declare em `lib/contracts/events/`. Comece como **documentação**; promova a `dispatchDomainEvent()` quando dois ou mais subscribers existirem.

### R6 — Validação no boundary, confiança dentro
Entrada de API/webhook valida com Zod imediatamente (`.parse()`). Código interno **confia nos tipos**. Não duplique validação em camadas internas. Trate apenas casos que o tipo não exprime (concorrência, race, etc.).

---

## 2. Stack

| Camada | Tech |
|---|---|
| Framework | Next.js 15 (App Router, `'use client'`) |
| UI | Tailwind + MUI v6 + Framer Motion |
| Backend | Firebase (Auth + Firestore + Storage) |
| Estado servidor | TanStack React Query v5 |
| Linguagem | TypeScript strict |
| Contratos | Zod + zod-to-openapi (instalar) |
| AI Agent | Python FastAPI + LangGraph (em `/agent`) |
| Ícones | Lucide |
| Fontes | Inter (corpo), Plus Jakarta Sans (`.font-display`) |

Comandos: `npm run dev` (Next), `npm run dev:agent` (Python), `npm run dev:all` (ambos com concurrently), `npm run typecheck`, `npm run test`.

---

## 3. Workflow ao codar uma feature

```
1. LER     →  lib/contracts/{domain,api,events}/ relacionados
              docs/architecture-map.md (módulos afetados)

2. SPEC    →  Criar/atualizar Zod schemas em lib/contracts/
              FSM se há status. Evento se há side-effect cross-módulo.

3. CÓDIGO  →  Implementar usando z.infer e .parse() nas bordas.
              Filtro businessId em toda query/write.

4. TESTE   →  __tests__/contracts/ para invariantes do schema.
              Smoke test para a route (request → response shape).

5. DOC     →  Adicionar linha em docs/architecture-map.md se mudou inventário.
```

### Onde achar o que

- **Tipos do sistema** → `lib/types/index.ts` (será migrado pra `lib/contracts/domain/` por fases — ver `docs/sdd-roadmap.md`)
- **Mapa de módulos** → `docs/architecture-map.md`
- **Roadmap SDD** → `docs/sdd-roadmap.md`
- **AuthProvider** → `app/components/providers/AuthProvider.tsx` (fonte da verdade pra user/business/sectors/presença)
- **API v1 specs** → `lib/contracts/api/v1/` (em construção)
- **Agent tools** → `app/api/agent/tools/{domain}/route.ts` + contratos em `lib/contracts/api/agent/`
- **Firestore rules** → `firestore.rules` (~1500 linhas)
- **Indexes compostos** → `firestore.indexes.json`

---

## 4. Multi-tenant — modelo de dados

```
Firebase Auth (UID)
   └─ users/{uid}          perfil + businessId + role + sectorIds + isOnline + userStatus + lastSeenAt
       └─ businesses/{id}  empresa (settings, fiscal, channels, enterprise)
            └─ ~40 coleções filtradas por businessId
```

Hierarquia de roles (numérica, maior = mais permissão):
```
founder: 100  →  admin: 80  →  manager: 60  →  operator: 40  →  viewer: 20
```

Verificação: `ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY['admin']`.

**Presença:** 4 status (`online`, `busy`, `invisible`, `offline`). Sempre use `getMemberDisplayStatus()` — `isOnline` cru ignora `userStatus === 'invisible'`. Heartbeat 60s no `AuthProvider`. Detalhes completos em `docs/architecture-map.md`.

**Sectors:** usuário ∈ múltiplos setores. `useAuth().userSectorIds` é a fonte. Admins veem tudo; demais filtram por `item.sectorIds.some(s => userSectorIds.includes(s))`. Aplica-se a Conversations, Kanban, CRM, Financeiro, Snippets, Spreadsheets.

---

## 5. Mapa de módulos (referência rápida)

```
app/components/features/
├── dashboard       KPIs + heatmap presença
├── pdv             Ponto de venda → sales, stockMovements, transactions, fiscal
├── orders          Pedidos delivery → deliveryOrders + stock
├── sales           Listagem/filtro de vendas
├── inventory       Produtos + BOM (components[]) + modifiers
├── purchases       Importação NF-e fornecedor → addStock
├── cardapio        Editor cardápio público
├── agenda          Appointments + commission + loyalty + GCal push
├── conversations   Omnichannel (Meta Cloud + Baileys + FB + IG)
├── crm             Leads + deals + segments + broadcasts + birthday + forms
├── clients         CRUD unificado (era crmContacts)
├── notas           Notas pessoais/equipe com tags multi-select
├── kanban          Boards com visibility (all|members|sectors)
├── financial       Transactions + reconciliação + Enterprise cards
├── fiscal          NF-e/NFC-e/NFSe via SEFAZ gateway
├── reports         Agregação cross-coleção + jsPDF
├── integrations    Enterprise dashboard (Stripe, AWS, GCal, ...)
├── settings        Perfil/Empresa/Fiscal/Usuários/Setores/Enterprise
├── team-chat       Chat interno + AI assistant
├── senhas          Vault de senhas AES-256-GCM
├── spreadsheets    Editor Univer com lock cooperativo
└── shared          Componentes compartilhados

app/api/
├── v1/*            Public API (Bearer SaasApiKey)
├── agent/*         Tools + runs + memory (HMAC bidirecional)
├── webhooks/{meta,facebook}   Entrada externa
├── whatsapp/*      Baileys sessions
├── booking/chat    Chat IA público para agendamento
├── broadcasts/{send,process-scheduled}   Cron processado
├── birthday-campaigns/run    Cron horário
├── orders/public   Recebe pedido anônimo do cardápio
├── fiscal/*        Wrapper SEFAZ
├── financial/*     PIX/Boleto/OCR/OpenBanking (stubs)
├── integrations/*  Proxies servidor pras APIs externas
├── channels/*      Meta signup + WhatsApp profile
├── forms/*         Templates + submissões públicas
├── vault           Senhas criptografadas
└── rag/reindex     Re-indexar knowledge chunks

/agent             Serviço Python (FastAPI + LangGraph 5 nodes)
lib/
├── contracts/     ← SDD vive aqui (em construção)
├── types/         ← Migrando pra contracts/domain/
├── services/      stock, stock-admin, commission, loyalty, giftCard, calendarSync,
│                  reconciliation, birthdayCampaignRunner, conversationFromCampaign,
│                  channels/, baileys/, storage/
├── agent/         auth (HMAC), circuit-breaker, dispatch, rate-limit
├── rag/           embed, store, memory, reindex
├── fiscal/        certificate-manager, number-sequence, uf, ncm-table
├── campaigns/     audience evaluation
├── channels/      shared client/server
├── middleware/    apiKeyAuth
├── config/        firebase
├── i18n/          translations
├── constants/     enums compartilhados
├── hooks/         React hooks reutilizáveis
└── utils/         format, validators, encryption
```

---

## 6. Convenções de código

### TypeScript
- Strict mode. `z.infer` em vez de redeclarar interface.
- Imports absolutos: `@/lib/...`, `@/components/...`. Adicionar `@/contracts/...` ao tsconfig.
- Sem `any`. Use `unknown` no boundary e refine.

### UI
- Tailwind first. MUI só para DataGrid/DatePicker/Dialog complexos.
- Dark mode via `.dark` na `<html>`. Sempre variantes `dark:`.
- Ícones Lucide, padrão `w-4 h-4`.
- `rounded-xl` (padrão), `rounded-2xl` (cards maiores).
- Cor primária: `red-600/500`.
- Animação: `framer-motion`, `AnimatePresence mode="wait"`. **Não use `filter: blur` em `exit`** (instabilidade GPU) — só no `enter`.
- Páginas full-height: `Agenda, PDV, Kanban, Conversas` → fallback spinner; resto → skeleton stagger.

### Firebase
- Queries com cache: TanStack Query, `staleTime: 5min`. `queryKey: ['x', business?.id, ...filters]`.
- Tempo real (presença, conversas): `onSnapshot` direto no `useEffect`.
- Importar firebase **apenas em `'use client'`** ou API routes. Server Components não tocam Firebase.
- Use `formatDate`/`formatDateTime`/`formatCurrency` de `lib/utils/format.ts`. Nunca `new Date(valor)` sem validar (`RangeError`).

### Audit fields
Ao gravar referência a usuário (operatorId, assignedTo, createdBy), inclua também o nome (`operatorName`) para evitar lookup extra.

---

## 7. Erros comuns — não faça

```typescript
// ❌ Query sem businessId
query(collection(db,'clients'))

// ❌ Interface paralela ao schema Zod
interface Sale { ... }  // redundante se SaleSchema existe

// ❌ POST sem idempotency em rota que cria recurso
await fetch('/api/v1/sales', { method:'POST', body: JSON.stringify({...}) })

// ❌ Mudar status sem checar FSM
await updateDoc(ref, { status: 'finalizada' })  // pode pular estados inválidos

// ❌ Side-effect cross-módulo inline em handler de UI
await Promise.all([createCommission(...), addLoyaltyPoints(...), syncGCal(...)])
// → declare evento appointment.completed e use dispatchDomainEvent

// ❌ Confiar em member.isOnline pra exibir status
if (member.isOnline) ...
// → use getMemberDisplayStatus(member) — leva 'invisible' em conta

// ❌ ROLE_HIERARCHY com comparação string
if (user.role === 'admin' || user.role === 'founder') ...
// → ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY['admin']

// ❌ Comentário descritivo do "o quê" do código
// "Carrega os clientes"  ← nome de função já diz isso
// Só escreva comentário se for "por quê" não-óbvio.

// ❌ new Date() em formatador sem validar
new Intl.DateTimeFormat().format(new Date(undefined))  // RangeError
// → use formatDate() que retorna '-' pra inválido
```

---

## 8. Quando atualizar este documento

- Adicionou módulo novo em `app/components/features/` → atualizar mapa em §5 + `docs/architecture-map.md`.
- Mudou regra dura (R1–R6) → reescrever a regra, não adicionar exceção.
- Adicionou nova fase no roadmap SDD → atualizar `docs/sdd-roadmap.md` (não duplique aqui).
- Encontrou erro comum recorrente em PRs → adicionar exemplo em §7.
- Atualizou stack/dependências → §2.

Este arquivo é **enxuto por design**. Detalhes técnicos vão para `docs/`. Schemas vão para `lib/contracts/`. Se você se pegou escrevendo descrição de implementação aqui, está no lugar errado.

---

## 9. Documentos relacionados

| Arquivo | Conteúdo |
|---|---|
| `docs/architecture-map.md` | Mapa denso de módulos, coleções, dependências cruzadas, gaps |
| `docs/sdd-roadmap.md` | Fases de adoção de contratos com critérios de pronto |
| `lib/contracts/README.md` | Manifesto SDD: regras, formato, workflow |
| `lib/contracts/_template/` | Modelos para copiar ao criar entity/route/event/fsm |
| `firestore.rules` | Autorização por coleção (regras Firestore) |
| `firestore.indexes.json` | Índices compostos |
| `agent/README.md` | Serviço Python (LangGraph, tools, HMAC) |
| `docs/integrations/` | Notas operacionais de integrações externas |
| `AGENTS.md` | (Histórico — duplicado deste CLAUDE.md, será removido em limpeza futura) |
