# Financeiro — idempotência opcional no contrato do agente (M03.3, 2º follow-up)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: retomada do 2º follow-up real deixado pela primeira rodada de M03.3
> (`docs/financeiro/FINANCEIRO_M03_3_MIGRACAO_API_V1.md` §3), a pedido explícito do usuário
> ("vamos fazer tudo dessa lista").

## 1. Recapitulando o achado original

A investigação original do M03.3 concluiu que `createTx` (tool `create_receivable`/
`create_payable` do agente) não tinha nenhuma chave disponível pra dedup — `CreateParams` não
carregava `saleId`/`appointmentId`/`idempotencyKey`, então migrar pro núcleo (M03.2) sem antes
estender o contrato seria trocar código sem ganho prático, e no ramo de parcelamento (batch
atômico) até regrediria a garantia atual (tudo-ou-nada).

## 2. Achado novo desta rodada: já existe proteção de replay em nível de transporte

Antes de estender o contrato, foi necessário confirmar **o que já está coberto** — senão o campo
novo seria redundante ou, pior, mal-entendido como a ÚNICA proteção existente.

`lib/agent/auth.ts:verifyAgentRequest` calcula um HMAC por request e reivindica esse assinatura
na coleção `agentNonces` (`claimNonce`) **antes** de qualquer handler de tool rodar. Um retry
byte-idêntico (mesma assinatura, ex.: o agente reenviando o mesmo request porque não recebeu
resposta a tempo) é rejeitado como replay com 409, sem nunca alcançar `createTx`.

**Implicação prática**: o cenário "rede duplica o mesmo request" já não pode duplicar uma
transação — isso já era verdade antes desta fatia, e não é o que o campo novo resolve.

## 3. O que o campo novo (`idempotencyKey`) resolve — e o que não resolve

O cenário real ainda aberto é outro: a **criação teve sucesso no servidor, mas a resposta se
perdeu** (timeout de rede, processo do agente reiniciou antes de processar a resposta, etc.) — o
agente Python, sem saber se a criação aconteceu, monta um **novo** request (nova assinatura HMAC,
`agentNonces` não ajuda aqui) pra tentar de novo. Sem uma chave estável repetida entre esse
request original e o retry, não há como o servidor saber que são "a mesma intenção".

- `lib/contracts/api/agent/financial.ts`: `CreateTxParamsBase` ganhou `idempotencyKey: z.string()
  .max(200).optional()`.
- `app/api/agent/tools/financial/route.ts`: `createTx`, no ramo `installments === 1`, agora monta
  um `AdminTransactionPayload` e chama `createTransactionSafeAdmin` (núcleo do M03.2) em vez de
  `ref.set()` direto. Quando `idempotencyKey` vem preenchido, o guard deriva o ID determinístico
  dele (prioridade sobre a derivação automática por `saleId`/`type`, que não se aplica aqui já
  que o agente não carrega esses campos) e a criação vira idempotente de verdade: reenviar o
  mesmo valor retorna o documento já existente em vez de duplicar.

**O que isso NÃO resolve sozinho**: o agente Python (LangGraph, fora deste repo) **ainda não
gera nem reenvia** esse valor — ele não faz parte desta sessão (mudança cross-serviço, lado
Python). Sem essa mudança do lado do agente, `idempotencyKey` fica ausente em todo request real
hoje, e o comportamento observável é **idêntico ao de antes**: cria direto, sem dedup. O campo
existe e está pronto pra ser usado; ativá-lo de fato é trabalho futuro, fora do escopo desta
fatia (documentado aqui pra não ser esquecido).

## 4. Achado colateral real: Admin SDK rejeita campos `undefined` explícitos

Ao reescrever o payload de `createTx` pra usar o guard, ficou visível um bug preexistente e
independente da idempotência: `lib/config/firebaseAdmin.ts` nunca chama
`.settings({ ignoreUndefinedProperties: true })` (confirmado por grep no projeto inteiro — zero
ocorrências de `ignoreUndefinedProperties` ou `.settings(` em qualquer `.ts`). Isso significa que
o Admin SDK **lança exceção** em `set()`/`create()`/`update()`/`batch.set()` se o objeto gravado
tiver qualquer chave com valor `undefined` explícito (diferente de a chave estar simplesmente
ausente).

O código anterior de `createTx` (ambos os ramos) e de `cancelTx` construía objetos por atribuição
incondicional — `dueDate: p.dueDate`, `notes: p.notes ? ... : tx.notes` — que produz
`campo: undefined` sempre que o valor opcional correspondente não vinha preenchido. Ou seja:
`create_receivable`/`create_payable` sem `dueDate` (pedido tão comum quanto "adiciona uma conta
de internet de R$50" sem data definida), ou `cancel` sem `reason` numa transação que nunca teve
`notes`, muito provavelmente já lançava um 500 antes desta correção — não testado empiricamente
contra produção (não há tenant real usando o agente hoje), mas o mecanismo é determinístico e
documentado no próprio SDK.

**Corrigido** nos três pontos, usando atribuição condicional (mesmo padrão já usado
corretamente em `app/api/agent/tools/agenda/route.ts`):
- `createTx`, ramo `installments === 1` — `dueDate`/`category`/`clientId`/`clientName`/`notes`/
  `paymentMethod`/`idempotencyKey` só entram no payload se não forem `undefined`.
- `createTx`, ramo de parcelamento — mesmo tratamento pros mesmos campos opcionais, por
  transação criada no batch.
- `cancelTx` — `notes` só entra no `patch` se o valor calculado não for `undefined` (era sempre
  incluído antes, mesmo quando `tx.notes` e `reason` eram ambos ausentes).

`markPaid` foi conferido e já estava correto — seu único campo opcional (`paymentMethod`) já era
atribuído condicionalmente via `if`, não por chave de objeto literal.

## 5. O que fica deliberadamente sem dedup

O ramo de parcelamento de `createTx` (`installments > 1`) continua sem idempotência. Dedup pra um
lote exigiria um design próprio — checar todos os N IDs determinísticos antes de criar qualquer
um, ou aceitar perder a garantia atual de tudo-ou-nada do `batch.commit()` chamando o guard em
loop (cada `tx.create()` é atômico individualmente, não em conjunto). Nenhuma das duas opções é
proporcional ao gap real (o agente ainda nem envia `idempotencyKey` em produção) — revisitar se e
quando o lado Python passar a suportar parcelamento com retry.

## 6. Verificação

`tsc --noEmit` limpo e suíte completa sem regressão (1063 testes/79 arquivos — nenhum teste novo
nesta fatia: o núcleo (`createTransactionSafeAdmin`) já tem 12 casos cobrindo idempotência desde
M03.2, e o achado de `undefined` é uma correção mecânica sem lógica nova a testar isoladamente,
mesma convenção usada em `AGENDA_M06_7_NUCLEO_AGENTE.md` pra fixes equivalentes). **Não testado
manualmente contra o agente Python real** — recomendado antes de confiar 100% que o campo novo
funciona ponta a ponta, quando o lado Python passar a enviá-lo.
