# M02.0 — Baseline de Vendas, PDV, Pedidos e Cardápio

> Levantamento concluído em: 28/08/2026
>
> Status: concluído em código; auditoria pronta para execução futura por tenant
>
> Escopo desta etapa: caracterização e observabilidade, sem alterar regras de produção

## 1. Objetivo

Registrar o comportamento atual dos cinco canais comerciais antes de criar os contratos e o núcleo autoritativo da M02. O baseline transforma diferenças hoje implícitas em fatos documentados e testáveis.

Esta etapa não corrige os riscos encontrados. Ela cria a proteção necessária para que cada correção posterior seja deliberada, comparável e reversível.

## 2. Documentos comerciais preservados

| Documento | Finalidade atual | Canais | Estados |
|---|---|---|---|
| `sales` | venda rápida de produto ou serviço | PDV, API v1 e agente de vendas | `aberta`, `finalizada`, `cancelada` |
| `deliveryOrders` | pedido com fabricação/atendimento e entrega/retirada | site, manual, WhatsApp, Facebook, Instagram e agente | `recebido`, `preparando`, `pronto`, `saiu_entrega`, `entregue`, `cancelado` |
| `orders` | venda B2B, orçamento e condicional | módulo Vendas | `pendente`, `condicional`, `confirmado`, `faturado`, `enviado`, `entregue`, `cancelado` |

As três coleções continuam separadas. A M02.1 criará contratos comuns e adaptadores sem migrar ou duplicar documentos entre elas.

## 3. Escritores encontrados

### 3.1 `sales`

| Caminho | Operação | Efeitos atuais | Garantia e lacuna |
|---|---|---|---|
| `lib/services/sales-server.ts` | cria venda finalizada | estoque, receita, comissão e cliente | idempotente e server-side, mas aceita preço/desconto enviados pelo cliente; financeiro reduz divisão ao primeiro meio |
| `/api/sales/checkout` | checkout autenticado do PDV | delega ao serviço de vendas | boa fronteira de autenticação; ainda usa o contrato permissivo atual |
| `/api/v1/sales` | cria venda pela API | delega ao mesmo serviço | compartilha efeitos e idempotência |
| `/api/agent/tools/sales` | cria e cancela venda do agente | criação compartilhada; cancelamento próprio | criação convergente, cancelamento ainda não compensa todos os efeitos |
| `PDVModule.tsx` | cancela venda | status, estoque, transação e cliente em passos separados | pode terminar parcialmente aplicado; benefício/fiscal não fazem parte da mesma operação |

### 3.2 `deliveryOrders`

| Caminho | Operação | Efeitos atuais | Garantia e lacuna |
|---|---|---|---|
| `/api/orders/public` | cria pedido do cardápio | preço/modificadores, zona, cliente, cupom, gift card, estoque, número e tracking | servidor recompõe boa parte das regras, mas a sequência não possui compensação completa e não usa o contrato Zod publicado |
| `OrdersModule.tsx` | cria/edita pedido manual | documento, estoque, receita, cliente, fidelidade e fiscal | regras críticas e transições ainda são coordenadas no navegador |
| `/api/agent/tools/orders` | cria, edita, entrega e cancela | horário, preço, estoque, cliente e receita | servidor e FSM presentes; regras ainda diferem do site/manual e a reversão é parcial |
| `/api/orders/[id]/pay-pix` e `pay-card` | inicia pagamento | campos Mercado Pago e idempotência | ciclo do dinheiro separado da fabricação, como desejado |
| webhook e jobs Mercado Pago | aprova, falha, expira, reconcilia e reembolsa | pagamento, estoque e contra-lançamento | maduros, porém ainda constituem um caminho de orquestração paralelo |
| `order-stock-restore.ts` | restaura pedido expirado/cancelado | claim recuperável e estoque | idempotente no pedido, mas reconstrói linhas usando o catálogo mutável |
| `transaction-reversal.ts` | contra-lança receita | transação determinística e flag no pedido | cobre delivery entregue, não é ainda uma reversão comercial comum |
| rotas fiscais | emite documento e atualiza origem | vínculo fiscal | emissão posterior é válida, mas o estado de pendência não é uniforme |

