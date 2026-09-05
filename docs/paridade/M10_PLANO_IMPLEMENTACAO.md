# M10 — Plano de implementação de Automações, Notificações e Eventos de Domínio

> Análise concluída em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Lente desta rodada: **odontologia** — cliente pagante real, sem cardápio/delivery/PDV ativo.
>
> Estado: investigação de abertura concluída em 05/09/2026 (mesmo rigor de M06/M03/M07). Nenhum
> código alterado nesta fatia — só investigação e plano. **Achado crítico que precisa de
> confirmação do usuário antes de qualquer priorização**: ver §1.

---

## 0. Correções ao que o roadmap presumia

"Planejado" está errado no mesmo sentido que M06/M04/M03/M07: existe um núcleo real e em
produção — 7 crons vivos, um bus de eventos de domínio com handlers reais, dedup atômico de
webhook, um mecanismo de "missed-run" já usado em produção, e uma coleção literalmente rotulada
"Dead-letter queue" em `firestore.rules:1159`. Mas a convergência está **pior** aqui do que em
M06/M07: existem dois inventários de cron divergentes no repo (`docker-compose.yml` vs
`vercel.json`), e a divergência não é cosmética.

## 1. Achado crítico — precisa de confirmação do usuário (GAP A)

`docker-compose.yml:100-170` (serviço `cron`, loop bash wall-clock, autentica com
`Authorization: Bearer ${CRON_SECRET}`, chama `app:3000` — self-contained, não depende de
scheduler externo) é a fonte real de cron em produção, conforme `docker_compose_crons` (memória
do projeto). Ele agenda:

| Endpoint | Cadência |
|---|---|
| `/api/broadcasts/process-scheduled` | 1 min |
| `/api/appointments/run-reminders` | 5 min |
| `/api/fiscal/cron/transmit-contingencia` | 30 min |
| `/api/agent/scheduled/run` | 1x/hora |
| `/api/birthday-campaigns/run` | 1x/hora |
| `/api/fiscal/cron/consultar-processando` | 1x/hora |
| `/api/data-retention/run` | 1x/dia (03:00) |

`vercel.json:1-24` lista um conjunto **diferente**:
```
/api/agent/scheduled/run                              0 * * * *
/api/birthday-campaigns/run                            0 * * * *
/api/integrations/mercadopago/cron/expire-pix          */10 * * * *
/api/integrations/mercadopago/cron/reconcile           */10 * * * *
/api/integrations/mercadopago/cron/refresh-tokens      0 4 * * *
```

Os 3 crons do Mercado Pago **não aparecem no `docker-compose.yml`**. Evidência de que
`vercel.json` é resíduo morto (não confirmado, só indício): as 3 rotas MP foram endurecidas em
2026-06-29 (commit `5152a60`, "remedia auditoria MP") — **depois** da última edição do
`docker-compose.yml` (2026-05-27, `37555ce`) — ou seja, foram criadas/fortalecidas depois do
scheduler Docker existir e nunca entraram nele.

**Consequência se confirmado**: os 3 crons de resiliência do Mercado Pago — `expire-pix`,
`reconcile`, `refresh-tokens` — são o código de cron mais bem projetado do repo (CAS
transacional, recuperação de estoque "recuperável", detecção de órfãos, sinais operacionais) e
**provavelmente nunca executam em produção**. PIX pendente que expira sem webhook fica `pending`
pra sempre (estoque preso); webhook de aprovação/estorno perdido nunca reconcilia; token MP nunca
renova proativamente → reconexão manual forçada.

**Achado adicional, confirmado morto nos DOIS inventários**: `/api/membership-billing/run`
(`lib/services/membershipBillingRunner.ts`) — totalmente implementado, idempotente
(`membershipBillingLogs/{id}_{cycle}` via `runTransaction`), TZ-aware, o próprio docstring
recomenda "rodar 1x/dia" — **não está em nenhum dos dois inventários**. Se algum tenant tiver
`clientMemberships` ativas, mensalidade nunca é cobrada.

**Isto precisa da confirmação do usuário sobre topologia de deploy real antes de qualquer
priorização** — ver checkpoint no §5.

## 2. Inventário do que já está hardenizado (baseline M10 herdado de M06/M07)

- **`birthdayCampaignRunner.ts`**: idempotência transacional por `(campaignId,clientId,year)`,
  catch-up de 6h, missed-run via `scheduledFallback.ts`, opt-out LGPD (M07.1), TZ por business.
