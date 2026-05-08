# Análise Arquitetural — Omnichannel ServicePro
> Gerado em 2026-05-05

---

## 1. Diagnóstico do que existe hoje

O sistema atual tem **muito mais sofisticação do que parece à primeira vista**. Você já tem:

- Dual-path de mensagens (Meta Cloud API + Baileys)
- Throttle com presets humanizados para anti-spam
- LGPD compliance com snapshot por mensagem no `broadcastMessages`
- Dead-letter queue para webhooks (`webhookFailures`)
- HMAC signing para chamadas de agente
- Opt-out tracking com `MarketingOptOuts`
- Retry de mensagens falhas via re-broadcast
- SLA tracking, CSAT, prioridade, labels

**Mas existem 4 problemas estruturais sérios:**

---

### Problema 1 — Baileys rodando dentro do Next.js

```
globalThis.__baileysManager = Map<connectionId, BaileysSession>
```

Isso é um hack de sobrevivência. Em Vercel/serverless, o processo pode morrer a qualquer momento e **matar todas as sessões Baileys ativas**. O `auto-restart até 8x` não resolve — se o processo morrer, não há quem reinicie. A reconexão depende de o usuário abrir o app.

---

### Problema 2 — Broadcasts rodam em API routes

O preset `human` tem delays de 5–45s e pausas de 2–5 minutos entre batches. Uma campanha de 500 contatos pode levar **horas**. Vercel tem timeout máximo de 5 minutos em Serverless Functions (10s no Edge). O código atual não tem mecanismo de checkpoint — se a função morrer no meio, a campanha fica travada em `sending`.

---

### Problema 3 — Firestore como banco de mensagens

| Limitação | Impacto prático |
|-----------|----------------|
| Sem full-text search | Não dá para buscar por conteúdo de mensagem |
| Sem agregações complexas | Stats de broadcast são re-calculadas a cada webhook — N writes por status update |
| Sem transações cross-collection | `broadcastMessages.status` + `broadcasts.stats` são atualizados em dois writes separados — possível inconsistência |
| Custo por leitura | Inbox com 1000 conversas = 1000 document reads por carregamento |
| Composite index limitado | Filtros avançados como `canal + setor + data + assignado` são caros |

---

### Problema 4 — Monolito acoplado ao Next.js

O código de negócio mais complexo do sistema (`baileys-manager.ts` 1000+ linhas, `webhooks/meta/route.ts` 600+ linhas, `broadcasts/send/route.ts` 400+ linhas) está embaixo de `app/api/` — é parte do app frontend. Não é reutilizável, não tem testes unitários nativos, não escala independentemente, não pode ser versionado separado.

---

## 2. Arquitetura proposta — `messaging-service`

```
┌─────────────────────────────────────────────────────────────┐
│                      messaging-service                       │
│                   NestJS + Drizzle + PostgreSQL              │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Channels │  │  Conv.   │  │Broadcasts│  │  Webhooks  │  │
│  │  Module  │  │  Module  │  │  Module  │  │   Module   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       │              │              │               │         │
│  ┌────▼──────────────▼──────────────▼───────────────▼─────┐  │
│  │                   Domain Events Bus                      │  │
│  │           (NestJS EventEmitter2 / Redis Pub/Sub)         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  │
│  │     Baileys Worker       │  │    Broadcast Worker      │  │
│  │  (persistent process,    │  │  (BullMQ — pause/resume  │  │
│  │   NestJS Worker thread   │  │   checkpoint, retry)     │  │
│  │   ou container separado) │  │                          │  │
│  └──────────────────────────┘  └──────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  WebSocket Gateway  (Socket.io ou WS nativo)         │    │
│  │  Replica do que hoje é Firestore onSnapshot           │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
         │ REST API + WebSocket                    │ Jobs
         ▼                                         ▼
   saas-erp (Next.js)                        BullMQ + Redis
   servicepro-v2 (NestJS)
   outros tenants futuros
```

---

### Stack definitiva

