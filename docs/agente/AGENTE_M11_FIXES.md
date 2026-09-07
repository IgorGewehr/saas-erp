# M11 — Agente de IA, API pública e Integrações: fixes e hardening

> Concluído em: 07/09/2026
>
> Plano de origem: `docs/paridade/M11_PLANO_IMPLEMENTACAO.md`

## M11.0 — Cockpit de integrações órfão apagado

Um painel inteiro (`IntegrationsModule.tsx`, 14 arquivos, ~4400 linhas) com 8
proxies server-side reais e funcionais (Stripe MRR, custo AWS via SDK,
Sentry, Supabase, Vercel, Cloudflare, GoDaddy, Resend) nunca estava ligado a
nenhum menu do sistema — um "cockpit de operações do próprio SaaS" (custo/
receita/infra da Aevo), não uma central de conectores pros clientes.
Perguntado ao usuário, decisão foi apagar.

Apagados: `app/components/features/integrations/` (14 arquivos), as 8 rotas
`app/api/integrations/{aws,cloudflare,godaddy,resend,sentry,stripe,supabase,
vercel}` (reconfirmado zero consumidor fora do próprio módulo morto) e
`lib/utils/integrationKeys.ts` (helper usado só pelas 8 rotas apagadas).
`google-calendar`/`mercadopago` (reais, usados pela Agenda e pelo checkout)
preservados intocados. A tela de Settings→Enterprise (onde o usuário
cadastra a própria chave do Resend, usada de verdade por
`financial/notify/service.ts` para envio de e-mail) também preservada — é
gravação de config, não o cockpit de leitura apagado.

Documentação corrigida: `docs/architecture-map.md` (linha do módulo
removida), `CLAUDE.md` §5 (módulo `integrations` removido do mapa da UI,
`api/integrations/*` redescrito como Google Calendar+Mercado Pago, grafo do
agente corrigido de "5 nodes" pra "6 nodes com reflection"),
`agent/README.md` (diagrama do grafo reescrito pra bater com
`agent/app/graph/graph.py` real), `PRE_PRODUCTION_CHECKLIST.md` (seção
"Integrações Enterprise" obsoleta removida; seção de hosting corrigida pra
citar Docker em vez de `vercel.json`, removido em M10).

## M11.1 — Validação Zod das rotas de tool do agente

`lib/contracts/api/agent/` já tinha contratos Zod completos pra 20 domínios,
com um helper de wiring pronto (`parseToolRequest`/`validateToolResponse`,
`lib/contracts/_runtime/agentToolValidation.ts`) — mas só 4 rotas
(`agenda`/`financial`/`fiscal`/`reports`) o usavam. As outras 16 faziam cast
manual sem validação de runtime: um payload malformado do LLM chegava ao
handler em vez de virar um 400 estruturado que o LLM consegue corrigir.

Wireados nesta fatia: **orders, catalog, clients, crm, inventory, sales,
memory, business, services, team, knowledge, conversations, notes,
purchase-notes, suppliers, kanban** (16 domínios) — todos seguindo o mesmo
padrão já estabelecido em `agenda`/`financial`: parse-then-single-switch-
then-validate, preservando toda a lógica de negócio.

**`send-interactive`** merece nota à parte: não estava nem registrado em
`AGENT_TOOL_DOMAINS` (não tinha ação alguma validada). Um arquivo de
contrato com o mesmo nome já existia no repo (commit `97f2d0f`) mas nunca
fora ligado ao registry — e usava um literal de action (`'send'`) que não
bate com o que o agente Python realmente envia (`_split_action` em
`agent/app/tools/client.py` gera `'send_interactive'` pra tool
`conversation_send_interactive`). Reescrito com o literal correto
(verificado contra o código do client Python), preservando os limites de
tamanho sensatos do arquivo antigo, registrado em `AGENT_TOOL_DOMAINS` e
wireado na rota.

### Bugs reais encontrados e corrigidos ao verificar contrato vs. handler

