# M02 — Plano de implementação de Vendas, PDV, Pedidos e Cardápio

> Análise concluída em: 28/08/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Estado desta rodada: M02.0 a M02.4 concluídas em código; M02.5a-d (cardápio público, pedido manual, agente, FSM central + bloqueio de edição pós-efeito) concluídas.
>
> **Pausado em 03/09/2026** a partir de M02.5e, **retomado em 08/09/2026** a pedido do usuário —
> odontologia continua prioridade, mas o restante da M02 (`variantId`, B2B, Mercado Pago
> tokenizado, cancelamento/devolução, UX/desempenho, migração, testes) volta a ser trabalhado em
> paralelo. Ver "Prioridade atual" em `docs/ROADMAP_PARIDADE_GESTAO_RAIZ.md`.

## 1. Resultado esperado

Ao concluir a M02, PDV, cardápio público, pedidos de delivery, pedidos criados pelo agente e vendas B2B deverão compartilhar as mesmas regras server-side de preço, desconto, pagamento, estoque e reversão.

O AEVO continuará com seus três documentos comerciais por compatibilidade e por diferença de finalidade:

- `sales`: venda rápida de PDV e serviços;
- `deliveryOrders`: pedidos omnichannel, cozinha, retirada e entrega;
- `orders`: orçamento, venda B2B e condicional.

Não haverá fusão destrutiva dessas coleções. A paridade será obtida por contratos, serviços e efeitos comuns, com adaptadores por canal. O objetivo é ter a maturidade transacional validada no Gestão Raiz sem perder as capacidades próprias do AEVO.

## 2. Inventário dos fluxos atuais

| Fluxo | Documento atual | Escrita principal | Capacidades relevantes | Risco dominante |
|---|---|---|---|---|
| PDV e serviços | `sales` | `/api/sales/checkout` → `createSaleWithSideEffects` | múltiplos pagamentos, comissão, estoque, fiscal, cliente | servidor ainda aceita preço/desconto do cliente e simplifica o financeiro |
| Cardápio público | `deliveryOrders` | `/api/orders/public` | horário, zona, modificadores, cupom, gift card, estoque, tracking e Mercado Pago | contrato Zod não é usado e a sequência de efeitos não tem compensação completa |
| Pedido manual | `deliveryOrders` | `OrdersModule` pelo SDK cliente | kanban, cozinha, entrega, impressão, fiscal e receita | criação, edição e transições críticas estão fragmentadas no cliente |
| Pedido do agente | `deliveryOrders` | `/api/agent/tools/orders` | idempotência, numeração, estoque e cliente | regras diferem do cardápio e do pedido manual; cancelamento é parcial |
| Venda B2B/condicional | `orders` | `VendasModule` pelo SDK cliente | orçamento, condicional, histórico e emissão fiscal | preço, estoque, status e efeitos são controlados no cliente |
| Pagamento online | `deliveryOrders` | rotas Mercado Pago, webhook e jobs | PIX, cartão, expiração, reconciliação e capability token | orquestração própria precisa aderir ao mesmo ledger comercial |

### 2.1 Referência confirmada no Gestão Raiz

O Gestão Raiz concentra PDV, B2B e outros canais no domínio de pedidos e oferece padrões já validados que serão portados ou adaptados:

- finalização server-side transacional e idempotente;
- pagamentos imediatos e diferidos tratados de forma distinta;
- pagamentos divididos com validação da soma e um efeito financeiro por parcela/meio;
- vínculo determinístico entre pedido, recebíveis, transações e conta financeira;
- cancelamento centralizado, reentrante e auditável;
- restauração de estoque e lotes vinculada aos efeitos originais;
- coordenação explícita com cancelamento fiscal e pendências de reprocessamento.

Não serão copiados lotes industriais de produto acabado, ordens de produção, PCP ou rastreabilidade fabril. O AEVO usará apenas o padrão de consistência e os lotes opt-in já entregues na M01.

### 2.2 Capacidades do AEVO que devem ser preservadas

- cardápio público por slug, categorias, imagens e disponibilidade diária;
- entrega por zona, retirada e validação do horário de funcionamento;
- modificadores com impacto em preço e consumo de insumos;
- cupons com limites globais, por cliente e de primeira compra;
- gift cards, pontos de fidelidade e crédito de relacionamento;
- PIX e cartão pelo Mercado Pago, tracking público por token e reconciliação;
- pedidos por WhatsApp, redes sociais, agente e operação manual;
- numeração sequencial compartilhada de pedidos;
- comanda, impressão, notificações e atualização em tempo real;
- serviços no PDV, comissão, NFC-e/NF-e/NFS-e e vínculos com clientes;
- estoque V2, BOM, variações, lotes e FEFO entregues na M01.

## 3. Diagnóstico e prioridades

### P0 — Corrigir antes de ampliar funcionalidades

1. **Preço do PDV ainda não é autoritativo no servidor.** O serviço valida a aritmética, mas recebe do cliente `unitPrice`, descontos, produtos e serviços sem reler todas as fontes de catálogo e permissão.
2. **Cancelamentos são operações compostas no cliente.** Venda/pedido, estoque, financeiro, cliente, gift card, fidelidade, cupom e fiscal podem terminar em estados diferentes se uma etapa falhar.
3. **Gift card e fidelidade do PDV são liquidados depois da venda e em melhor esforço.** Uma venda pode ser confirmada mesmo que o débito real de pontos ou saldo falhe.
4. **Pedido manual grava e muda estados críticos diretamente pelo SDK cliente.** A autorização, FSM e os efeitos não são uma única operação de domínio.
5. **A restauração reconstrói a intenção de estoque a partir do catálogo atual.** Alterar BOM, modificadores ou variação após a venda pode devolver quantidade ou insumo incorreto. A reversão deve usar o ledger/movimentos originais.

### P1 — Resolver durante a migração dos canais

1. A transação financeira do PDV é sempre marcada como paga e registra apenas o primeiro meio, mesmo quando há divisão ou meio diferido.
2. O contrato `CreatePublicOrderBodySchema` não corresponde ao payload realmente aceito por `/api/orders/public` e não é a fronteira efetiva de validação.
3. Variações do catálogo V2 ainda não percorrem carrinho, preço, estoque, fiscal, impressão e repetição de pedido.
4. As FSMs existem, mas nem todas as transições são revalidadas no servidor.
5. As regras atuais ainda permitem escrita direta em `sales`, `deliveryOrders` e `orders` para campos críticos.
6. Cupom ou gift card podem ser consumidos antes de uma falha posterior sem uma compensação garantida.
7. A emissão fiscal posterior à venda é válida como processo assíncrono, mas falta um estado explícito, consultável e reprocessável em todos os canais.

### P2 — Qualidade operacional e custo

1. Listeners de produtos e algumas listas comerciais ainda carregam o conjunto inteiro do tenant.
2. O cardápio público consulta todos os produtos ativos do negócio a cada regeneração, sem projeção pública paginada/cacheada por versão.
3. Faltam testes integrados dos fluxos completos de checkout, pagamento, cancelamento, concorrência e recuperação.
4. Há diferenças de regra entre cardápio, agente, pedido manual, PDV e B2B que hoje só são percebidas em produção.

## 4. Decisões de escopo

### Portar do Gestão Raiz

- finalização idempotente com referências determinísticas;
- tratamento correto de pagamentos imediatos, diferidos e divididos;
- cancelamento/estorno centralizado e reentrante;
- integração financeira auditável, sem lançamentos duplicados;
- coordenação de cancelamento fiscal com estado pendente e retentativa;
- testes concorrentes e reconciliação antes/depois.

### Adaptar

- usar um núcleo comercial comum com adaptadores, sem fundir as três coleções atuais;
- aplicar restauração exata aos lotes opcionais e variações do AEVO;
- usar o modelo de pedido industrial apenas como referência de consistência;
- adaptar recebíveis e contas financeiras aos meios realmente habilitados no pequeno negócio;
- manter emissão fiscal assíncrona quando a venda não puder aguardar o provedor, mas registrar seu estado de forma confiável.

### Manter AEVO

- cardápio, delivery, modificadores, cupons, gift cards, fidelidade e Mercado Pago;
- canais sociais, agente, tracking público e experiência de cozinha/entrega;
- separação entre venda rápida, delivery e B2B na interface e nos documentos legados.

### Não aplicar

- produção industrial, lotes de produto acabado obrigatórios e rastreabilidade fabril;
- reservas de matéria-prima, PCP, MRP e expedição industrial;
- regras fiscais/logísticas sem uso nos segmentos atendidos pelo AEVO.

## 5. Arquitetura-alvo

```text
PDV | Cardápio | Pedidos | B2B | Agente | API v1
                         │
                         ▼
             Fronteiras autenticadas/Zod
                         │
                         ▼
              Núcleo Comercial M02
              ├── cotação e preço autoritativo
              ├── descontos, cupons e permissões
              ├── alocação de pagamentos
              ├── coordenador de operação/checkpoints
              ├── estoque e lotes pelo núcleo M01
              ├── gift card e fidelidade por ledger
              ├── financeiro e comissão
              └── estado fiscal e eventos
                         │
                         ▼
          Adaptadores compatíveis por documento
              ├── sales
              ├── deliveryOrders
              └── orders
```

