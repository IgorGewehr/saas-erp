# M01.1 — Contratos V2 e compatibilidade

> Data: 25/08/2026
> Status: implementado e aguardando adoção gradual pelos escritores.

## Decisão

Os contratos V2 são aditivos e possuem normalizadores de leitura. Nenhuma coleção será migrada em bloco nesta etapa e nenhum fluxo atual passa a gravar V2 automaticamente. Isso evita quebrar PDV, Pedidos, Cardápio, Fiscal, API v1 ou ferramentas do agente.

Cada contrato V2 possui `schemaVersion: 2`. Documentos V1 podem ser lidos e convertidos em memória; a persistência definitiva ocorrerá nas etapas que migrarem cada writer.

## Produto V2

Arquivo: `lib/contracts/domain/productV2.ts`.

### Decisões

- `kind`: `simple`, `variant` ou `composite`.
- Produto composto controla saldo pelos componentes; o pai fica com `trackStock=false`.
- Produto com variações não mistura BOM no V2 inicial.
- `unit` é a unidade de estoque.
- `purchaseUnit` e `purchaseToStockFactor` formalizam conversão de compra.
- `costMethod` começa com `moving_average` ou `last_cost`.
- `imageUrl` continua legível, mas `images[]` passa a ser o modelo canônico para múltiplas imagens.
- `maxStock:null` legado é normalizado para ausência.
- `trackStock` e `menuAvailable` passam a fazer parte do contrato.
- Variações possuem SKU, código de barras, preço, custo e saldo próprios.

### Compatibilidade

`normalizeProductToV2` infere o tipo do produto, promove a imagem legada e registra avisos em `migration.warnings`.

O saldo do pai de um produto com variações será tratado como derivado quando os writers forem migrados. Até lá, o campo legado permanece preservado para os consumidores atuais.

## Fornecedor V2

Arquivo: `lib/contracts/domain/supplier.ts`.

### Decisões

- Fornecedor pode ter CPF ou CNPJ.
- O campo canônico é `document`, sempre sem pontuação.
- `documentType` precisa corresponder a 11 ou 14 dígitos.
- `razaoSocial` permanece como nome jurídico/canônico para compatibilidade.
- Condições de pagamento, prazo, pedido mínimo e múltiplo são opcionais.
- O CNPJ legado é preservado apenas na memória de migração.

O contrato normaliza formato, mas a validação de dígitos verificadores será adicionada no serviço de domínio para permitir tratamento explícito de cadastros legados inválidos.

## Nota de compra V2

Arquivo: `lib/contracts/domain/purchaseNoteV2.ts`.

### Estados

```text
rascunho → pendente → processando → importada
                              ├──→ parcial
                              └──→ falha
pendente/processando → cancelada
importada/parcial → revertida
```

O mapa executável da FSM será criado junto com o serviço de importação. O contrato já exige:

- claim quando o status é `processando`;
- carimbo de entrada quando `importada` ou `parcial`;
- movimentos de estoque para documentos V2 importados;
- erro para status `falha`;
- data de reversão para status `revertida`.

### Itens

Cada item separa quantidade/unidade de compra da quantidade/unidade de estoque e registra:

- ação `pending`, `match`, `create` ou `skip`;
- fator de conversão;
- custo unitário de aquisição;
- custos acessórios rateados;
- resultado da importação;
- movimento e lote associados.

Notas V1 já marcadas como importadas sem `stockMovementIds` continuam legíveis, mas recebem `migration.auditIncomplete=true`. Essa exceção não é aceita para novas notas V2.

## Movimento de estoque V2

Arquivo: `lib/contracts/domain/stockMovementV2.ts`.

### Decisões

- `sourceType`, `sourceId` e `sourceLineId` substituem a ambiguidade entre `saleId`, `purchaseId` e `orderId`.
- `idempotencyKey` é obrigatória no modelo canônico.
- `balanceAccuracy` diferencia saldos exatos de auditoria legada best-effort.
- `quantity` em ajuste passa a ser sempre delta assinado.
- O normalizador converte o ajuste absoluto legado da API v1 para delta.

## Estratégia de versionamento

1. Leitura: aceitar V1 ou V2 e normalizar em memória.
2. Escrita nova: validar V2 no serviço server-side correspondente.
3. Migração lazy: atualizar o documento quando ele passar por uma operação segura.
4. Backfill: executar somente após todos os leitores aceitarem V2.
5. Remoção de campos legados: fora do M01; só depois de telemetria confirmar ausência de consumidores.

## Próxima integração

M01.2 deve usar estes contratos no novo núcleo server-side de estoque. A migração dos writers seguirá esta ordem:

1. entrada/ajuste manual;
2. compras;
3. PDV e vendas;
4. pedidos e estornos;
5. agente e API v1;
6. consumo de produtos em serviços.