- **`appointmentReminderRunner.ts`**: idempotência transacional por `(aptId,minutesBefore,slot)`,
  TZ por business (M06.5), seguro contra reagendamento. **Sem** detecção de missed-run (gap,
  §3 GAP C).
- **`app/api/agent/scheduled/run/route.ts`**: dupla auth, rate-limit em trigger manual, TZ-aware,
  opt-out respeitado (M06.5c), `client_inactive` com idempotência por episódio.
- **`broadcasts/process-scheduled/route.ts`**: CAS transacional, gate de consentimento LGPD,
  concorrência limitada.
- **`appointment.completed/.canceled/.noShow`**: handlers relêem doc fresco, reconfirmam
  `businessId`/status, idempotentes via CAS.
- **`webhookIdempotency.ts`**: dedup atômico via `.create()`, usado por Meta e Baileys (M07.2).
- **Crons Mercado Pago** (se rodarem — ver §1): os mais hardenizados do repo — CAS de FSM, claim
  de restauro "recuperável", detecção de órfãos, sinais operacionais agregados.

## 3. Gaps reais encontrados (medidos contra R3/R5 e o pedido explícito do roadmap)

### GAP A — crítico, ver §1 (confirmação de topologia de deploy)

### GAP B — alto: `membership-billing/run` nunca agendado (ver §1)

### GAP C — médio: falha de cron é essencialmente invisível

O loop bash só faz `echo` no stdout do container em falha HTTP (invisível sem `docker compose
logs cron`). Zero SDK de observabilidade no código da aplicação (grep por `@sentry`/`Sentry\.` =
0). `detectAndNotifyMissedRun`/`markSuccessfulRun` (`scheduledFallback.ts`) — único mecanismo
real de "avisar humano que o cron perdeu o slot" — é usado **só** por `birthdayCampaignRunner.ts`
(confirmado, único call-site fora da própria definição). `appointmentReminderRunner` (o job mais
crítico pra uma clínica — lembrete de atendimento), `membershipBillingRunner`,
`broadcasts/process-scheduled`, `data-retention`, motor de automação CRM — nenhum tem
equivalente.

### GAP D — médio: idempotência por episódio incompleta nas automações CRM (já sabido, confirmado ainda verdadeiro)

`automationRuleLogs` (M06.5c) só está ligado pro trigger `client_inactive`
(`agent/scheduled/run/route.ts:902`). `high_churn_risk` e `lifecycle_change` não têm guard — a
ação (`notify_team`/`send_whatsapp`/`add_tag`) redispara todo dia em que a regra rodar, mesmo bug
de spam que M06.5c já corrigiu pro trigger irmão. Documentado em M06.5c como "fora do escopo
daquela fatia especificamente sobre recall" — agora é o escopo natural do M10.

### GAP E — baixo/médio, decisão de produto: `sendFinancialNotifications` não checa opt-out

`app/api/financial/notify/service.ts` dispara cobrança/vencimento via WhatsApp sem checar
`marketingOptOuts`, diferente de broadcasts/aniversário/automações CRM (todos corrigidos nesta
sessão). Pode ser correto (cobrança é "transacional", não "marketing" sob LGPD) — mas mesma
classe de bug já achada 2x nesta sessão, vale confirmação explícita em vez de assumir.

### GAP F — baixo: `webhookSeen` sem purga de TTL

Grava `expiresAt` (intenção de 24h) mas nenhum job no repo purga a coleção — só funciona se uma
TTL policy do Firestore foi configurada fora do repo (console/gcloud, não verificável pelo
código).

### GAP G — arquitetural, esperado: sem retry no bus de eventos

`dispatchDomainEvent()` não tem retry — handler que falha só é logado em `handlerResults` no doc
de auditoria. Único "reprocessamento" real é o script manual `scripts/reconcile-appointment-
completions.ts` (exige `--businessId` explícito, dry-run por padrão). "Tentativas" do pedido do
roadmap é hoje 100% runbook manual — proporcional ao volume atual (1-2 tenants), não um bug.

## 4. Eventos de domínio (R5) — declarado vs. dispatchado vs. com handler

18 tipos declarados em `lib/contracts/events/index.ts:406-425`:

- **Promovidos, com handler real** (`lib/contracts/_runtime/handlers/index.ts:27-29`):
  `appointment.completed`, `appointment.canceled`, `appointment.noShow`.
- **Dispatchados/persistidos, audit-only (sem handler)**: `appointment.trialCompleted`,
  `payment.approved`/`payment.refunded`, `purchase.imported/financialLinked/reverted`,
  `commercial.operationCompleted` (os 2 últimos gravados via `tx.create` direto, não via bus —
  deliberado, registro de auditoria precisa ser atômico com a tx de negócio).