| Camada | Tecnologia | Por quê |
|--------|-----------|---------|
| Framework | NestJS | DI nativo, módulos, guards, interceptors — igual ao servicepro-v2 que você já usa |
| ORM | Drizzle ORM | Type-safe, SQL-like (não "magic"), zero runtime overhead, ótimo com Postgres |
| Banco | PostgreSQL 16 | Full-text search, JSONB, ACID, arrays nativos, pgvector futuro |
| Filas | BullMQ + Redis | Pause/resume, retry com backoff, workers isolados, dashboard (Bull Board) |
| Real-time | Socket.io (NestJS Gateway) | Substitui Firestore onSnapshot para mensagens |
| Cache/Rate-limit | Redis | Idempotency keys, rate limiting por business, Baileys state cache |
| Auth entre serviços | JWT + API keys (HMAC) | saas-erp chama via header `X-Api-Key` |

---

### Schema PostgreSQL (Drizzle) — estrutura principal

```typescript
// channels/connections
export const channelConnections = pgTable('channel_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  type: channelTypeEnum('type').notNull(), // whatsapp_cloud | baileys | facebook | instagram
  ownerType: ownerTypeEnum('owner_type').notNull(),
  ownerId: uuid('owner_id'),
  displayName: text('display_name').notNull(),
  isActive: boolean('is_active').default(true),
  isPrimary: boolean('is_primary').default(false),
  // credentials (encrypted at rest)
  phoneNumberId: text('phone_number_id'),
  wabaId: text('waba_id'),
  pageId: text('page_id'),
  igAccountId: text('ig_account_id'),
  accessTokenEnc: text('access_token_enc'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  isConnected: boolean('is_connected').default(false),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// conversations
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  channelConnectionId: uuid('channel_connection_id').references(() => channelConnections.id),
  channel: text('channel').notNull(),
  contactId: uuid('contact_id'), // FK para clients
  contactExternalId: text('contact_external_id').notNull(), // Meta phone/userId
  contactName: text('contact_name'),
  status: conversationStatusEnum('status').default('open'),
  assignedTo: uuid('assigned_to'),
  assignedToSectorId: uuid('assigned_to_sector_id'),
  priority: priorityEnum('priority').default('low'),
  unreadCount: integer('unread_count').default(0),
  lastMessage: text('last_message'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  slaBreached: boolean('sla_breached').default(false),
  labels: text('labels').array(),
  isDeleted: boolean('is_deleted').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  businessIdx: index().on(t.businessId),
  externalIdx: uniqueIndex().on(t.businessId, t.channelConnectionId, t.contactExternalId),
  // Full-text search em nome do contato e última mensagem
  searchIdx: index('conversations_search_idx').using('gin',
    sql`to_tsvector('portuguese', coalesce(${t.contactName}, '') || ' ' || coalesce(${t.lastMessage}, ''))`
  ),
}));

// messages
export const conversationMessages = pgTable('conversation_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  businessId: uuid('business_id').notNull(),
  direction: directionEnum('direction').notNull(),
  content: text('content'),
  status: messageStatusEnum('status').default('sending'),
  externalMessageId: text('external_message_id').unique(), // wamid, mid
  mediaUrl: text('media_url'),
  mediaType: text('media_type'),
  isInternal: boolean('is_internal').default(false),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  // Full-text search em conteúdo de mensagem — algo impossível no Firestore
  contentSearchIdx: index('messages_content_fts').using('gin',
    sql`to_tsvector('portuguese', coalesce(${t.content}, ''))`
  ),
}));

// broadcasts com stats como colunas dedicadas (não JSONB)
export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  name: text('name').notNull(),
  channel: text('channel').notNull(),
  status: broadcastStatusEnum('status').default('draft'),
  messageType: text('message_type').notNull(),
  templateName: text('template_name'),
  templateParams: jsonb('template_params').$type<BroadcastTemplateParam[]>(),
  messageContent: text('message_content'),
  throttle: jsonb('throttle').$type<SendThrottle>(),
  consentBasis: text('consent_basis'),
  // Stats como colunas — permite UPDATE atômico sem re-calcular
  statsTotal: integer('stats_total').default(0),
  statsSent: integer('stats_sent').default(0),
  statsDelivered: integer('stats_delivered').default(0),
  statsRead: integer('stats_read').default(0),
  statsFailed: integer('stats_failed').default(0),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// broadcast_messages — rastreamento por destinatário
export const broadcastMessages = pgTable('broadcast_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  broadcastId: uuid('broadcast_id').references(() => broadcasts.id).notNull(),
  businessId: uuid('business_id').notNull(),
  contactId: uuid('contact_id'),
  recipientId: text('recipient_id').notNull(), // phone E.164 ou email
  status: broadcastMessageStatusEnum('status').default('pending'),
  externalMessageId: text('external_message_id'),
  errorMessage: text('error_message'),
  consentBasis: text('consent_basis'), // snapshot no momento do envio
  customColumns: jsonb('custom_columns').$type<Record<string, string>>(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// opt-outs de marketing
export const marketingOptOuts = pgTable('marketing_opt_outs', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  channel: text('channel').notNull(), // 'email' | 'whatsapp' | 'all'
  identifier: text('identifier').notNull(), // lowercase email ou E.164 phone
  source: text('source').notNull(), // 'unsubscribe-link' | 'whatsapp-keyword' | 'manual' | 'bounce' | 'complaint'
  broadcastId: uuid('broadcast_id'),
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  uniqueOptOut: uniqueIndex().on(t.businessId, t.channel, t.identifier),
}));
```

