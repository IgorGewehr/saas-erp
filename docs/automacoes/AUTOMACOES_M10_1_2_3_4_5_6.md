# Automações — M10.1/2/3/4/5/6

> Concluído em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: primeira rodada de execução do plano M10, com 3 checkpoints de decisão apresentados
> ao usuário e respondidos, mais os itens de engenharia pura que dependiam dessas respostas ou
> eram independentes delas.

## M10.1 — Topologia de deploy confirmada: só Docker

O usuário confirmou: **não existe deploy Vercel ativo** — `vercel.json` era resíduo morto. Isso
significa que os 3 crons de resiliência do Mercado Pago (`expire-pix`, `reconcile`,
`refresh-tokens`) — o código de cron mais bem projetado do repo (CAS transacional, recuperação de
estoque "recuperável", detecção de órfãos) — **realmente nunca executavam em produção**.

**Corrigido**: os 3 crons MP + `/api/membership-billing/run` (M10.2) foram adicionados ao loop
`docker-compose.yml` (única fonte de cron real agora):
- `mercadopago/cron/expire-pix` + `mercadopago/cron/reconcile`: a cada 10 min (recomendação do
  próprio docstring das rotas).
- `mercadopago/cron/refresh-tokens`: 1x/dia, 04:00.
- `membership-billing/run`: 1x/dia, 06:00.

`vercel.json` foi **removido** (não apenas ignorado) — deixá-lo no repo, contradizendo a
topologia real confirmada pelo usuário, seria exatamente o tipo de inconsistência silenciosa que
esta sessão inteira tem caçado.

## M10.2 — Cobrança de assinatura confirmada em uso

Usuário confirmou que a odontologia usa `clientMemberships`. `/api/membership-billing/run`
agendado (ver M10.1 acima) — 1x/dia às 06:00, mesmo padrão dos outros jobs diários.

## M10.3 — Missed-run pro lembrete de atendimento: investigado, achado que não se aplica como planejado

O plano original assumia reuso direto de `detectAndNotifyMissedRun`/`markSuccessfulRun`
(`scheduledFallback.ts`), mesmo padrão de `birthdayCampaignRunner.ts`. **Investigação encontrou
que o encaixe não é direto**: o mecanismo existente é modelado em torno de uma ENTIDADE por
tenant (uma `BirthdayCampaign` com `id`/`businessId`/`sendAtHour`/`createdBy` — um dono real pra
notificar). `appointmentReminderRunner.ts` é uma varredura ÚNICA cross-tenant (não iterra por
campanha/negócio configurável) — não existe uma entidade "esta execução do lembrete" com dono
único pra notificar quando o slot é perdido. Forçar o encaixe exigiria inventar uma entidade
artificial ou notificar TODOS os negócios com agendamento no período, o que não é o mesmo
mecanismo e merece seu próprio desenho.

**Não implementado nesta fatia** — dobrado na pergunta de produto já sinalizada no plano (M10,
§5, "vale um canal de alerta operacional genérico?"), que fica mais concreta agora: a real
necessidade aqui não é "reusar scheduledFallback", é decidir se vale construir um mecanismo de
saúde de cron NOVO (heartbeat global, não por-entidade) — decisão de produto/prioridade, não
resolvida silenciosamente aqui.

## M10.4 — Idempotência por episódio estendida aos 2 triggers restantes ✅

`shouldSkipRepeatedAutomation` (guard via `automationRuleLogs`, M06.5c) só cobria
`client_inactive`. Estendido pra `high_churn_risk` e `lifecycle_change`
(`app/api/agent/scheduled/run/route.ts`) — mesmo bug de spam diário (condição permanece
verdadeira indefinidamente, ação redispara todo dia que a regra rodar), agora fechado nos 3
triggers state-based.

Fingerprint por trigger (o valor que, ao mudar, indica um novo "episódio" legítimo):
- `client_inactive`: `client.lastVisit` (já existia).
- `high_churn_risk`: `scores.churnRisk` — imperfeito (o score pode oscilar sem um episódio de
  verdade), mas é o sinal mais próximo disponível sem mudar o schema; mesmo nível de precisão já
  aceito pra `client_inactive`.
- `lifecycle_change`: `client.updatedAt` — não existe campo dedicado de "quando a
  `lifecycleStage` mudou"; reusar `updatedAt` é aproximado (qualquer edição do cliente também
  muda o valor), mas resolve o bug confirmado (disparo garantido todo dia) sem exigir campo novo
  no schema.

## M10.5 — `sendFinancialNotifications` respeita opt-out ✅

Usuário confirmou: cobrança de atendimento via WhatsApp/e-mail deve respeitar
`marketingOptOuts`, por consistência com os outros 3 caminhos já corrigidos nesta sessão
(broadcasts, aniversário, automações CRM). `app/api/financial/notify/service.ts`: nova
`fetchOptOutSet`/`isOptedOut` (lida 1x por negócio, chave `channel:identifier` cobre `all` +
canal específico numa única leitura, reusada pelos 2 loops — vencimento próximo e cobrança
atrasada — e pelos 2 canais — WhatsApp e e-mail). Cada um dos 4 pontos de envio (WhatsApp
vencimento, e-mail vencimento, WhatsApp atrasado, e-mail atrasado) agora checa o opt-out antes de
enviar.

## M10.6 — Correção de documentação (custo zero) ✅

`lib/contracts/events/index.ts`: jsdoc de `deliveryOrder.confirmed` corrigido — afirmava no
presente que o evento "serve pra trilha de auditoria em `domainEvents/{id}`", mas nenhum código
dispatcha esse evento hoje (confirmado por grep). Corrigido pra refletir a realidade: só schema,
sem trilha de auditoria, promoção é decisão de produto separada.

## Verificação

`tsc --noEmit` limpo, suíte completa sem regressão. Sem teste novo — nenhum dos arquivos tocados
(`docker-compose.yml`, `financial/notify/service.ts`, `agent/scheduled/run/route.ts`,
`lib/contracts/events/index.ts`) tem cobertura prévia nesta categoria (cron/webhook/config), mesma
convenção já estabelecida nesta sessão. **`docker-compose.yml` não foi testado rodando de
verdade** — recomendado validar após deploy que os novos jobs (MP + membership-billing) de fato
disparam nos horários configurados (`docker compose logs cron`).
