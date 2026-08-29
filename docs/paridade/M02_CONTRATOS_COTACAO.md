# M02.1 — Contratos, cotação e preço autoritativo

> Concluída em código em: 29/08/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: fundação comercial compartilhada; migração dos escritores ocorre nas M02.3, M02.5 e M02.6

## Resultado entregue

A M02.1 introduz uma linguagem comercial V2 comum para PDV, cardápio, pedidos manuais, agente e B2B sem fundir `sales`, `deliveryOrders` e `orders`.

O novo núcleo recebe apenas IDs, quantidades e contexto da operação. Produto, serviço, variação, modificadores, estoque e zona são relidos no servidor. O resultado é calculado em centavos inteiros e devolve snapshots autoritativos, decomposição do preço e disponibilidade agregada.

## Componentes

### Contratos V2

`lib/contracts/domain/commercialV2.ts` formaliza:

- cesta de cotação por `businessId` e canal;
- linha exclusiva de produto ou serviço;
- `variantId`, modificadores por ID e observação;
- snapshots de nome, SKU, variação e preços;
- subtotal, desconto, taxa, gorjeta e total em centavos;
- origem do desconto e motivo;
- alocações de pagamento;
- requisitos de estoque e faltas agregadas;
- referências de transação, estoque, cupom, gift card, fidelidade e fiscal;
- documento comercial de leitura V2 compatível com as três coleções legadas.

`lib/contracts/api/commercial/quote.ts` define a fronteira de `POST /api/commercial/quote`.

### Cotação server-side

`lib/services/commercial-quote.ts` é a fonte única desta etapa para:

- conversão de reais para centavos;
- preço de produto simples e produto com variação;
- preço de serviço;
- estratégias `sum`, `max` e `avg` de modificadores;
- consumo de produto, componente de BOM, insumo de serviço e insumo ligado a modificador;
- disponibilidade agregada quando várias linhas disputam o mesmo saldo;
- entrega por zona ou taxa plana;
- desconto manual fixo ou percentual;
- rejeição de total esperado obsoleto;
- isolamento de tenant e bloqueio de catálogo inativo/indisponível.

A rota autenticada permite cotação a partir de `operator`. Desconto manual exige `manager` ou função superior. A cotação não grava no Firestore; a disponibilidade é uma prévia e a disputa concorrente definitiva continua pertencendo ao checkout transacional.

### Adaptadores legados

`lib/services/commercial-adapters.ts` converte, para leitura V2:

- `Sale` para origem `sale`;
- `DeliveryOrder` para origem `deliveryOrder`;
- `Order` para origem `order`.

Os adaptadores preservam pagamentos divididos, `variantId` ainda desconhecido pelo schema antigo, modificadores, IDs de movimentos e efeitos conhecidos. Gift card legado é exposto como alocação de pagamento e recebe um ajuste de compatibilidade porque esse documento já o subtraía do campo `total`.

Nenhum adaptador regrava ou migra documentos nesta etapa.

### Contrato do cardápio público

O contrato de `POST /api/orders/public` agora representa o payload realmente enviado pelo cardápio: `businessId`, snapshots esperados de item, endereço, taxa informativa, pagamento, cupom e gift card.

A rota usa esse schema na entrada. A taxa enviada permanece ignorada; catálogo, modificadores, zona, benefícios e total continuam sendo recalculados pelo servidor. A migração desse escritor para o coordenador comum será feita na M02.5.

## Política monetária

1. Valores do catálogo legado em reais entram no núcleo uma única vez.
2. A conversão usa arredondamento para o centavo mais próximo.
3. Soma, desconto, taxa, gorjeta e comparação de total são feitas em inteiros.
4. Percentuais são expressos em basis points: `10000 = 100%`.
5. O cliente pode informar `expectedTotalCents`; divergência devolve conflito acionável e não é aceita silenciosamente.

## Compatibilidade e limites desta etapa

- As três coleções comerciais continuam intactas.
- PDV, cardápio, agente e B2B ainda não foram redirecionados ao novo núcleo.
- Cupom, gift card e fidelidade ainda serão integrados ao ciclo recuperável na M02.4.
- A cotação não reserva estoque e não substitui o guard transacional do checkout.
- O endpoint de cotação é interno e autenticado; a experiência pública será conectada na M02.5.
- Nenhuma regra do Firestore foi restringida nesta rodada.

## Evidências automatizadas

Os testes da etapa cobrem:

- arredondamento e invariantes dos contratos;
- igualdade de preço entre canais internos;
- adulteração de nome/preço de modificador;
- variação e estoque agregado;
- serviço e consumo de insumos;
- desconto autorizado e bloqueado;
- total esperado obsoleto;
- tenant, item inativo e indisponibilidade no cardápio;
- adaptação de `Sale`, `DeliveryOrder` e `Order`;
- pagamento dividido, gift card legado e referências de efeitos;
- correspondência entre contrato e rota pública;
- ausência de escrita na cotação.

Na validação desta entrega, a suíte completa aprovou 728 testes em 50 arquivos, o typecheck passou e o build de produção gerou as 153 páginas sem falha.

## Próxima etapa

A M02.2 criará `commercialOperations`, IDs determinísticos e checkpoints recuperáveis. O contrato e a cotação desta etapa serão a entrada validada do coordenador; nenhum canal será migrado antes de esse ciclo estar testado contra replay e falha intermediária.