---

### Broadcast Worker — resolvendo o problema de timeout

```
BullMQ Queue: "broadcasts"
  ├── Job: { broadcastId, businessId, lastProcessedIndex? }
  │
  └── Worker (processo separado, sem limite de timeout):
        1. Busca broadcast + recipients do Postgres
        2. Filtra opt-outs (query Postgres)
        3. Itera recipients a partir de lastProcessedIndex com throttle:
           ├── Envia via Meta API ou Baileys
           ├── UPDATE broadcast_messages SET status='sent', sent_at=NOW()
           ├── UPDATE broadcasts SET stats_sent = stats_sent + 1  ← atômico!
           └── await delay(random(delayMin, delayMax))
        4. A cada batch: salva lastProcessedIndex no job data (checkpoint)
        5. Se SIGTERM recebido: UPDATE broadcasts SET status='paused', para gracefully
        6. Job re-enfileirado com lastProcessedIndex preservado → continua do checkpoint
```

O checkpoint é a chave: você salva `lastProcessedIndex` no job data do BullMQ. Se o worker morrer, o job é re-tentado e **continua do ponto onde parou**, não do zero.

```typescript
// broadcast.worker.ts
@Processor('broadcasts')
export class BroadcastWorker {
  @Process()
  async handle(job: Job<BroadcastJobData>) {
    const { broadcastId, businessId } = job.data;
    const lastIndex = job.data.lastProcessedIndex ?? 0;

    const recipients = await this.db.query.broadcastMessages.findMany({
      where: and(
        eq(broadcastMessages.broadcastId, broadcastId),
        eq(broadcastMessages.status, 'pending'),
      ),
      offset: lastIndex,
    });

    for (let i = 0; i < recipients.length; i++) {
      if (this.isShuttingDown) {
        await job.update({ ...job.data, lastProcessedIndex: lastIndex + i });
        return; // BullMQ recoloca o job na fila
      }

      await this.sendMessage(recipients[i]);

      await this.db.update(broadcasts)
        .set({ statsSent: sql`stats_sent + 1` })
        .where(eq(broadcasts.id, broadcastId));

      await delay(randomBetween(throttle.delayMinMs, throttle.delayMaxMs));
    }
  }
}
```

---

### Baileys Worker — resolvendo o problema de serverless

