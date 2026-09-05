# Conversas — consentimento na campanha de aniversário (M07.1)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: primeiro item da ordem recomendada de `docs/paridade/M07_PLANO_IMPLEMENTACAO.md`
> (§2.3) — gap de LGPD explicitamente nomeado no próprio roadmap ("aniversário,
> consentimento") e o mais isolado/urgente dos achados da investigação de abertura do M07.

## 1. O gap

`lib/services/birthdayCampaignRunner.ts` (`executeCampaign`) nunca checava `marketingOptOuts`
antes de enviar a mensagem de aniversário — um cliente que já tinha respondido "PARE"/"STOP" no
WhatsApp (ou pedido opt-out por outro canal) continuava recebendo a mensagem de aniversário todo
ano. É a MESMA classe de bug já encontrada e corrigida duas vezes nesta sessão em sistemas
irmãos:
- `app/api/broadcasts/send/route.ts` (já tinha o filtro desde antes desta sessão — um dos
  write-paths mais hardenizados do repo).
- `app/api/agent/scheduled/run/route.ts` (M06.5c, mesma sessão — automações de CRM mandavam
  mensagem mesmo pra quem tinha optado por sair).

A campanha de aniversário era o 3º e último caminho de envio automatizado com esse gap.

## 2. Correção

Mesma lógica de `agent/scheduled/run/route.ts`, adaptada ao formato de execução do runner:

- Nova `fetchWhatsAppOptOutSet(businessId)` em `birthdayCampaignRunner.ts` — mesma query simples
  (`marketingOptOuts` filtrado por `businessId` + `channel in ['whatsapp','all']`), retorna um
  `Set<string>` de telefones em minúsculo pra lookup O(1).
- `runBirthdayCampaigns`: lê o set uma única vez por business (mesmo racional de já ler `clients`
  uma vez por business), reusado por todas as campanhas devidas daquele tenant no mesmo tick.
- `executeCampaign` ganhou um parâmetro `optOutSet: Set<string>`; dentro do loop por cliente
  elegível, checa `optOutSet.has(phone.toLowerCase())` **antes** de tentar reivindicar o slot de
  idempotência — clientes em opt-out são contados num novo campo `RunResult.skippedOptOut`
  (paralelo ao já existente `skippedIdempotent`) e pulados sem tentar enviar.
- Política de falha na leitura do opt-out, espelhando a de `broadcasts/send/route.ts` (mesma
  preocupação de compliance, mesmo texto de decisão): **fail-closed** se o erro mencionar "index"
  (índice composto ausente é sinal de config faltando — pula o business inteiro naquele tick,
  tenta de novo no próximo, nunca manda sem filtro); **fail-open com warning** em erro transiente
  (timeout, Firestore instável) — não travar o cron inteiro por uma falha pontual.

## 3. Achado de duplicação, documentado e não resolvido nesta fatia

Esta é agora a **3ª implementação independente** da mesma query de opt-out no repo (a 1ª em
`broadcasts/send/route.ts`, com cap de 50k + fail-closed em índice ausente; a 2ª em
`agent/scheduled/run/route.ts`, versão simples sem cap; esta, cópia da 2ª). Não extraído pra um
helper compartilhado nesta fatia: as versões têm requisitos de volume genuinamente diferentes
(broadcast manda pra uma lista grande de destinatários de uma vez, precisa de cap e alerta de
capacidade; aniversário e automações de CRM processam poucos clientes por tick) — proporcional a
duplicar a versão simples aqui em vez de generalizar a versão com cap só pra estas duas. Se um
dia a duplicação incomodar, a extração natural seria um `lib/services/marketingOptOuts.ts` com a
versão simples, usado pelos 2 sites que não precisam do cap.

## 4. Verificação

`tsc --noEmit` limpo e suíte completa sem regressão (nenhum teste novo — não existe teste
dedicado pra `birthdayCampaignRunner.ts` nem pra `agent/scheduled/run/route.ts` hoje, mesma
convenção já estabelecida nesta sessão pra serviços cron com integração pesada de Admin SDK +
Meta Graph/Baileys, que dependeria de mockar Firestore + fetch externo pra um ganho de teste
pequeno frente a uma correção mecânica de baixo risco — mesmo padrão usado pros fixes de
`undefined` do M03.3/agente). **Não testado manualmente contra um tenant real** — recomendado
antes de confiar 100%: registrar um opt-out de teste, forçar `birthDate` de um cliente pra hoje,
rodar `runBirthdayCampaigns` e confirmar que `skippedOptOut` incrementa e nenhuma mensagem sai.