Cada domínio foi auditado comparando o shape REAL retornado/consumido pelo
handler contra o schema Zod — não foi só "plugar o helper". Isso achou
várias divergências genuínas, quase todas da mesma classe de bug já
documentada nesta sessão em `financial/route.ts` (campo opcional atribuído
incondicionalmente vira `undefined` explícito, que o Admin SDK rejeita
sem `ignoreUndefinedProperties`):

- **catalog**: `search` exigia `_score` no schema mas o handler nunca
  incluía — corrigido no handler.
- **clients**: `update` devolvia só o patch (sem `businessId`/`name`
  obrigatórios do schema); `getFullHistory.stats.lastVisit` mandava
  `undefined` onde o schema exige `null`.
- **crm**: `createDeal`/`logActivity` atribuíam campos opcionais
  incondicionalmente — corrigido pra atribuição condicional.
- **orders**: contrato usava `pontoReferencia` (campo que não existe em
  lugar nenhum do sistema) em vez de `reference` — corrigido no contrato.
- **inventory**: contrato faltava `trackLots`/`trackExpiry`/
  `expiryWarningDays`/`initialLot`/`idempotencyKey`/`lotId` em 4 schemas —
  parse não-passthrough descartaria silenciosamente esses campos (ou
  rejeitaria com 400 num patch `.strict()`).
- **sales**: contrato faltava `variantId`/`basePrice`/`selectedModifiers`/
  `notes` em cada item + `idempotencyKey`; o enum de forma de pagamento
  compartilhado (`PaymentMethodSchema`) não batia com o real usado no
  checkout — criado um enum local `SalesPaymentMethodSchema`.
- **memory**: `FactSchema` exigia `contactId` por fato (nunca gravado assim
  no domínio) — corrigido denormalizando no handler; `validUntil` rejeitava
  datas sem horário (formato usado de verdade).
- **business**: `getContext()` nunca calculava `segment`/`segmentVocab` que
  o contrato já declarava — corrigido reaproveitando a mesma derivação já
  usada em `lib/agent/dispatch.ts`/`app/api/booking/chat/route.ts`.
- **services**: action `import_grade` existia na rota mas não no contrato;
  schemas de create/update faltavam `capacity`/`sessions`/campos fiscais de
  serviço (`lc116Code`, `codigoMunicipal`, `nbs`, `aliquotaISS`).
- **knowledge**: `metadata` exigido como objeto no schema mas
  `KnowledgeChunk.metadata` pode ser `undefined` — corrigido com fallback.
- **notes/suppliers/kanban**: `search`/`search_cards` já tinham `_score`
  corretamente calculado e anexado — nenhuma correção necessária.
- **kanban**: `ColumnSchema` usava `name` (o real campo gravado é `title`)
  — corrigido no contrato; `create_card` tinha o mesmo padrão de
  `undefined` explícito em `description`/`dueDate` — corrigido no handler.
- **purchase-notes**: mesmo padrão de `undefined` explícito em
  `unmatchedItems[].cProd` (campo opcional dentro de um array) — corrigido.

Nenhuma mudança de comportamento pra chamadas hoje bem-formadas — os fixes
fecham gaps que só se manifestavam quando um campo opcional estava ausente
(caso comum) ou quando o LLM mandava um payload malformado (antes: 500 cru;
agora: 400 estruturado).

**Fora de escopo desta fatia (M11.1b)**: portar os 16 domínios restantes do
lado Python (`agent/app/tools/contracts/`) pra Pydantic — hoje só
`agenda`/`orders`/`clients`/`sales` têm modelo de resposta ali. Escopo maior
e codebase diferente; risco de erro sem ver payloads reais de produção.
Deliberadamente adiado.

## M11.2 — Rate limiting na API v1

Das 22 rotas `/api/v1/*`, só `conversations/send` tinha rate limit. Aplicado
`checkBusinessRateLimit` (mesmo helper, endpoint key `v1-<recurso>-write`,
janela de 1h) às 19 rotas restantes com pelo menos 1 método mutante — as 2
únicas rotas somente-leitura (`fiscal/documents`, `conversations/messages`)
corretamente não precisavam de nada.

