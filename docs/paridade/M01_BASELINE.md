# M01 — Baseline de Catálogo, Estoque, Fornecedores e Compras

> Levantamento de caracterização anterior à evolução do módulo.
> Data: 25/08/2026
> Status: concluído para o início do M01.1.

## Objetivo do baseline

Registrar o comportamento e o acoplamento atuais antes de alterar schemas ou mover escritas críticas para o servidor. Este documento descreve fatos do código atual; não representa ainda a arquitetura-alvo.

## Coleções e contratos atuais

| Coleção | Tipo de domínio | Contrato Zod | Observação |
|---|---|---|---|
| `products` | `lib/types/index.ts:Product` | `lib/contracts/domain/product.ts` | O tipo usado pela UI possui campos não cobertos integralmente pelo schema |
| `stockMovements` | `lib/types/index.ts:StockMovement` | `lib/contracts/domain/stockMovement.ts` | Ledger append-only nas regras atuais |
| `purchaseNotes` | `lib/types/index.ts:PurchaseNote` | `lib/contracts/domain/purchaseNote.ts` | Totais da UI e do contrato usam shapes diferentes |
| `suppliers` | `lib/types/index.ts:Supplier` | Contrato específico apenas do agente | Não há regra explícita nem UI operacional completa |

## Escritores de saldo encontrados

| Caminho | Operação | Garantia atual | Risco/observação |
|---|---|---|---|
| `lib/services/stock.ts` | Entrada, saída e restauração pelo SDK cliente | Batch + `increment()` | Saldo real é atômico, mas `previousStock/newStock` do movimento é best-effort |
| `lib/services/stock-admin.ts` | Saída/restauração server-side | Transação com leitura do saldo real | É o caminho mais forte existente; entrada ainda não está centralizada aqui |
| `InventoryModule.tsx` | Cadastro/edição define `currentStock`; ajuste chama `stock.ts` | Escrita direta no produto no CRUD | Alterar produto pode mudar saldo sem criar movimento correspondente |
| `ComprasModule.tsx` | Entrada por NF-e | `addStock`, depois custo e nota em commits separados | Sem claim transacional; corrida pode duplicar entrada |
| `/api/v1/stock-movements` | Entrada, saída e ajuste | Idempotency wrapper + batch | Lê saldo antes do batch, portanto duas operações concorrentes podem calcular `newStock` sobre o mesmo valor |
| Agente `/tools/inventory` | Cadastro, ajuste e reset | Batch/increment conforme ação | Reimplementa regras fora do serviço canônico |
| Agente `/tools/purchase-notes` | Entrada de compra | Um batch com nota e movimentos | Checagem de `stockImportedAt` ocorre antes do batch, sem claim/transaction contra corrida |
| `PDVModule.tsx` | Baixa/restauração de vendas | `stock.ts` cliente | Auditoria de saldo best-effort |
| `OrdersModule.tsx` | Baixa/restauração manual de pedidos | `stock.ts` cliente + guards no pedido | Ainda depende do caminho cliente |
| `/api/orders/public` | Baixa de pedido público | `deductStockAdmin` | Transação e guard contra oversell para itens protegidos |
| `sales-server.ts` | Baixa de venda server-side | `deductStockAdmin` | Caminho forte, mas não é usado por todos os fluxos |
| `order-stock-restore.ts` | Restauro por estorno/expiração | `restoreStockAdmin` + guard no caller | Idempotência pertence ao pedido, não ao serviço de estoque |
| `serviceConsumption.ts` | Consumo de produtos por serviço | `stock.ts` cliente | Deve migrar junto com os outros consumidores |

## Consumidores de catálogo e estoque

| Consumidor | Uso principal |
|---|---|
| Estoque | CRUD, saldo, movimentos, custo, imagens e planilha |
| Compras | Match da NF-e, entrada e custo médio |
| PDV | Catálogo, disponibilidade, BOM, modificadores, baixa e cancelamento |
| Pedidos | Catálogo, disponibilidade, baixa/restauração e status |
| Cardápio público | Produtos entregáveis, categorias, disponibilidade e imagens |
| Fiscal | Busca do item, NCM/CFOP e emissão |
| Vendas | Exibição de itens e histórico |
| Clientes | Produtos relacionados a compras/vendas do cliente |
| Command Palette | Busca rápida de produtos |
| API v1 | CRUD de produtos e criação/lista de movimentos |
| Agente | Catálogo, inventário, fornecedores, compras e pedidos |
| RAG | Indexação de produtos para conhecimento do agente |

## Regras de segurança atuais

