# M02.5d — FSM Central de Transições de Status

> Concluída em código em: 01/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: transições de status de `deliveryOrders` (aceitar/preparar/entregar/cancelar/excluir/recusar) e seus efeitos. Edição de itens pós-efeito, emissão fiscal automática e Mercado Pago ficam fora desta fatia.

## 1. Resultado entregue

As transições de status de `deliveryOrders` — antes implementadas de forma duplicada em `OrdersModule.tsx` (client SDK) e `app/api/agent/tools/orders/route.ts` (admin SDK) — agora usam uma única fonte: `lib/services/delivery-order-transition-admin.ts` (`transitionDeliveryOrderAdmin`). A UI passa a chamar uma nova rota autenticada, `PATCH /api/orders/[id]/transition`; o agente chama a mesma função diretamente (sem round-trip HTTP, mesmo padrão dos adaptadores de criação).

Mercado Pago (`webhook-settle.ts`, crons de expiração/reconciliação) **não foi tocado** — ele nunca mudou `status` (só `paymentFsmStatus`) e já delegava o restauro de estoque para `restoreOrderStockRecoverable`, a mesma função que o novo serviço reaproveita sem alteração.

## 2. Bugs reais corrigidos pela consolidação

O mapeamento das duas implementações revelou três divergências que não eram só "código duplicado" — eram comportamentos diferentes para o mesmo efeito pretendido:

1. **Fidelidade não acumulava em pedidos entregues pelo agente.** `OrdersModule` chamava `calculateEarnedPoints`/`addLoyaltyPoints` após lançar a receita; o `updateStatus` do agente lançava a MESMA receita determinística (`transactions/{orderId}_revenue`, mesmo CAS) mas nunca creditava pontos. Um cliente que fechava o pedido pelo WhatsApp não ganhava fidelidade. Corrigido com `addLoyaltyPointsAdmin` (novo, mirror Admin SDK de `addLoyaltyPoints` em `lib/services/loyalty.ts`), chamado pelo mesmo `bookDeliveryRevenueAdmin` usado por ambos os canais agora.
2. **`handleDelete` (botão "Excluir" da UI) pulava a validação de FSM.** Só tinha guard para `status==='cancelado'` — nada impedia "excluir" um pedido já **entregue** (restauraria estoque e marcaria cancelado um pedido cuja receita já tinha sido reconhecida, sem reverter a transação). `handleReject` (recusar) já validava corretamente para o mesmo efeito final. Agora `transitionDeliveryOrderAdmin` valida a FSM **sempre**, então "excluir" um pedido entregue é rejeitado (o pedido entregue é terminal — reversão de venda concluída é um fluxo à parte, ainda não implementado).
3. **Restauro de estoque pela UI usava uma resolução de produtos mais simples que o caminho admin.** `restoreOrderStockOnce` (client) usava o array `products` já carregado no estado do componente; `restoreOrderStockRecoverable` (admin, usado por agente e Mercado Pago) já fazia 3 passes de resolução para cobrir insumos de modificadores e componentes de BOM. Cancelar pela UI e cancelar pelo agente podiam divergir no que restauravam. Agora os dois canais chamam a mesma função.

## 3. O que mudou tecnicamente

- **Novo serviço** `lib/services/delivery-order-transition-admin.ts`: `transitionDeliveryOrderAdmin({db, orderId, businessId, targetStatus, actor, reason?, now?})`. Sempre valida `assertTransitionDeliveryOrder`. Para `entregue`: gate X1 (pedido online exige `paymentFsmStatus==='paid'`) + `bookDeliveryRevenueAdmin` (receita idempotente + registro de compra + fidelidade). Para `cancelado`: `restoreOrderStockRecoverable` (reaproveitada, sem alteração) + patch de `cancelledAt/cancelledBy/cancelledByName/internalNotes`. Para as demais: dedução de estoque legada ao entrar em `preparando` (só para pedidos sem `stockDeductedAt` — pedidos criados pelos adaptadores M02.5a/b/c já saem de `recebido` com estoque deduzido na criação).
- **Nova rota** `PATCH /api/orders/[id]/transition`: mirror de `/api/orders/manual`, `verifyAuth` + gate `operator+`. Corpo `{businessId, status, reason?}`; resposta `{ok, data:{status, stockAlerts}}`.
- **Agente** (`updateStatus`/`cancelOrder`): passam a chamar `transitionDeliveryOrderAdmin` diretamente. `get`/`list_by_client`/`update_items`/`list_recent` não mudaram.
- **`OrdersModule.tsx`**: novo helper `transitionOrder(orderId, status, reason?)` (fetch autenticado). `handleStatusChange` mantém as pré-checagens client-side (FSM/gate X1) como UX otimista, mas delega a escrita e os efeitos ao servidor; usa `stockAlerts` da resposta para os mesmos toasts de estoque baixo. `handleDelete`/`handleReject` chamam o mesmo helper. Funções `bookDeliveryRevenue`/`restoreOrderStockOnce` e os imports que só elas usavam (`runTransaction`, `applyStockOperation`, `buildOrderStockLines`, `recordClientPurchaseClient`, `calculateEarnedPoints`, `addLoyaltyPoints`) foram removidos.

## 4. O que ficou de fora (deliberado)

- **Emissão fiscal automática** (`autoEmitNfceIfEnabled`) continua client-disparada após a resposta da transição, como antes — mover para o servidor abriria a superfície do subsistema fiscal, fora do pedido desta consolidação. Continua sendo uma lacuna pré-existente que o agente não emite NFC-e automaticamente ao entregar (só a UI faz isso).
- **Mercado Pago** — nenhuma mudança. Já não tocava `status` e já usava a função de restauro correta.
- **Edição de itens pós-efeito** (`update_items` do agente, edição de pedido manual na UI) — travas de segurança para editar um pedido que já teve estoque debitado/pagamento fazem parte de um item separado do checklist da M02.5 ("Bloquear edição insegura após efeitos"), não desta fatia.
- **Notificação ao cliente e alerta de estoque baixo** continuam disparados pelo client após a resposta da rota, alimentados pelos dados que a rota devolve.

## 5. Evidências automatizadas

- `tests/services/deliveryOrderTransitionAdmin.test.ts` (9 casos): entrega com receita+registro de compra; fidelidade só acumula na execução que lança a receita (replay não duplica); pedido online não pago rejeita; cancelamento delega ao restauro admin e grava auditoria; cancelar pedido já entregue rejeita pela FSM (prova do bug corrigido); pulo de estado inválido rejeita; dedução legada em `preparando` funciona e não duplica; isolamento de tenant.
- `tests/contracts/m01-ui-smoke.test.ts`: atualizado para refletir a nova arquitetura — verifica que `OrdersModule.tsx` cria pedidos via `/api/orders/manual` e transiciona status via `/transition`, sem mais `bookDeliveryRevenue`/`restoreOrderStockOnce` client-side (PDV mantém seu próprio check, inalterado).
- Suíte completa: 802 testes em 57 arquivos aprovados. `tsc --noEmit` limpo. Mercado Pago, criação nos três canais e PDV sem alteração de resultado.

## 6. Próximos limites (fora desta fatia)

- Bloqueio/delta de edição pós-efeito (itens do agente, edição manual).
- `variantId` ponta a ponta (M02.5e).
- Mercado Pago no mesmo `operationId` (M02.5f).
- Emissão fiscal automática também no caminho do agente (gap pré-existente, não corrigido aqui).
