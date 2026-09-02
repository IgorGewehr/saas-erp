# M02 — Tipo de pedido "Mesa" (salão do restaurante do hotel)

> Concluída em código em: 02/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: último gap identificado pro restaurante de hotel (Cardápio/Pedidos). O usuário confirmou que o modelo de uso real é mesas no salão (com ou sem QR code por mesa) — não é cobrança na conta do quarto (sem integração de PMS/hotel).

## 1. Resultado entregue

Novo `DeliveryType = 'mesa'`, com campo `tableNumber` opcional. Suporta dois fluxos:

1. **Manual** — garçom/recepção cria o pedido pelo formulário de Pedidos, escolhe "Mesa" e digita o número.
2. **Autoatendimento via QR code** — hóspede escaneia um QR na própria mesa apontando pra `https://.../p/{slug}?mesa=12`; o cardápio público abre com a mesa já travada (sem perguntar "entrega ou retirada", sem pedir endereço).

## 2. Os pontos binários corrigidos

`DeliveryType` era tratado como binário (`=== 'entrega' ? X : Y`) em vários lugares — cada um assumia implicitamente "se não é entrega, é retirada". Adicionar um terceiro valor sem revisar cada um teria feito esses lugares mostrarem "Retirada" errado pra um pedido de mesa. Lista completa corrigida (referência pra quem adicionar um 4º `DeliveryType` no futuro):

1. `app/api/orders/public/route.ts` — notificação WhatsApp pro negócio (`🍽️ Mesa {N}`).
2. `app/api/conversations/status-notify/route.ts` — mensagem "pronto" ao cliente (mesa não menciona entregador/retirada).
3. `OrdersModule.tsx`'s `statusFlowFor()` — mesa pula a etapa `saiu_entrega`, igual retirada.
4. `OrdersModule.tsx`'s `OrderCard` (badge do kanban).
5. `OrdersModule.tsx`'s `NewOrderCard` (faixa de pedidos novos).
6. `OrdersModule.tsx`'s `OrderDetailDrawer` (seção "Mesa" no lugar do bloco de endereço).
7. `OrdersModule.tsx`'s `OrderFormDialog` (terceiro botão + campo de número da mesa).
8. `ComandaTermica.tsx` + `lib/services/printing/comandaEscpos.ts` (ticket impresso/preview — cabeçalho `MESA {N}`).
9. `app/p/[slug]/CatalogClient.tsx` (seletor, campo, `addressValid`, textos de "pagar na entrega/retirada", tela de sucesso).

**Achados durante a implementação, fora da lista original** (o `tsc --noEmit` pegou todos, um a um, ao adicionar `'mesa'` ao enum canônico):
- `lib/contracts/domain/commercialV2.ts` — `CommercialDeliveryQuoteSchema`/`CommercialQuoteSchema.delivery.type` tinham `z.enum(['entrega','retirada'])` **redeclarado independentemente**, não importado do contrato canônico (`lib/contracts/domain/deliveryOrder.ts`). Corrigido pra importar `DeliveryTypeSchema` — fecha esse gap de duplicação (G4) de vez.
- `lib/services/commercial-quote.ts` — `resolution: type === 'retirada' ? 'none' : ...` tinha o mesmo problema binário; corrigido pra `!== 'entrega'`.
- `lib/services/commercial-benefits-admin.ts` — `deliveryContextFrom()` tinha o retorno anotado como `'entrega' | 'retirada'` (tipo local redeclarado); alargado pra `DeliveryType` canônico.

**Deixado de propósito sem `'mesa'`**: `lib/contracts/api/agent/orders.ts` (`OrdersCreateParamsSchema.deliveryType`) — o agente de IA conversa por WhatsApp/chat, que não tem como saber em qual mesa física do salão o cliente está. Pedido de mesa continua exclusivo dos fluxos manual/QR.

## 3. O que mudou tecnicamente

- `lib/contracts/domain/deliveryOrder.ts` + `lib/types/index.ts`: `DELIVERY_TYPES`/`DeliveryType` ganham `'mesa'`; `DeliveryOrderSchema`/`DeliveryOrder` ganham `tableNumber?: string` (opcional mesmo pra mesa — não trava se o garçom esquecer).
- `lib/contracts/api/services/delivery-order-server.ts` + `lib/contracts/api/orders/public.ts`: `tableNumber?` nos contratos de criação (compartilhados por `/api/orders/public` e `/api/orders/manual` via spread do body validado).
- `lib/services/delivery-order-edit-admin.ts`: `tableNumber` como campo LIVRE (não sensível) — editável em qualquer status, não aciona reconciliação de estoque.
- `app/p/[slug]/page.tsx`: lê `searchParams.mesa` (mesmo padrão já usado em `pedido/[orderId]/page.tsx` pro token de tracking), repassa como prop.

## 4. O que ficou de fora (deliberado)

- Geração/impressão de QR code em si — usa gerador externo apontando pra `?mesa=N`.
- Relatório de faturamento por mesa — Reports não tem nenhum breakdown por `deliveryType` hoje, seria relatório novo do zero.
- Qualquer integração com sistema de hotel/PMS (cobrança na conta do quarto) — confirmado com o usuário que não é o modelo de uso.
- "Pedir de novo" (repetir último pedido) restaura `deliveryType='mesa'` mas não o número da mesa (não fica salvo no snapshot local) — hóspede redigita, inconveniência menor.

## 5. Evidências automatizadas

- `tests/contracts/m02-delivery-order-contract.test.ts`: aceita `deliveryType='mesa'` com e sem `tableNumber`, sem exigir endereço/taxa de entrega.
- `tests/services/deliveryOrderServerCommercial.test.ts`: cria pedido de mesa com `tableNumber` via `createDeliveryOrderWithSideEffects`.
- `tests/services/deliveryOrderEditAdmin.test.ts`: edita `tableNumber` em qualquer status sem tocar estoque (campo livre).
- Suíte completa: 827 testes em 60 arquivos aprovados. `tsc --noEmit` limpo (foi o `tsc` que revelou os 3 pontos de duplicação em `commercialV2.ts`/`commercial-quote.ts`/`commercial-benefits-admin.ts` não previstos no plano original).
