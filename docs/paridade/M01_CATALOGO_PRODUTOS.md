# M01.3 — Catálogo de produtos

> Data: 25/08/2026
> Status: M01.3a concluído; M01.3b pendente.

## Objetivo desta rodada

Retirar do componente visual a autoridade sobre cadastro, edição, imagens e exclusão de produtos. O catálogo passa a usar um núcleo server-side comum, com isolamento por tenant, contratos V2 e compatibilidade com PDV, Pedidos, Cardápio, BOM e modificadores.

## Arquitetura implementada

- `lib/services/product-catalog-admin.ts`: núcleo canônico de produto e identificadores.
- `app/api/products/route.ts`: cadastro, edição e arquivamento autenticados.
- `app/api/products/images/route.ts`: upload autenticado de imagens JPG, PNG e WebP.
- `lib/services/product-catalog-client.ts`: cliente único usado pela interface.
- API v1 e agente reutilizam o mesmo núcleo para criar, editar e arquivar.

O saldo inicial e qualquer alteração de `currentStock` continuam passando por `stock-core-admin`, produzindo movimento de estoque e chave idempotente.

## Invariantes

1. Toda operação é vinculada ao `businessId` obtido da autenticação.
2. SKU e código de barras são normalizados e únicos dentro do tenant.
3. Produto e variações compartilham o mesmo espaço de unicidade de identificadores.
4. Claims determinísticos ficam em `productIdentifiers` e só podem ser escritos pelo Admin SDK.
5. Produtos não são apagados fisicamente; arquivamento define `isActive=false`, `menuAvailable=false`, `archivedAt` e `archivedBy`.
6. Reativar o mesmo produto mantém seus identificadores reservados.
7. Novos documentos são persistidos com `schemaVersion: 2`, mantendo `imageUrl` como compatibilidade.
8. Produto composto continua controlando saldo pelos componentes, sem saldo próprio.
9. Escritas diretas do navegador no catálogo foram bloqueadas, exceto a atualização transitória de custo médio da importação de compras.

## Interface

- Cadastro e edição usam as rotas server-side.
- Upload deixou de usar o SDK de Storage diretamente no componente.
- A ação de excluir foi substituída por arquivar, com mensagem reversível.
- Cards e lista exibem custo, venda, margem, saldo, mínimo, data e origem da última movimentação.
- A listagem possui paginação local configurável em 12, 24 ou 48 itens.
- O modo planilha continua somente leitura e agora inclui código de barras, margem, unidade de compra, quantidades de imagens/variações e data de atualização.

## Segurança

As Firestore Rules negam criação e exclusão direta de produtos. Atualizações diretas aceitam apenas `costPrice` e `updatedAt`, necessárias temporariamente pelo fluxo legado de importação de compras. `currentStock`, SKU, código de barras e demais metadados ficam sob autoridade do servidor.

## Evidências automatizadas

- Normalização de SKU e código de barras.
- Rejeição de duplicidade no mesmo tenant.
- Permissão do mesmo identificador em tenants distintos.
- Troca atômica de claims durante edição.
- Arquivamento sem exclusão ou liberação de identificadores.
- Colisão entre identificador principal e variação.
- Contratos impedindo `currentStock` dentro dos metadados.
- Verificação de que o componente visual não chama escrita de produto nem upload direto.
- Verificação estática das regras de segurança.

## Próxima rodada — M01.3b

1. editor visual de múltiplas imagens com ordenação e imagem principal;
2. editor de variações com atributos, SKU, código, preços e estoque;
3. categorias livres e gerenciamento de catálogo;
4. importação CSV com pré-validação e relatório de erros;
5. paginação server-side sem listener ilimitado.