```
NestJS app (long-running container, NÃO serverless)
  │
  └── BaileysModule
        ├── onApplicationBootstrap(): restore all active sessions from DB
        ├── Session Map: Map<connectionId, BaileysSession>
        ├── Health check endpoint: GET /health/baileys
        └── Graceful shutdown: persist all sessions before SIGTERM

┌─────────────────────────────────────────┐
│  messaging-service container (Railway/  │
│  Render/EC2 — SEMPRE LIGADO)           │
│                                         │
│  [Baileys Worker] ←──────────────────→  │
│  [Broadcast Worker]      Redis          │
│  [Webhook Handler]      (BullMQ)        │
│  [REST API]                             │
│  [WebSocket Gateway]                    │
└─────────────────────────────────────────┘
```

O Baileys sai do Next.js completamente. O saas-erp passa a ser apenas o frontend.

---

### WebSocket Gateway — substituindo Firestore onSnapshot

```typescript
// messaging.gateway.ts
@WebSocketGateway({ cors: true, namespace: '/messaging' })
export class MessagingGateway {
  @SubscribeMessage('subscribe:business')
  async subscribe(client: Socket, { businessId }: { businessId: string }) {
    await client.join(`business:${businessId}`);
  }

  // Chamado pelo WebhooksModule após processar mensagem inbound
  notifyNewMessage(businessId: string, message: ConversationMessageDto) {
    this.server.to(`business:${businessId}`).emit('message:received', message);
  }

  // Chamado pelo ConversationsModule após atualização
  notifyConversationUpdate(businessId: string, conversation: ConversationDto) {
    this.server.to(`business:${businessId}`).emit('conversation:updated', conversation);
  }

  // Chamado pelo BroadcastWorker a cada N mensagens enviadas
  notifyBroadcastProgress(businessId: string, stats: BroadcastStatsDto) {
    this.server.to(`business:${businessId}`).emit('broadcast:progress', stats);
  }
}
```

No frontend (saas-erp), substituir `onSnapshot` por:

```typescript
// hooks/useMessagingSocket.ts
const socket = io(MESSAGING_SERVICE_URL, {
  auth: { token: await firebaseUser.getIdToken() },
  namespace: '/messaging',
});

socket.emit('subscribe:business', { businessId });
socket.on('message:received', (msg) => {
  queryClient.setQueryData(['messages', msg.conversationId], (old) => [...old, msg]);
});
socket.on('conversation:updated', (conv) => {
  queryClient.setQueryData(['conversations', businessId], (old) =>
    old.map(c => c.id === conv.id ? conv : c)
  );
});
```

---

## 3. Estratégia de migração (incremental, sem big-bang)

```
Mês 1          Mês 2          Mês 3          Mês 4
Phase 0        Phase 1        Phase 2        Phase 3
Setup          Dual-write     Read switch    Cutover
```

---

### Phase 0 — Setup (1–2 semanas)

- [ ] Criar repositório `messaging-service` (NestJS monorepo ou standalone)
- [ ] Schema Drizzle + migrations iniciais
- [ ] PostgreSQL no Railway/Supabase/Neon
- [ ] Redis no Upstash ou Railway
- [ ] Docker Compose local (postgres + redis + app)
- [ ] CI/CD básico (GitHub Actions → Railway/Render)
- [ ] Auth service-to-service: header `X-Api-Key` validado por guard NestJS
- [ ] Healthcheck endpoint (`/health`)

---

### Phase 1 — Dual-write (2–3 semanas)

**Ideia:** webhooks chegam ao Next.js como hoje, mas o Next.js faz forward para o messaging-service **em paralelo**. Nenhuma UI muda.

```typescript
// app/api/webhooks/meta/route.ts — adicionar ao final do handler existente
// Dual-write: forward para messaging-service sem bloquear a resposta para a Meta
fetch(`${process.env.MESSAGING_SERVICE_URL}/webhooks/meta`, {
  method: 'POST',
  headers: {
    'X-Api-Key': process.env.MESSAGING_SERVICE_KEY!,
    'Content-Type': 'application/json',
    'X-Business-Id': resolvedBusinessId,
  },
  body: JSON.stringify(payload),
}).catch(err => console.error('[dual-write] forward failed', err));
// Meta recebe 200 imediatamente — o forward é fire-and-forget
```