### 5.1 Contrato comercial canônico

O contrato compartilhado deve representar, no mínimo:

- origem/canal, tenant, operador e cliente;
- linhas com `productId` ou `serviceId`, `variantId`, quantidade e snapshots de nome, SKU e preço;
- modificadores validados e seu impacto em preço/estoque;
- subtotal, desconto de itens, desconto do pedido, taxa, gorjeta e total;
- origem do desconto: manual, cupom, campanha, pontos ou outro benefício;
- alocações de pagamento, vencimento, parcelas, provedor e estado;
- intenção e resultado de estoque, incluindo IDs dos movimentos e alocações de lote;
- efeitos de cupom, gift card, fidelidade, cliente, comissão e financeiro;
- estado fiscal independente do estado comercial;
- `schemaVersion`, `operationId`, `idempotencyKey`, timestamps e correlação.

Os cálculos serão feitos em centavos inteiros dentro do núcleo. Os campos numéricos legados em reais continuam sendo persistidos nos adaptadores durante a transição.

### 5.2 Coordenador recuperável

Operações que atravessam múltiplos documentos não dependerão de uma transação Firestore impossível de estender a provedores externos. Um documento de operação manterá checkpoints determinísticos:

1. entrada validada e preço calculado;
2. benefícios e pagamentos reservados;
3. estoque aplicado;
4. documento comercial persistido;
5. financeiro, comissão e cliente conciliados;
6. evento/fiscal enfileirado;
7. operação concluída ou aguardando compensação.

Cada etapa deve ser idempotente e retomável. Falha depois de um efeito reservado deve gerar retentativa ou compensação explícita, nunca apenas um log de melhor esforço.

## 6. Etapas de implementação

### M02.0 — Baseline e caracterização

- [x] Registrar os campos e escritores de `sales`, `deliveryOrders` e `orders`.
- [x] Mapear todos os efeitos em estoque, lotes, transações, bancos, comissão, cliente, cupom, gift card, fidelidade e fiscal.
- [x] Criar fixtures dos cinco canais: PDV, cardápio, pedido manual, agente e B2B.
- [x] Congelar em testes o comportamento válido de horário, zona, modificadores, Mercado Pago, impressão e fiscal.
- [x] Criar uma matriz de estados e transições por tipo de documento.
- [x] Criar auditoria read-only de venda/pedido e seus efeitos relacionados.

**M02.0 concluída:** mapa de escritores/efeitos, matrizes de estado, cinco fixtures, 20 testes de caracterização e auditoria read-only por tenant. Detalhes em `docs/paridade/M02_BASELINE.md`.

**Saída:** baseline reproduzível, mapa de dependências e testes que protegem as capacidades exclusivas do AEVO.

### M02.1 — Contratos, cotação e preço autoritativo

- [x] Criar contratos V2 compartilhados para linha, preço, desconto, alocação de pagamento e referências de efeitos.
- [x] Criar normalizadores/adaptadores compatíveis para os três documentos atuais.
- [x] Implementar cotação server-side por produto, serviço, variação, modificador, zona e canal.
- [x] Validar disponibilidade, tenant, status ativo e permissão de desconto.
- [x] Recalcular todos os totais no servidor e rejeitar preço obsoleto/adulterado com resposta acionável.
- [x] Consolidar o contrato real de `/api/orders/public` e usá-lo na fronteira.
- [x] Definir política única de arredondamento em centavos.

**M02.1 concluída:** contratos comerciais V2, adaptadores de leitura para as três coleções, cotação autenticada em centavos e fronteira pública consolidada. A cotação não escreve nem reserva estoque; os canais serão migrados somente após o coordenador recuperável. Detalhes em `docs/paridade/M02_CONTRATOS_COTACAO.md`.

**Saída:** qualquer canal obtém o mesmo total autoritativo para a mesma cesta e contexto.

### M02.2 — Coordenador de operação comercial

- [x] Criar `commercialOperations` com tenant, origem, chave idempotente, checkpoints, erros e estado de compensação.
- [x] Definir IDs determinísticos para documento comercial, movimentos, transações e ledgers.
- [x] Integrar o núcleo M01 sem reconstruir efeitos já executados.
- [x] Persistir IDs de movimentos e alocações de lote no resultado comercial.
- [x] Implementar retomada segura após falha em cada checkpoint.
- [x] Emitir logs estruturados e eventos com o mesmo `operationId`.
- [x] Impedir que um replay altere preço, estoque ou dinheiro novamente.

**M02.2 concluída:** coordenador server-side com lease, checkpoints, fingerprint, IDs determinísticos, integração exata ao estoque M01, adaptadores idempotentes de efeitos, evento correlacionado e estado explícito de compensação. Nenhum canal foi migrado antecipadamente. Detalhes em `docs/paridade/M02_COORDENADOR_OPERACOES.md`.

**Saída:** uma operação multi-etapas observável, idempotente e recuperável.

### M02.3 — PDV e venda de serviços

- [x] Migrar `/api/sales/checkout` e API/agente de vendas para o núcleo comum.
- [x] Revalidar catálogo, serviço, variação, modificadores e desconto no servidor.
- [x] Preservar múltiplos meios de pagamento no documento da venda.
- [x] Criar efeito financeiro separado para cada alocação quando necessário.
- [x] Distinguir pagamento imediato, a receber, sem pagamento e crédito da loja.
- [x] Integrar comissão, cliente e estoque nos checkpoints da operação.
- [x] Manter venda de serviços sem forçar baixa de produto inexistente.
- [x] Exibir no histórico o estado real de pagamento, financeiro, estoque e fiscal.

**M02.3 concluída:** PDV, API v1 e criação de venda pelo agente usam cotação autoritativa e o coordenador recuperável; pagamentos são conciliados por alocação, comissão vem do cadastro autenticado, cliente e estoque participam dos checkpoints e o histórico expõe o estado composto. Benefícios serão liquidados no ledger na M02.4 e a reversão centralizada pertence à M02.7. Detalhes em `docs/paridade/M02_PDV_SERVICOS.md`.

**Saída:** PDV autoritativo e compatível com vendas à vista, divididas e diferidas.

### M02.4 — Cupons, gift cards e fidelidade

- [x] Levar resgate e estorno de gift card para ledger server-side determinístico.
- [x] Levar débito, ganho e estorno de pontos para ledger server-side determinístico.
- [x] Integrar cupons ao mesmo ciclo de reserva, confirmação e liberação.
- [x] Impedir saldo negativo ou consumo concorrente além do limite.
- [x] Unificar comportamento entre PDV, cardápio, pedido manual e agente no núcleo comercial.
- [x] Tratar desconto manual separadamente, com permissão e motivo auditáveis.
- [x] Garantir compensação quando estoque, persistência ou pagamento falhar depois da reserva.

**M02.4 concluída:** ledgers determinísticos de cupons, gift cards e fidelidade integrados ao coordenador comercial no checkpoint `benefits_reserved`, confirmados em `downstream_reconciled` e revertidos automaticamente em falhas. Detalhes em `docs/paridade/M02_BENEFICIOS.md`.

**Saída:** benefícios e saldos nunca ficam consumidos sem uma operação comercial correspondente.

### M02.5 — Delivery, cardápio e agente

- [x] Fazer pedido público, manual e do agente usarem a mesma criação server-side.
- [x] Preservar horário, zona, entrega/retirada, modificadores, tracking e numeração nos três canais de criação.
- [x] Adicionar variação ao carrinho, contrato, estoque, impressão, fiscal e repetição de pedido. **(M02.5e — concluída 08/09/2026)**
- [x] Mover transições críticas de status para endpoint/serviço autenticado com FSM server-side.
- [x] Definir quando o estoque é reservado/deduzido em cada forma de pagamento e canal (dedução na criação pelos três canais; dedução legada em `preparando` só para pedidos anteriores à migração).
- [x] Bloquear edição insegura após efeitos; quando permitida, calcular e aplicar delta compensatório. Ver `docs/paridade/M02_EDICAO_PEDIDO_POS_EFEITO.md` — de quebra corrigiu um bug real de dedução dupla de estoque (não relacionado a edição).
- [x] Integrar Mercado Pago ao mesmo `operationId` e aos mesmos efeitos reconciliáveis. **(M02.5f — analisada e fechada sem mudança de código, 08/09/2026)**
- [x] Manter jobs de expiração/reconciliação, eliminando caminhos paralelos de estorno.