- **Declarados no schema mas NUNCA dispatchados em código nenhum** (8 no total): `sale.finalized`,
  `deliveryOrder.confirmed`, `client.created`, `booking.created`, `form.submitted`,
  `broadcast.replied`, `conversation.reopened`, `caixa.fechado`. A maioria já se auto-rotula
  honestamente "não implementado ainda" no próprio jsdoc (`booking.created:135`,
  `form.submitted:150`, `caixa.fechado:365-367`). **Uma exceção real de imprecisão de
  documentação**: `deliveryOrder.confirmed:210-214` afirma no presente que o evento "serve pra
  trilha de auditoria em `domainEvents/{id}`" — isso não é verdade hoje, nenhum código constrói
  esse evento. Correção de doc de custo zero, ver M10.6.

## 5. O que é decisão de produto, não de engenharia

- ~~Topologia de deploy real (GAP A)~~ — **respondido**: só Docker (M10.1).
- ~~Agendar `membership-billing/run`? (GAP B)~~ — **respondido**: sim (M10.2).
- ~~`sendFinancialNotifications` deve respeitar `marketingOptOuts`?~~ — **respondido**: sim (M10.5).
- **Promover algum dos 8 eventos "só schema"?** — maioria é vertical de varejo/delivery/cardápio,
  não clínica; não perseguir sem sinal real. Ainda em aberto.
- **Vale um canal de alerta operacional genérico** (cron falhou → notifica dono)? Ainda em
  aberto, e agora mais concreto: M10.3 confirmou que `scheduledFallback.ts` não se estende
  diretamente a `appointmentReminderRunner.ts` (varredura cross-tenant sem entidade-dona) — um
  canal genérico exigiria um desenho novo (heartbeat global, não por-entidade), não só reuso.
  Vale o investimento pro volume atual (1-2 tenants)?

## 6. Fora de escopo deliberado

- **Dead-letter queue completo com replay automático** e **retry exponencial genérico no bus de
  eventos** — infraestrutura de reprocessamento em escala não se justifica pra 1-2 tenants; o
  padrão atual (notificar dono, runbook manual via CLI) é proporcional e já é a filosofia
  documentada em `scheduledFallback.ts` ("previsibilidade > magia").
  Mesma categoria "dormente até sinal real de demanda" do PIX/Boleto (M03) e Sequências (M07).
- **Promoção dos 8 eventos "só schema" pra dispatch real** (exceto correção de doc do M10.6) —
  tratada como escopo próprio, não deste plano, dado que a maioria é vertical de varejo/delivery.

## 7. Fases

### M10.0 — Baseline (investigação de abertura) ✅ Concluído (05/09/2026)

Feito via agente de investigação dedicado. Achados em §0-§4 acima.

### M10.1 — Confirmar topologia de deploy (checkpoint, GAP A) ✅ Concluído (05/09/2026)

- [x] **Decisão do usuário: só Docker, Vercel não roda mais nada** — `vercel.json` era resíduo
      morto, os 3 crons MP realmente nunca executavam. Adicionados ao loop
      `docker-compose.yml` (`expire-pix`/`reconcile` a cada 10min, `refresh-tokens` 1x/dia
      04:00). `vercel.json` removido (não só ignorado — deixá-lo contradizendo a topologia real
      seria a mesma inconsistência silenciosa caçada a sessão inteira). Doc:
      `docs/automacoes/AUTOMACOES_M10_1_2_3_4_5_6.md`.

### M10.2 — `membership-billing/run` (checkpoint, GAP B) ✅ Concluído (05/09/2026)

- [x] **Decisão do usuário: usa assinaturas — agendar.** Adicionado ao `docker-compose.yml`
      (1x/dia, 06:00).

### M10.3 — Missed-run pro lembrete de atendimento — investigado, achado que a suposição original não se sustenta

