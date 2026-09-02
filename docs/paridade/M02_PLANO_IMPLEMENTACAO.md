# M02 — Plano de implementação de Vendas, PDV, Pedidos e Cardápio

> Análise concluída em: 28/08/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Estado desta rodada: M02.0 a M02.4 concluídas em código; M02.5a-d (cardápio público, pedido manual, agente, FSM central) concluídas; próxima etapa M02.5e

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
- [ ] Adicionar variação ao carrinho, contrato, estoque, impressão, fiscal e repetição de pedido.
- [x] Mover transições críticas de status para endpoint/serviço autenticado com FSM server-side.
- [x] Definir quando o estoque é reservado/deduzido em cada forma de pagamento e canal (dedução na criação pelos três canais; dedução legada em `preparando` só para pedidos anteriores à migração).
- [x] Bloquear edição insegura após efeitos; quando permitida, calcular e aplicar delta compensatório. Ver `docs/paridade/M02_EDICAO_PEDIDO_POS_EFEITO.md` — de quebra corrigiu um bug real de dedução dupla de estoque (não relacionado a edição).
- [ ] Integrar Mercado Pago ao mesmo `operationId` e aos mesmos efeitos reconciliáveis.
- [ ] Manter jobs de expiração/reconciliação, eliminando caminhos paralelos de estorno.

**M02.5a concluída em código:** `/api/orders/public` migrado para o núcleo comercial (cotação, coordenador, ledgers de benefício) via `lib/services/delivery-order-server.ts`. Corrigidos dois bugs latentes do núcleo M02.4 que só apareciam com frete (cupom de entrega e teto de desconto do gift card). Duas mudanças de comportamento deliberadas (estoque de insumo/modificador agora bloqueia; gift card em corrida aborta o pedido) documentadas em `docs/paridade/M02_DELIVERY_CARDAPIO.md`.

**M02.5b concluída em código:** criação de pedido manual (`OrdersModule.tsx`) migrada para a MESMA função `createDeliveryOrderWithSideEffects`, generalizada para o canal `manual`, via nova rota autenticada `app/api/orders/manual/route.ts` (`operator+` cria, `manager+` desconto/override de frete). Núcleo ganhou suporte a taxa de entrega manual fora de zona (`canOverrideDeliveryFee`, `resolution:'manual'`). Estoque insuficiente e preço de item adulterado agora bloqueiam duro (antes eram só aviso/sem checagem) — decisão confirmada com o usuário. Detalhes em `docs/paridade/M02_PEDIDO_MANUAL.md`.

**M02.5c concluída em código:** criação de pedido do agente de IA (`/api/agent/tools/orders`, action `create`) migrada para a MESMA função, canal `agent`. Agente perdeu a capacidade de aplicar desconto manual ou taxa de entrega fora de zona — decisão de segurança confirmada com o usuário, contra manipulação via conversa (prompt injection); frete agora sempre resolvido por zona, igual ao cardápio público. Checagem de preço obsoleto por item (M02.5a) passou a ser pulada para o canal `agent`, que nunca teve preço real de item para enviar. Detalhes em `docs/paridade/M02_AGENTE_PEDIDOS.md`. Com isso, os três canais de criação (público, manual, agente) estão unificados.

**M02.5d concluída em código:** transições de status (aceitar/preparar/entregar/cancelar/excluir/recusar) centralizadas em `lib/services/delivery-order-transition-admin.ts`, usada pela nova rota autenticada `PATCH /api/orders/[id]/transition` (UI) e diretamente pelo agente — substituindo duas implementações independentes que haviam divergido de verdade: fidelidade não acumulava em pedidos entregues pelo agente (corrigido), "excluir" um pedido pela UI pulava a validação de FSM e não impedia excluir um pedido já entregue (corrigido), e o restauro de estoque no cancelamento pela UI usava uma resolução de produtos mais fraca que a do agente/Mercado Pago (unificado). Mercado Pago não foi tocado — já não mexia em `status` e já usava a função de restauro correta. Detalhes em `docs/paridade/M02_FSM_TRANSICOES.md`. `variantId`, bloqueio de edição pós-efeito e Mercado Pago com `operationId` ficam para M02.5e–f.

