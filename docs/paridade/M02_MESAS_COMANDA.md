# M02 — Comanda de mesa (TableSession) + fechamento no PDV

> Concluída em código em: 02/09/2026
> Projeto de destino: AEVO (`saas-erp`)
> Sucessora de `docs/paridade/M02_MESA_SALAO.md` (que entregou só `deliveryType='mesa'` + `tableNumber` texto livre + QR `?mesa=N`).

## 1. Contexto

O restaurante do hotel usa mesas no salão. O `M02_MESA_SALAO` marcou um pedido
como "mesa X" mas não existia **comanda** (conta corrente somando vários pedidos
da mesma mesa) nem forma de **fechar a conta e cobrar de uma vez**. Também
faltava o link do cardápio público no próprio módulo Cardápio e um gerador de QR
por mesa.

## 2. Decisões (confirmadas com o dono)

1. **Modelo completo**: entidade `TableSession` + FSM (não só uma view sobre
   pedidos).
2. **Fechar conta = 1 venda no PDV**: pedido de mesa vinculado a uma comanda
   NÃO lança receita sozinho. A receita, o pagamento e a NFC-e saem UMA vez pelo
   checkout do PDV.
3. **Mesas configuráveis nas Configurações** (`settings.aiAgent.pedidos.tables`)
   + folha de QR imprimível na tela Cardápio.

## 3. O que foi entregue

### Contrato + FSM
- `lib/contracts/domain/tableSession.ts` — `TableSession` (Zod, `z.infer`, sem
  interface paralela). Status `aberta | fechada | paga | cancelada`. Invariantes:
  `fechada ⇒ closedAt+closedByUid+subtotalSnapshot`; `paga ⇒ saleId+paidAt+closedAt`;
  `aberta ⇒` nenhum campo de fechamento/pagamento; `orderIds` sem duplicatas.
- `lib/contracts/fsm/tableSession.ts` — `aberta→fechada→paga`, `fechada→aberta`
  (reabrir), `*→cancelada`. `paga`/`cancelada` terminais.

### Vínculo pedido ↔ comanda + receita única
- `lib/contracts/domain/deliveryOrder.ts` — novos opcionais `tableSessionId` e
  `settledViaSaleId` (invariante: `settledViaSaleId ⇒ status='entregue' + tableSessionId`).
- `lib/services/delivery-order-server.ts` — `createDeliveryOrderWithSideEffects`
  valida a sessão (`aberta` + mesmo businessId) antes de criar e faz
  `arrayUnion(orderId)` na sessão depois de persistir.
- `lib/services/delivery-order-transition-admin.ts` — `transitionDeliveryOrderAdmin`
  ganhou o param `settleViaSaleId`. Com ele + `targetStatus='entregue'` + pedido
  com `tableSessionId`: marca `entregue` **sem** `transactions/{orderId}_revenue`,
  sem loyalty, sem `recordClientPurchase`. Sem o param: caminho de receita
  inalterado.

### Serviço + rotas
- `lib/services/table-session-admin.ts` — `open` (idempotente: reusa a sessão
  aberta da mesma mesa), `close` (congela `subtotalSnapshot` = Σ pedidos
  não-cancelados), `reopen`, `cancel` (cancela pedidos abertos), `settle`
  (`fechada→paga`: cada pedido não-terminal → `transitionDeliveryOrderAdmin` com
  `settleViaSaleId`; grava `saleId`/`paidAt`; **no-op** num 2º settle da mesma Sale).
- `POST /api/table-sessions` + `/[id]/{close,reopen,cancel,settle}` — auth
  Firebase, operador+. `_shared.ts` mapeia erros.
- `/api/orders/public` — quando vem `?mesa=N`, resolve/abre a `TableSession`
  daquela mesa no servidor (`openedByUid='public'`) e injeta `tableSessionId`
  (o client anônimo nunca escolhe a sessão direto).

### PDV
- `PDVModule` lê `sessionStorage['pendingTableCheckout']` (deixado pela tela
  Mesas), semeia o carrinho com os itens consolidados, mostra faixa "Fechando
  Mesa N". Após o checkout OK, `POST /api/table-sessions/{id}/settle` com o
  `saleId`. Falha do settle não desfaz a venda (best-effort + toast).
