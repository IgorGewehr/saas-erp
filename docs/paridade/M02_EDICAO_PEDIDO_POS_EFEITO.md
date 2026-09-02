# M02 — Corrigir dedução dupla de estoque + travar edição insegura pós-efeito

> Concluída em código em: 01/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: item ainda `[ ]` do checklist M02.5 (`docs/paridade/M02_PLANO_IMPLEMENTACAO.md` §6) — "Bloquear edição insegura após efeitos; quando permitida, calcular e aplicar delta compensatório". Investigando esse item, apareceu um bug mais fundamental e mais urgente, independente de qualquer edição, corrigido junto.

## 1. Bug real encontrado: dedução dupla de estoque + restauro perdido

Confirmado lendo o código diretamente:

1. `commercial-operation-admin.ts` (`persistCommercialDocument`) já debita estoque na **criação** do pedido (checkpoint `stock_applied`) — mas nunca gravava `stockDeductedAt` no documento persistido.
2. `delivery-order-transition-admin.ts` debita estoque de novo na transição `recebido→preparando`, com o guard `if (!order.stockDeductedAt)` — pensado só como fallback pra pedidos legados. Como o campo nunca era setado na criação, essa condição era **sempre verdadeira** pra pedidos novos → **dedução dupla**, com chave de idempotência diferente da usada na criação, então o dedup nativo não detectava.
3. `order-stock-restore.ts` (`restoreOrderStockRecoverable`) se recusa a restaurar estoque quando `!order.stockDeductedAt` — cancelar um pedido ainda `recebido` (antes de chegar em `preparando`) nunca restaurava o estoque debitado na criação. **Perda permanente.**

Isso acontecia em todo pedido criado pelos adaptadores M02.5a/b/c (cardápio público, manual, agente), independente de qualquer edição.

**Correção**: `persistCommercialDocument` agora grava `stockDeductedAt` no mesmo bloco condicional que já grava `stockOperationId`/`stockMovementIds` quando há efeito de estoque, gateado por `sourceType === 'deliveryOrder'`. Com isso, o fallback de `recebido→preparando` volta a ser fallback de verdade (só age em pedidos genuinamente legados) e o restauro em `recebido` passa a funcionar.

**Limite conhecido**: pedidos já criados antes deste fix, ainda em `recebido` (não transicionados), passam pelo fallback de dedução uma última vez ao transicionar. Sem backfill nesta fatia — aceitável pro estágio de pilot, sem volume real acumulado ainda.

## 2. Edição de pedido — bloqueio, não reconciliação automática

Hoje `OrdersModule.tsx` escrevia a edição de pedido direto via Client SDK, sem checar status nem tocar estoque — o único write-path do módulo que não passava pelo núcleo comercial server-side. E o agente (`update_items`) tinha lógica própria, com um guard (`if (existing.stockDeductedAt) throw`) que, depois do fix do item 1, passaria a bloquear **sempre** (todo pedido novo tem `stockDeductedAt` desde a criação) — inutilizando a edição pelo agente.

Novo `lib/services/delivery-order-edit-admin.ts` (`editDeliveryOrderAdmin`), fonte única pra UI e agente (mesmo padrão de `transitionDeliveryOrderAdmin`, M02.5d):

- **Campos livres** (contato do cliente, notas, forma/status de pagamento fora de Mercado Pago, previsão de entrega) — editáveis em qualquer status.
- **Campos sensíveis** (`items`, `deliveryFee`, `discount`, `deliveryType`, `deliveryAddress`) — só mudam de valor com `status === 'recebido'`. Fora disso, rejeita (`DeliveryOrderEditBlockedError`, HTTP 409) e orienta cancelar + criar novo pedido.

**Por que bloquear em vez de reconciliar automaticamente fora de `recebido`**: mesma filosofia já usada em `reversePurchaseNoteAdmin` (bloquear quando não dá pra provar que é seguro, não adivinhar). E cobre de graça os efeitos de receita/fiscal — `transactionId` só existe a partir de `entregue`, `fiscalDocumentId` só depois disso — nunca existem enquanto o pedido ainda está em `recebido`, então bloquear ali evita ter que reconciliar Transaction ou documento fiscal nesta fatia.

**Dentro de `recebido`**, mudança de `items` reconcilia estoque por **restaura tudo + deduz tudo de novo** (não delta cirúrgico por SKU) — reaproveita `restoreStockAdmin`/`deductStockAdmin` (`lib/services/stock-admin.ts`), que já expandem BOM corretamente (ao contrário de `ajuste`, que exige expansão manual). Pré-checagem de disponibilidade antes de tocar em qualquer coisa; se a dedução dos itens novos falhar mesmo assim (corrida real), compensa devolvendo os itens antigos antes de propagar o erro — o pedido nunca fica com estoque parcialmente debitado.

Extraído de quebra: `resolveOrderStockProductIndex` (`lib/services/order-stock-restore.ts`) — a resolução de 3 passes (itens → insumos de modificador → folhas de BOM) que antes só existia inline em `restoreOrderStockRecoverable`, agora reaproveitada também pela reconciliação de edição (fecha gap G4 — lógica duplicada divergindo).

## 3. O que mudou tecnicamente

- `lib/services/commercial-operation-admin.ts`: grava `stockDeductedAt` na criação (item 1).
- `lib/services/order-stock-restore.ts`: nova `resolveOrderStockProductIndex` exportada (extração), `restoreOrderStockRecoverable` simplificado pra usá-la.
- `lib/services/delivery-order-edit-admin.ts` (novo): `editDeliveryOrderAdmin`.
- `app/api/orders/[id]/edit/route.ts` (novo): `PATCH`, mirror de `/transition`, `verifyAuth` + `operator+`.
- `app/api/agent/tools/orders/route.ts`: `updateItems` mantém a resolução de preço no catálogo (agente não tem preço real), mas delega status/estoque/reconciliação pra `editDeliveryOrderAdmin`.
- `app/components/features/orders/OrdersModule.tsx`: novo helper `editOrder` (fetch autenticado); `persistOrder`'s branch de edição chama a nova rota em vez de `updateDoc` direto.

## 4. O que ficou de fora (deliberado)

- Backfill de `stockDeductedAt` em pedidos já existentes.
- Reconciliação automática de receita/fiscal em edição — desnecessária por construção.
- Delta cirúrgico por SKU (via `ajuste`) — restaurar+deduzir tudo é mais simples e reaproveita primitivos já testados.

## 5. Evidências automatizadas

- `tests/services/deliveryOrderServerCommercial.test.ts`: novo caso confirma `stockDeductedAt` setado na criação; novo caso de regressão confirma que a transição `recebido→preparando` não debita de novo (`stockApplied: false`, estoque inalterado).
- `tests/services/deliveryOrderEditAdmin.test.ts` (novo, 7 casos): reconciliação de troca de quantidade; reconciliação de troca de produto; bloqueio fora de `recebido`; edição de campos livres em qualquer status; pré-checagem rejeita estoque insuficiente sem tocar nada; compensação devolve itens antigos quando a dedução falha após a pré-checagem passar; isolamento de tenant.
- Suíte completa: 823 testes em 60 arquivos aprovados. `tsc --noEmit` limpo.
