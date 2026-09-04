# Agenda — reengajamento de paciente inativo (recall) — M06.5c

> Concluído em código em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: último item do checklist M06.5 (`docs/paridade/M06_PLANO_IMPLEMENTACAO.md`):
> "Reengajamento de paciente sem retorno há N meses (recall), reaproveitando CRM/campanhas."

## 1. Achado principal: o recall já existia — e tinha dois bugs reais

Antes de desenhar uma feature nova, a investigação (Explore dedicado) procurou o que já existia
e encontrou: **o recall já está implementado**, na aba "Automações" do CRM
(`app/components/features/crm/AutomacoesTab.tsx`) — trigger `client_inactive`, configurável em
dias (`inactiveDays`, até 365 = ~12 meses), com ação `send_whatsapp` e um texto padrão pronto
("Olá {{primeiro_nome}}, sentimos sua falta!"). Executado por `processCRMAutomations()`
(`app/api/agent/scheduled/run/route.ts`). Ou seja: esta fatia não precisava construir nada novo
— precisava **consertar** o que já existia, porque tinha dois bugs reais que tornavam essa
automação arriscada de usar de verdade:

### Bug 1 — campo errado torna metade da condição um no-op

```ts
daysSince(c.lastVisit as string) >= inactiveDays &&
daysSince(c.lastContactAt as string) >= inactiveDays   // ← lastContactAt não existe em Client
```

`Client` não tem campo `lastContactAt` — o campo real é `lastContactDate`
(`lib/types/index.ts`). `daysSince(undefined)` sempre retorna `9999`, então essa segunda
condição sempre era verdadeira — inofensivo (a condição principal, `lastVisit`, continuava
funcionando), mas não fazia o que o código aparentava fazer. Corrigido pro campo certo.

### Bug 2 — sem idempotência por cliente, spam diário garantido

A única trava de repetição existente era **por regra, por dia** (`rule.lastRunAt`), não por
**(regra, cliente)**. Um paciente que cruza os 90 dias de inatividade continua "inativo" —
por definição — todo santo dia até voltar. Sem uma trava por cliente, a automação reenviaria
"sentimos sua falta" TODO dia em que o cron rodasse, pro mesmo paciente, indefinidamente. Esse é
o tipo de bug que, se alguém realmente ligasse essa automação, provavelmente causaria uma
reclamação real do paciente antes de qualquer benefício.

## 2. O que foi entregue

- **`fetchWhatsAppOptOutSet`** — busca em lote (1x por negócio, reusado por todas as
  regras/clientes) o conjunto de telefones que já pediram opt-out de marketing. Mesmo padrão
  (fetch + `Set` em memória, não filtro de 3 campos na query) que `app/api/broadcasts/send/route.ts`
  já usa — reaproveita o MESMO índice composto `[businessId, channel]`, sem índice novo.
- **`shouldSkipRepeatedAutomation`** — idempotência por `(ruleId, clientId)`, nova coleção
  `automationRuleLogs`. Chave não é data (diferente de `birthdayCampaignLogs`, que é anual por
  natureza) — é um "fingerprint de episódio": `client.lastVisit` no momento da ação. Se o
  paciente **não voltou** desde a última vez que a automação agiu (mesmo `lastVisit`), pula —
  já foi actionado pra este episódio de inatividade. Se voltou e ficou inativo de novo depois
  (`lastVisit` mudou), age de novo — é um novo episódio, não repetição.
- `client_inactive` corrigido (bug 1) e agora protegido por idempotência (bug 2), aplicada
  DEPOIS do filtro de condições AND customizadas — só reivindica o "já fiz" pra quem de fato
  vai ser actionado.
- `send_whatsapp` (usado por QUALQUER trigger de automação, não só recall) agora respeita
  opt-out de marketing antes de mandar mensagem — correção de compliance geral, não específica
  de recall.

## 3. Por que não foi preciso tocar em `Broadcast`/`Segment`/campanhas de verdade

O checklist fala em "reaproveitando CRM/campanhas" — investigado a fundo: existe um motor de
campanha completo (`Broadcast`+`Segment`+`lib/campaigns/audience.ts`), mas ele **não suporta
filtro por dias-desde-uma-data** hoje (`evaluateAudienceFilter` só aceita `gt`/`lt` numéricos, e
`lastVisit` é uma string ISO, não um número) — construir recall em cima desse motor exigiria
estender o motor de segmentação primeiro, escopo bem maior. A automação de CRM
(`client_inactive`) já resolve o mesmo problema com uma abordagem mais simples e já
parcialmente construída — reaproveitá-la (consertando os bugs) é mais fiel ao espírito de
"reaproveitar" do que construir um caminho paralelo nessa fatia.

## 4. O que ficou de fora (deliberado)

- **`high_churn_risk` e `lifecycle_change` têm o MESMO bug 2** (sem idempotência por cliente,
  re-actionam todo dia enquanto a condição continuar verdadeira) — achado durante esta
  investigação, não corrigido aqui. Só `client_inactive` foi protegido, por ser o trigger que
  este item do checklist é especificamente sobre. Os outros dois ficam para uma fatia futura de
  hardening geral do motor de automações de CRM.
- **Migrar `client_inactive` pro motor de `Broadcast`/`Segment`** — ver §3; escopo maior,
  exigiria estender `lib/campaigns/audience.ts` pra suportar filtros de data relativa.
- **UI relabeling** ("dias" → "meses") — `inactiveDays` já permite até 365 dias (~12 meses);
  não foi adicionada nenhuma UI nova, só a automação existente ficou segura de usar.
- **Reengajamento de conversa parada** (`dispatchReengagementToAgent`/
  `processStalledConversations`) — confirmado que é um conceito DIFERENTE (cliente que sumiu no
  MEIO de uma conversa ativa, não paciente sem retorno há meses); não tocado, não é o que este
  item do checklist pede.

## 5. Verificação

Verificado por `tsc --noEmit` limpo e suíte completa (968 testes em 73 arquivos — sem
regressão, sem testes novos). **Sem testes novos nesta fatia**: `app/api/agent/scheduled/run/route.ts`
não exporta nenhuma de suas ~16 funções internas hoje e não tem nenhum teste de rota — mesmo
padrão já observado (e mantido) na fatia anterior (M06.5b) para o mesmo arquivo; adicionar
exports/testes só pra este trecho criaria uma inconsistência (por que só 2 de 16 funções
seriam testáveis?) maior que o ganho. Confiança vem de revisão cuidadosa de código +
documentação explícita, não de suíte automatizada. **Não testado contra o cron real em
produção** nesta rodada — antes de confiar de verdade nesta automação: ligar `client_inactive`
num tenant de teste com `inactiveDays` baixo, confirmar que o paciente recebe a mensagem uma
vez, rodar o cron de novo no dia seguinte e confirmar que NÃO reenvia; opt-out um número de
teste e confirmar que ele é pulado.