### 3.3 `orders`

| Caminho | Operação | Efeitos atuais | Garantia e lacuna |
|---|---|---|---|
| `VendasModule.tsx` | cria B2B/condicional | grava o documento pelo SDK cliente | preço, desconto, produto e tenant dependem do cliente |
| `VendasModule.tsx` | altera status | grava status e histórico pelo SDK cliente | a FSM documentada não é imposta no servidor e não dispara estoque/financeiro de forma comum |
| emissão fiscal da interface | prepara NF-e | usa itens do pedido | vínculo existe, mas faturamento, estoque e recebível não formam uma operação única |

## 4. Mapa de efeitos

| Efeito | Coleção/campo | Origem/vínculo atual | Observação para a M02 |
|---|---|---|---|
| Estoque | `stockMovements` | `saleId`, `deliveryOrderId`, `orderId` ou `sourceType/sourceId` | persistir os IDs originais no documento comercial e reverter o ledger, não o catálogo atual |
| Lotes | alocações dentro dos movimentos | movimento de saída/restauração | M01 já oferece FEFO e restauração exata quando a alocação é preservada |
| Receita/comissão | `transactions` | `saleId`, `deliveryOrderId`, `orderId`; FKs `transactionId`/`commissionTransactionId` | pagamentos divididos/diferidos ainda precisam de representação fiel |
| Cupom | `couponRedemptions` | `orderId` | reserva transacional, mas falta liberação/compensação comum |
| Gift card delivery | `giftCardRedemptions` | `orderId` | ledger determinístico existe no site |
| Gift card PDV | campos em `giftCards` | `usedBySaleId` | resgate é cliente e não possui o mesmo ledger do delivery |
| Fidelidade | `loyaltyTransactions` | `sourceType/sourceId` | IDs aleatórios e execução pós-venda em melhor esforço no PDV |
| Cliente | `clients` e subcoleção `purchases` | `sourceId` | parte é idempotente; status/visita ainda pode ser melhor esforço |
| Fiscal | `fiscalDocuments` e `fiscalDocId` | `saleId` ou `orderId` | emissão é assíncrona; cancelamento pendente precisa ser explícito |
| Pagamento online | campos inline em `deliveryOrders` | `externalPaymentId` e referência `businessId:order:orderId` | preservar a FSM independente e conectar ao futuro `operationId` |

## 5. Matrizes de estado atuais

### Venda de PDV (`Sale`)

```text
aberta ──► finalizada ──► cancelada
   └────────────────────► cancelada
```

`cancelada` é terminal. A transição `finalizada → cancelada` exige efeitos externos que hoje não são coordenados pela FSM.

### Pedido de delivery (`DeliveryOrder`)

```text
recebido ──► preparando ──► pronto ──► saiu_entrega ──► entregue
    │             │            │              │
    └─────────────┴────────────┴──────────────┴──────► cancelado
```

`pronto → entregue` é permitido para retirada. Pedido online precisa estar `paid` antes de `entregue`; esse gate é aplicado nos caminhos mais maduros, mas não pertence à função pura da FSM.

### Pedido B2B/condicional (`Order`)

```text
pendente ──► confirmado ──► faturado ──► enviado ──► entregue
    └──────► condicional ──► confirmado
```

Estados anteriores à entrega podem cancelar conforme a matriz atual. A UI não chama hoje uma fronteira server-side que imponha a matriz e seus efeitos.

### Pagamento Mercado Pago

```text
pending ──► authorized ──► paid ──► refunded
   ├─────────────────────► paid
   ├─────────────────────► failed
   └─────────────────────► expired
```

A separação entre estado de pagamento e estado de fabricação é uma capacidade correta do AEVO e será preservada.

## 6. Fixtures e caracterização automatizada