| Coleção | Leitura | Criação/alteração | Exclusão |
|---|---|---|---|
| `products` | Operador do próprio negócio | Manager cria; operador altera | Manager pode excluir fisicamente |
| `stockMovements` | Operador do próprio negócio | Operador cria | Bloqueada |
| `purchaseNotes` | Manager do próprio negócio | Manager cria/altera | Bloqueada |
| `suppliers` | Sem bloco explícito | Sem bloco explícito | Sem bloco explícito |

Consequências para a evolução:

- o cliente ainda pode alterar `products.currentStock` diretamente;
- o cliente ainda pode criar `stockMovements` diretamente;
- `suppliers` é operável pelo Admin SDK do agente, mas não pela UI protegida pelas Rules;
- o M01.8 deverá retirar escritas críticas diretas somente depois que todas as UIs estiverem usando rotas server-side.

## Divergências de contrato confirmadas

1. A UI persiste `maxStock: null`, enquanto `ProductSchema` aceita número ou ausência, não `null`.
2. O tipo/UI usa `trackStock`, mas `ProductSchema` não o declara e o remove durante o parse.
3. `PurchaseNote` da UI usa `totalProducts`, `totalTaxes` e `totalValue`; o contrato usa `subtotal` e `total`.
4. O contrato de nota importada exige `stockMovementIds`; o fluxo visual atual não os grava.
5. `StockMovementSchema` define ajuste como delta assinado; a API v1 interpreta `quantity` do ajuste como novo saldo absoluto.
6. `sourceId` em `stock.ts` é persistido como `saleId`, mesmo quando a origem pode ser pedido ou outro domínio.
7. O fluxo do agente e o fluxo visual de compras possuem implementações diferentes de match, custo e importação.
8. A enumeração `importAction = match/create/skip` existe no domínio, mas ainda não orienta a interface de importação.

Essas divergências estão congeladas nos testes de caracterização. No M01.1, os testes deverão ser atualizados junto com o contrato escolhido — nunca apenas removidos.

## Comportamentos caracterizados por teste

Arquivo: `tests/contracts/m01-inventory-baseline.test.ts`.

- Produto simples aceito pelo contrato atual.
- BOM de um nível e proibição de autorreferência.
- Expansão e multiplicação dos componentes.
- Soma da demanda quando o mesmo insumo aparece em mais de uma linha.
- Falha explícita para produto ausente no índice de BOM.
- Totais dos itens de compra devem fechar com quantidade × preço.
- Nota importada exige carimbo e IDs de movimentos.
- FSM atual permite apenas `pendente → importada/cancelada`.
- Entradas, saídas e ajustes devem fechar matematicamente no ledger.
- Shapes divergentes atuais de produto/nota estão registrados como incompatíveis.

O teste concorrente server-side já existente em `tests/services/stockAdminGuard.test.ts` caracteriza a disputa pela última unidade no caminho `deductStockAdmin`.

## Fixture inicial de NF-e

Foi adicionada `tests/fixtures/m01/nfe-compra-caracterizacao.xml`, uma fixture sintética e sem validade fiscal contendo:

- dois itens;
- SKU do fornecedor e GTIN;
- unidades `KG` e `CX`;
- frete e desconto;
- ICMS, IPI, PIS e COFINS;
- lote, fabricação e validade;
- total da NF-e diferente da simples soma de produtos.

Ela será usada para caracterizar e depois substituir o parser cliente no M01.5. Casos adicionais necessários naquela etapa: XML com namespace alternativo, item sem match, unidade incompatível, nota repetida e XML inválido.

## Referência do Gestão Raiz aplicável ao M01

- Serviço de compras com claim/lock e importação idempotente.
- Classificação de nota e sincronização SEFAZ com lock por tenant.
- Upsert de fornecedor pelo documento.
- Custo de aquisição rateado e custo médio ponderado.
- Unidade de compra convertida para unidade canônica.
- Reimportação/reversão controlada e auditada.
- Integração opcional com conta a pagar ou conta bancária.
- Lotes e validade como fonte para uma versão simplificada e opcional no AEVO.

Não serão trazidas neste módulo as regras de qualidade industrial, quarentena, laudos, FISPQ ou produção.

## Gate para iniciar M01.1

- [x] Campos principais das quatro coleções registrados.
- [x] Escritores de saldo mapeados.
- [x] Consumidores principais mapeados.
- [x] Regras de segurança relevantes registradas.
- [x] Testes de caracterização dos contratos e regras puras criados.
- [x] Fixture inicial de NF-e criada.
- [x] Suíte nova executada e aprovada: 18 testes em 2 arquivos.

Execução de referência: `npm.cmd run test:run -- tests/contracts/m01-inventory-baseline.test.ts tests/services/stockAdminGuard.test.ts`.