**M02.5f analisada e fechada (08/09/2026):** investigação dedicada (Explore agent, evidência por arquivo:linha) antes de tocar em código de pagamento real. Veredito: **não há bug** — `webhook-settle.ts` já converge com o resto do núcleo comercial pelos MESMOS 3 helpers compartilhados, só que via um mecanismo de idempotência PRÓPRIO (CAS de FSM transacional + IDs determinísticos) em vez do `operationId` do coordenador M02.2:
- Restauro de estoque: `restoreOrderStockRecoverable` é o ÚNICO caller de `restoreStockAdmin` pra cancelamento/estorno/expiração — usado por MP (refund/chargeback), pelo cron `expire-pix` (que o próprio código chama de "helper ÚNICO") e pela transição manual/agente (`delivery-order-transition-admin.ts`, usada por ambos). Nenhuma segunda implementação.
- Reversão de receita: `reverseDeliveryOrderRevenue` tem exatamente 1 caller (o webhook do MP) — não por lacuna, mas porque a FSM (`lib/contracts/fsm/deliveryOrder.ts`) torna `entregue`/`cancelado` ambos terminais SEM transição entre si; receita só é lançada em `entregue`, então só o MP (que pode reverter DEPOIS da entrega) precisa deste caminho.
- Crons: `cron/reconcile` chama `settlePaymentNotification` DIRETAMENTE (mesma função do webhook, não reimplementação). `cron/expire-pix` trata um evento local genuinamente diferente (timeout de QR sem payload do MP) e já delega o restauro ao mesmo helper único. A corrida "webhook tardio depois de expiração local" já tem rede de segurança simétrica: vira `needsManualReview` em vez de sobrescrever/conflitar silenciosamente (não é lacuna ignorada, é tratamento deliberado).
- `operationId` nem é campo em `DeliveryOrder` — vive só na coleção efêmera `commercialOperations`, sem nenhum consumidor downstream (suporte, painel admin) que precisaria dele num pedido pago via MP.
Conclusão: o texto do checklist ficou desatualizado (herdado de antes da M02.5a-d convergirem os canais pro núcleo comum) — não é uma lacuna de paridade real. Fechado sem mudança de código, evitando reescrever um motor de liquidação financeira já maduro e testado por um ganho puramente cosmético.

**M02.5a concluída em código:** `/api/orders/public` migrado para o núcleo comercial (cotação, coordenador, ledgers de benefício) via `lib/services/delivery-order-server.ts`. Corrigidos dois bugs latentes do núcleo M02.4 que só apareciam com frete (cupom de entrega e teto de desconto do gift card). Duas mudanças de comportamento deliberadas (estoque de insumo/modificador agora bloqueia; gift card em corrida aborta o pedido) documentadas em `docs/paridade/M02_DELIVERY_CARDAPIO.md`.

**M02.5b concluída em código:** criação de pedido manual (`OrdersModule.tsx`) migrada para a MESMA função `createDeliveryOrderWithSideEffects`, generalizada para o canal `manual`, via nova rota autenticada `app/api/orders/manual/route.ts` (`operator+` cria, `manager+` desconto/override de frete). Núcleo ganhou suporte a taxa de entrega manual fora de zona (`canOverrideDeliveryFee`, `resolution:'manual'`). Estoque insuficiente e preço de item adulterado agora bloqueiam duro (antes eram só aviso/sem checagem) — decisão confirmada com o usuário. Detalhes em `docs/paridade/M02_PEDIDO_MANUAL.md`.

**M02.5c concluída em código:** criação de pedido do agente de IA (`/api/agent/tools/orders`, action `create`) migrada para a MESMA função, canal `agent`. Agente perdeu a capacidade de aplicar desconto manual ou taxa de entrega fora de zona — decisão de segurança confirmada com o usuário, contra manipulação via conversa (prompt injection); frete agora sempre resolvido por zona, igual ao cardápio público. Checagem de preço obsoleto por item (M02.5a) passou a ser pulada para o canal `agent`, que nunca teve preço real de item para enviar. Detalhes em `docs/paridade/M02_AGENTE_PEDIDOS.md`. Com isso, os três canais de criação (público, manual, agente) estão unificados.

**M02.5d concluída em código:** transições de status (aceitar/preparar/entregar/cancelar/excluir/recusar) centralizadas em `lib/services/delivery-order-transition-admin.ts`, usada pela nova rota autenticada `PATCH /api/orders/[id]/transition` (UI) e diretamente pelo agente — substituindo duas implementações independentes que haviam divergido de verdade: fidelidade não acumulava em pedidos entregues pelo agente (corrigido), "excluir" um pedido pela UI pulava a validação de FSM e não impedia excluir um pedido já entregue (corrigido), e o restauro de estoque no cancelamento pela UI usava uma resolução de produtos mais fraca que a do agente/Mercado Pago (unificado). Mercado Pago não foi tocado — já não mexia em `status` e já usava a função de restauro correta. Detalhes em `docs/paridade/M02_FSM_TRANSICOES.md`. `variantId` e Mercado Pago com `operationId` ficaram para M02.5e–f, pausados em 03/09/2026 e retomados em 08/09/2026; bloqueio de edição pós-efeito já foi concluído depois, ver `docs/paridade/M02_EDICAO_PEDIDO_POS_EFEITO.md`.

**M02.5e concluída em código (08/09/2026):** investigação prévia (Explore agent) confirmou que o modelo de variação, o motor de cotação comercial (M02.1) e o núcleo de estoque (M01) já eram 100% variant-aware desde M01.3b/M02.1 — o gap estava inteiramente confinado ao contrato de item do pedido e às 3 UIs de checkout, que nunca alimentavam `variantId`. Fechado:
- **Contratos** (em lockstep): `PublicOrderItemSchema`, `DeliveryOrderItemSchema` e o espelho hand-written `DeliveryOrderItem` em `lib/types/index.ts` ganharam `variantId?`/`variantName?`.
- **Núcleo** (`delivery-order-server.ts`): repassa `item.variantId` pra linha da cotação; persiste `variantId`/`variantName` de volta, combinando `productName` como "Produto — Variante" (mesma convenção que `stockRequirement()` já usava internamente) — isso propaga de graça pro item fiscal (NFC-e) e pra comanda térmica, sem tocar nenhum dos dois módulos.
- **Pipeline de estoque de EDIÇÃO** (`stock-admin.ts`/`stock-lines.ts`) — achado real: um SEGUNDO pipeline, paralelo ao núcleo comercial, usado só quando um pedido já criado é editado (UI e agente `update_items`) não lia `variantId` do item — editar um pedido com variação restauraria/deduziria contra o estoque do produto BASE, não da variante (corrupção de estoque silenciosa). Corrigido.
- **UI manual** (`OrdersModule.tsx`): removido o filtro que escondia produtos com variação do buscador (colocado ali em M02.5d como placeholder documentado); adicionado seletor de variação (chips) na busca; dedup do carrinho agora por `(productId, variantId)`.
- **Cardápio público** (`CatalogClient.tsx`/`ProductDetailSheet.tsx`): achado real — um produto SÓ com variação (sem modificadores) caía direto em `addSimpleToCart` sem nunca pedir a variação, o que resultaria em `VARIANT_REQUIRED` no checkout; corrigido roteando pra sheet também quando há variação. Sheet ganhou seletor de variação (radio, mesmo padrão visual dos modificadores); preço/disponibilidade passam a refletir a variação escolhida.
- **Disponibilidade** (`lib/utils/menu-availability.ts`): achado real — `isOutOfStock` não tinha noção de `variants[]`, então todo produto com variação usava `currentStock` da RAIZ (que não é o saldo real — o saldo vive em cada `variants[].currentStock`); nova regra: esgotado só quando TODAS as variações ativas estão sem saldo.
- **Agente de IA**: achado real e mais sério do canal — mesmo adicionando `variantId` ao contrato, o agente nunca teria como usá-lo, porque o tool `catalog_search`/`list_menu` nunca expunha `product.variants` na resposta (o LLM não tinha como descobrir o id de uma variação) — corrigido em `MenuItemSchema`(TS)/`MenuItemShape`(Python)/`toMenuItem()` + JSON schema do tool `orders_create` em `agent/app/tools/registry.py`. De quebra, corrigido outro bug real: `toMenuItem()`'s `outOfStock` também não considerava variação — todo produto com variação aparecia esgotado pro agente. **Escopo deliberadamente fora**: `orders_update_items` (edição de pedido pelo agente) não ganhou `variantId` no tool schema — a função que resolve preço nessa ação (`updateItems()`) bypassa o motor de cotação e lê `product.salePrice` direto, então expor o campo sem consertar a resolução de preço criaria uma capacidade que parece funcionar mas silenciosamente ignora a variação.
- Achado no baseline: o fixture `tests/fixtures/m02/manual-delivery-order.json` (M02.0) já incluía `variantId` deliberadamente, com um teste que caracterizava/documentava o gap ("variantId ainda é descartado pelo contrato"). Teste atualizado pra confirmar o fechamento em vez de documentar a lacuna.
- Testes novos: `tests/utils/menu-availability.test.ts` (6 casos). Suite completa sem regressão (1145 testes/87 arquivos). Não testado contra navegador nesta sessão.

**Saída:** delivery omnichannel consistente, sem divergência entre site, atendente e agente.

### M02.6 — Venda B2B e condicional