- O PDV **re-cota** os itens pelo núcleo comercial no fechamento (comportamento
  normal do PDV) — a conta reflete o cardápio no momento de fechar.

### Tela Mesas (nova, sidebar)
- `app/components/features/mesas/MesasModule.tsx` — grade de mesas (número
  grande, status, total corrente, tempo) + painel de comanda (todos os itens de
  todos os pedidos vinculados) + ações abrir / + pedido / fechar conta / reabrir
  / cancelar / enviar pro PDV. Filtro por setor (admin vê tudo).
- Wiring: `Sidebar.tsx` (`MenuPage 'Mesas'`, `useCases:['pedidos']`),
  `app/app/page.tsx` (lazy + FULL_HEIGHT), `TabContext.tsx`, `CommandPalette.tsx`.

### Cardápio + Configurações
- `MesaQrCodes.tsx` — link público (`/p/{slug}`) com copiar/abrir/QR + modal
  "Mesas & QR codes" (grade de QR por mesa, download PNG, folha A4 imprimível
  via `window.open`). `CardapioLinkMissing` quando não há slug.
- `SettingsModule` (aba Empresa → Cardápio Online) — editor "Mesas do salão"
  (`settings.aiAgent.pedidos.tables`: `{id,label}[]`, add/remove/renomear +
  "gerar 1…N").

### Gerenciador de Pedidos
- Badge de mesa grande (faixa indigo "MESA N") em `OrderCard` e no drawer.
- Filtro por tipo no header (Todos / Entrega / Retirada / Mesa) com contadores.
- Pedido com `tableSessionId`: ação "Entregar" some do drawer, substituída por
  "Fechar conta na tela de Mesas" (protege a receita única).
- "+ Pedido" da tela Mesas → `OrderFormDialog` com tipo/mesa travados +
  `tableSessionId` no `POST /api/orders/manual`.

### Rules + índices + eventos
- `firestore.rules` — `match /tableSessions/{id}`: `read` se own business;
  `create/update/delete: if false` (WRITE é Admin-SDK-only via rotas).
- `firestore.indexes.json` — `[businessId, tableLabel, status]` e
  `[businessId, status, openedAt]`.
- `lib/contracts/events/index.ts` — `table.opened` / `table.closed` /
  `table.settled` (AUDIT-ONLY; efeito inline no serviço; `close`/`settle`
  chamam `dispatchDomainEvent` best-effort).

## 4. Guarda anti-receita-dobrada (o ponto de maior risco)

Pedido de mesa **com** `tableSessionId`:
- só chega a `entregue` via `settleTableSessionAdmin` (com `settleViaSaleId`);
- o OrdersModule esconde a ação manual "Entregar";
- a receita/pagamento/NFC-e é a **Sale única** do PDV.

Pedido de mesa **sem** `tableSessionId` (texto livre legado) = comportamento de
hoje (receita na entrega).

Cobertura: `tests/services/deliveryOrderTransitionAdmin.test.ts` (entregue com
`settleViaSaleId` não cria `transactions/{orderId}_revenue`; sem ele, cria) +
`tests/services/tableSessionAdmin.test.ts` (settle delega com `settleViaSaleId`,
double-settle no-op) + `tests/contracts/tableSession.test.ts` (invariantes + FSM).

## 5. O que ficou de fora (deliberado)

- **Trava de preço no momento do pedido** — o PDV re-cota no fechamento. Se o
  cardápio mudar de preço entre pedir e fechar, a conta usa o preço atual.
  Follow-up: snapshot de preço por item da comanda.
- **Sessão de caixa do PDV** — `settle` não abre/fecha `cashSession`; o
  fechamento de comanda entra na Sale normal do PDV.
- **Divisão de conta** (split entre hóspedes) — a conta fecha inteira.
- **Relatório por mesa** — Reports não quebra por `deliveryType`/`tableSession`.
- **Agente de IA abrindo mesa** — o agente não sabe em qual mesa física o
  cliente está (mesma decisão do M02_MESA_SALAO).

## 6. Evidências automatizadas

- `tsc --noEmit` limpo.
- `npm run test:run` — 848 testes / 62 arquivos, verdes (21 novos).
