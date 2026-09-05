# Conversas — dedup atômico de mensagens inbound do Baileys (M07.2)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: 2º item da ordem recomendada de `docs/paridade/M07_PLANO_IMPLEMENTACAO.md` (§2.2) —
> reuso de mecanismo já comprovado em produção, sem decisão de produto envolvida.

## 1. O gap

`app/api/whatsapp/baileys-manager.ts` (processamento de mensagem inbound) deduplicava mensagens
via **check-then-act**: uma query (`conversationMessages.where('externalMessageId','==',...)
.where('businessId','==',...).limit(1).get()`) seguida de uma decisão em código. Isso tem janela
de corrida real — duas entregas quase simultâneas do mesmo evento (retry de rede, reconexão do
socket Baileys) podem passar pela query **antes** de qualquer uma das duas escrever o documento,
e as duas seguem em frente, gerando mensagem duplicada na conversa.

O caminho WhatsApp Cloud (`app/api/webhooks/meta/route.ts:1511`) já usa um mecanismo atômico
(`markWebhookSeen`, `lib/contracts/_runtime/webhookIdempotency.ts`) desde antes desta sessão — o
Baileys, provavelmente o caminho de WhatsApp principal/gratuito de uma clínica pequena (não exige
verificação Meta Business), nunca tinha recebido a mesma correção.

## 2. Correção

Substituído o bloco de dedup por uma chamada a `markWebhookSeen(adminDb, { businessId,
externalMessageId: messageId, source: 'baileys' })` — mesma função já usada pelo caminho Cloud,
sem duplicar lógica nova. `markWebhookSeen` usa `ref.create()` (não `set()`) num doc
`webhookSeen/{businessId}_{externalMessageId}`: o Firestore rejeita atomicamente a segunda
chamada concorrente com `ALREADY_EXISTS`, que a função traduz em `{ seen: true }` — não há janela
de corrida possível, diferente da query anterior.

Mesma política de falha do caminho Cloud: se `markWebhookSeen` lançar por outro motivo (não
`ALREADY_EXISTS`), loga o erro e **segue processando** — melhor arriscar uma duplicata rara do
que perder a mensagem por completo.

## 3. Limitação preexistente, não introduzida por esta correção

`messageId` é `waMessage.key.id || \`wa_${Date.now()}\`` — o fallback só existe quando o Baileys
não fornece um ID de mensagem (raro). Esse fallback não é estável entre entregas duplicadas
(`Date.now()` muda a cada chamada), então o dedup (atômico ou não) não protege esse caso
específico. Isso já era verdade antes desta correção (a query antiga tinha a mesma limitação) —
não é uma regressão, só não é resolvido aqui (fora do escopo: exigiria uma estratégia de
fallback-ID diferente, ex.: hash de conteúdo+remetente+janela de tempo).

## 4. Verificação

`tsc --noEmit` limpo e suíte completa sem regressão. Sem teste novo — não existe teste dedicado
pra `baileys-manager.ts` hoje (arquivo de integração pesada com socket Baileys + Firestore Admin
SDK, mesma categoria de arquivos sem cobertura já estabelecida nesta sessão). **Não testado
manualmente contra uma sessão Baileys real** — o mecanismo (`markWebhookSeen`) já está validado
em produção pelo caminho Cloud, então o risco reside só na integração (import correto, assinatura
de parâmetros), não no mecanismo em si.