- [x] Criar pedidos B2B/condicionais pelo núcleo server-side, preservando `orders`.
- [x] Aplicar preço, desconto, variação, estoque e tenant no servidor.
- [x] Formalizar FSM de orçamento, confirmação, faturamento, envio, entrega e cancelamento.
- [x] Definir reserva/baixa/devolução de estoque para condicional. **(reserva deliberadamente NÃO implementada — ver nota abaixo)**
- [x] Integrar pagamentos diferidos, parcelas e contas a receber.
- [ ] Integrar emissão NF-e e histórico auditável. **(deliberadamente adiado — ver nota abaixo)**
- [x] Paginar lista e produtos sem listeners ilimitados. **(paginação limit/offset da API v1, mesmo padrão de `/api/v1/sales`)**

**Saída:** B2B e condicional deixam de depender de regras críticas na interface.

**M02.6 concluída — núcleo (08/09/2026); tela deliberadamente adiada.** Checkpoint com o
usuário: item avaliado como maior que os demais do M02 (o contrato de domínio `Order`/FSM já
existia de uma fase anterior, mas ZERO serviço/rota/UI foi construído em cima dele — diferente
de M02.5e/f, que eram convergência de canais já existentes). Usuário escolheu **núcleo agora,
tela depois**.

**Achado-chave que mudou a abordagem**: o motor de cotação comercial (`commercial-quote.ts`,
M02.1) e o coordenador de operação (`commercial-operation-admin.ts`, M02.2) já eram
`channel:'b2b'`/`sourceType:'order'`-aware desde que foram construídos — só nunca tinham sido
chamados com esses valores. A criação de Order, porém, **não usa o coordenador de checkpoint**:
diferente de Sale/DeliveryOrder (cotação+efeitos na mesma operação), o próprio FSM
(`ORDER_TRANSITION_EFFECTS`) documenta que os efeitos de Order (estoque, receita, fiscal) só
acontecem depois, na transição `confirmado→faturado` — não na criação (`pendente`). Por isso:

- **`lib/services/order-server.ts`** (criação) — só cotação (`quoteCommercialCartAdmin`,
  reusada, não duplicada) + persistência idempotente (ID determinístico do carrinho + `tx.create()`,
  mesmo padrão do núcleo M03.2 de Transaction). Sem efeitos, sem coordenador.
- **`lib/services/order-transition-admin.ts`** (transições) — aqui vivem os efeitos reais:
  - `confirmado→faturado`: dedução de estoque (`applyStockOperationAdmin`, reusa o núcleo M01
    inteiro — BOM, bloqueio de negativo) + lançamento de receita
    (`createTransactionSafeAdmin`, núcleo M03.2 — idempotente por
    businessId+orderId+type+installmentNumber, **reusado, não reimplementado**). Parcelas: `n>1`
    gera N Transactions com `installmentGroupId=orderId`, vencimento em ciclos de 30 dias.
  - `*→cancelado` (a partir de faturado): restaura estoque + cancela cada Transaction vinculada
    via `transitionTransactionSafeAdmin` (a FSM de Transaction já aceita pendente/pago→cancelado
    — não precisou de nenhum contra-lançamento manual como o de DeliveryOrder).
- **Reserva de estoque em `confirmado`**: deliberadamente NÃO implementada. O próprio
  `ORDER_TRANSITION_EFFECTS` já marca isso como **"opcional"** — não é um corte de escopo
  silencioso, é a leitura literal do que o FSM já documentava. Bloqueio de saldo insuficiente
  acontece no ponto real de compromisso (`faturado`, via `negativeStockPolicy:'prevent'`), não
  antes.
- **NF-e (emissão/cancelamento) deliberadamente adiada** — decisão de risco, não de esforço:
  emitir um documento fiscal real sem poder validar contra um SEFAZ de homologação neste
  ambiente é um risco maior (legal/compliance) que o valor desta fatia. `fiscalDocId` fica vazio;
  o pedido fatura/cancela normalmente sem fiscal. Mesmo tratamento dado ao backlog fiscal
  dormente (`ROADMAP_FISCAL_BACKLOG.md`).
- **Contratos estendidos** (achados no caminho, todos aditivos): `Transaction.orderId` (novo,
  espelha `deliveryOrderId`) — propagado em `transactionTxGuardAdmin.ts` (derivação de chave de
  idempotência) e `m03-financial-audit.ts` (5º campo de origem auditado, antes só
  sale/purchaseNote/appointment/deliveryOrder — Order nunca entrava na varredura de
  duplicidade/referência quebrada). `OrderSchema`/`OrderItemSchema` ganharam `installments`,
  `invoicedAt`/`stockDeductedAt`/`transactionIds`/`cancelledAt`/`cancelledBy`/`cancelledByName`,
  e `serviceId`/`variantId` no item (mesma convenção "Produto — Variante" combinada em
  `productName` do M02.5e).
- **API v1**: `POST/GET /api/v1/orders` + `PATCH /api/v1/orders/{id}/transition`. Novos scopes
  `read:orders`/`write:orders` (`ApiKeyScope`, `API_KEY_SCOPE_LABELS`, `API_KEY_SCOPE_GROUPS`,
  `API_KEY_SCOPES` — 4 registros paralelos pré-existentes, todos atualizados). Índices compostos
  novos em `firestore.indexes.json` (businessId+createdAt, +status, +type, +clientId) — validados
  via `--dry-run`, **deploy pendente de autorização** (ver pendências da sessão).
- **Tool do agente** (`b2b-orders`, domínio novo — `orders` já é DeliveryOrder): só
  `create`/`get`/`list_by_client`. **Deliberadamente SEM `update_status`/`cancel`** — mesma
  decisão de segurança do M02.5c (agente não aplica desconto manual): dar ao LLM o poder de
  faturar/cancelar um pedido B2B via conversa move estoque e dinheiro real, superfície real de
  manipulação por prompt injection. TS+Python+JSON schema do tool (`registry.py`) todos
  atualizados; `_MUTATING_TOOLS`/gating read-only do modo analyst verificados (`create` some do
  analyst, `get`/`list_by_client` continuam visíveis).
- **`firestore.rules`**: NENHUMA regra nova pra `orders` nesta fatia — todos os caminhos de
  escrita são Admin SDK (API v1 + agente), e o catch-all já nega acesso client SDK por padrão.
  Regra de leitura fica pra quando a UI (próxima fatia) precisar de `onSnapshot`/`getDocs` direto
  do navegador.
- Testes novos: `tests/contracts/order.test.ts` (12 casos — schema + FSM), `tests/contracts/
  orderServer.test.ts` (8 casos), `tests/services/orderTransitionAdmin.test.ts` (4 casos —
  `splitInstallments`). Suite completa sem regressão (1170 testes/90 arquivos). Verificado
  também no lado Python (venv local): `get_response_model('b2b-orders_create'/'_get'/
  '_list_by_client')` resolve corretamente; `ruff check --select F,E9` limpo; gating
  operator/analyst confirmado programaticamente (`create` ausente do conjunto analyst).

### M02.7 — Cancelamento, devolução e reembolso

- [x] Criar uma operação server-side de reversão por tipo de documento. **(Sale — novo; DeliveryOrder e Order já tinham desde M02.5d/M02.6)**
- [x] Validar tenant, função, FSM e situação fiscal antes de aplicar efeitos. **(motivo já era opcional nos 3 tipos; não endurecido)**
- [x] Restaurar o estoque pelos movimentos e lotes originais, inclusive variações e insumos. **(já estava sólido nos 3 tipos — achado da investigação: único item já 100% coberto de saída)**
- [x] Reverter/compensar transações, recebíveis, conta financeira e comissão.
- [x] Estornar cupom, gift card, fidelidade e estatísticas do cliente quando aplicável. **(achado real: nenhum cancelamento no repo fazia isso antes — ver nota)**
- [ ] Diferenciar cancelamento total, devolução parcial e reembolso do provedor. **(deliberadamente fora de escopo — ver nota)**
- [ ] Persistir estado fiscal `nao_emitido`/`emitido`/`cancelamento_pendente`/`cancelado`/`erro`. **(não implementado como proposto — colidiria com um enum real já existente; ver nota)**
- [x] Tornar cancelamento repetido um no-op auditável, sem efeito duplo. **(achado real: Sale via PDV tinha um bug de duplo-efeito ao vivo — corrigido)**

**Saída:** nenhum cancelamento concluído deixa estoque, dinheiro ou benefício divergente sem pendência explícita.

**M02.7 concluída parcialmente (08/09/2026) — escopo reduzido por decisão do usuário.** Investigação
dedicada (Explore agent, evidência por arquivo:linha) ANTES de qualquer código — mesmo rigor do
M02.5f, mas com veredito oposto: **não é item desatualizado, são bugs reais e concretos**:

- **Achado mais sério — bug de duplo-efeito AO VIVO em produção**: `PDVModule.tsx`'s
  `handleCancelSale` (client SDK) não tinha CAS no `sale.status` nem trava na reversão de stats
  do cliente — cancelar a MESMA venda duas vezes (duplo-clique, duas abas) decrementava
  `totalSpent`/`visitCount` do cliente DUAS vezes. Checkpoint com o usuário: escolhida a opção
  mais ampla (reconstruir o cancelamento inteiro server-side, não só o guard cirúrgico).
