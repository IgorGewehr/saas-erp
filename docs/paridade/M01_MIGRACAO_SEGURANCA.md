# M01.8 — Migração, segurança e desempenho

## Resultado

A transição dos documentos legados do M01 passou a ter um processo operacional explícito e reversível. O migrador trabalha por um único `businessId`, usa páginas pequenas, valida o contrato V2 antes da escrita, confere claims de unicidade e preserva os campos legados por `merge`.

Nenhuma migração de produção é executada automaticamente pelo deploy. O comando permanece em dry-run até que o operador informe `--apply` e a confirmação textual exigida.

## Escopo da migração

Coleções processadas, nesta ordem:

1. `products` — `schemaVersion`, imagens, unidades, custo, flags de estoque/lote, campos normalizados e claims de SKU/código de barras.
2. `suppliers` — documento normalizado, tipo CPF/CNPJ e claim de unicidade por tenant.
3. `purchaseNotes` — contrato V2, aliases compatíveis com a UI V1, vínculo possível com fornecedor e claim da chave de acesso.
4. `stockMovements` — origem, idempotência, precisão do saldo e `correlationId`.

Documentos que não passam no schema são relatados e ignorados. O migrador não inventa documentos fiscais, quantidades, datas ou referências ausentes.

## Garantias

- O dry-run é o modo padrão e não grava execução, checkpoint, backup ou documento de domínio.
- `--businessId` é obrigatório; não há varredura global de tenants.
- O modo de escrita exige `--apply --confirm=M01_PARITY_V2`.
- Cada página salva um checkpoint por coleção em `m01MigrationRuns`.
- Repetir uma página após interrupção é seguro: o documento é reavaliado e os claims são determinísticos.
- Conflitos de SKU, código de barras, CPF/CNPJ ou chave de acesso não são sobrescritos.
- A atualização usa `merge`, preservando `imageUrl`, `currentStock` e campos legados ainda consumidos.
- Antes da primeira alteração de cada documento é criado um backup em `m01MigrationBackups`.
- O rollback só restaura documentos que ainda possuem o `migrationAudit.runId` original; edição posterior vira conflito e não é sobrescrita.

## Execução

Instale as dependências e carregue as credenciais administrativas corretas no `.env.local`.

Dry-run obrigatório:

```powershell
npm run migrate:m01 -- --businessId=<tenant> --run-id=<identificador-da-rodada>
```

Antes de prosseguir, revise os totais `invalid` e `conflicts` de cada coleção. Eles devem estar zerados ou possuir tratamento aprovado e documentado.

Aplicação, usando o mesmo identificador revisado:

```powershell
npm run migrate:m01 -- --businessId=<tenant> --run-id=<identificador-da-rodada> --apply --confirm=M01_PARITY_V2
```

Retomada após interrupção:

```powershell
npm run migrate:m01 -- --businessId=<tenant> --run-id=<identificador-da-rodada> --apply --confirm=M01_PARITY_V2 --resume
```

Rollback controlado:

```powershell
npm run migrate:m01 -- --businessId=<tenant> --run-id=<identificador-da-rodada> --rollback --confirm=ROLLBACK_M01_PARITY_V2
```

## Ordem de publicação

1. Fazer backup/exportação do ambiente conforme a política operacional.
2. Publicar e aguardar a criação dos índices do Firestore.
3. Rodar o dry-run para cada tenant e arquivar o resumo.
4. Corrigir ou aprovar explicitamente os documentos inválidos/conflitantes.
5. Aplicar a migração e conferir `m01MigrationRuns`.
6. Validar amostras de produto, fornecedor, nota, saldo e movimento.
7. Publicar as regras que bloqueiam escrita cliente em `purchaseNotes`.
8. Monitorar logs pelo `runId`, `operationId`, `correlationId` ou `idempotencyKey`.

As regras mais restritivas de `purchaseNotes` devem entrar depois da migração, pois o fluxo legado de entrada ainda gravava custo/status pelo navegador. Notas V2 usam exclusivamente os núcleos server-side.

## Paginação e custo

- Produtos: cursor por ID, até 200 documentos por chamada.
- Fornecedores: cursor por ID, até 200 documentos por chamada.
- Movimentações: cursor opaco por `createdAt + documentId`, até 200 por chamada.
- Notas: cursor opaco por `issueDate + documentId`, até 100 por chamada.
- A tela de Compras atualiza páginas controladas a cada 30 segundos, sem listener ilimitado.
- A API v1 de movimentos não baixa mais a coleção inteira para recortar no servidor.
- Relações de fornecedor têm limites explícitos e a reversão de compra filtra `businessId`, produto e data antes de ler o ledger.

## Observabilidade

Operações de estoque persistem o mesmo `correlationId` no movimento e em `stockOperations`. O servidor emite logs JSON com evento, tenant, operação, chave idempotente, origem e quantidade de ajustes. A migração emite um log por página e um resumo final correlacionados pelo `runId`.

Não são incluídos em log XML, dados bancários, tokens ou conteúdo integral de documentos.

## Validação desta entrega

- Testes puros verificam normalização, idempotência, preservação dos aliases legados, claims e cursores.
- Testes de fronteira verificam o dry-run padrão, confirmação de escrita, regras, índices e ausência de listeners ilimitados nas listas administrativas.
- A execução em uma base real permanece uma ação operacional por tenant; ela não foi disparada por este commit.
