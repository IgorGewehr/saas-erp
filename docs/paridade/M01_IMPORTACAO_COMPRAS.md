# M01.5 — Importação de compras

> Data: 25/08/2026
> Status: M01.5a, M01.5b e M01.5c concluídos; próximo: M01.5d.

## Resultado esperado

Transformar o XML de uma NF-e de compra em uma entrada revisável e, após confirmação explícita, atualizar estoque e custo uma única vez. O navegador deixa de decidir duplicidade, destinatário, saldo e custo definitivo.

## Fluxo-alvo

```text
XML recebido
  → preparação server-side
    → validação fiscal estrutural
    → fornecedor + sugestões de produto
    → rascunho revisável
  → confirmação server-side
    → claim transacional da nota
    → criar/vincular/ignorar cada item
    → entrada idempotente no estoque
    → custo médio e resultado por item
  → importada | parcial | falha recuperável
```

## M01.5a — Ingestão e preparação

- [x] Criar parser server-side sem dependência da interface.
- [x] Validar tamanho/formato, modelo 55, chave de acesso, emitente, destinatário, itens e totais.
- [x] Conferir o destinatário contra o CPF/CNPJ da empresa autenticada.
- [x] Normalizar itens, tributos, frete, seguro, desconto, outras despesas, ST, IPI e lote opcional.
- [x] Ratear custos acessórios por valor dos produtos, com fechamento de centavos na última linha.
- [x] Calcular custo de aquisição unitário preliminar.
- [x] Criar, localizar ou enriquecer fornecedor pelo núcleo do M01.4 sem sobrescrever dados preenchidos.
- [x] Sugerir produtos e variações por código do fornecedor/SKU, GTIN/código de barras, NCM e nome.
- [x] Impedir duas notas com a mesma chave no tenant por claim determinístico.
- [x] Armazenar XML original no Storage por caminho privado e manter hash SHA-256 no documento.

### Arquivos da entrega M01.5a

- `lib/services/purchase-xml-parser.ts`: parser, validações, lote, tributos e rateio.
- `lib/services/purchase-import-admin.ts`: fornecedor, sugestões, conversão preliminar e claim da chave.
- `app/api/purchase-notes/prepare/route.ts`: upload autenticado e preparação.
- `app/api/purchase-notes/xml/route.ts`: download privado do XML original.
- `purchaseNoteIdentifiers`: claims determinísticos por tenant/chave.

## M01.5b — Revisão por item

- [x] Migrar o modal de Compras para consumir a preparação server-side.
- [x] Exibir as ações explícitas `vincular`, `criar produto` e `ignorar` em cada item.
- [x] Permitir escolher variação, corrigir unidade/fator, quantidade de estoque, custo, lote e validade.
- [x] Permitir fechar e retomar uma revisão já preparada, sem reenviar o XML.
- [x] Validar novamente no servidor tenant, produto, variação, datas, itens completos e combinações de ação.
- [x] Bloquear o lançamento legado para notas V2; a entrada só será liberada pela confirmação idempotente do M01.5c.

### Arquivos da entrega M01.5b

- `app/components/features/purchases/PurchaseImportDialog.tsx`: upload, sugestões e editor explícito por item.
- `lib/contracts/api/purchase-note-review.ts`: contrato estrito da intenção de revisão.
- `app/api/purchase-notes/review/route.ts`: gravação autenticada da revisão.
- `lib/services/purchase-import-admin.ts`: validação transacional de produto/variação e persistência canônica.
- `lib/services/purchase-import-client.ts`: cliente das etapas de preparação e revisão.

## M01.5c — Confirmação idempotente

- [x] Reivindicar a nota em transação com token, ator, horário e expiração de cinco minutos.
- [x] Rejeitar claim concorrente ativo e permitir recuperação segura de claim expirado.
- [x] Criar produtos solicitados pelo mesmo núcleo do catálogo, usando identificador determinístico por nota/linha.
- [x] Executar uma entrada de estoque idempotente por nota/linha.
- [x] Persistir `stockMovementId`, status e erro por item.
- [x] Atualizar saldo e custo médio ponderado na mesma transação do movimento.
- [x] Fechar a nota como `importada`, `parcial` ou `falha`, sem apagar resultados anteriores.
- [x] Reutilizar a mesma confirmação segura quando a entrada for solicitada pelo agente.

### Arquivos da entrega M01.5c

- `app/api/purchase-notes/confirm/route.ts`: confirmação autenticada da entrada.
- `lib/services/purchase-import-admin.ts`: claim, criação determinística, resultado por item e fechamento.
- `lib/services/stock-core-admin.ts`: custo médio atômico junto ao saldo e ao ledger.
- `lib/contracts/domain/stockMovementV2.ts`: memória de custo no movimento.
- `app/components/features/purchases/ComprasModule.tsx`: confirmação e acompanhamento visual dos resultados.

## M01.5d — Reversão e recuperação

- Permitir nova tentativa apenas para itens pendentes/com erro, reutilizando as mesmas chaves.
- Reverter por movimentos compensatórios, nunca apagando ledger.
- Restaurar custo somente quando houver memória de cálculo segura; caso contrário, sinalizar revisão.
- Bloquear reversão quando dependências posteriores exigirem tratamento manual.

## Fora deste marco

- Conta a pagar, compra já paga e baixa bancária entram no M01.6.
- Sincronização automática de documentos recebidos na SEFAZ entra no M01.6.
- Matéria-prima industrial, qualidade e múltiplos depósitos continuam fora do núcleo do AEVO.

## Critérios de aceite

1. XML inválido ou de outro destinatário não cria nota utilizável.
2. A mesma chave de acesso não cria duas notas no mesmo tenant.
3. Dois usuários não confirmam a mesma nota simultaneamente; claim expirado pode ser recuperado.
4. Repetir uma confirmação não duplica saldo, produto, movimento ou custo.
5. Cada item possui resultado e movimento rastreáveis.
6. XML só pode ser baixado por usuário autenticado do mesmo tenant.
7. Notas legadas continuam legíveis durante a migração.
8. Uma nota V2 não utiliza o lançamento legado enquanto a confirmação idempotente não estiver concluída.
