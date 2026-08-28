# M01.7 — Lotes e validade opcionais

> Data: 28/08/2026
> Status: concluído; próxima entrega: M01.8.

## Decisão de adaptação

O Gestão Raiz usa lotes dentro de uma operação industrial que também inclui quarentena, controle de qualidade, laudos e documentos técnicos. O AEVO recebeu somente a rastreabilidade útil para pequenos negócios: lote e validade opcionais por produto, entrada vinculada à compra, alerta de vencimento e baixa simplificada.

Não há validade presumida. Quando `trackExpiry` está ativo, toda entrada exige a data real informada no XML ou pelo operador.

## Modelo

- `products.trackLots`: habilita conciliação do saldo com lotes.
- `products.trackExpiry`: exige validade e implica `trackLots`.
- `products.expiryWarningDays`: janela de alerta, com padrão de 30 dias.
- `stockLots`: guarda `businessId`, produto/variação, código normalizado, fabricação, validade, fornecedor, notas de compra, quantidade inicial/atual, custo e auditoria.
- `stockMovements.lotAllocations[]`: registra quais lotes participaram de cada entrada, saída, ajuste ou restauração.

Produtos legados continuam com `trackLots=false` e `trackExpiry=false`. Ativar ou desativar rastreamento com saldo diferente de zero é bloqueado; o tratamento de saldos legados pertence à migração assistida da M01.8.

## Garantias transacionais

1. Produto, lotes, movimento e resultado idempotente são alterados na mesma transação.
2. Toda consulta e documento de lote é isolado por `businessId`.
3. A entrada de produto rastreado exige lote para a quantidade inteira; validade é obrigatória quando configurada.
4. A saída automática usa FEFO: primeiro vence, primeiro sai. Lotes vencidos não participam de vendas, pedidos ou serviços.
5. O operador pode escolher um lote explicitamente, inclusive um vencido para perda ou descarte manual.
6. Ajustes de produto rastreado exigem um lote explícito, preservando a soma entre saldos.
7. Cancelamentos de venda/pedido devolvem a quantidade exatamente aos lotes gravados na baixa original.
8. Reprocessar a mesma chave de idempotência não duplica produto, lote ou ledger.
9. A reversão da NF-e usa a alocação original e esgota novamente o lote criado pela compra.

## Interface operacional

- O cadastro do produto oferece controles independentes para lote e validade, com antecedência configurável.
- A movimentação manual solicita código, fabricação e validade na entrada de produto rastreado.
- Saídas podem selecionar um lote ou deixar a escolha automática por FEFO.
- A visão “Lotes e validade” mostra saldos ativos, vencidos, críticos e dentro da janela de alerta, com atalho para baixa explícita.
- A API v1 aceita `lot` em entradas e `lotId` em saídas/ajustes; o agente aceita lote inicial e ajuste de lote explícito.

## Segurança e desempenho

- Navegadores podem ler `stockLots` somente no próprio tenant e como operador ou superior.
- Escritas diretas em `stockLots` são negadas; apenas o núcleo server-side altera saldos.
- Os índices cobrem lotes por empresa/produto e a busca do movimento original por empresa/origem usada em restaurações.
- A operação limita a leitura transacional a 450 lotes por produto; uma necessidade maior deve evoluir para paginação/particionamento específico.

## Fora deste marco

- Quarentena, aprovação/reprovação, amostragem e controle de qualidade.
- Laudos, FISPQ, dossiês e anexos regulatórios.
- Localização por depósito, rua ou endereço de estoque.
- Serialização unitária e rastreabilidade industrial de produção.

## Evidências automatizadas

- Contratos de produto, lote e movimento com invariantes de validade e fechamento das alocações.
- Entrada idempotente, custo do lote e vínculo com fornecedor/NF-e.
- Saída FEFO distribuída entre lotes.
- Bloqueio automático de vencido e descarte manual explícito.
- Restauração exata após cancelamento.
- Reversão da compra usando o lote original.
- Isolamento entre empresas, regras do Firestore e resumo de alertas.
