# M01.5 — Importação de compras

> Data: 25/08/2026
> Status: M01.5a concluído; próximo: M01.5b.

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

- Migrar o modal de Compras para consumir a preparação server-side.
- Exibir as ações explícitas `vincular`, `criar produto` e `ignorar` em cada item.
- Permitir escolher variação, corrigir unidade/fator, quantidade, custo, lote e validade.
- Validar toda a seleção novamente no servidor; a interface é apenas editora da intenção.

## M01.5c — Confirmação idempotente

- Reivindicar a nota em transação com token, ator, horário e expiração.
- Rejeitar claim concorrente ativo e permitir recuperação segura de claim expirado.
- Criar produtos solicitados pelo mesmo núcleo do catálogo.
- Executar uma entrada de estoque determinística por nota/linha.
- Persistir `stockMovementId`, status e erro por item.
- Atualizar custo médio ponderado usando saldo/custo anteriores e custo de aquisição.
- Fechar a nota como `importada`, `parcial` ou `falha`, sem apagar resultados anteriores.

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
3. Dois usuários não confirmam a mesma nota simultaneamente.
4. Repetir uma confirmação não duplica saldo, produto, movimento ou custo.
5. Cada item possui resultado e movimento rastreáveis.
6. XML só pode ser baixado por usuário autenticado do mesmo tenant.
7. Notas legadas continuam legíveis durante a migração.