- **Achado mais valioso — cupom/gift card nunca eram liberados**: `compensateCommercialBenefitsAdmin`
  (`commercial-benefits-admin.ts`, núcleo M02.4) já existia, já era correto, já era testado — mas
  tinha exatamente 1 caller em todo o repo (`commercial-operation-admin.ts`, só pra falha EM
  ANDAMENTO do checkout, nunca para cancelamento pós-hoc). Cancelar um DeliveryOrder ou uma Sale
  que resgatou cupom/gift card deixava o valor consumido PRA SEMPRE. Agora reconstrói o
  `CommercialOperationHandlerContext` a partir de `commercialOperations/{sale.commercialOperationId}`
  (campo já persistido desde M02.2) e chama a função existente — sem reimplementar nada.
- **Construído**: `lib/services/sale-transition-admin.ts` (`cancelSaleAdmin`) — serviço único
  substituindo os DOIS caminhos divergentes que existiam (PDV client SDK, quase completo mas com
  o bug de duplo-efeito e sem reverter benefícios/fiscal; agente, que só mudava `status` e
  deixava estoque/dinheiro órfãos). Efeitos: gate fiscal (nota `autorizada` bloqueia — cancele a
  nota primeiro), status+stats do cliente atômicos com CAS real (`Sale.clientStatsReversedAt`,
  campo novo), restauração de estoque (mesma `idempotencyKey` que o client já usava — retomada
  seguro), cancelamento de cada Transaction vinculada (núcleo M03.2, `transitionTransactionSafeAdmin`),
  reversão de benefícios via o `commercialOperationId` original.
- **`app/api/sales/[id]/cancel/route.ts`** (novo, autenticado) — `PDVModule.tsx`'s
  `handleCancelSale` migrado de ~130 linhas de writes client SDK sequenciais pra 1 chamada fetch;
  UI ao redor (loading, toast, invalidação de cache) preservada sem mudança de comportamento
  visível. `app/api/agent/tools/sales/route.ts`'s `cancelSale` migrado pra chamar o mesmo serviço.
- **`firestore.rules`**: `sales` ganhou `isValidSaleTransition` (espelha `isValidTransactionTransition`
  já existente pra `transactions`) — antes o `allow update` não validava transição nenhuma, defesa
  em profundidade real contra qualquer write-path client SDK futuro que não passe pelo serviço.
- **`Sale`/`SaleSchema`**: ganharam `cancelledAt`/`cancelledBy`/`cancelledByName` (já eram escritos,
  nunca declarados no contrato Zod — mesma classe de drift já corrigida em Order/DeliveryOrder) e
  `clientStatsReversedAt` (novo, o CAS guard).
- **Deliberadamente fora de escopo, por decisão de risco não de esforço**:
  - *Devolução parcial* — zero implementação em QUALQUER lugar do repo hoje (nem Sale, nem
    DeliveryOrder, nem Order); é greenfield, exigiria matemática de item-a-item nova. Fica
    dormente até sinal real de demanda, mesmo tratamento do PIX/Boleto/Sequências de CRM.
  - *Enum fiscal `nao_emitido/emitido/cancelamento_pendente/cancelado/erro`* — a investigação
    achou que um enum REAL e FSM-aplicado já existe (`FiscalDocumentStatus` em
    `lib/contracts/fsm/fiscalDocument.ts`: `pendente/processando/contingencia/autorizada/
    rejeitada/cancelada/erro`), já denormalizado em `Sale.fiscalStatus`/etc via
    `docs/fiscal/FISCAL_VINCULO_PENDENTE.md` (M04, sessão anterior). Introduzir o vocabulário do
    checklist criaria um SEGUNDO enum paralelo e não-reconciliado. O que a fatia FEZ foi o gate
    prático (bloquear cancelamento com nota `autorizada`) usando o enum que já existe — reconciliar
    o `fiscalStatus:'nao_emitido'` legado de `sales-server.ts` com o enum real fica pra uma fatia
    fiscal dedicada (fora do escopo comercial da M02).
  - *DeliveryOrder e Order (B2B) não ganharam a mesma reversão de benefícios nesta fatia* —
    `compensateCommercialBenefitsAdmin` está pronta e testada, mas só foi wireada em Sale. Order
    nunca resgata cupom/gift card hoje (não implementado em M02.6), então não é gap real pra ele.
    DeliveryOrder É um gap real remanescente (a investigação já mapeou o caminho: mesmo padrão
    de `sale.commercialOperationId` existe em `deliveryOrder.commercialOperationId`) — fica
    registrado aqui como próximo item óbvio se aparecer um caso real (cupom/gift card em pedido
    de delivery cancelado).
- Testes novos: `tests/services/saleTransitionAdmin.test.ts` (9 casos — fiscal gate, tenant
  mismatch, CAS/duplo-efeito, clamp em zero, sem clientId). `tests/services/
  orderTransitionCancelInvoice.test.ts` (8 casos — cobertura que `order-transition-admin.ts` não
  tinha desde M02.6, achado da mesma investigação). **Bug real encontrado pelo próprio teste
  novo**: `invoiceOrder()` (M02.6) nunca gravava `installmentGroupId` nas parcelas apesar do
  comentário dizer que gravava — corrigido no caminho. Suite completa sem regressão (1187
  testes/92 arquivos). `tests/contracts/m01-ui-smoke.test.ts` atualizado (asserção estrutural
  antiga esperava o `stock-server-client` do PDV, que não existe mais no cancelamento).

### M02.8 — Experiência e desempenho comercial

- [x] Adaptar seletores de variação e modificadores ao PDV e cardápio. **(cardápio já tinha desde M02.5e; PDV era o gap real — corrigido)**
- [x] Exibir indisponibilidade e mudança de preço sem aceitar total antigo silenciosamente. **(já satisfeito nos dois canais — confirmado, sem mudança)**
- [ ] Exibir estado composto da operação e ações de retentativa autorizadas. **(deliberadamente adiado — ver nota)**
- [x] Criar leitura pública segura do cardápio, sem expor o documento completo da empresa. **(achado real: `products` vazava pro HTML público; corrigido)**
- [x] Paginar produtos, vendas e pedidos; limitar listeners por janela/cursor. **(4 listeners sem teto, `limit(2000)`)**
- [x] Preservar modo kanban, comanda, impressão, tracking e acessibilidade móvel. **(confirmado: nenhum trabalho da M02 nesta sessão tocou esses caminhos)**
- [x] Garantir que tela otimista nunca anuncie conclusão antes do checkpoint necessário. **(já satisfeito nos 3 fluxos de checkout verificados — confirmado, sem mudança)**

**Saída:** operação rápida para o usuário e custo previsível no Firestore.

**M02.8 concluída (09/09/2026) — escopo reduzido por decisão de risco, não de esforço.**
Investigação dedicada (Explore agent, veredito por item) ANTES de qualquer código, mesmo padrão
das fatias anteriores:

- **Achado mais sério — vazamento de dado do cardápio público**: `app/p/[slug]/page.tsx` já
  aplicava allowlist ao `Business` (`PublicBusiness`, existente, bem documentado), mas passava o
  array `products` INTEIRO pro client component — em Next.js, todo campo de um prop server→client
  vai pro payload RSC/HTML enviado ao navegador anônimo, mesmo campo que a UI nunca lê. Isso
  incluía `costPrice`, `sku`, `ncm`/`cfop`/`cest`, `linkedProductId` de modificador (insumo interno
  do BOM) e `costPrice`/`sku`/`barcode` de cada variação — tudo visível no view-source de qualquer
  visitante. Corrigido com o mesmo padrão já usado pro `Business`: `toPublicProduct()`
  (`app/p/[slug]/page.tsx`, exportada e testada) projeta só os campos que a UI usa, incluindo
  sanitização recursiva de `modifierGroups[].options[]` e `variants[]`. Tipos novos
  (`PublicProduct`/`PublicProductModifierGroup`/`PublicProductModifierOption`/`PublicProductVariant`)
  em `CatalogClient.tsx`, propagados em `ProductDetailSheet.tsx`. `lib/utils/menu-availability.ts`
  generalizado pra uma interface estrutural mínima (`AvailabilityProduct`) — `Product` completo e
  `PublicProduct` satisfazem os dois sem cast. Regressão coberta por
  `tests/utils/publicProduct.test.ts` (lista negra de ~18 campos sensíveis).
- **PDV sem seletor de variação**: `PDVModule.tsx`'s `handleCatalogClick`/`addToCart` nunca tratava
  `product.variants[]` — um produto com variação (só variação, sem modificador) caía direto em
  `addToCart`, que lê `product.currentStock`/`product.salePrice` (campos de topo, sem sentido pra
  `kind:'variant'`) — entrava no carrinho com preço/estoque errados e o checkout SEMPRE rejeitava
  no servidor (`VARIANT_REQUIRED`, `commercial-quote.ts`, já variant-aware desde M02.1). Corrigido
  com `PDVVariantPicker.tsx` (novo, espelha `PDVModifierPicker.tsx`) + wiring em `PDVModule.tsx`.
  `SaleItem.variantId` já existia no contrato (fatia anterior não lembrada) — gap era só de UI.
