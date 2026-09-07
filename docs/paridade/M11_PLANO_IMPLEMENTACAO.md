# M11 — Plano de Agente de IA, API pública e Integrações

> Análise concluída em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Estado: investigação de abertura concluída em 05/09/2026 (mesmo rigor de M05/M08/M09/M10/M13).
> Nenhum código alterado nesta fatia de investigação — fixes na sequência.

---

## 0. Escopo reivindicado pelo roadmap (citação literal)

> M11 — Agente de IA, API pública e Integrações
> - Status: `Planejado`
> - Contratos de entrada e saída das ferramentas do agente.
> - Permissões, orçamento, memória, RAG e observabilidade.
> - API pública versionada e integrações externas com segredos protegidos no servidor.

## 1. Correções ao que o roadmap presumia

- "Planejado" está desatualizado a ponto de contradizer a própria tabela de priorização do
  mesmo roadmap (linha 58: "Agente já cobre agendamento básico via booking público; evoluir
  mais não é urgente agora" 🟢), que já reconhecia código real 15 linhas antes da entrada
  `Planejado` nunca ter sido reconciliada.
- As 3 sub-áreas têm implementação real e substancial: serviço Python separado (FastAPI +
  LangGraph, grafo de 6 nós com reflection, não 4 como o próprio `agent/README.md` descreve —
  README desatualizado em relação ao próprio código), 21 rotas de tool + 6 rotas de infra no
  Next.js, stack RAG completo (embed/store/memory/reindex), 22 rotas de API v1 100%
  autenticadas, gateway Mercado Pago com OAuth completo + 3 crons de resiliência já agendados
  (corrigidos em M10), sync real com Google Calendar, canais multi-WhatsApp genuinamente wired.
- `docs/architecture-map.md` já continha um "gap register" (G1/G3/G6) que antecipava boa parte
  desta investigação. G3 (falta idempotency-key) está parcialmente obsoleto — `sales`/`products`
  já têm idempotência real (corrigida em trabalho anterior de M03); só `appointments` continua
  sem.
- `PRE_PRODUCTION_CHECKLIST.md` referencia `vercel.json` para agendar cron do agente — arquivo já
  removido deliberadamente em M10 (produção é 100% Docker). Também lista "GitHub" como integração
  Enterprise real, mas nunca existiu rota para isso.

## 2. O que já existe e funciona

- **Agente**: auth HMAC bidirecional com anti-replay real (`lib/agent/auth.ts`), circuit breaker
  por tenant (`lib/agent/circuit-breaker.ts`), rate limiting cross-worker via Firestore
  (`lib/agent/rate-limit.ts`), dispatcher de inbound completo (debounce, gate de IA
  ligada/desligada, indicador de digitação, memória de longo prazo, pré-carga de horários
  considerando feriados/overrides), budget diário real e enforced (`agent/app/budget.py` +
  `app/api/agent/budget/route.ts`, aborta o run ANTES de qualquer chamada LLM se excedido),
  observabilidade real e consultável (`agentRuns`, `businessId` forçado pelo servidor via HMAC).
- **RAG**: real, não stub — embed (`lib/rag/embed.ts`), vector store com dedup por
  `contentHash` (`lib/rag/store.ts`), memória semântica por contato com eviction
  (`lib/rag/memory.ts`), reindex de produtos/serviços/snippets/políticas
  (`lib/rag/reindex.ts`). Wired ponta-a-ponta nas tools `knowledge`/`memory` e no dispatcher.
- **Guardrails Python**: validador de schema leve (`agent/app/tools/validator.py`) + checks
  semânticos por tool + role gating real (`TOOL_MIN_ROLE`, 12 tools destrutivas exigem
  manager/admin, `agent/app/tools/guardrails.py`).
- **API v1**: 22 rotas, autenticação por API key 100% consistente (`lib/middleware/
  apiKeyAuth.ts` — hash SHA-256, scopes, expiração), gestão de keys real na UI (32 scopes
  granulares), idempotência real em `sales`/`products`.
- **Integrações que importam pro tenant**: Google Calendar (OAuth + criptografia de token, real
  e usado pela Agenda), Mercado Pago (OAuth Marketplace completo, 3 crons de resiliência já
  agendados via Docker desde M10), canais WhatsApp/Meta/Facebook/Instagram (abstração real via
  `channelConnections.ts`, consumida por webhooks/envio/broadcasts).

## 3. Gaps reais encontrados

### Gap 1 — ALTO: contratos Zod do agente existem mas só 4 de 21 rotas os aplicam

`lib/contracts/api/agent/` tem 20 domínios com schema Zod completo e um registry pronto
(`index.ts`) + helper de wiring não-invasivo (`parseToolRequest`/`validateToolResponse`,
`lib/contracts/_runtime/agentToolValidation.ts`). Só `agenda`/`financial`/`fiscal`/`reports`
realmente chamam esse helper — as outras 17 rotas fazem cast manual (`body.params as X`) sem
validação de runtime. No lado Python, a cobertura de output schema é OUTRO conjunto de 4
domínios (`agenda`/`orders`/`clients`/`sales`) — a interseção "validado ponta-a-ponta" é só
`agenda`. Payload malformado do LLM nas outras 16-17 rotas passa até o handler, que pode falhar
com 500 genérico em vez de erro estruturado que o LLM consiga corrigir.

### Gap 2 — ALTO: rate limiting da API v1 é quase inexistente e o que existe não é durável

Das 22 rotas `/api/v1/*`, só `conversations/send` aplica rate limit. As outras 21 — incluindo
`sales`/`transactions`/`broadcasts`/`purchase-notes`, todas com potencial de abuso financeiro/
spam — não têm limite nenhum por chave de API. O limiter usado
(`lib/utils/rateLimit.ts`) é in-memory por instância (o próprio comentário do arquivo admite
"resets on cold starts... replace with Redis-backed for production at scale"). Contraste: o
rate-limiter do agente é Firestore-backed e cross-worker — a API pública não tem o mesmo nível
de robustez que a superfície do próprio agente.

### Gap 3 — MÉDIO: RAG do catálogo só atualiza por clique manual, texto da UI promete cron inexistente

Nenhuma rota de CRUD de produto/serviço/snippet chama `upsertChunk` na escrita. A UI promete
"reindex manual ou será agendado a cada 6h" (`SettingsModule.tsx:3862`) — esse cron não existe
em lugar nenhum (nem Docker, nem GitHub Actions). Se um tenant cadastra produto novo, o agente
não "sabe" dele via `knowledge_search` até um admin clicar manualmente.

### Gap 4 — MÉDIO: API v1 sem estratégia de versionamento além do prefixo de URL

Sem negociação de versão, sem header de depreciação, sem spec OpenAPI gerada (libs existem em
`node_modules`, nenhum arquivo do projeto as usa). "Versionada" hoje é só `/v1/` no path.

### Gap 5 — MÉDIO: 8 proxies de integração são código real porém 100% órfão (cockpit de founder morto)

`app/components/features/integrations/` (14 arquivos, 4398 linhas) continua sem importador vivo
(reconfirmado — mesmo achado do M09). As 8 rotas server-side que essa UI chamaria
(`app/api/integrations/{stripe,aws,cloudflare,godaddy,resend,sentry,supabase,vercel}`) SÃO
código real e bem escrito (MRR real do Stripe, custo real da AWS via SDK) — não são stubs, mas
são inatingíveis porque zero UI viva as invoca. Achado de enquadramento: essas 8 abas descrevem
um "cockpit de operações do próprio SaaS" (custo AWS, MRR Stripe dos clientes do Aevo, deploys
Vercel) — não é "central de conectores" no sentido do bullet do roadmap (que fala de
pagamento/calendário/canais, já sólidos via Mercado Pago/Google Calendar/WhatsApp).

### Gap 6 — BAIXO: `/api/v1/appointments` sem idempotency-key (G3 do architecture-map, parcial)

Único endpoint do G3 original ainda sem o padrão já usado em `sales`/`products`.

### Gap 7 — BAIXO: documentação secundária desatualizada (higiene, não risco funcional)

`agent/README.md` descreve grafo de 4 nós (real tem 6, com reflection).
`PRE_PRODUCTION_CHECKLIST.md` referencia `vercel.json` (removido em M10) e integração GitHub
(nunca existiu). `docs/architecture-map.md:54` descreve o cockpit morto como se fosse ativo.

## 4. O que é decisão de produto, não de engenharia

- **Destino do cockpit morto (Gap 5)**: apagar (4398 linhas mortas, zero risco), religar como
  página de admin interno (fora do menu do tenant), ou transformar em feature Enterprise
  vendável a clientes grandes (conectar a própria AWS/Stripe/Sentry)?
- **Posicionamento da API v1**: "API para automação/agente de IA" (como o próprio texto da UI de
  criação de chave já diz) ou "API pública developer-facing para parceiros externos"? Muda a
  prioridade real dos Gaps 2/4 (rate-limit robusto e versionamento importam mais se for
  developer-facing de verdade).
- **Reindex automático do catálogo (Gap 3)**: trigger em toda escrita (custo de embedding maior,
  sempre atualizado) vs. cron periódico (mais barato, staleness aceitável) — trade-off de custo,
  não só engenharia.
- **Teto de orçamento diário padrão** (`DEFAULT_DAILY_CAP_USD = 5`) — decisão de pricing, vale
  confirmar se ainda reflete custo real por conversa.

## 5. Fases

### M11.0 — Checkpoint de escopo (decisão de produto) ✅ Concluído (05/09/2026)
- [x] Perguntado ao usuário: destino do cockpit morto → **apagar**. Posicionamento da API v1 →
      **interna/automação** (não developer-facing pra terceiros).
- [x] Apagados: `app/components/features/integrations/` (14 arquivos, 4398 linhas), as 8 rotas
      órfãs `app/api/integrations/{aws,cloudflare,godaddy,resend,sentry,stripe,supabase,vercel}`
      (reconfirmado zero consumidor fora do próprio módulo morto antes de apagar) e
      `lib/utils/integrationKeys.ts` (helper só usado pelas 8 rotas apagadas — reconfirmado
      órfão). `google-calendar`/`mercadopago` (reais, usados) preservados intocados. Settings→
      Enterprise (config de API keys, incl. Resend usado de verdade por
      `financial/notify/service.ts`) preservado — é gravação, não o cockpit de leitura apagado.
      `docs/architecture-map.md:54` e `CLAUDE.md` §5 atualizados (linha do módulo removida).

### M11.1 — Fechar validação Zod das rotas de tool do agente (Gap 1, engenharia pura, TS-side) ✅ Concluído (07/09/2026)
- [x] Estendido `parseToolRequest`/`validateToolResponse` a 16 domínios (orders, catalog,
      clients, crm, inventory, sales, memory, business, services, team, knowledge,
      conversations, notes, purchase-notes, suppliers, kanban) + `send-interactive` (nunca
      teve contrato registrado — criado do zero, action `'send_interactive'` verificado
      contra `agent/app/tools/client.py`). Todos os 21 domínios/rotas de tool agora validam.
      Vários bugs reais de divergência contrato↔handler encontrados e corrigidos ao longo do
      caminho (ver `docs/agente/AGENTE_M11_FIXES.md`).
- [ ] Porte Python (16 domínios Pydantic restantes) tratado como fase separada (M11.1b) —
      escopo maior, codebase diferente, risco de erro maior sem ver payloads reais em produção.

### M11.2 — Rate limiting real na API v1 (Gap 2, engenharia pura) ✅ Concluído (07/09/2026)
- [x] Aplicado `checkBusinessRateLimit` às 19 rotas restantes com método mutante (as 2 rotas
      somente-leitura `fiscal/documents`/`conversations/messages` corretamente não precisavam).
      300/hora para sales/transactions/purchase-notes/broadcasts/appointments/bank-accounts;
      600/hora para as demais 13.

### M11.3 — Idempotência em `/api/v1/appointments` (Gap 6, engenharia pura, baixo esforço) ✅ Concluído (05/09/2026)
- [x] `withIdempotency` (mesmo padrão de `sales`/`products`) no POST — sem chave, comportamento
      idêntico ao anterior; com chave, replay retorna o mesmo resultado (`_idempotent: true`).

### M11.4 — Reindex automático do catálogo (Gap 3, depende de decisão de custo)
- [x] Texto da UI corrigido (`SettingsModule.tsx:3862`) — não promete mais um cron de 6h
      inexistente, deixa claro que é manual hoje.
- [ ] Decisão de automatizar (trigger em write vs. cron real) NÃO perguntada nesta fatia —
      trade-off de custo de embedding, deliberadamente deixado dormente até sinal de demanda
      (mesmo tratamento de outros itens de custo/produto dormentes nesta sessão). Reabrir se o
      usuário achar o catálogo desatualizado no agente na prática.

### M11.5 — Higiene de documentação (Gap 7, custo zero) ✅ Concluído (05/09/2026)
- [x] `agent/README.md` (grafo real, 6 nós com reflection). `PRE_PRODUCTION_CHECKLIST.md`
      (removida seção "Integrações Enterprise" obsoleta, corrigida seção 9.4 pra Docker em vez
      de vercel.json). `docs/architecture-map.md:54` (linha do cockpit removida, não só
      requalificada — módulo foi apagado, não só re-rotulado). `CLAUDE.md` §5 (módulo
      `integrations` removido do mapa; `api/integrations/*` descrito como
      Google Calendar+Mercado Pago; grafo do agente corrigido pra 6 nós).

### M11.6 — Testes, homologação e aceite

- [x] `npm run typecheck`/`npm run test` limpos em cada fatia e no estado final combinado
      (1071 testes/80 arquivos, sem regressão).
- [ ] Smoke manual (não executado — precisa de ambiente com o agente Python rodando de
      verdade, mesma ressalva recorrente desta sessão).

**M11 fecha aqui (07/09/2026)**: M11.0–M11.3 e M11.5 concluídos; M11.4 parcial (texto da UI
corrigido, decisão de automação de reindex deliberadamente adiada); M11.1b (Python) e o
smoke manual ficam como pendências conhecidas, não lacunas silenciosas.

## 6. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Adicionar rate limit quebrar integração de cliente real da API v1 | Limites generosos, mesma ordem de grandeza do agente (120/min); nenhum tenant real usa a API v1 hoje via terceiro confirmado |
| Validação Zod nova rejeitar payload que hoje passa (mesmo malformado) | Reaproveita exatamente o mesmo helper já provado em 4 domínios; erro estruturado é estritamente melhor que 500 genérico |
| Investir no cockpit morto sem necessidade real | Checkpoint explícito (M11.0) antes de qualquer código nele |

## 7. Ordem de entrega recomendada

1. **M11.0** — checkpoint de produto (rápido, não bloqueia o resto).
2. **M11.3** — idempotência de appointments (baixo esforço, alto valor).
3. **M11.5** — higiene de documentação (custo zero).
4. **M11.2** — rate limiting da API v1 (mecânico, alto valor de segurança).
5. **M11.1** — validação Zod das rotas de tool (mecânico, maior volume).
6. **M11.4** — conforme decisão de M11.0.
7. **M11.6** — aceite.