Nesta fase: PostgreSQL acumula dados reais em paralelo ao Firestore. Você valida consistency via script de diff antes de avançar.

**Script de validação (executar antes da Phase 2):**
```sql
-- Contar conversas por business no Postgres vs Firestore
SELECT business_id, COUNT(*) as pg_count FROM conversations GROUP BY business_id;
-- Comparar com: db.collection('conversations').where('businessId','==',x).count()
```

---

### Phase 2 — Read switch (2–3 semanas)

Trocar as queries de leitura da UI para a API do messaging-service, **um módulo por vez** (sem rollback necessário se algum falhar):

**Ordem recomendada:**
1. **Broadcasts** — sem real-time crítico, mais simples
2. **Conversation list** — real-time via WebSocket
3. **Messages thread** — real-time via WebSocket (mais sensível)

```typescript
// Antes (Firestore direto no componente):
useEffect(() => {
  const q = query(collection(db, 'conversations'), where('businessId', '==', business.id));
  return onSnapshot(q, snap => setConversations(snap.docs.map(d => d.data())));
}, [business.id]);

// Depois (React Query + REST):
const { data: conversations } = useQuery({
  queryKey: ['conversations', business.id],
  queryFn: () => messagingApi.getConversations(business.id),
  staleTime: 30_000,
});
// + useMessagingSocket() para receber updates em tempo real
```

---

### Phase 3 — Cutover (1–2 semanas)

- [ ] Baileys **migra para messaging-service** (sai do Next.js completamente)
- [ ] Broadcasts **migram para BullMQ** (sai do API route, zero timeout)
- [ ] Dual-write removido do Next.js
- [ ] Regras Firestore para `conversations`/`conversationMessages`/`broadcasts`/`broadcastMessages` → `deny all`
- [ ] Next.js vira 100% frontend (sem lógica de messaging embutida)
- [ ] Script de migração histórica: Firestore → Postgres para dados antigos

```typescript
// migration/firestore-to-postgres.ts
const conversations = await getDocs(query(
  collection(db, 'conversations'),
  where('businessId', '==', businessId)
));

for (const doc of conversations.docs) {
  await db.insert(conversationsTable)
    .values(mapFirestoreConversation(doc.data()))
    .onConflictDoNothing(); // idempotente — pode rodar N vezes
}
```

---

### Phase 4 — Multi-tenant e outros sistemas

Com o messaging-service standalone, qualquer sistema pode consumir a mesma API:

```
saas-erp (Next.js)      ─────┐
servicepro-v2 (NestJS)  ─────┤──→ messaging-service API
app Flutter             ─────┘   (mesma instância, todos os tenants)
outro-cliente-futuro    ─────┘
```

Cada sistema autentica com sua própria API key no header `X-Api-Key`. Todos os tenants (`businessId`) ficam isolados no mesmo banco PostgreSQL via row-level filtering — sem overhead de instâncias separadas.

**Rate limiting por tenant no Redis:**
```typescript
// rate-limit.guard.ts
const key = `rate:${businessId}:send`;
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, 3600);
if (count > 300) throw new TooManyRequestsException();
```

---

## 4. Estrutura de módulos NestJS