Tiers: **300/hora** (risco financeiro/agendamento) — `sales`, `transactions`,
`purchase-notes`, `broadcasts`, `appointments`, `bank-accounts`. **600/hora**
(risco individual menor) — `products`, `services`, `stock-movements`,
`crm/contacts`, `crm/deals`, `crm/activities`, `kanban/boards`,
`kanban/cards`, `snippets`, `sectors`, `segments`, `users`, `conversations`.

Posicionamento da API confirmado com o usuário: interna/automação (agente +
integrações que o próprio negócio controla), não developer-facing pra
terceiros — por isso limites generosos, sem investimento em portal/
OpenAPI/versionamento formal nesta fatia.

## M11.3 — Idempotência em `/api/v1/appointments`

Único endpoint de escrita relevante ainda sem `X-Idempotency-Key` (G3 do
`architecture-map.md`, parcialmente obsoleto — `sales`/`products` já
tinham). Adicionado `withIdempotency` no POST, mesmo padrão exato de
`sales`/`products`: sem header, comportamento idêntico ao anterior; com
header repetido, replay devolve o mesmo resultado (`_idempotent: true`).

## M11.4 — Reindex automático do catálogo (parcial)

Texto da UI (`SettingsModule.tsx`) corrigido — não promete mais um cron de
6h que nunca existiu. Decisão de automatizar de fato (trigger em write vs.
cron real) NÃO tomada nesta fatia — trade-off de custo de embedding
deliberadamente deixado dormente até sinal de demanda real.

## Metodologia — subagentes em paralelo, uma verificação séria

Dado o volume (16 domínios de contrato + 19 rotas de rate limit), o trabalho
foi paralelizado em 5 agentes em background: 1 pra rate limiting (19 rotas)
e 4 pra Zod-wiring (4 domínios cada). Um desses 4 agentes (notes/
purchase-notes/suppliers/kanban) foi interrompido por limite de sessão/API
no meio da tarefa — o resumo devolvido veio marcado como parcial/não
confiável. Em vez de aceitar o resumo, os 4 arquivos de rota + os 4 de
contrato desse grupo foram lidos e conferidos manualmente linha a linha
(shape do handler vs. schema, ação por ação) antes de seguir — o trabalho
real já estava completo e correto nos 4 domínios, só o relatório final do
agente que não chegou a ser escrito.

**Erro cometido e corrigido nesta mesma fatia**: ao criar o contrato de
`send-interactive`, usei `Write` num path que JÁ tinha um arquivo versionado
(`git log` confirma commit `97f2d0f`) sem lê-lo primeiro — sobrescrevendo um
contrato pré-existente (nunca importado/wireado, mas com bounds de tamanho
sensatos que valiam a pena preservar). Detectado durante a auditoria
pré-commit (`git status` mostrou `M`, não `??`, sinal de que o arquivo já
existia). Reconciliado: mantido o literal de action correto (verificado
contra `client.py`, diferente do `'send'` do arquivo antigo, que nunca foi
exercitado de verdade), restaurados os limites de tamanho do arquivo
original. Nenhum outro arquivo referenciava os exports antigos (confirmado
via grep) — sem regressão, mas o processo (Read-antes-de-Write) deveria ter
sido seguido à risca independente do resultado.

## Verificação

- `npm run typecheck` — limpo em cada fatia e no estado final combinado.
- `npm run test` — 1071 testes / 80 arquivos, sem regressão, no estado
  final combinado (mesma baseline do resto da sessão).
- Sem migração de dado necessária.
- Smoke manual não executado (mesma ressalva de sempre — precisa de
  ambiente com o agente Python rodando de verdade).

## Fora de escopo deliberado

- M11.1b (Pydantic pro lado Python, 16 domínios restantes).
- M11.4 completo (decisão de automatizar reindex).
- Qualquer trabalho de "API pública developer-facing" (OpenAPI, portal,
  versionamento formal) — decisão explícita do usuário de manter o
  posicionamento interno/automação por agora.