- [ ] ~~Estender `detectAndNotifyMissedRun`/`markSuccessfulRun` reuso direto~~ — **investigado,
      achado real**: o mecanismo é modelado em torno de uma ENTIDADE por tenant (uma
      `BirthdayCampaign` com dono pra notificar); `appointmentReminderRunner.ts` é uma varredura
      ÚNICA cross-tenant, sem entidade equivalente. Reuso direto não se aplica sem inventar uma
      entidade artificial ou notificar todos os negócios — mecanismo diferente, merece desenho
      próprio. Dobrado na pergunta de produto já sinalizada no §5 ("vale um canal de alerta
      operacional genérico?"), agora mais concreta. Não implementado nesta fatia. Ver
      `docs/automacoes/AUTOMACOES_M10_1_2_3_4_5_6.md` §M10.3.

### M10.4 — Idempotência por episódio nos triggers restantes (engenharia pura, GAP D) ✅ Concluído (05/09/2026)

- [x] `high_churn_risk` e `lifecycle_change` (`agent/scheduled/run/route.ts`) ganharam o mesmo
      guard via `automationRuleLogs` que `client_inactive` já tinha (M06.5c) — fecha o spam
      diário residual. Fingerprint por trigger: `scores.churnRisk` (high_churn_risk, aproximado —
      score pode oscilar sem episódio real, mesmo nível de precisão já aceito pro trigger irmão);
      `client.updatedAt` (lifecycle_change, aproximado — sem campo dedicado de "quando mudou",
      mas resolve o disparo garantido diário). Doc:
      `docs/automacoes/AUTOMACOES_M10_1_2_3_4_5_6.md`.

### M10.5 — `sendFinancialNotifications` e opt-out (checkpoint, GAP E) ✅ Concluído (05/09/2026)

- [x] **Decisão do usuário: sim, aplicar o mesmo filtro.** `app/api/financial/notify/service.ts`
      ganhou `fetchOptOutSet`/`isOptedOut` (1 leitura por negócio, chave `channel:identifier`
      cobre `all`+canal específico), aplicado nos 4 pontos de envio (WhatsApp/e-mail ×
      vencimento/atrasado). Doc: `docs/automacoes/AUTOMACOES_M10_1_2_3_4_5_6.md`.

### M10.6 — Correção de documentação (custo zero) ✅ Concluído (05/09/2026)

- [x] `lib/contracts/events/index.ts` — jsdoc de `deliveryOrder.confirmed` corrigido (não afirma
      mais uma trilha de auditoria que não existe).

### M10.7 — Purga de TTL do `webhookSeen` (baixa prioridade)

- [ ] Confirmar se existe TTL policy configurada no Firestore Console (fora do repo). Se não,
      decidir se vale um job de purga ou se o crescimento da coleção é aceitável no volume atual.

### M10.8 — Dead-letter/retry genérico — fora de escopo deliberado (ver §6)

### M10.9 — Testes, homologação e aceite

- [ ] Smoke manual: forçar um cron a perder o slot e confirmar que a notificação de missed-run
      chega (M10.3); confirmar que `high_churn_risk`/`lifecycle_change` não redisparam no mesmo
      episódio (M10.4).

## 8. Critérios para marcar M10 como concluído

- [ ] Topologia de deploy real confirmada e os crons MP/membership-billing rodando onde deveriam
      (ou dormentes com justificativa registrada).
- [ ] Job mais crítico pro caso de uso atual (lembrete de atendimento) tem detecção de
      missed-run, mesmo padrão já usado por aniversário.
- [ ] Automações CRM não redisparam a mesma ação pro mesmo cliente/episódio nos 3 triggers
      state-based (não só 1).
- [ ] `deliveryOrder.confirmed` não afirma mais uma trilha de auditoria que não existe.

## 9. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Confirmar que crons MP estão mortos e "consertar" adicionando ao Docker sem que o ambiente real seja Docker (ex.: só um teste antigo) | Checkpoint explícito com o usuário antes de qualquer mudança de infraestrutura de cron |
| Estender `scheduledFallback.ts` pra outro job e quebrar o mecanismo que já funciona pro aniversário | Reuso direto da mesma função já testada em produção, não reimplementação |
| Investir em dead-letter/retry genérico sem demanda real | Deliberadamente fora de escopo (§6), dormente até sinal real |

## 10. Ordem de entrega recomendada

1. **M10.1** ✅ — checkpoint de topologia de deploy: só Docker, crons MP agendados.
2. **M10.2** ✅ — checkpoint membership-billing: usa assinaturas, agendado.
3. **M10.3** — missed-run pro lembrete de atendimento: investigado, reuso direto não se aplica;
   dobrado na pergunta em aberto do §5 (canal de alerta operacional genérico).
4. **M10.4** ✅ — idempotência por episódio nos 2 triggers restantes.
5. **M10.5** ✅ — checkpoint `sendFinancialNotifications`/opt-out: aplicar o filtro, feito.
6. **M10.6** ✅ — fix de doc.
7. **M10.7** — purga TTL `webhookSeen` (baixa prioridade, ainda não abordado).
8. **M10.8** — permanece dormente (fora de escopo por padrão).
9. **M10.9** — aceite.
