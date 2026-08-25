# M01.2 — Núcleo server-side de estoque

## Resultado

O AEVO passou a ter uma única autoridade de escrita para saldo: `applyStockOperationAdmin`.
O browser mantém apenas a pré-checagem de disponibilidade; toda mutação efetiva é
autenticada e executada no servidor.

## Invariantes implementados

1. A operação exige `businessId`, origem, operador, motivo e chave idempotente.
2. Produtos base, componentes de BOM e documentos de origem informados são lidos
   e validados pelo tenant dentro da transação.
3. Todas as leituras acontecem antes das escritas.
4. `products.currentStock` e o respectivo `stockMovements` V2 são gravados na
   mesma transação.
5. `previousStock` e `newStock` vêm do saldo autoritativo lido na transação.
6. A chave em `stockOperations` fecha duplicação e concorrência. Repetir o mesmo
   evento devolve o resultado anterior; reutilizar a chave com outro saldo/origem
   gera conflito.
7. Saída pode operar em modo compatível (`allow`) ou rígido (`prevent`).
8. Ajuste usa delta assinado no ledger V2; a API v1 pode continuar enviando alvo
   absoluto, convertido no servidor.
9. Cruzamentos de estoque mínimo/zerado são calculados no núcleo e devolvidos aos
   chamadores para toast e notificação.
10. Produtos compostos continuam expandindo BOM em um nível. Linhas de insumos de
    modificadores são construídas por `buildOrderStockLines` antes da operação.

## Fluxos migrados

- PDV: checkout server-side com venda, receita, comissão, estoque, modificadores e
  estatísticas idempotentes do cliente.
- Cancelamento de venda no PDV.
- Pedidos internos: baixa ao preparar e restauração ao cancelar.
- Cardápio público e criação de pedido pelo agente.
- Vendas criadas pela API v1 e pelo agente.
- Entrada de NF-e pela tela de Compras e pelo agente.
- Ajustes manuais da tela de Estoque e do agente.
- Consumo de insumos ao concluir serviços.
- API v1 de movimentações.
- Restauros automáticos de pedidos por cancelamento, estorno e expiração.

## Superfícies

- Núcleo: `lib/services/stock-core-admin.ts`
- Adaptador Admin legado: `lib/services/stock-admin.ts`
- Boundary autenticado: `POST /api/stock/operations`
- Cliente autenticado: `lib/services/stock-server-client.ts`
- Checkout do PDV: `POST /api/sales/checkout`
- Ledger: `stockMovements` com `schemaVersion: 2`
- Idempotência: `stockOperations`, inacessível ao Client SDK nas Firestore Rules
- Firestore Rules: clientes não criam `stockMovements`, não alteram
  `products.currentStock` e só criam produto com saldo inicial zero

## Limites encaminhados para as próximas etapas

- Custos e status completos da importação de NF-e serão consolidados com claim e
  recuperação na M01.5.
- Variações com saldo próprio serão ativadas junto ao catálogo V2 na M01.3.
- Alertas persistentes continuam usando o distribuidor existente; a detecção do
  cruzamento já é única e server-side.
