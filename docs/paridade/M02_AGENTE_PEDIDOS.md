# M02.5c — Criação de Pedido do Agente no Núcleo Comercial

> Concluída em código em: 01/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: CRIAÇÃO de pedido pelo agente de IA (`/api/agent/tools/orders`, action `create`). `get`, `list_by_client`, `update_status`, `update_items`, `cancel` e `list_recent` não mudaram — ficam para a M02.5d (FSM central).

## 1. Resultado entregue

Com esta fatia, os **três canais de criação de `deliveryOrders`** (cardápio público — M02.5a, pedido manual — M02.5b, agente de IA — M02.5c) usam a mesma função `createDeliveryOrderWithSideEffects` (`lib/services/delivery-order-server.ts`), agora com `channel: 'agent'`. O bullet "Fazer pedido público, manual e do agente usarem a mesma criação server-side" do plano mestre da M02.5 está completo.

Antes, `createOrderInner` em `app/api/agent/tools/orders/route.ts` tinha uma implementação própria e mais fraca que os outros dois canais: preço lido direto do catálogo sem suportar modificadores, expansão de BOM manual, dedução de estoque pelo núcleo V1 (`deductStockAdmin`), e nenhuma validação de zona de entrega — o `deliveryFee` vinha literalmente do que o modelo de linguagem decidisse enviar.

## 2. Decisão de segurança: agente perde desconto manual e override de frete

O contrato do agente (`lib/contracts/api/agent/orders.ts`) permitia `deliveryFee`/`discount` livres em `OrdersCreateParamsSchema`, sem qualquer revisão humana — um vetor real de manipulação via prompt injection (um cliente convencendo o bot a "aplicar 100% de desconto" ou zerar o frete). Confirmado com o usuário: **essa capacidade foi removida**, não apenas restringida.

- `deliveryFee`/`discount` foram removidos de `OrdersCreateParamsSchema` (contrato usado pelo codegen/registro de tools do serviço Python) e do `CreateParams` local da rota.
- A rota não repassa mais nenhum valor de frete/desconto ao núcleo comercial — `canApplyManualDiscount`/`canOverrideDeliveryFee` ficam `undefined` (falso) na chamada, então mesmo que o corpo da requisição ainda contivesse esses campos, o núcleo os rejeitaria (`DISCOUNT_FORBIDDEN`/`DELIVERY_FEE_OVERRIDE_FORBIDDEN`) — mas o desenho já não oferece a possibilidade, não depende do núcleo bloquear.
- O canal `agent` agora se comporta como o `site` para preço: **frete sempre resolvido por zona configurada**; endereço fora de área é rejeitado (`DELIVERY_OUT_OF_AREA`) em vez de aceitar qualquer taxa. Uma negociação real de desconto precisa ser escalada para um humano (pedido manual, `manager+`, ver `docs/paridade/M02_PEDIDO_MANUAL.md`).

## 3. Ajuste no núcleo: checagem de preço por item não se aplica ao agente

O checkpoint anti-adulteração "preço obsoleto por item" (`ITEM_PRICE_CHANGED`, criado na M02.5a) compara o total calculado pela cotação contra o total que o CLIENTE afirmou no carrinho — útil quando existe uma UI que pré-calculou e exibiu um preço (cardápio público, formulário manual). O agente nunca teve esse conceito: seu payload de item é só `{productId, quantity, notes}`, sem preço nenhum. Migrar sem ajustar isso faria TODO pedido do agente falhar com "preço inválido".

`delivery-order-server.ts` agora só roda essa checagem quando `channel === 'site' || channel === 'manual'`. Para o agente, o item é enviado com `unitPrice`/`total` placeholder (`0`) só para satisfazer o schema compartilhado (`PublicOrderItemSchema`) — o nome e o preço reais sempre vêm do snapshot autoritativo da cotação, nunca do placeholder.

## 4. O que se manteve igual

- Guard de horário/pausa (`assertOrdersAcceptedNow`) continua na rota, antes de chamar o núcleo — mesmo padrão do cardápio público.
- O `withIdempotency` externo com chave determinística por `(conversationId, hash do carrinho)` continua protegendo contra reentrega da mesma mensagem; a mesma chave agora também é passada como `idempotencyKey` ao núcleo, que cobre replay/compensação via o coordenador (defesa em profundidade, igual site/manual).
- A forma da resposta da tool (`{id, number, total, subtotal, estimatedDeliveryAt}`) foi preservada exatamente — não exige nenhuma mudança no serviço Python `/agent` que consome esta tool.
- `clientId` (quando o agente já resolveu o cliente) ou `clientPhone` (resolução por telefone) — ambos já suportados pelo adaptador desde a M02.5b.

## 5. Mudanças de comportamento deliberadas

1. **Desconto manual e taxa de entrega livre removidos** (seção 2) — a mudança mais visível desta fatia.
2. **Endereço fora de zona configurada agora bloqueia a criação** em vez de aceitar a taxa que o agente enviasse.
3. **Estoque insuficiente e produto inativo/indisponível já bloqueavam antes** (o agente já tinha essas checagens) — sem mudança de comportamento aqui, só a origem da regra migrou para o núcleo compartilhado (estoque V1→V2, ganhando FEFO/lotes automaticamente, mesma unificação das fatias anteriores).
4. **Produto com variação cadastrada não pode ser pedido pelo agente** (a cotação exige `variantId`, que o agente ainda não coleta) — o agente já não suportava variações antes, então não é uma regressão nova, só uma limitação que persiste.

## 6. Limitações conhecidas

- Sem cupom/gift card no canal agente ainda (contrato já suporta, rota não expõe).
- Sem `variantId` ponta a ponta.
- `update_status`/`update_items`/`cancel` continuam com lógica própria (efeitos de entrega/cancelamento replicados também em `OrdersModule.tsx` e no webhook Mercado Pago) — consolidar isso é o objetivo da M02.5d.

## 7. Evidências automatizadas

- `tests/services/deliveryOrderServerCommercial.test.ts` (`describe` "M02.5c — pedido do agente"): item com `unitPrice`/`total` zerados não é rejeitado (usa o preço do catálogo); desconto manual/override de frete continuam bloqueados mesmo se enviados, por falta de permissão concedida ao canal.
- Suíte completa: 792 testes em 56 arquivos aprovados. `tsc --noEmit` limpo. PDV, cardápio público e pedido manual sem alteração de resultado.

## 8. Próximos limites (fora desta fatia)

- M02.5d — FSM central de transições de status + efeitos (unificar `OrdersModule` client, agent tools e webhook Mercado Pago) e trava de edição insegura após efeitos.
- M02.5e — `variantId` ponta a ponta.
- M02.5f — Mercado Pago no mesmo `operationId`.