- **4 listeners `onSnapshot` sem teto**: `products` em `PDVModule.tsx`/`VendasModule.tsx`/
  `OrdersModule.tsx` e `orders` em `VendasModule.tsx` liam a coleção inteira do tenant sem
  `limit`. Corrigido com `limit(2000)` nos 4 — mesmo teto já usado no `clients` de
  `OrdersModule.tsx` (precedente existente). Catálogo/histórico real dos dois tenants pagantes
  fica muito abaixo disso; o teto é rede de segurança de custo, não paginação de UX (cursor/
  "carregar mais" fica pra quando um tenant real se aproximar do teto — não há sinal disso hoje).
- **Deliberadamente adiado**: *estado composto da operação (`commercialOperations`) e ações de
  retentativa na UI* — a investigação confirmou que o coordenador (M02.2) já persiste estado
  suficiente pra construir essa tela, mas hoje NENHUM consumidor (usuário ou suporte) pediu essa
  visibilidade; é observabilidade especulativa, não bug nem gap reportado. Fica registrado como
  candidato natural pra M02.9 (que já tem "painéis/consultas de operações incompletas" no
  checklist) em vez de ser feito agora sem caso de uso real.
- Testes novos: `tests/utils/publicProduct.test.ts` (4 casos). Suite completa sem regressão
  (1191 testes/93 arquivos, subindo de 1187/92 no fim da M02.7).

### M02.9 — Migração, regras e observabilidade

- [x] Introduzir campos V2 de forma aditiva e manter leitores dos documentos legados. **(já satisfeito — confirmado, sem mudança)**
- [ ] Enriquecer documentos antigos sob demanda ou por migrador idempotente por tenant. **(especulativo — sem script, nenhum campo novo é exigido de doc antigo)**
- [ ] Não duplicar vendas entre coleções durante a migração. **(não se aplica — decisão de 28/08/2026 já eliminou o risco)**
- [ ] Migrar canal por canal atrás de flag controlada e com rollback. **(especulativo — migração já ocorreu sem flag, não há canal legado concorrente)**
- [x] Restringir writes críticos diretos após cada canal usar o servidor. **(parcial, por decisão de risco — ver nota)**
- [x] Adicionar índices para operações, paginação, estados de pagamento e pendências fiscais. **(gap estreito fechado: 5 índices compostos pra combinação de filtros da API v1)**
- [x] Criar painéis/consultas de operações incompletas, compensações e divergências. **(auditoria M02.0 já cobria Sale/Order/DeliveryOrder×efeitos; estendida pra `commercialOperations` travadas)**
- [x] Documentar runbook de retomada, rollback e reconciliação. **(`M02_RUNBOOK_OPERACOES.md`, escopo mínimo — depende do item anterior)**

**Saída:** implantação gradual, reversível e observável por tenant.

**M02.9 concluída (09/09/2026) — escopo reduzido, vários itens do checklist original
(herdado do Gestão Raiz) não se aplicam à arquitetura real do AEVO.** Investigação
dedicada (Explore agent) + verificação PESSOAL adicional antes de mexer em
`firestore.rules` (rules afeta produção dos 2 tenants pagantes; não bastou confiar
no relatório do agente):

- **Campos V2 aditivos**: confirmado — todo campo introduzido desde M02.1 é
  `.optional()`, e todo serviço lê Sale/DeliveryOrder/Order por CAST (`{ id,
  ...snapshot.data() } as Sale`), nunca `.parse()` estrito. Um documento de
  meses atrás sem `commercialOperationId`/`variantId`/`cancelledAt` é lido sem
  erro — os ramos que dependem desses campos simplesmente não disparam. O
  único `.parse()` estrito sobre essas entidades (`commercial-adapters.ts`) é
  código morto, sem caller em produção.
- **Enriquecer/backfill, flag por canal, não-duplicar entre coleções**: os
  três não têm equivalente real no AEVO — a decisão de 28/08/2026 (preservar
  `sales`/`deliveryOrders`/`orders` como canais distintos com núcleo
  compartilhado, sem migração V1→V2 de dado) já elimina a premissa desses 3
  itens do checklist original. Cada canal teve UM escritor novo que substituiu
  o antigo de uma vez (PDV em M02.3, delivery/cardápio em M02.5, B2B nasceu
  direto no núcleo em M02.6) — nunca dois caminhos concorrentes que
  justificassem flag/rollback.
- **Restringir writes diretos — achado que corrigiu o próprio relatório da
  investigação**: o agente concluiu "zero consumidores client SDK" pra
  `sales` e `deliveryOrders`. Verificação pessoal (grep por `'sales'`/
  `'deliveryOrders'` em TODO `app/` e `lib/`, não só nos módulos óbvios) achou
  que `sales` TEM um escritor client SDK vivo e real:
  `app/components/features/clients/shared/mergeClients.ts`'s
  `reassociateRelatedDocs` grava `clientId` direto via `writeBatch` em
  `sales`/`transactions` sempre que dois clientes são fundidos no CRM — uma
  feature viva, não código morto. Fechar `sales` pra Admin-SDK-only teria
  QUEBRADO o merge de clientes em produção. Por isso `sales` e `orders` (B2B,
  que TEM escritor vivo confirmado em `VendasModule.tsx:671,693` — a tela
  nunca migrou, decisão já registrada em M02.6) **não foram restringidos**.
  `deliveryOrders` foi verificado de verdade (inclusive contradição encontrada
  no comentário da própria regra antiga, que dizia haver escrita client SDK de
  status — rastreado até `OrdersModule.tsx`'s `transitionOrder()`, que é
  `fetch` pra `/api/orders/[id]/transition`, não `updateDoc`; o comentário
  estava desatualizado desde a centralização de 01/09/2026) e fechado pro
  padrão Admin-SDK-only (`allow create/update: if false`, mesmo de
  `commercialOperations`) — removido também o lock por campo
  (`paymentFieldsLocked`/`paymentStatusLocked`), que virou código morto.
- **Índices**: a maioria das queries reais já tinha índice. Gap real e
  estreito: `GET /api/v1/sales` e `GET /api/v1/orders` aceitam múltiplos
  filtros opcionais simultâneos (`status`+`clientId` em sales;
  `status`+`type`+`clientId` em orders) que, combinados, pedem um índice
  composto que só cobria os filtros isolados. Fechado com 5 índices novos
  (`firestore.indexes.json`). Sem consumidor confirmado combinando filtros
  hoje — é rede de segurança pra API pública documentada, mesmo raciocínio do
  `limit(2000)` da M02.8.
- **Painéis de operações travadas**: `scripts/audit-m02-commercial.ts` +
  `lib/services/m02-commercial-audit.ts` (entregues na M02.0) já cobriam
  Sale/DeliveryOrder/Order × efeitos (transação, estoque, benefício, fiscal),
  mas nunca liam `commercialOperations` — não havia como encontrar uma
  operação travada em estado intermediário, só o documento final já
  divergente. Estendido: `commercialOperations` agora entra na auditoria,
  novo código `STUCK_OPERATION` (operação fora de estado terminal SEM lease
  ativo — mesmo critério de "posso retomar?" que o próprio coordenador usa
  internamente). Campo novo `commercialOperations?` no input é opcional
  (aditivo) — comparações contra baseline antigo continuam funcionando.