```
messaging-service/
├── src/
│   ├── app.module.ts
│   ├── channels/
│   │   ├── channels.module.ts
│   │   ├── channels.controller.ts     ← REST CRUD de connections
│   │   ├── channels.service.ts
│   │   ├── meta-signup.service.ts     ← Embedded Signup flow
│   │   └── dto/
│   ├── conversations/
│   │   ├── conversations.module.ts
│   │   ├── conversations.controller.ts
│   │   ├── conversations.service.ts
│   │   └── dto/
│   ├── messages/
│   │   ├── messages.module.ts
│   │   ├── messages.controller.ts
│   │   ├── messages.service.ts        ← send, status update
│   │   └── dto/
│   ├── broadcasts/
│   │   ├── broadcasts.module.ts
│   │   ├── broadcasts.controller.ts
│   │   ├── broadcasts.service.ts      ← create, pause, resume, retry
│   │   ├── broadcast.worker.ts        ← BullMQ processor com checkpoint
│   │   └── dto/
│   ├── webhooks/
│   │   ├── webhooks.module.ts
│   │   ├── meta.controller.ts         ← POST /webhooks/meta (HMAC validation)
│   │   ├── facebook.controller.ts
│   │   └── webhooks.service.ts        ← inbound processing pipeline
│   ├── baileys/
│   │   ├── baileys.module.ts
│   │   ├── baileys.service.ts         ← session manager (substitui baileys-manager.ts)
│   │   ├── baileys-auth.service.ts    ← persist/restore state no Postgres
│   │   └── baileys-media.service.ts   ← download + upload S3/Storage
│   ├── contacts/
│   │   ├── contacts.module.ts
│   │   ├── contacts.service.ts        ← auto-linking inbound → client
│   │   └── dto/
│   ├── gateway/
│   │   ├── messaging.gateway.ts       ← Socket.io (substitui onSnapshot)
│   │   └── gateway.module.ts
│   ├── database/
│   │   ├── database.module.ts
│   │   ├── schema.ts                  ← todas as tabelas Drizzle
│   │   └── migrations/
│   ├── common/
│   │   ├── guards/api-key.guard.ts
│   │   ├── guards/rate-limit.guard.ts
│   │   ├── interceptors/tenant.interceptor.ts
│   │   └── decorators/business-id.decorator.ts
│   └── config/
│       └── configuration.ts
├── docker-compose.yml
├── drizzle.config.ts
└── package.json
```

---

## 5. Principais ganhos vs riscos

| Ganho | Como resolve |
|-------|-------------|
| Baileys confiável | Container sempre ativo, sem serverless |
| Broadcasts sem timeout | BullMQ worker com checkpoint por recipient |
| Busca em mensagens | PostgreSQL GIN full-text search nativo |
| Stats de broadcast atômicas | `UPDATE SET stats_sent = stats_sent + 1` |
| Multi-sistema | REST API + WebSocket servindo qualquer cliente |
| Isolamento de deploy | messaging-service deploya independente do saas-erp |
| Testabilidade | NestJS + DI → unit tests com mocks nativos |
| Custo previsível | PostgreSQL não cobra por leitura/escrita individual |

| Risco | Mitigação |
|-------|----------|
| Dual-write inconsistency | Validar com script de diff Firestore vs Postgres antes do cutover |
| WebSocket vs Firestore onSnapshot | Socket.io tem reconnect automático; fallback polling em caso de falha |
| Latência extra (saas-erp → API) | Redis cache + HTTP/2 keep-alive; latência real < 50ms na mesma região |
| Migração dos dados históricos | Script batch idempotente (pode rodar N vezes), validado em staging antes do cutover |
| Sessões Baileys no container restart | `onApplicationBootstrap` restaura todas as sessões ativas do Postgres automaticamente |

---

## 6. Onde começar

### Semana 1 — Bootstrap
```bash
nest new messaging-service
cd messaging-service
pnpm add drizzle-orm pg @types/pg drizzle-kit
pnpm add @nestjs/bull bull bullmq redis ioredis
pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
pnpm add @whiskeysockets/baileys
```

### Semana 2 — Core
1. Schema Drizzle + primeira migration
2. `WebhooksModule` com handler Meta (portando `webhooks/meta/route.ts`)
3. Dual-write ativo no saas-erp → dados reais entrando no Postgres

### Semana 3–4 — Broadcasts
1. `BroadcastWorker` com BullMQ + checkpoint
2. `BroadcastsController` (pause/resume/retry)
3. Testar com campanha real em staging

### Mês 2 — Conversations + WebSocket
1. `MessagingGateway` Socket.io
2. Migrar leitura de conversations e messages no saas-erp
3. Baileys migra para o serviço

### Mês 3 — Cutover
1. Script de migração histórica
2. Validação de consistência
3. Remove dual-write e Firestore listeners de messaging
