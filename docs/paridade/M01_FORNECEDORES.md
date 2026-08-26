# M01.4 — Fornecedores

> Data: 25/08/2026
> Status: concluído.

## Resultado

O AEVO passou a ter um cadastro operacional de fornecedores dentro de Compras. A mesma regra de domínio atende a interface autenticada, a API interna e a ferramenta do agente, eliminando o antigo CRUD paralelo do agente.

## Arquitetura

- `lib/contracts/domain/supplier.ts`: contrato canônico Supplier V2 e leitura compatível dos documentos legados.
- `lib/contracts/api/supplier-catalog.ts`: fronteira validada de criação, edição e arquivamento.
- `lib/services/supplier-admin.ts`: núcleo server-side para normalização, unicidade, histórico, busca, paginação e relações.
- `app/api/suppliers/route.ts`: rota autenticada usada pela interface.
- `lib/services/supplier-client.ts`: cliente único da tela.
- `app/api/agent/tools/suppliers/route.ts`: agente adaptado para reutilizar o mesmo núcleo.
- `app/components/features/purchases/SuppliersPanel.tsx`: tela operacional integrada a Compras.

## Capacidades entregues

- Listagem paginada, busca local sobre os lotes carregados e filtro de inativos.
- Cadastro e edição de pessoa jurídica por CNPJ ou pessoa física por CPF.
- Razão social/nome, fantasia, inscrição estadual, telefone, e-mail, endereço e observações.
- Condições de pagamento, prazo médio de entrega, valor e quantidade mínimos e múltiplo de compra.
- Inativação reversível e reativação, sem exclusão física.
- Histórico append-only de cadastro, edição, inativação e reativação, com ator e campos alterados.
- Painel do fornecedor com notas fiscais, produtos e movimentos de estoque relacionados.
- Associação automática de NF-e nova quando o documento já está cadastrado.
- Vinculação de notas legadas sem `supplierId` ao cadastrar ou atualizar o fornecedor correspondente.

## Invariantes de segurança

1. O `businessId` vem da autenticação ou do contexto HMAC do agente.
2. CPF/CNPJ é normalizado para somente dígitos antes da persistência.
3. Um claim determinístico em `supplierIdentifiers` impede duplicidade concorrente dentro do tenant.
4. O mesmo documento pode existir em tenants distintos.
5. Alterações são reconstruídas dentro da transação usando o documento atual, evitando sobrescrita por leitura antiga.
6. Fornecedor não é apagado fisicamente.
7. `suppliers`, `supplierIdentifiers` e `supplierHistory` não aceitam escrita direta do navegador pelas Firestore Rules.
8. Relações retornadas pela API revalidam o tenant de cada nota, produto e movimento.

## Compatibilidade

- Documentos V1 com `cnpj` continuam legíveis e são normalizados para `document`, `documentType` e `schemaVersion: 2` nas novas escritas.
- O campo `cnpj` é preservado em fornecedores pessoa jurídica para consumidores legados.
- A ação `find_by_cnpj` do agente foi mantida, embora o núcleo agora também aceite CPF.

## Evidências automatizadas

- Normalização de documento formatado.
- Duplicidade bloqueada no mesmo tenant e permitida entre tenants.
- Troca transacional do claim ao editar o documento.
- Inativação sem exclusão física.
- Bloqueio de acesso cruzado por `businessId`.
- Vínculos com notas, movimentos e produtos sem vazamento entre tenants.
- Verificação de que UI, API e agente usam o mesmo núcleo.
- Verificação estática das regras de segurança.

## Próxima etapa — M01.5

A importação de compras será movida para o servidor, com validação do XML, criação/atualização assistida do fornecedor, match explícito por item, claim de importação e atualização idempotente de estoque e custo.