- **Runbook**: não existia nenhum documento de retomada/reconciliação pro
  núcleo comercial em lugar nenhum do repo (confirmado — `docs/paridade/
  M13_PLANO_IMPLEMENTACAO.md` já registrava explicitamente "nenhum runbook no
  sistema"). Criado `M02_RUNBOOK_OPERACOES.md`, escopo mínimo: como rodar a
  auditoria, como interpretar `STUCK_OPERATION`, como retomar (replay do
  mesmo idempotencyKey) ou compensar manualmente
  (`compensateCommercialBenefitsAdmin`/`transitionTransactionSafeAdmin`, já
  existentes desde M02.4/M03.2). Sem sweep automático nem painel de UI —
  ambos especulativos sem incidente real documentado.
- Testes novos: 2 casos em `tests/services/m02CommercialAudit.test.ts`
  (`STUCK_OPERATION` detectado sem lease/lease expirado; não detectado em
  status terminal ou lease ainda válido). Suite completa sem regressão (1193
  testes/93 arquivos, subindo de 1191/93 no fim da M02.8).
- **Deploy de `firestore.rules`/`firestore.indexes.json` pendente de
  autorização explícita do usuário** (mesmo padrão já usado pros índices da
  M02.6) — editado e commitado, mas não aplicado em produção nesta fatia.

### M02.10 — Testes, homologação e aceite

- [x] Testar preço, arredondamento, variação, modificadores, zona, cupom e descontos. **(já bem coberto — confirmado, sem gap)**
- [x] Testar pagamentos imediatos, diferidos, divididos, pontos, gift card e Mercado Pago. **(gap real e o maior dos 10 — Mercado Pago tinha ZERO testes; fechado)**
- [x] Testar duas vendas disputando o último saldo e o último lote válido. **(saldo já coberto; lote era gap — fechado)**
- [x] Testar concorrência pelo último uso de cupom, saldo de gift card e pontos. **(gap real — mock nem serializava transação; fechado)**
- [x] Testar replay do checkout e falha após cada checkpoint. **(5 de 6 já cobertos; `benefits_reserved` era o único sem teste dedicado — fechado)**
- [x] Testar cancelamento total/parcial, cancelamento repetido e reembolso assíncrono. **(total/repetido já cobertos M02.7; parcial confirmado fora de escopo; reembolso assíncrono = mesmo gap do Mercado Pago, fechado junto)**
- [x] Testar isolamento entre dois `businessId` em todos os efeitos. **(bem coberto; 1 gap pontual em order-server.ts — fechado)**
- [x] Testar compatibilidade de documentos legados e rollback das flags. **(já coberto no caminho real; "rollback de flags" não se aplica — confirmado)**
- [ ] Executar smoke manual dos cinco canais e da emissão/cancelamento fiscal. **(fora do alcance deste ambiente — sem browser, sem SEFAZ de homologação; mesma ressalva de sempre)**
- [ ] Comparar antes/depois com auditoria de estoque, lotes, financeiro e benefícios. **(só capacidade, nunca exercitada contra tenant real — requer credenciais de produção que este ambiente não tem)**

**Saída:** evidência objetiva de consistência funcional e transacional em homologação.

**M02.10 concluída (09/09/2026) — 2 dos 10 itens continuam fora do alcance deste
ambiente por natureza (manual/produção), não por escolha.** Investigação dedicada
(Explore agent, veredito por item com evidência arquivo:linha) mapeou os ~1193
testes acumulados de M02.0-M02.9 contra cada um dos 10 itens do checklist ANTES
de escrever qualquer teste novo:

- **Achado mais sério — Mercado Pago sem NENHUM teste**: `lib/services/
  mercadopago/webhook-settle.ts` (561 linhas, único caller de
  `settlePaymentNotification`, plugado no webhook real + 2 crons de
  reconciliação) nunca teve um teste dedicado. É o arquivo que decide
  aprovação/estorno/chargeback de dinheiro real — o maior gap dos 10 itens.
  Fechado com `tests/services/mercadopagoWebhookSettle.test.ts` (19 casos):
  aprovação fresca com taxa MP lançada como despesa, reentrega idempotente,
  refund parcial em `approved` (não confundir com refund cheio), valor
  divergente, aprovação tardia pós-estorno (stale, no-op), aprovação em
  pedido morto (revisão manual — dinheiro pode ter sido recebido), refund
  cheio com restauro de estoque + reversão de receita + evento, reentrega de
  refund (efeitos reaplicados, evento não duplicado), refund parcial na
  reversão, `cancelled` pré-pagamento (vira `failed`, sem receita a reverter),
  reversão impossível/já-terminal-por-outro-caminho, `authorized`,
  `rejected` (não terminaliza), status intermediário. Mocka por inteiro os 3
  efeitos cross-módulo (`restoreOrderStockRecoverable`/
  `reverseDeliveryOrderRevenue`/`dispatchDomainEvent`) — mesma decisão já
  usada em M02.5's `deliveryOrderTransitionAdmin.test.ts` (provar que o
  arquivo DECIDE certo e DELEGA certo, não reverificar a mecânica interna do
  que já é testado em outro lugar).
- **Concorrência de benefícios — gap real, e o mock nem suportava testar
  isso**: `tests/services/m02CommercialBenefits.test.ts` (único arquivo do
  núcleo M02.4) não tinha nenhum caso de corrida nem de `TENANT_MISMATCH`,
  apesar de `commercial-benefits-admin.ts` ter 6 pontos de `fail(
  'TENANT_MISMATCH', ...)`. Pior: o mock de `runTransaction` não serializava
  — um teste de corrida escrito contra ele daria falso-positivo (passaria
  mesmo sem guard nenhum). Portado o padrão `transactionTail` (mesmo de
  `stockCoreAdmin.test.ts`/`commercialOperationAdmin.test.ts`) e adicionados
  4 casos: cupom `usageLimit:1` disputado por duas vendas simultâneas (só
  uma resgata, a outra recebe `COUPON_EXHAUSTED`), gift card com saldo que
  cabe uma mas não duas redenções simultâneas (`GIFT_CARD_INSUFFICIENT`), e
  os 2 `TENANT_MISMATCH` que faltavam (cupom e gift card de outro negócio).
- **Lote sob corrida**: só existia teste de concorrência pelo saldo agregado
  do produto (`stockCoreAdmin.test.ts`); a distribuição FEFO nunca foi
  exercida sob corrida. 1 caso novo reaproveitando o mesmo fake DB
  (`transactionTail` já provado), disputando a última unidade de um lote
  específico — mesmo padrão do saldo simples, agora também no
  `stockLots/{id}`.
- **Checkpoint `benefits_reserved` sem teste de queda+retomada**: dos 6
  checkpoints do coordenador M02.2, 4 com efeito real já tinham teste
  dedicado de falha+replay (`stock_applied`, `document_persisted`,
  `event_enqueued`, `downstream_reconciled`); `benefits_reserved` (resgate de
  cupom/gift card/pontos) era o único sem. 1 caso novo em
  `commercialOperationAdmin.test.ts`: crasha depois de resgatar um cupom,
  confirma `usedCount` já incrementado mas operação `failed`; retoma e
  confirma que o replay NÃO resgata o cupom de novo (ledger já existe).
- **`order-server.ts` era o único dos 3 canais de criação sem teste de
  `TENANT_MISMATCH`**: Sale e DeliveryOrder já tinham (`salesServerCommercial
  .test.ts`, `deliveryOrderServerCommercial.test.ts`); `createOrderWithSideEffects`
  (M02.6) nunca teve NENHUM teste de serviço (só o schema de input, em
  `tests/contracts/orderServer.test.ts`). Criado `tests/services/
  orderServerCommercial.test.ts` (8 casos) cobrindo o caminho todo: criação
  com cotação autoritativa, `OPERATOR_REQUIRED`, `CLIENT_NOT_FOUND`,
  `TENANT_MISMATCH` (o gap específico), cliente do mesmo tenant, replay
  idempotente, carrinho diferente sem colidir, `type=condicional`.
- **Devolução parcial**: reconfirmado fora de escopo (zero implementação em
  qualquer lugar do repo — greenfield, não é questão de teste). **Reembolso
  assíncrono**: é o mesmo fluxo/mesmo gap do Mercado Pago acima — fechado
  junto (webhook de estorno chegando dias depois é exatamente o que os casos
  de refund/chargeback de `mercadopagoWebhookSettle.test.ts` cobrem).
- **Smoke manual e comparação antes/depois contra tenant real**: confirmado
  fora do alcance deste ambiente (sem browser, sem SEFAZ de homologação, sem
  credenciais de produção pro `npm run audit:m02`) — mesma ressalva recorrente
  de toda a sessão (M02.5e, M02.6). `scripts/audit-m02-commercial.ts` (M02.0,
  estendido em M02.9) tem a CAPACIDADE de comparação `--baseline`/`--output`,
  nunca exercitada contra dado real — fica registrado como próximo passo
  operacional (não de código) quando alguém com acesso de produção rodar.
- Testes novos: 19 (`mercadopagoWebhookSettle.test.ts`) + 8
  (`orderServerCommercial.test.ts`) + 1 (lote sob corrida,
  `stockCoreAdmin.test.ts`) + 1 (`benefits_reserved` queda+retomada,
  `commercialOperationAdmin.test.ts`) + 4 (concorrência/tenant de benefícios,
  `m02CommercialBenefits.test.ts`) = 33 testes novos, 2 arquivos novos. Suite
  completa sem regressão (1226 testes/95 arquivos, subindo de 1193/93 no fim
  da M02.9).

## M02 — módulo concluído (09/09/2026)

Todas as 11 sub-fases (M02.0-M02.10) estão concluídas em código, cada uma com
escopo reduzido ou itens deliberadamente adiados por decisão explícita de risco
(nunca por omissão silenciosa — ver nota de cada sub-fase acima). O núcleo
comercial (cotação autoritativa, coordenador recuperável, ledgers de benefício,
transições server-side de Sale/Order/DeliveryOrder) converge os 3 canais
(PDV/delivery+cardápio/B2B) sob as mesmas garantias de consistência, idempotência
e isolamento multi-tenant. Pendências que ficam deliberadamente fora, registradas
para retomada futura sob sinal real de demanda: tela de pedido B2B (M02.6), NF-e
de Order (M02.6), estado composto da operação na UI (M02.8), devolução parcial e
reconciliação de enum fiscal (M02.7), sweep automático/painel de operações
travadas (M02.9), smoke manual e auditoria contra tenant real (M02.10).

## Retomada dos itens adiados (10/09/2026)

Usuário pediu explicitamente pra construir os itens acima "com cuidado" —
priorizados por risco: primeiro os sem dependência externa, depois os
refactors de UI de alto risco (só com plano de validação combinado antes).