Foram adicionadas cinco fixtures sintéticas, sem dados reais:

- `tests/fixtures/m02/pdv-sale.json`;
- `tests/fixtures/m02/public-menu-order.json`;
- `tests/fixtures/m02/manual-delivery-order.json`;
- `tests/fixtures/m02/agent-order.json`;
- `tests/fixtures/m02/b2b-order.json`.

O teste `tests/contracts/m02-commercial-baseline.test.ts` cobre:

- contratos dos cinco documentos/canais;
- pagamento dividido do PDV;
- comportamento atual que aceita preço informado pelo cliente;
- divergência atual entre o contrato público e o payload real da rota;
- ausência de `variantId` no contrato de item comercial;
- preço autoritativo de modificadores;
- zona de entrega, horário, off-hours e pausa manual;
- geração da comanda com modificadores e observação;
- FSMs de Sale, DeliveryOrder, Order e pagamento;
- referência externa tenant/pedido do Mercado Pago.

Essas lacunas são expectativas explícitas do baseline. Elas só serão atualizadas quando a etapa correspondente implementar o comportamento novo.

## 7. Auditoria read-only

O comando abaixo consulta apenas um tenant e não executa writes:

```text
npm run audit:m02 -- --businessId=tenant_123 --output=m02-before.json
```

Depois de uma migração de canal:

```text
npm run audit:m02 -- --businessId=tenant_123 --baseline=m02-before.json --output=m02-after.json
```

A auditoria cruza:

- `sales`, `deliveryOrders` e `orders`;
- `transactions` e `stockMovements`;
- `couponRedemptions`, `giftCardRedemptions` e `loyaltyTransactions`;
- `fiscalDocuments`.

Ela detecta documento de outro tenant, número inválido, pagamentos divergentes, referência financeira/estoque/fiscal ausente e efeito órfão. A saída ordenada permite comparação determinística antes/depois. O código de saída `2` indica inconsistência ou regressão; ausência de `businessId` aborta para impedir varredura global.

Não foi executada contra o projeto Firebase padrão, pois não há um ambiente identificado com segurança como homologação.

## 8. Descobertas congeladas para as próximas etapas

1. O PDV possui entrada server-side, mas o preço e desconto ainda vêm do cliente.
2. `CreatePublicOrderBodySchema` e `/api/orders/public` descrevem payloads diferentes.
3. `variantId` existe no catálogo V2, porém é descartado pelos contratos de Sale/DeliveryOrder/Order.
4. O PDV preserva os pagamentos na venda, mas cria uma única receita paga com o primeiro método.
5. Gift card e pontos do PDV são aplicados depois da venda, em melhor esforço.
6. O site possui ledgers melhores para cupom/gift card, mas sem compensação completa após falha posterior.
7. Cancelamento de PDV e pedido manual ainda coordena efeitos no cliente.
8. A baixa/restauração de delivery pode reconstruir BOM e modificadores a partir de definições alteradas depois da venda.
9. B2B cria e muda status diretamente no cliente, sem núcleo transacional.
10. Listeners de catálogo e algumas listas continuam sem paginação adequada.

## 9. Evidência de conclusão

- [x] Documentos e escritores comerciais mapeados.
- [x] Efeitos e vínculos atuais registrados.
- [x] Cinco fixtures sintéticas criadas.
- [x] Regras válidas de horário, zona, modificadores, pagamento, impressão e fiscal protegidas por testes existentes/novos.
- [x] Matrizes de estado registradas e testadas.
- [x] Auditoria read-only por tenant criada e testada.
- [x] 20 novos testes de caracterização aprovados.
- [x] Suíte completa aprovada: 712 testes em 48 arquivos.
- [x] TypeScript strict aprovado com `tsc --noEmit`.
- [x] Nenhuma regra de produção alterada nesta etapa.

Com esse gate concluído, a próxima etapa é a M02.1: contratos canônicos, adaptadores e cotação autoritativa.