**Saída:** delivery omnichannel consistente, sem divergência entre site, atendente e agente.

### M02.6 — Venda B2B e condicional

- [ ] Criar pedidos B2B/condicionais pelo núcleo server-side, preservando `orders`.
- [ ] Aplicar preço, desconto, variação, estoque e tenant no servidor.
- [ ] Formalizar FSM de orçamento, confirmação, faturamento, envio, entrega e cancelamento.
- [ ] Definir reserva/baixa/devolução de estoque para condicional.
- [ ] Integrar pagamentos diferidos, parcelas e contas a receber.
- [ ] Integrar emissão NF-e e histórico auditável.
- [ ] Paginar lista e produtos sem listeners ilimitados.

**Saída:** B2B e condicional deixam de depender de regras críticas na interface.

### M02.7 — Cancelamento, devolução e reembolso

- [ ] Criar uma operação server-side de reversão por tipo de documento.
- [ ] Validar tenant, função, FSM, motivo e situação fiscal antes de aplicar efeitos.
- [ ] Restaurar o estoque pelos movimentos e lotes originais, inclusive variações e insumos.
- [ ] Reverter/compensar transações, recebíveis, conta financeira e comissão.
- [ ] Estornar cupom, gift card, fidelidade e estatísticas do cliente quando aplicável.
- [ ] Diferenciar cancelamento total, devolução parcial e reembolso do provedor.
- [ ] Persistir estado fiscal `nao_emitido`, `emitido`, `cancelamento_pendente`, `cancelado` ou `erro`.
- [ ] Tornar cancelamento repetido um no-op auditável, sem efeito duplo.

**Saída:** nenhum cancelamento concluído deixa estoque, dinheiro ou benefício divergente sem pendência explícita.

### M02.8 — Experiência e desempenho comercial

- [ ] Adaptar seletores de variação e modificadores ao PDV e cardápio.
- [ ] Exibir indisponibilidade e mudança de preço sem aceitar total antigo silenciosamente.
- [ ] Exibir estado composto da operação e ações de retentativa autorizadas.
- [ ] Criar leitura pública segura do cardápio, sem expor o documento completo da empresa.
- [ ] Paginar produtos, vendas e pedidos; limitar listeners por janela/cursor.
- [ ] Preservar modo kanban, comanda, impressão, tracking e acessibilidade móvel.
- [ ] Garantir que tela otimista nunca anuncie conclusão antes do checkpoint necessário.

**Saída:** operação rápida para o usuário e custo previsível no Firestore.

### M02.9 — Migração, regras e observabilidade

- [ ] Introduzir campos V2 de forma aditiva e manter leitores dos documentos legados.
- [ ] Enriquecer documentos antigos sob demanda ou por migrador idempotente por tenant.
- [ ] Não duplicar vendas entre coleções durante a migração.
- [ ] Migrar canal por canal atrás de flag controlada e com rollback.
- [ ] Restringir writes críticos diretos após cada canal usar o servidor.
- [ ] Adicionar índices para operações, paginação, estados de pagamento e pendências fiscais.
- [ ] Criar painéis/consultas de operações incompletas, compensações e divergências.
- [ ] Documentar runbook de retomada, rollback e reconciliação.

**Saída:** implantação gradual, reversível e observável por tenant.

### M02.10 — Testes, homologação e aceite

- [ ] Testar preço, arredondamento, variação, modificadores, zona, cupom e descontos.
- [ ] Testar pagamentos imediatos, diferidos, divididos, pontos, gift card e Mercado Pago.
- [ ] Testar duas vendas disputando o último saldo e o último lote válido.
- [ ] Testar concorrência pelo último uso de cupom, saldo de gift card e pontos.
- [ ] Testar replay do checkout e falha após cada checkpoint.
- [ ] Testar cancelamento total/parcial, cancelamento repetido e reembolso assíncrono.
- [ ] Testar isolamento entre dois `businessId` em todos os efeitos.
- [ ] Testar compatibilidade de documentos legados e rollback das flags.
- [ ] Executar smoke manual dos cinco canais e da emissão/cancelamento fiscal.
- [ ] Comparar antes/depois com auditoria de estoque, lotes, financeiro e benefícios.

**Saída:** evidência objetiva de consistência funcional e transacional em homologação.

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
