# M02.5a — Cardápio Público no Núcleo Comercial

> Concluída em código em: 01/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: `/api/orders/public` migrado para o núcleo comercial M02.1–M02.4. Pedido manual, agente, FSM central de transições, `variantId` e Mercado Pago com `operationId` ficam para as próximas fatias da M02.5.

## 1. Resultado entregue

O cardápio público (`deliveryOrders`, canal `site`) passou a usar o mesmo núcleo server-side já validado pelo PDV: cotação autoritativa em centavos (`quoteCommercialCartAdmin`), coordenador recuperável por checkpoints (`runCommercialOperationAdmin`) e ledgers determinísticos de cupom/gift card (`commercial-benefits-admin.ts`). O caminho antigo (preço calculado na rota, cupom via `couponRedeem.ts`, gift card via `checkoutRedemptions.ts`, estoque V1 via `deductStockAdmin`) foi substituído por um único adaptador: `lib/services/delivery-order-server.ts`.

`/api/orders/public/route.ts` agora só cuida da fronteira HTTP: rate limit, parsing/validação do contrato, `withIdempotency` (double-tap de curtíssimo prazo) e o guard de horário/pausa manual (`assertOrdersAcceptedNow`) — que continua fora do núcleo porque é uma regra por-negócio/por-instante, não por-item. Toda a regra comercial (preço, modificadores, zona de entrega, cupom, gift card, estoque, numeração, tracking) vive no adaptador.

## 2. Correções feitas no núcleo (não específicas do canal site)

Duas lacunas do núcleo M02.4 só apareciam quando um canal com frete existia — o PDV nunca as exercitou:

1. **`reserveCommercialBenefitsAdmin` tinha `deliveryFee`/`deliveryType` fixos** (`deliveryFee: 0, deliveryType: 'retirada'`), herdados de quando só o PDV usava a função. Sem a correção, qualquer cupom com `appliesTo: 'entrega'` seria rejeitado como `wrong_channel` mesmo num pedido de entrega legítimo. Agora lê `context.request.quote.delivery` (fallback `retirada`/0 quando ausente — neutro para `Sale`, que nunca preenche esse bloco).
2. **`applyAuthoritativeCommercialDiscounts` limitava o desconto ao subtotal de mercadoria**, ignorando o frete. Isso é inócuo para `Sale` (frete sempre 0), mas para delivery um gift card que precisasse cobrir mercadoria + frete seria clampado abaixo do necessário — e o ledger debitaria do saldo do cliente MAIS do que foi de fato abatido do total. O teto agora inclui `deliveryFeeCents`.

Ambas as correções têm cobertura de regressão em `tests/services/m02CommercialBenefits.test.ts` e `tests/services/deliveryOrderServerCommercial.test.ts`, e não alteram nenhum resultado dos testes existentes de PDV (`salesServerCommercial.test.ts`, `m02-commercial-operation.test.ts`).

## 3. Frete grátis e gift card — como são representados

- **Cupom de valor (fixed/percent)**: desconta a mercadoria via `applyAuthoritativeCommercialDiscounts`, como no PDV. Vira `document.discount`/`couponDiscount`.
- **Cupom de frete grátis**: zera `pricing.deliveryFeeCents` diretamente (não passa por `discountCents`) — o documento mostra `deliveryFee: 0`, igual ao comportamento legado. O valor reservado no ledger de benefício é o frete ORIGINAL (`quote.delivery.feeCents`, que não é tocado — só a `pricing` efetiva é ajustada), para a reconciliação anti-adulteração do ledger continuar íntegra. Frete grátis num pedido de retirada (ou zona com taxa zero) é aceito mas inócuo — nenhum ledger é criado, pois não há valor a registrar.
- **Gift card**: cobre até `min(saldo, valor a pagar após cupom)`, aplicado via `applyAuthoritativeCommercialDiscounts` (agora com o teto corrigido). `document.giftCardAmount` fica separado de `document.discount` — o mesmo contrato que `Sale`/o adapter de leitura V2 já assumiam (`lib/services/commercial-adapters.ts` documenta isso desde antes desta migração).

## 4. Mudanças de comportamento deliberadas

Estas divergências do comportamento anterior são intencionais — unificam a regra com o PDV, não são bugs de migração:

1. **Estoque de insumo/modificador com saldo negativo agora bloqueia.** O guard antigo da rota isentava insumos de BOM/modificador e produtos com grupos de modificador cadastrados (mesmo sem uso no pedido). O núcleo M01 (`applyStockOperationAdmin`, `negativeStockPolicy: 'prevent'`) bloqueia qualquer requisito rastreado insuficiente, sem essas isenções. Efeito: um produto com modificadores cadastrados e estoque zerado, que hoje seria vendido, passa a ser rejeitado.
2. **Gift card em corrida agora aborta o pedido inteiro.** Antes, se o saldo fosse drenado entre o pré-check e o débito, o pedido seguia sem o desconto (soft-fail, comentário explícito no código antigo). Agora a reserva acontece no checkpoint `benefits_reserved`, antes de estoque/documento — uma falha aí aborta tudo, sem estoque tocado nem documento criado. Alinha gift card com cupom (que já falhava duro).
3. **Preço obsoleto por item agora usa `CommercialOperationError`/`CommercialQuoteError`** em vez de `PublicOrderError`, mas a mensagem pública ("Preço inválido para X. Atualize o carrinho...") é a mesma.

## 5. Limitação conhecida — produtos com variação

`quoteCommercialCartAdmin` exige `variantId` para qualquer produto com `kind==='variant'` ou `variants.length>0` (regra do M02.1, pensada para o PDV). Como `CreatePublicOrderBodySchema`/o carrinho do cardápio ainda não enviam `variantId` (fica para uma fatia futura de M02.5), **um produto com variações cadastradas hoje fica impossível de pedir pelo cardápio público** — a cotação rejeita com `VARIANT_REQUIRED`. Antes da migração isso não bloqueava (o caminho V1 ignorava variações). Recomendação: não listar produtos com variação no cardápio público até `variantId` chegar ao contrato de delivery.

## 6. Evidências automatizadas

- `tests/contracts/m02-delivery-order-contract.test.ts` — campos aditivos (`commercialOperationId`, `couponId/Code/Discount`, `giftCardId/Code/Amount`, `trackingToken`) e invariante de total corrigida (`subtotal + deliveryFee - discount - giftCardAmount`).
- `tests/services/m02CommercialBenefits.test.ts` — reserva de cupom `appliesTo: 'entrega'` e cupom de frete grátis usando o frete real da cotação.
- `tests/services/deliveryOrderServerCommercial.test.ts` (12 casos) — retirada simples, entrega com zona, reconstrução de modificador adulterado, cupom de entrega, frete grátis, gift card parcial, gift card insuficiente (aborta tudo), bloqueio de estoque, replay com e sem `X-Idempotency-Key`, conflito de idempotência com carrinho diferente, isolamento de tenant.
- `tests/contracts/m02-commercial-v2.test.ts` — sem alteração de resultado; o workaround de "reinflação" de `total` em `commercial-adapters.ts` (necessário só porque o schema antigo não descontava `giftCardAmount`) foi removido, já que a invariante corrigida aceita o total real armazenado diretamente.
- Suíte completa: 775 testes em 56 arquivos aprovados. `tsc --noEmit` limpo.

## 7. Compatibilidade

- `sales`, `orders` e o restante de `deliveryOrders` (pedido manual, agente, transições de status) não foram tocados — só o caminho de criação do canal `site`.
- Documentos antigos continuam legíveis: os campos novos são aditivos e opcionais; `commercial-adapters.ts` (leitura V2 de compatibilidade) foi simplificado, não quebrado.
- Nenhuma coleção nova; `commercialOperations` já existia desde a M02.2.

## 8. Próximos limites (fora desta fatia)

- M02.5b — pedido manual (`OrdersModule`) sobre o mesmo adaptador (`channel: 'manual'`).
- M02.5c — agente (`channel: 'agent'`), fechando o gap de hoje (agente não valida modificador/cupom/gift card).
- M02.5d — FSM central de transições de status + efeitos (hoje ainda replicados em 3 lugares: `OrdersModule`, agent tools, webhook Mercado Pago).
- M02.5e — `variantId` ponta a ponta em carrinho/contrato/estoque/impressão/fiscal/repetição de pedido.
- M02.5f — Mercado Pago no mesmo `operationId`.
