# M01 — Validação final e aceite

Data da rodada: 2026-08-28
Escopo: Catálogo, Estoque, Fornecedores e Compras, incluindo integrações com PDV, Pedidos e Financeiro.

## Situação

A implementação e a validação automatizada da M01.9 estão concluídas. O aceite operacional permanece pendente até executar, em homologação, a comparação antes/depois, o checklist manual das telas e a validação das regras/índices do Firestore.

Nenhuma migração ou escrita foi executada em homologação ou produção nesta rodada.

## Matriz de evidências automatizadas

| Critério | Evidência principal |
|---|---|
| Schemas e compatibilidade V1/V2 | `tests/contracts/m01-v2-contracts.test.ts`, `tests/contracts/m01-inventory-baseline.test.ts` |
| Conversões, rateio da NF-e e custo final | `tests/services/purchaseXmlParser.test.ts`, `tests/services/purchaseImportAdmin.test.ts` |
| Custo médio móvel e memória de custo | `tests/services/stockCoreAdmin.test.ts` |
| BOM e agregação de componentes | `tests/contracts/m01-inventory-baseline.test.ts`, `tests/services/stockCoreAdmin.test.ts` |
| Transação atômica de estoque e ledger V2 | `tests/services/stockCoreAdmin.test.ts` |
| Duas vendas disputando a última unidade | teste simultâneo com `Promise.allSettled` em `tests/services/stockCoreAdmin.test.ts` |
| Dois usuários importando a mesma NF-e | teste simultâneo com claim único em `tests/services/purchaseImportAdmin.test.ts` |
| Isolamento entre empresas | testes de catálogo, estoque, lotes, fornecedores, compras, financeiro e migração |
| Entrada, ajuste, venda, cancelamento e estorno | `tests/services/stockCoreAdmin.test.ts`, testes de fronteira do PDV/Pedidos |
| Compra completa, parcial, reprocessada e revertida | `tests/services/purchaseImportAdmin.test.ts` |
| Financeiro idempotente e reversível | `tests/services/purchaseImportAdmin.test.ts`, `tests/contracts/m01-purchase-import-boundaries.test.ts` |
| Catálogo/Estoque, Fornecedores, Compras, PDV e Pedidos continuam conectados | `tests/contracts/m01-ui-smoke.test.ts` e compilação completa do Next.js |
| Comparação de saldo/custo antes/depois | `scripts/audit-m01-homologation.ts` e `tests/services/m01HomologationAudit.test.ts` |
| Migração segura, regras, índices e paginação | `tests/services/m01MigrationAdmin.test.ts`, `tests/contracts/m01-migration-boundaries.test.ts` |

## Auditoria antes/depois em homologação

O comando é estritamente de leitura no Firestore, exige um único `businessId` e pagina produtos e lotes. O relatório contém os saldos e custos de produtos simples, variações e lotes, além de apontar lote órfão, número inválido, mistura de tenant e divergência entre o saldo controlado e a soma dos lotes.

Antes do deploy/migração:

```powershell
npm run audit:m01 -- --businessId=TENANT_HOMOLOGACAO --output=m01-before.json
```

Depois do deploy/migração:

```powershell
npm run audit:m01 -- --businessId=TENANT_HOMOLOGACAO --baseline=m01-before.json --output=m01-after.json
```

Resultado aprovado:

- `comparison.preserved` igual a `true`;
- `differences` vazio;
- `beforeIssues` e `afterIssues` vazios;
- código de saída `0`.

Qualquer diferença ou problema de integridade retorna código `2` e bloqueia o aceite. O relatório deve ser anexado ao registro da implantação. Os arquivos de snapshot podem conter identificadores internos e não devem ser publicados no repositório.

## Checklist manual de homologação

Usar duas empresas de teste, A e B. Manter aberta a tela da empresa B durante as operações da empresa A para verificar que nenhum dado aparece no tenant incorreto.

### Catálogo e Estoque

- [ ] Abrir Estoque e confirmar paginação de produtos e movimentos.
- [ ] Criar produto simples, produto com variações e produto composto/BOM.
- [ ] Editar metadados sem alterar o saldo atual.
- [ ] Fazer entrada e ajuste; conferir movimento, saldo anterior e saldo posterior.
- [ ] Fazer saída até zero e confirmar bloqueio da próxima saída estrita.
- [ ] Cadastrar entrada com lote/validade e conferir alerta e baixa FEFO.
- [ ] Confirmar que arquivar preserva histórico e identificadores.

### Fornecedores e Compras

- [ ] Criar, editar, buscar, inativar e reativar fornecedor.
- [ ] Confirmar bloqueio de CNPJ/CPF duplicado somente dentro da mesma empresa.
- [ ] Importar NF-e, revisar vínculos/conversões/rateio e confirmar a entrada.
- [ ] Repetir a confirmação e verificar que saldo/movimento não duplicam.
- [ ] Simular falha em uma linha, reprocessar somente o erro e concluir a nota.
- [ ] Vincular conta a pagar e compra paga; repetir a ação e verificar idempotência.
- [ ] Reverter a compra e conferir movimentos compensatórios, custo e financeiro.

### PDV, Pedidos e Cardápio

- [ ] Concluir venda no PDV e conferir baixa única no estoque.
- [ ] Cancelar venda e conferir restauração única, inclusive de BOM/lotes.
- [ ] Mover pedido para preparação e conferir baixa única.
- [ ] Cancelar/reembolsar pedido e conferir restauração única.
- [ ] Abrir o cardápio e confirmar produtos, variações, imagens, disponibilidade e modificadores.
- [ ] Confirmar que produto sem controle de estoque continua vendável e não gera baixa.

### Segurança e operação

- [ ] Repetir consultas com a empresa B e confirmar isolamento total.
- [ ] Validar as regras com credenciais de usuário comum e de administrador.
- [ ] Publicar/validar `firestore.indexes.json` e percorrer todas as listas paginadas.
- [ ] Executar os dois snapshots e arquivar o relatório aprovado.
- [ ] Registrar responsável, data, tenant e versão/commit homologados.

## Regra de decisão

O módulo pode receber aceite final somente quando:

1. testes, typecheck e build estiverem verdes no mesmo commit;
2. a comparação antes/depois estiver preservada;
3. nenhum item do checklist manual estiver pendente;
4. regras e índices estiverem validados em homologação;
5. não houver erro crítico nos logs correlacionados de estoque/compras.

Se qualquer item falhar, não executar a migração em produção. Corrigir a causa, restaurar o backup quando aplicável e repetir o ciclo completo no mesmo tenant de homologação.