**Painel de operações comerciais travadas entregue (10/09/2026).** Item que
M02.8/M02.9 registraram como "especulativo, sem consumidor real" agora tem
consumidor real (o próprio usuário pediu). Reusa `detectStuckOperations`
(M02.9) sem duplicar a lógica — novo `findStuckCommercialOperations`
(`lib/services/m02-commercial-audit.ts`) extrai um resumo pronto pra UI
(operationId, sourceType, status, checkpoint onde parou, tentativas, último
erro) a partir do mesmo critério "sem lease ativo e fora de estado
terminal". Como `commercialOperations` é Admin-SDK-only pra leitura E
escrita (`firestore.rules: allow read, write: if false`), a UI não pode ler
Firestore direto (diferente de `AuditoriaTab.tsx`, que lê soft-delete direto
porque essas coleções têm regra de leitura liberada) — nova rota
`GET /api/admin/commercial-operations/stuck` (Admin SDK, `verifyAuth` +
gate `ROLE_HIERARCHY >= admin`, mesmo padrão forte de
`app/api/admin/repair-contact-names/route.ts`) e nova aba "Operações" em
Settings (`OperacoesTab.tsx`, `admin`+, mesmo visual de `AuditoriaTab.tsx`).
**Deliberadamente read-only**: retomada (replay do idempotencyKey) e
compensação manual continuam procedimento guiado via
`M02_RUNBOOK_OPERACOES.md` — um botão de ação exigiria desenho de segurança
próprio (qual efeito reexecutar, com que autorização) fora do escopo deste
painel. 1 teste novo (`m02CommercialAudit.test.ts`). Suite sem regressão
(1227/95, de 1226/95).

**Tela de pedido B2B migrada pro núcleo server-side (10/09/2026) — fecha o
gap de preço manipulável achado em M02.9.** Investigação revelou que
`VendasModule.tsx` já era uma tela B2B completa (lista, criação, mudança de
status, KPIs) — só nunca tinha sido migrada pro núcleo do M02.6, e o
preço/total de cada item era 100% calculado e confiado no navegador, sem
NENHUMA validação server-side (nem `firestore.rules` protegia). Checkpoint
com o usuário sobre item avulso (a tela permitia item digitado sem produto
cadastrado, incompatível com a cotação autoritativa que só aceita
`productId`/`serviceId` real): escolhida a opção "só catálogo" — todo item
de pedido B2B agora exige produto cadastrado, mesma regra que PDV/Delivery/
Cardápio já seguem. Item avulso/desconto por linha foram removidos do
formulário; preço passa a ser sempre exibido como PRÉVIA (calculada do
`salePrice` atual do produto, não editável) — o valor que realmente conta
vem sempre da cotação do servidor.

Construído: `app/api/b2b-orders/route.ts` (POST, criação) e
`app/api/b2b-orders/[id]/transition/route.ts` (PATCH, transição) —
autenticados por sessão de usuário (`verifyAuth`), mirror exato de
`app/api/sales/[id]/cancel`/`app/api/orders/[id]/transition`
(deliveryOrders). Diferente de `/api/v1/orders/*` (Bearer API key, só pra
integração externa) — `VendasModule.tsx` não pode expor a API key do
negócio no navegador. `VendasModule.tsx` migrado: `createOrder`/
`changeStatus` agora chamam essas rotas via `fetch`, preservando a UX
existente (toast, sincronização via `onSnapshot`, painel lateral). Novo
campo "Parcelas" no formulário (backend já suportava `installments` desde
M02.6, nunca exposto na UI). Alertas de estoque baixo/zerado ao faturar
agora aparecem como toast (mesmo padrão de `OrdersModule.tsx`) — antes
mudar status não tinha efeito NENHUM de estoque/financeiro; agora
`confirmado→faturado` deduz estoque de verdade e lança a receita
(parcelada se `installments>1`), e `*→cancelado` a partir de `faturado`
reverte os dois. Botão "Emitir NF-e" (decorativo, sem `onClick`) desabilitado
com aviso explícito — fica pra M02 NF-e de Order (próxima fatia).

**`firestore.rules` fechado pra `orders` (Admin-SDK-only), mesmo padrão de
`deliveryOrders` (M02.9).** Com a migração, zero escritor client SDK
confirmado (grep por `addDoc`/`updateDoc`/`setDoc`/`deleteDoc`/`writeBatch`
referenciando `'orders'` em todo `app/` — os 2 pontos restantes são leituras
em `VendasModule.tsx`/`ReportsModule.tsx`). `allow create/update/delete: if
false`; leitura continua liberada pro tenant. Era exatamente o gap que
M02.9 tinha deixado aberto por depender desta migração.

Suite completa sem regressão. Deploy de `firestore.rules` pendente de
autorização explícita do usuário (mesmo padrão já usado nas fatias
anteriores) — editado e commitado, não aplicado em produção ainda.

## 7. Ordem de entrega recomendada

1. M02.0 — baseline e caracterização.
2. M02.1 — contratos e cotação autoritativa.
3. M02.2 — coordenador recuperável.
4. M02.3 — PDV.
5. M02.4 — cupons, gift cards e fidelidade.
6. M02.5 — delivery, cardápio e agente.
7. M02.6 — B2B e condicional.
8. M02.7 — cancelamento, devolução e reembolso.
9. M02.8 — experiência e desempenho.
10. M02.9 — migração, segurança e observabilidade.
11. M02.10 — testes e aceite.

PDV será o primeiro canal migrado porque já possui uma entrada server-side e permite validar o novo núcleo com menor superfície. Delivery vem depois da estabilização dos benefícios e pagamentos; B2B entra em seguida por exigir recebíveis e condicionais próprios.

## 8. Estratégia de compatibilidade e implantação

- **Sem merge de coleções:** cada fluxo preserva sua coleção e interface atual.
- **Campos aditivos:** documentos V2 recebem referências de operação/efeitos; leitores antigos continuam funcionando.
- **Migração por canal:** `sales` primeiro, depois `deliveryOrders` e por fim `orders`.
- **Migração por tenant:** ativação controlada, com dry-run, auditoria e rollback.
- **Sem dupla baixa:** o canal muda de escritor de uma vez; não haverá dual-write de estoque ou financeiro.
- **Documentos legados:** reversão usa movimentos conhecidos quando disponíveis e entra em revisão explícita quando não for possível provar o efeito original.
- **Gateway externo:** webhook e job conciliam pelo mesmo identificador, sem reexecutar o checkout.

## 9. Critérios para marcar M02 como concluído

- [ ] O servidor é a fonte de verdade de preço e disponibilidade em todos os canais.
- [ ] Repetir a mesma operação não cria outra venda, pedido, baixa, cobrança ou benefício.
- [ ] Pagamentos divididos e diferidos aparecem corretamente no financeiro.
- [ ] Nenhuma venda usa pontos ou gift card sem um débito confirmado ou pendência recuperável.
- [ ] Cancelamento restaura exatamente os movimentos/lotes originais e compensa os demais efeitos.
- [ ] Variações funcionam ponta a ponta no PDV, cardápio, delivery e B2B.
- [ ] FSMs e permissões críticas são impostas no servidor.
- [ ] Mercado Pago, fiscal, comissão e cliente estão vinculados por IDs determinísticos.
- [ ] Documentos legados continuam legíveis e reversíveis com segurança.
- [ ] Listas críticas estão paginadas ou limitadas por janela.
- [ ] Testes concorrentes e de isolamento multi-tenant estão aprovados.
- [ ] Smoke e auditoria antes/depois foram aprovados em homologação.

## 10. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Quebrar cardápio ou delivery ao centralizar regras | testes de caracterização + adaptadores + migração por canal |
| Cobrar ou baixar estoque duas vezes | IDs determinísticos + checkpoints + idempotência no efeito |
| Operação parar no meio | estado recuperável + retentativa/compensação + consulta de pendências |
| Restaurar BOM/lote errado após mudança do catálogo | persistir movimentos e alocações originais; não reconstruir do catálogo atual |
| Perder saldo de benefício | ledger server-side com reserva, confirmação e reversão |
| Expor outro tenant | validação de `businessId` em toda referência e testes cruzados |
| Divergir gateway e pedido | webhook/job conciliados ao mesmo `operationId` |
| Alterar documentos legados em massa | campos aditivos, dry-run, backfill por tenant e rollback |
| Aumentar custo do Firestore | paginação, janela temporal, projeção pública e índices explícitos |
| Copiar complexidade industrial | manter somente garantias transacionais aplicáveis ao AEVO |

## 11. Fora do escopo da M02

- reestruturação completa do Financeiro, que pertence à M03;
- revisão integral dos documentos e provedores fiscais, que pertence à M04;
- unificação completa do cadastro de clientes/CRM, que pertence à M05;
- produção, expedição e rastreabilidade industrial;
- multi-filial/multi-depósito sem uma decisão específica de produto.

As integrações mínimas com financeiro, fiscal e cliente entram na M02 apenas para manter a venda consistente. A expansão funcional desses módulos será feita nas fases seguintes.
