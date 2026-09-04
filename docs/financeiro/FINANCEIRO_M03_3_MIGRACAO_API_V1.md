# Financeiro — migração da API v1 pro núcleo (M03.3, primeira rodada)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: quinta fatia de execução do M03 (`docs/paridade/M03_PLANO_IMPLEMENTACAO.md`), logo
> após o núcleo (M03.2). Esta é a PRIMEIRA rodada de M03.3 — migra o caminho de maior exposição
> (API externa); as próximas rodadas (agente, clássico/V2, PDV) foram investigadas e, ao
> contrário do que o plano original previa, não tinham um gap do MESMO tipo pra corrigir agora
> (ver §3).

## 1. O que foi migrado: `app/api/v1/transactions/route.ts`

Rota third-party-facing (API key), a de validação mais solta e menor visibilidade sobre uso real
(ver `docs/paridade/M03_PLANO_IMPLEMENTACAO.md` §0, item #12 da tabela de 13 caminhos).

- **`POST`**: `adminDb.collection('transactions').add(...)` (sem idempotência nenhuma) substituído
  por `createTransactionSafeAdmin`. Aceita `X-Idempotency-Key` (R3, a rota nunca suportou isso
  antes) com prioridade sobre a chave derivada automaticamente de `saleId`+`type` quando presente
  (mesma combinação que `m03-financial-audit.ts` usa pra medir `DUPLICATE_SOURCE_TRANSACTION`).
  Resposta: **201** pra criação nova, **200** pra replay idempotente (nada novo foi criado) — sem
  mudança de shape do corpo da resposta, só o status code passa a diferenciar os dois casos.
- **`PUT`** (`?action=mark-paid` e atualização padrão): `docRef.update(...)` cru substituído por
  `transitionTransactionSafeAdmin`. O atalho `mark-paid` agora passa pelo FSM — uma transação já
  `cancelada` não pode mais ser marcada como paga (antes, o `update` forçava `status:'pago'`
  incondicionalmente). Atualização padrão: quando `status` não muda, `targetStatus` fica ausente
  (o núcleo só aplica o `patch`, sem acionar o FSM — evita um pré-fetch só pra descobrir o status
  atual). Erros do guard mapeados pra HTTP: `TransactionNotFoundConst`/`TenantMismatch` → 404
  (preserva o comportamento anterior de não revelar se o id existe em outro tenant),
  `TransactionInvalidTransitionError` → 409 (novo — antes uma transição inválida simplesmente
  seria aceita sem checagem nenhuma).

**Comportamento novo, deliberado e documentado** (não é regressão silenciosa): um `POST`
repetido com o mesmo `saleId`+`type` (ou o mesmo `X-Idempotency-Key`) agora devolve a transação
JÁ CRIADA em vez de criar uma segunda. Se algum integrador externo hipotético dependesse do
comportamento antigo (criar múltiplas transações com o mesmo `saleId`+`type` sem usar
`installmentGroupId`/`installmentNumber` pra diferenciá-las), essa chamada passaria a ser tratada
como duplicidade. Não há evidência de uso real assim — o comportamento antigo era o bug que
`m03-financial-audit.ts`/`AGENDA_COBRANCA.md` já documentavam, não uma feature.

## 2. `GET`/`DELETE` não tocados

`GET` é leitura pura, sem escrita, fora de escopo. `DELETE` faz hard-delete direto — não há
conceito de idempotência/FSM aplicável (deletar duas vezes já é idempotente por natureza: a
segunda chamada encontra "not found").

## 3. Investigado, NÃO migrado nesta rodada (achados reais, diferentes do esperado)

### `app/api/agent/tools/financial/route.ts`

O plano original supunha "já tem Zod no boundary, falta idempotência" — **parcialmente errado**,
descoberto só ao ler o código: `markPaid`/`cancelTx` **já chamam `assertTransitionTransaction`**
(FSM já aplicado, achado real de código melhor do que o esperado). O gap genuíno é em
`createTx` (`create_receivable`/`create_payable`) — sem idempotência nenhuma — mas
`CreateParams` (o contrato do agente) **não carrega nenhuma referência de origem nem chave
explícita** (sem `saleId`/`appointmentId`/`idempotencyKey`). Migrar pra
`createTransactionSafeAdmin` sem uma chave disponível cairia sempre no ramo "sem chave possível,
cria direto" — **nenhum ganho prático de dedup**, só uma troca de código sem efeito observável.
Pior: o caminho de parcelamento usa `adminDb.batch()` pra criar N documentos atomicamente;
migrar esse ramo pro guard (que cria UM documento por chamada) exigiria um loop de N chamadas —
**perderia a garantia atômica atual** (hoje, ou todas as parcelas são criadas ou nenhuma) sem
ganhar dedup nenhum em troca (mesma ausência de chave). Corrigir de verdade exigiria estender o
contrato do agente (`lib/contracts/api/agent/financial.ts`) pra aceitar um identificador estável
vindo do próprio tool-call do LLM — mudança de contrato cross-camada (Python↔TS), fora do escopo
desta fatia. Registrado como follow-up, não executado.

### `PDVModule.tsx:1173-1184` (reversão de venda → cancela a transação vinculada)

Achado real, mas menos grave do que o plano supunha: o `updateDoc` cru grava
`status:'cancelado'` incondicionalmente — só que **toda transição PARA `cancelado` é válida a
partir de QUALQUER estado** no FSM (`TRANSACTION_TRANSITIONS`: `pendente`, `atrasado` e `pago`
podem ir pra `cancelado`; só `cancelado` em si é terminal, e cancelar de novo uma já cancelada é
um no-op, não uma violação). Ou seja: **não existe hoje nenhuma sequência real de estados que
esse código consiga violar** — o FSM sempre aceitaria essa transição específica, mesmo se fosse
checado. O gap é mais arquitetural (não usa o núcleo) do que funcional (nenhum bug observável
decorre disso hoje).

Migrar de verdade também é maior do que "trocar uma chamada": este é código **client SDK**
(browser, `PDVModule.tsx`), e `transactionTxGuardAdmin.ts` é Admin-SDK-only por decisão do M03.2
(§3 de `FINANCEIRO_M03_2_NUCLEO.md`) — corrigir exigiria OU construir o guard client-side
deliberadamente adiado, OU mover esse trecho (e o resto do fluxo de cancelamento de venda —
reversão de estoque, atualização de stats do cliente, tudo no mesmo `handleCancelSale`) pra uma
rota server-side nova. Ambos são fatias maiores que "migrar um caminho de escrita pro núcleo
existente" — registrado como follow-up real (arquitetural, não um bug ativo), não executado
agora.

## 4. Verificação

Nenhum teste novo dedicado à rota `app/api/v1/transactions/route.ts` — mesma convenção já usada
pra outras rotas nesta sessão quando a lógica nova é composição de funções já testadas em
profundidade (aqui: `createTransactionSafeAdmin`/`transitionTransactionSafeAdmin`, 13 casos em
`tests/services/transactionTxGuardAdmin.test.ts`) e a rota em si vira principalmente wiring
(parse → validar → chamar o guard → mapear erro pra status HTTP). Mockar autenticação por API
key exigiria simular o hash SHA-256 (`crypto.subtle.digest`) do `apiKeyAuth.ts` — custo
desproporcional ao risco pra uma camada que não tem lógica de negócio própria.

`tsc --noEmit` limpo. Suíte completa sem regressão (contagem exata no commit). **Não testado
manualmente contra uma chamada HTTP real** — recomendado antes de confiar 100%: chamar
`POST /api/v1/transactions` duas vezes com o mesmo `X-Idempotency-Key` (ou o mesmo `saleId`) e
confirmar que a segunda resposta vem com `200` e o MESMO `id`; chamar
`PUT .../transactions?action=mark-paid` numa transação já cancelada e confirmar `409`.

## 5. Próxima etapa recomendada

M03.4 (enforcement no servidor — `firestore.rules` pra `transactions`) ou retomar M03.3 quando
houver apetite pra decidir os dois follow-ups reais encontrados aqui: estender o contrato do
agente com um identificador estável, e decidir se a reversão de venda do PDV migra pra rota
server-side (maior, mas resolveria de vez a arquitetura, não só o caso específico de
cancelamento).
