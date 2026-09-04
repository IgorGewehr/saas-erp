# Financeiro — atomicidade no cancelamento de venda do PDV (M03.3, follow-up)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: retomada de um dos 2 follow-ups reais deixados pela primeira rodada de M03.3
> (`docs/financeiro/FINANCEIRO_M03_3_MIGRACAO_API_V1.md` §3), a pedido explícito do usuário.

## 1. Recapitulando o achado original

`PDVModule.tsx:handleCancelSale` (cancelamento de venda) tinha um passo que cancelava toda
`Transaction` vinculada à venda (`saleId`) via um loop de `updateDoc` independentes. A
investigação original do M03.3 concluiu que isso era **menos grave do que o plano supunha**:
toda transição PARA `cancelado` já é válida a partir de QUALQUER estado no FSM
(`TRANSACTION_TRANSITIONS`), então não existia nenhuma sequência real que esse código
conseguisse violar — não era um bug de FSM.

## 2. O gap real que sobrava: falta de atomicidade

Uma venda pode ter MAIS de uma `Transaction` vinculada (ex.: receita da venda + comissão do
vendedor). O loop original fazia um `updateDoc` por documento, **sem nenhuma garantia atômica
entre eles** — se a conexão do navegador caísse (ou a aba fechasse) entre a primeira e a segunda
chamada, o resultado seria uma transação cancelada e a outra não, uma inconsistência real
(ainda que de baixa probabilidade e recuperável manualmente).

## 3. Correção

O loop de `updateDoc` virou um único `runTransaction` (client SDK): a query que já buscava as
transações vinculadas (`where('saleId','==',sale.id)`) continua fora da transação (Firestore
client SDK não aceita query reads dentro de `runTransaction`, só reads de documento — mesma
limitação já documentada em `lib/services/appointmentTxGuard.ts`), mas os IDs resultantes são
re-lidos e atualizados **dentro** da mesma transação — ou todas as transações vinculadas são
canceladas, ou nenhuma é (a tx do Firestore reexecuta em caso de conflito de leitura). Ganho
extra, de graça: re-checagem de `businessId` por documento dentro da tx (defesa em profundidade,
mesmo padrão de outros guards desta sessão).

## 4. Por que NÃO migrado pro núcleo Admin-SDK nem pra rota server-side

Ambas as alternativas mais "corretas" arquiteturalmente (construir o guard client-side
deliberadamente adiado no M03.2, ou mover `handleCancelSale` inteiro — que também mexe com
restauração de estoque e estatísticas do cliente — pra uma rota server-side) são
desproporcionais ao gap real encontrado aqui (atomicidade, não FSM). `firestore.rules` (M03.4)
já garante `amount>0` e transição de status válida nesta escrita mesmo sem o núcleo — a correção
de atomicidade fecha o que sobrava sem precisar de infraestrutura nova.

## 5. Verificação

Sem teste dedicado — `handleCancelSale` é lógica embutida num componente React grande
(`PDVModule.tsx`), mesma convenção já usada nesta sessão pra fixes equivalentes em UI (sem
precedente de teste de componente neste projeto). `tsc --noEmit` limpo e suíte completa sem
regressão (contagem exata no commit) — nenhuma mudança fora deste arquivo. **Não testado
manualmente em navegador** — recomendado antes de confiar 100%: cancelar uma venda com 2+
transações vinculadas (ex.: com comissão de vendedor configurada) e confirmar que ambas viram
`cancelado`.
