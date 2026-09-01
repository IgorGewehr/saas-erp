# M02.5b — Pedido Manual no Núcleo Comercial

> Concluída em código em: 01/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: CRIAÇÃO de pedido manual (`OrdersModule.tsx`) migrada para o núcleo comercial. Edição de pedido existente e transições de status (aceitar/preparar/entregar/cancelar/excluir) permanecem client-side — ficam para a M02.5d (FSM central).

## 1. Resultado entregue

A criação de pedido manual (balcão/telefone, tela "Pedidos") passou a usar o mesmo núcleo comercial já validado pelo PDV (M02.3/M02.4) e pelo cardápio público (M02.5a): cotação autoritativa, coordenador recuperável por checkpoints e ledgers de benefício, via `lib/services/delivery-order-server.ts` — a MESMA função (`createDeliveryOrderWithSideEffects`) generalizada para o canal `manual`, não uma cópia.

Antes, `OrdersModule.tsx` gravava o pedido direto pelo SDK cliente (`setDoc`): sem revalidar preço/modificador contra o catálogo, sem checar permissão para desconto ou taxa de entrega (qualquer operador digitava qualquer valor), sem transação atômica com estoque/cliente, com pré-check de estoque meramente informativo (toast, não bloqueava). Agora a criação passa por `POST /api/orders/manual`, uma rota autenticada (Firebase Auth + `verifyAuth`) que delega ao núcleo.

## 2. Núcleo — taxa de entrega manual fora de zona

Decisão de produto: se o endereço cai numa zona configurada, a zona é sempre autoritativa (igual ao cardápio público — o valor digitado é ignorado mesmo com permissão). Se o endereço não cair em nenhuma zona (`out-of-area`) ou o negócio não tiver zonas configuradas, o atendente pode propor uma taxa — mas só com permissão de **gerente+**.

Implementado em `quoteCommercialCartAdmin` (`lib/services/commercial-quote.ts`) via um novo parâmetro `canOverrideDeliveryFee` (default `false` — nenhum canal existente passa isso) e um campo `manualFeeCents` em `CommercialDeliveryQuoteSchema.delivery`. Sem permissão, uma tentativa de override lança `DELIVERY_FEE_OVERRIDE_FORBIDDEN` (403). A resolução resultante fica marcada como `resolution: 'manual'` (novo valor do enum, aditivo — nenhum consumidor existente fazia match exaustivo sobre esse campo).

## 3. Permissões

- **Criar pedido manual**: `operator+` (mesmo patamar do checkout do PDV).
- **Aplicar desconto manual** (`discount` do formulário): `manager+`, reaproveitando o mecanismo nativo do núcleo (`CommercialQuoteRequestSchema.manualDiscount`, já usado pelo PDV desde M02.1 — nenhuma mudança no núcleo, só a rota manual agora também alimenta esse campo).
- **Propor taxa de entrega fora de zona**: `manager+` (`canOverrideDeliveryFee`).

Sem as permissões, a tentativa é rejeitada pelo núcleo (`DISCOUNT_FORBIDDEN`/`DELIVERY_FEE_OVERRIDE_FORBIDDEN`) — a UI não precisa esconder os campos, o servidor é a autoridade.

## 4. Identidade do cliente e do operador

- `clientId` (selecionado na UI) tem precedência sobre `clientPhone` — o formulário sempre manda os dois juntos ao escolher um cliente existente (não são mutuamente exclusivos). Quando `clientId` está presente, o adaptador só valida o tenant (evita reimplementar a resolução por telefone). Sem `clientId`, cai no mesmo caminho do canal público (`resolveClientIdentityAdmin`).
- `operatorId`/`operatorName` viajam no input do serviço mas são **sempre sobrescritos pela rota** com a identidade do token verificado (`auth.uid`/`auth.name`) — nunca confiam no valor enviado pelo corpo da requisição, mesmo padrão de `sales-server.ts`/`/api/sales/checkout`.
- `DeliveryOrder` ganhou os campos aditivos `createdBy`/`createdByName` (auditoria — convenção do projeto de sempre gravar nome junto do ID), preenchidos para TODOS os canais (`'public'`/`'Cardápio online'` no site, operador autenticado no manual).
- `document.channel` (origem do pedido: `whatsapp|facebook|instagram|manual|site`) agora vem de `originChannel`, preservando o comportamento de hoje de tagear o pedido com o canal da conversa de origem mesmo quando criado pela tela manual.

## 5. Mudanças de comportamento deliberadas

1. **Estoque insuficiente agora bloqueia duro.** Antes era só um aviso (toast) que não impedia a criação — o atendente podia confirmar mesmo sem saldo. Decisão confirmada com o usuário: consistência total com PDV/cardápio é preferível a manter o escape hatch; se o atendente precisa vender mesmo assim, ajusta o estoque antes.
2. **Preço/modificador de item adulterado agora bloqueia.** O formulário manual nunca revalidava preço contra o catálogo; agora usa a mesma cotação autoritativa (mesmo guard de tolerância por item do cardápio público/PDV).
3. **Produto com variação cadastrada fica indisponível no seletor do pedido manual.** A cotação exige `variantId` para produtos com variação (regra herdada do M02.1/PDV) e o formulário ainda não tem UI para escolher variação — mitigado filtrando esses produtos do seletor (`deliverableProducts` em `OrdersModule.tsx`). Fica para a M02.5e.
4. **Taxa de zona configurada agora é sempre autoritativa**, mesmo que o atendente digite outro valor — só quando NENHUMA zona resolve o endereço o valor digitado é considerado (e exige permissão de gerente).

## 6. Limitações conhecidas

- Sem cupom/gift card no canal manual nesta fatia (o contrato já suporta os campos, mas a UI/rota não os expõe — fica para quando fizer sentido).
- Sem `variantId` ponta a ponta (ver item 5.3).
- As regras do Firestore para escrita direta em `deliveryOrders` não foram apertadas — um cliente ainda poderia, tecnicamente, escrever direto via SDK. Isso é overhead explícito da M02.9 no plano mestre, não desta fatia.

## 7. Evidências automatizadas

- `tests/services/commercialQuote.test.ts` — resolução de zona: zona casada ignora override; fora de área bloqueia sem override; fora de área libera com override+permissão; fora de área rejeita override sem permissão; sem zonas configuradas cai na taxa plana ou usa o override quando fornecido.
- `tests/services/deliveryOrderServerCommercial.test.ts` (`describe` "M02.5b — pedido manual"): `clientId` direto e de outro tenant, desconto manual com/sem permissão, override de frete com/sem permissão e ignorado quando a zona casa, `originChannel`/`createdBy`/`createdByName`, `paymentStatus` explícito.
- `tests/contracts/m02-delivery-order-contract.test.ts` — `createdBy`/`createdByName` aceitos pelo contrato.
- Suíte completa: 790 testes em 56 arquivos aprovados. `tsc --noEmit` limpo. PDV e cardápio público sem alteração de resultado (os parâmetros novos são opcionais e nunca enviados por esses canais).

## 8. Próximos limites (fora desta fatia)

- M02.5c — agente (`/api/agent/tools/orders`), fechando o gap de hoje (agente não valida modificador/cupom/gift card e não usa o núcleo comercial).
- M02.5d — FSM central de transições de status + efeitos (hoje replicados em 3 lugares: `OrdersModule` client, agent tools, webhook Mercado Pago) e trava de edição insegura após efeitos.
- M02.5e — `variantId` ponta a ponta em carrinho/contrato/estoque/impressão/fiscal/repetição de pedido.
- M02.5f — Mercado Pago no mesmo `operationId`.
