# M02.4 — Cupons, Gift Cards e Fidelidade no Núcleo Comercial

> Concluída em código em: 31/08/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: ledgers server-side determinísticos e reserva/confirmação/compensação de benefícios no PDV e núcleo comercial M02

## 1. Resultado entregue

Os benefícios comerciais (cupons de desconto, saldos de gift cards e pontos do programa de fidelidade) foram migrados para um modelo de ledgers server-side determinísticos geridos atomicamente pelo coordenador de operações comerciais (`commercialOperations`).

No fluxo anterior do PDV, a baixa de pontos e o resgate de gift cards ocorriam no navegador em "melhor esforço" pós-venda. Agora:
- **Reserva antecipada**: cupons, gift cards e resgates de pontos são reservados no checkpoint `benefits_reserved` **antes** da baixa de estoque e da persistência da venda.
- **Confirmação transacional**: após a gravação da venda, o checkpoint `downstream_reconciled` confirma as reservas e lança o acúmulo de pontos de fidelidade para o cliente.
- **Compensação automática**: caso ocorra uma falha permanente em etapas subsequentes (estoque, documento ou financeiro), os ledgers de benefícios desta operação são revertidos (`compensateCommercialBenefitsAdmin`), restaurando o saldo do gift card, a contagem de uso do cupom e o saldo de pontos do cliente.
- **Prevenção de dupla baixa e concorrência**: requisições repetidas usam a chave de idempotência e os IDs determinísticos da operação (`couponRedemptionIds`, `giftCardRedemptionIds`, `loyaltyTransactionIds`). Tentativas concorrentes pelo mesmo saldo são serializadas pela transação do Firestore.

## 2. Estrutura dos Ledgers Server-Side

### 2.1 Cupons (`couponRedemptions`)
- Documento com ID determinístico: `couponredemption_<hash(operationId:benefit:intentId)>`.
- Transação atômica valida validade, canal, valor mínimo, limites de uso globais e por cliente.
- Status do ledger: `reserved` ➔ `confirmed` (ou `reversed` em caso de compensação/estorno).

### 2.2 Gift Cards (`giftCardRedemptions`)
- Documento com ID determinístico: `giftredemption_<hash(operationId:benefit:intentId)>`.
- Abate o saldo `remainingValue` do documento `giftCards/{id}` na reserva e altera status para `used` quando o saldo zera.
- Na compensação, restaura o valor em reais em `remainingValue` e reativa o gift card se ainda estiver dentro do prazo de validade.

### 2.3 Fidelidade (`loyaltyTransactions`)
- Documentos com IDs determinísticos: `loyaltytx_<hash(operationId:benefit:intentId)>`.
- Distingue `action: 'redeem'` (resgate no checkout) e `action: 'earn'` (acúmulo pós-venda).
- Valida conversão em centavos (`pointValueInCentavos`) e limite mínimo de resgate (`minPointsToRedeem`).

## 3. Integração com o PDV (`sales-server.ts`)

- O checkout do PDV, API v1 e agente invoca `loadCommercialBenefitResourcesAdmin` para carregar cupom, gift cards e fidelidade autoritativamente no servidor.
- O cupom é reavaliado server-side com `evaluateCoupon` e aplicado à cotação via `applyAuthoritativeCommercialDiscounts`.
- O documento `Sale` resultante registra a quebra completa de benefícios: `manualDiscount`, `couponId`, `couponCode`, `couponDiscount`, `pointsRedeemed` e `pointsEarned`.

## 4. Evidências automatizadas

- Suíte de testes unitários e de integração em `tests/services/m02CommercialBenefits.test.ts` validando reserva, confirmação, concorrência e compensação.
- Validação de contrato em `tests/contracts/m02-commercial-operation.test.ts`.
- Execução limpa do `npm run typecheck` e da suíte Vitest.
