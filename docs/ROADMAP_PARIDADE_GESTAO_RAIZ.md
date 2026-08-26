# Roadmap de evolução do AEVO com base no Gestão Raiz

> Documento vivo de acompanhamento.
>
> Criado em: 25/08/2026
> Projeto de destino: AEVO (`saas-erp`)
> Referência funcional: Gestão Raiz
> Princípio: buscar paridade de maturidade, segurança e experiência sem transformar o AEVO em um ERP industrial.

## Como usar este documento

- Cada módulo começa desmarcado (`[ ]`) e só recebe `[x]` quando implementação, migração, testes e validação funcional estiverem concluídos.
- O status do módulo deve seguir: `Planejado` → `Em análise` → `Em implementação` → `Em validação` → `Concluído`.
- Descobertas que alterem escopo devem ser registradas no histórico de decisões antes da implementação.
- Cada módulo deve ter uma entrega isolada e validável. Não misturar refatoração estrutural de outro módulo na mesma entrega.
- Toda mudança deve preservar isolamento multi-tenant por `businessId`, compatibilidade com dados existentes e reversibilidade da migração.

## Objetivo

Elevar os módulos compartilhados do AEVO ao nível de maturidade atingido pelo Gestão Raiz em produção, aproveitando regras e fluxos já validados por clientes. A referência será adaptada para pequenos negócios, varejo, alimentação e prestadores de serviços.

Paridade não significa copiar telas, coleções ou regras industriais. Para cada capacidade encontrada no Gestão Raiz, a decisão deve ser uma destas:

- **Portar:** comportamento aplicável praticamente sem mudança de negócio.
- **Adaptar:** reutilizar a regra, simplificando-a para o público do AEVO.
- **Manter AEVO:** o AEVO já possui solução mais adequada ao seu público.
- **Não aplicar:** capacidade exclusivamente industrial ou regulatória sem valor para o AEVO.

## Regras permanentes de implementação

1. Toda leitura e escrita deve respeitar `businessId`.
2. Operações de estoque, dinheiro, fiscal e cobrança devem ser atômicas ou idempotentes.
3. Regras críticas devem ficar em serviços/contratos, não dentro de componentes visuais.
4. Alterações de schema devem incluir compatibilidade, migração e estratégia de rollback.
5. Nenhum módulo será considerado concluído apenas porque a interface está pronta.
6. Os critérios de conclusão incluem testes, regras do Firestore, índices, observabilidade e smoke test.
7. Funcionalidades industriais só entram quando houver caso de uso claro para pequenos negócios.

---

## Roadmap geral

### Fase 0 — Base e governança da evolução

- [ ] **M00 — Baseline técnico, contratos e estratégia de migração**
  - Status: `Planejado`
  - Registrar contratos atuais e dados legados antes das mudanças.
  - Definir padrão de versionamento de schema e scripts de migração.
  - Padronizar critérios de aceite, testes e checklist de segurança multi-tenant.
  - Criar mapa de dependências entre estoque, vendas, financeiro e fiscal.

### Fase 1 — Operação comercial fundamental

- [ ] **M01 — Catálogo, Estoque, Fornecedores e Compras**
  - Status: `Em implementação — M01.0 a M01.4 e M01.5a–c concluídos; próximo: M01.5d`
  - Produtos, categorias, imagens, variações, estoque, movimentações, fornecedores e NF-e de entrada.
  - Base para PDV, pedidos, financeiro, fiscal, cardápio e relatórios.

- [ ] **M02 — Vendas, PDV, Pedidos e Cardápio**
  - Status: `Planejado`
  - Unificar regras de preço, desconto, pagamento, baixa/restauração de estoque e cancelamento.
  - Preservar cardápio, delivery, modificadores, fidelidade e gift cards do AEVO.
  - Adaptar do Gestão Raiz as garantias de consistência, auditoria e emissão fiscal.

- [ ] **M03 — Financeiro e Conciliação**
  - Status: `Planejado`
  - Consolidar Financeiro atual e Financeiro V2 antes de adicionar novas capacidades.
  - Contas a pagar/receber, caixa e bancos, recorrência, parcelamento, DRE, fluxo projetado, orçamento e conciliação.
  - Integrar compras, vendas, comissões, estornos e documentos fiscais sem lançamentos duplicados.

- [ ] **M04 — Fiscal e Contábil**
  - Status: `Planejado`
  - Revisar certificado, NFC-e, NF-e, NFS-e, eventos, cancelamento, carta de correção, contingência e sincronização de status.
  - Adaptar rotinas contábeis e exportações ao perfil tributário dos pequenos negócios.
  - MDF-e e rotinas estritamente industriais/logísticas permanecem fora do escopo inicial.

### Fase 2 — Relacionamento e prestação de serviços

- [ ] **M05 — Clientes, CRM e Jornada Comercial**
  - Status: `Planejado`
  - Cadastro unificado, deduplicação, histórico, scoring, origem, pipeline, atividades, segmentos e formulários.
  - Integrar cliente com vendas, agenda, conversas, financeiro e fiscal.

- [ ] **M06 — Agenda, Serviços, Booking e Assinaturas**
  - Status: `Planejado`
  - Agenda, conflitos, recursos, recorrência, comissões, lembretes, booking público e calendários.
  - Evoluir memberships, cobrança recorrente e proteção contra no-show quando o gateway estiver disponível.

- [ ] **M07 — Conversas, Canais e Campanhas**
  - Status: `Planejado`
  - WhatsApp, Facebook, Instagram, caixa de entrada, atribuição, setores, snippets e notas internas.
  - Campanhas, listas, aniversário, consentimento, templates, entregabilidade e auditoria.
  - Preservar deduplicação e isolamento de tenant nos webhooks.

### Fase 3 — Gestão e inteligência

- [ ] **M08 — Dashboard, Relatórios e Indicadores**
  - Status: `Planejado`
  - Indicadores confiáveis derivados dos módulos transacionais.
  - Vendas, margem, CMV, estoque, financeiro, clientes, agenda, canais e reputação.
  - Paginação/exportação e reconciliação dos números com as fontes.

- [ ] **M09 — Equipe, Permissões e Colaboração**
  - Status: `Planejado`
  - Usuários, convites, funções, setores, presença e visibilidade por departamento.
  - Kanban, notas, chat de equipe, planilhas e cofre com autorização consistente.

- [ ] **M10 — Automações, Notificações e Eventos de Domínio**
  - Status: `Planejado`
  - Alertas operacionais, lembretes, jobs agendados, eventos entre módulos e reprocessamento.
  - Transformar eventos hoje apenas auditáveis em integrações controladas quando houver caso de uso.
  - Garantir idempotência, tentativas, dead-letter e rastreabilidade.

- [ ] **M11 — Agente de IA, API pública e Integrações**
  - Status: `Planejado`
  - Contratos de entrada e saída das ferramentas do agente.
  - Permissões, orçamento, memória, RAG e observabilidade.
  - API pública versionada e integrações externas com segredos protegidos no servidor.

### Fase 4 — Produto SaaS e estabilização

- [ ] **M12 — Configurações, Onboarding, Planos e Billing**
  - Status: `Planejado`
  - Perfil, empresa, modo de uso, fiscal, canais, usuários, setores e preferências.
  - Onboarding por segmento e ativação apenas dos módulos relevantes ao negócio.
  - Planos, limites, cobrança do SaaS e experiência de upgrade/downgrade.

- [ ] **M13 — Segurança, Desempenho e Preparação para Produção**
  - Status: `Planejado`
  - Auditoria final de regras/índices, autorização, paginação, custos do Firestore e dados sensíveis.
  - Testes de regressão, carga e concorrência dos fluxos críticos.
  - Observabilidade, backups, runbooks, deploy progressivo e plano de rollback.

## Itens do Gestão Raiz que não serão copiados integralmente

- PCP, MRP e ordens de produção industriais.
- Controle de qualidade GMP/ANVISA, FISPQ, laudos e dossiês técnicos.
- Equipamentos industriais, estabilidade e rendimento de fabricação.
- Estoques separados de matéria-prima, embalagem e produto acabado como regra obrigatória.
- MDF-e e logística industrial, até existir demanda real no AEVO.

Partes reutilizáveis desses módulos — como receitas simples, ficha técnica, custo de composição, lote e validade — poderão entrar no M01 ou M02 como recursos opcionais por segmento.

---

# Plano detalhado — M01: Catálogo, Estoque, Fornecedores e Compras

## 1. Resultado esperado

Ao concluir o M01, o AEVO deverá possuir uma fonte confiável e auditável para produtos, custos e saldos. Uma compra poderá entrar por XML ou cadastro assistido, vincular/criar fornecedor e produtos, atualizar estoque e custo, e opcionalmente gerar o compromisso financeiro sem duplicidade.

O módulo deve atender varejo, alimentação e serviços com venda de produtos, sem exigir conceitos industriais.

## 2. Estado atual confirmado

### O que o AEVO já faz bem

- Catálogo multi-tenant com produto, SKU, código de barras, categoria, unidade, custo, preço e campos fiscais.
- Cardápio, disponibilidade, categorias de menu, restrições alimentares e modificadores.
- Produto composto por `components[]` com expansão de BOM de um nível.
- Modificadores que podem consumir insumos vinculados.
- Movimentações manuais, histórico paginado, alertas de estoque mínimo e sincronização em tempo real.
- Baixa e restauração de estoque integradas com PDV e pedidos.
- Importação de XML de NF-e de compra, tentativa de match por SKU/nome e cálculo de custo médio.
- Contratos Zod para Product, PurchaseNote e StockMovement.
- Fornecedores disponíveis no domínio e nas ferramentas do agente.

### Lacunas e riscos encontrados no AEVO

1. `InventoryModule.tsx` concentra interface, upload, CRUD e orquestração de estoque em um arquivo grande.
2. `ComprasModule.tsx` interpreta XML e executa regras críticas diretamente no cliente.
3. A proteção contra importação duplicada depende de estado lido pelo cliente; dois usuários podem iniciar a entrada simultaneamente.
4. Entrada de estoque, atualização do custo e mudança do status da nota acontecem em etapas separadas.
5. O contrato exige rastreabilidade por movimentos, mas o fluxo atual não persiste todos os identificadores esperados na nota.
6. Parte do estoque usa SDK cliente com `previousStock/newStock` de melhor esforço; a auditoria exata existe apenas em caminhos server-side.
7. Ainda há caminhos cliente e servidor distintos para operações de estoque, aumentando o risco de divergência.
8. Não existe uma tela operacional completa de fornecedores, apesar da coleção e da ferramenta do agente existirem.
9. O match de itens da NF-e é limitado; falta uma etapa explícita de `vincular`, `criar` ou `ignorar` por item.
10. Faltam custo de aquisição completo, rateio de frete/seguro/desconto/impostos e vínculo consistente com contas a pagar.
11. Exclusão física de produto pode quebrar histórico e referências de vendas, pedidos, receitas ou movimentos.
12. Produtos com variações, múltiplas imagens e lotes/validade ainda não possuem um modelo final coerente para todos os segmentos.

### Referências úteis já validadas no Gestão Raiz

- CRUD e paginação de produtos e fornecedores por tenant.
- Múltiplas imagens, variações, visibilidade e estados de produto.
- Fornecedor com condições de pagamento, prazo de entrega, pedido mínimo e múltiplo de compra.
- Importação manual e sincronização de documentos recebidos na SEFAZ.
- Chave de acesso como proteção contra duplicidade.
- Criação/atualização automática de fornecedor a partir da NF-e.
- Classificação de documento, edição dos itens antes da entrada e match manual.
- Claim/lock de importação, idempotência, reimportação controlada e reversão auditada.
- Rateio de custos acessórios e cálculo de custo médio ponderado.
- Conversão de unidades de compra para unidade de estoque.
- Criação opcional de conta a pagar ou baixa em conta bancária quando a compra já foi paga.
- Lotes, validade e rastreabilidade; no AEVO isso será opcional e simplificado.

## 3. Decisões de escopo

### Portar

- Idempotência forte da entrada de compras.
- Fornecedor operacional e auto-vínculo por CNPJ.
- Match manual de itens e criação assistida de produto.
- Custo médio ponderado e custo de aquisição rateado.
- Conversão de unidade de compra para unidade de estoque.
- Integração opcional com contas a pagar/conta bancária.
- Histórico auditável e reversão controlada.

### Adaptar

- Lotes e validade como recurso opcional por produto/segmento.
- Variações para varejo sem reproduzir a separação industrial de estoques.
- Receita/ficha técnica simples aproveitando o BOM já existente.
- Sincronização SEFAZ somente para empresas com configuração fiscal compatível.

### Manter do AEVO

- Cardápio, modificadores, disponibilidade para delivery e atributos alimentares.
- Integração de estoque com pedidos, Mercado Pago e restauração por estorno.
- Tempo real para catálogo e alertas operacionais.
- Separação de serviços e produtos; serviço não deve virar produto artificialmente.

### Não aplicar agora

- Quarentena e liberação por controle de qualidade industrial.
- Laudos, FISPQ, GHS e qualificação regulatória de fornecedor.
- FEFO obrigatório e rastreabilidade industrial completa.
- Múltiplos depósitos/filiais; será tratado apenas quando o produto suportar multi-location.

## 4. Arquitetura-alvo

```text
UI de Catálogo / Fornecedores / Compras
                │
                ▼
Rotas autenticadas e validadas por Zod
                │
                ▼
Serviços de domínio
  ├── catálogo e variações
  ├── fornecedores
  ├── estoque e movimentos
  ├── importação de compras
  └── custos e integração financeira
                │
                ▼
Firestore por businessId
  products | suppliers | purchaseNotes | stockMovements
                │
                ├── transactions / bankAccounts
                └── notifications / domainEvents
```

Regras críticas de escrita devem executar no servidor. A interface pode manter listeners em tempo real, mas não deve ser a autoridade para decidir se uma nota pode ser importada ou qual é o saldo definitivo.

## 5. Etapas de implementação

### M01.0 — Baseline e testes de caracterização ✅

- [x] Documentar todos os campos usados de `products`, `stockMovements`, `purchaseNotes` e `suppliers`.
- [x] Mapear todos os escritores de `currentStock` no AEVO.
- [x] Mapear consumidores: PDV, pedidos, cardápio, fiscal, financeiro, agente e API v1.
- [x] Criar testes de caracterização dos fluxos atuais antes de mover regras.
- [x] Capturar fixture inicial de NF-e com produto simples, unidade divergente, desconto, frete e impostos. Casos adicionais ficam para M01.5.

**Saída:** mapa de dependências e suíte que detecta regressões do comportamento atual.

### M01.1 — Contratos e modelo de dados ✅

- [x] Definir `ProductV2Schema`, mantendo leitura compatível com documentos atuais.
- [x] Definir estratégia para produto simples, produto com variação e produto composto.
- [x] Formalizar `trackStock`, unidade de compra, fator de conversão, custo atual e custo médio.
- [x] Definir múltiplas imagens sem quebrar o campo legado `imageUrl`.
- [x] Definir `SupplierSchema` e normalização única de CPF/CNPJ.
- [x] Evoluir `PurchaseNoteSchema` com estados de processamento, claim e rastreabilidade.
- [x] Evoluir `StockMovementSchema` com `sourceType`, `sourceId`, `idempotencyKey` e saldo exato.
- [x] Definir `schemaVersion` e política de campos legados.

**Saída:** contratos Zod, tipos derivados e documento de migração.

### M01.2 — Núcleo server-side de estoque ✅

- [x] Criar uma operação server-side única para entrada, saída, ajuste e restauração.
- [x] Ler saldo dentro de transação e registrar `previousStock/newStock` exatos.
- [x] Gravar produto e movimento na mesma transação.
- [x] Validar tenant de todos os produtos e referências antes de escrever.
- [x] Preservar expansão de BOM e consumo de modificadores.
- [x] Adicionar chave idempotente por origem para impedir movimentos duplicados.
- [x] Impedir estoque negativo nos fluxos configurados para controle rígido.
- [x] Centralizar alertas de estoque mínimo e esgotamento.
- [x] Migrar gradualmente os chamadores cliente para as rotas server-side.

**Saída:** uma única regra confiável de saldo para Compras, PDV e Pedidos.

### M01.3 — Catálogo de produtos

- [x] Extrair persistência e upload do componente visual para serviços/rotas.
- [x] Validar unicidade de SKU e código de barras dentro do `businessId`.
- [x] Implementar inativação/arquivamento em vez de exclusão física de item referenciado.
- [x] Preservar produto simples, receita/BOM, cardápio e modificadores.
- [x] Adicionar múltiplas imagens de forma compatível.
- [x] Adicionar variações para os segmentos que necessitam, com SKU, código, preço e estoque próprios.
- [x] Melhorar categorias, filtros, importação/exportação e paginação do catálogo.
- [x] Exibir margem, custo, saldo, estoque mínimo e origem da última atualização.
- [x] Manter o modo planilha, ajustando-o aos novos contratos.

**M01.3a concluído:** núcleo compartilhado pela UI, API v1 e agente; claims de SKU/código por tenant; upload autenticado; estoque inicial auditável; soft archive; indicadores e planilha V2.

**M01.3b concluído:** editor de até oito imagens, variações com saldo auditável, categorias livres, importação CSV com relatório por linha e paginação server-side. Detalhes em `docs/paridade/M01_CATALOGO_PRODUTOS.md`.

**Saída:** catálogo modular, seguro e adequado a varejo/alimentação.

### M01.4 — Fornecedores

- [x] Criar módulo/tela de fornecedores acessível pelo menu de Compras.
- [x] Implementar listar, buscar, criar, editar, inativar e visualizar histórico.
- [x] Reutilizar um serviço único entre UI, API e agente.
- [x] Incluir razão social, fantasia, CNPJ/CPF, contatos, endereço e observações.
- [x] Incluir condições de pagamento, prazo médio, pedido mínimo e múltiplo de compra como campos opcionais.
- [x] Relacionar fornecedor com notas, produtos e movimentações de compra.
- [x] Impedir duplicidade por documento normalizado dentro do tenant.

**M01.4 concluído:** núcleo transacional V2, claims de documento por tenant, trilha de auditoria, tela operacional em Compras e relações com notas, produtos e movimentos. Detalhes em `docs/paridade/M01_FORNECEDORES.md`.

**Saída:** cadastro operacional de fornecedores conectado ao fluxo de compras.

### M01.5 — Importação de compras

- [x] Mover parsing e validação decisiva do XML para o servidor.
- [x] Validar chave de acesso, emitente, destinatário, totais e itens.
- [x] Armazenar o XML original com acesso autorizado e trilha de auditoria.
- [x] Criar ou atualizar fornecedor pelo documento da NF-e.
- [x] Apresentar para cada item as ações `vincular`, `criar produto` ou `ignorar`.
- [x] Sugerir match por código do fornecedor, SKU, GTIN, NCM e nome normalizado.
- [x] Permitir corrigir unidade/fator, quantidade de estoque, custo, lote e validade antes de confirmar.
- [x] Implementar claim transacional para impedir duas importações simultâneas.
- [x] Usar movimentos determinísticos/idempotentes por nota e item.
- [x] Criar produtos solicitados com identificador determinístico pelo núcleo do catálogo.
- [x] Atualizar custo médio ponderado com frete, seguro, desconto, ST, IPI e outras despesas rateadas.
- [x] Gravar `stockMovementIds` e resultado item a item na nota.
- [x] Suportar resultado completo, parcial e falha recuperável.
- [ ] Implementar cancelamento e recuperação/reprocessamento dos itens com erro.
- [ ] Definir reversão controlada sem apagar histórico.

**M01.5a concluído:** preparação server-side, validação do destinatário e da estrutura fiscal, XML privado com hash, fornecedor V2, rateio preliminar e sugestões de produto. O plano e as próximas subetapas estão em `docs/paridade/M01_IMPORTACAO_COMPRAS.md`.

**M01.5b concluído:** editor por item com vínculo/criação/descarte explícitos, variações, conversão, custo e lote; revisão validada e persistida no servidor; retomada de rascunho e bloqueio do lançamento legado para notas V2.

**M01.5c concluído:** claim transacional com expiração, criação determinística de produtos, movimento idempotente por linha, custo médio atômico e fechamento completo/parcial/falha com rastreabilidade individual.

**Saída:** entrada de compra repetível com segurança, sem duplicar saldo ou custo.

### M01.6 — Integrações financeira, fiscal e operacional

- [ ] Oferecer criação de conta a pagar usando o valor total real da NF-e.
- [ ] Suportar compra já paga com seleção obrigatória da conta debitada.
- [ ] Vincular transação financeira à nota e ao fornecedor.
- [ ] Evitar duplicidade de lançamentos em reprocessamentos.
- [ ] Integrar consulta/sincronização de NF-e recebidas quando o fiscal estiver configurado.
- [ ] Emitir eventos auditáveis de compra importada, estoque alterado e custo atualizado.
- [ ] Disponibilizar as mesmas capacidades autorizadas para o agente e API v1.

**Saída:** compra refletida corretamente em estoque, custo e financeiro.

### M01.7 — Lotes e validade opcionais

- [ ] Adicionar configuração por produto `trackLots`/`trackExpiry`.
- [ ] Criar lote na entrada quando o recurso estiver habilitado.
- [ ] Guardar fornecedor, nota, quantidade inicial/atual, custo e validade.
- [ ] Alertar produtos próximos do vencimento.
- [ ] Permitir baixa por lote em fluxo simplificado quando necessário.
- [ ] Não incluir quarentena, laudos ou qualidade industrial nesta etapa.

**Saída:** rastreabilidade leve para alimentação, cosméticos, farmácia e varejo perecível.

### M01.8 — Migração, segurança e desempenho

- [ ] Criar migração idempotente para documentos legados.
- [ ] Fazer backfill de `schemaVersion`, campos normalizados e referências possíveis.
- [ ] Preservar `imageUrl`, `currentStock` e demais campos usados pelos módulos atuais durante a transição.
- [ ] Atualizar Firestore Rules para todos os novos caminhos e negar writes críticos diretos do cliente.
- [ ] Criar/validar índices para listas, busca, movimentos e notas.
- [ ] Paginar produtos, movimentos, fornecedores e notas sem listeners ilimitados.
- [ ] Adicionar logs estruturados e correlação por operação/idempotency key.
- [ ] Executar migração em dry-run antes de qualquer escrita em produção.

**Saída:** dados existentes preservados e custo operacional controlado.

### M01.9 — Testes e validação

- [ ] Testes unitários dos schemas, conversões, custo médio, rateio e BOM.
- [ ] Testes de integração das transações de estoque.
- [ ] Teste concorrente: duas vendas disputando o último item.
- [ ] Teste concorrente: dois usuários importando a mesma NF-e.
- [ ] Testes de isolamento entre dois `businessId`.
- [ ] Testes de entrada, ajuste, venda, cancelamento e estorno.
- [ ] Testes de compra completa, parcial, reprocessada e revertida.
- [ ] Testes da integração financeira e prevenção de duplicidade.
- [ ] Smoke test das telas de Catálogo, Estoque, Fornecedores, Compras, PDV e Pedidos.
- [ ] Comparar saldos e custos antes/depois em uma base de homologação.

**Saída:** evidência objetiva de que o módulo está pronto para uso real.

## 6. Ordem de entrega recomendada

1. M01.0 — baseline e caracterização.
2. M01.1 — contratos e compatibilidade.
3. M01.2 — núcleo server-side de estoque.
4. M01.4 — fornecedores.
5. M01.5 — importação de compras.
6. M01.6 — financeiro/fiscal.
7. M01.3 — evolução visual e funcional do catálogo.
8. M01.7 — lotes/validade opcionais.
9. M01.8 — migração, regras e desempenho.
10. M01.9 — validação final e aceite.

O núcleo de estoque vem antes das novas telas porque todos os demais fluxos dependem dele. A evolução visual do catálogo pode começar depois que os contratos estiverem estáveis, sem bloquear fornecedores e compras.

## 7. Critérios para marcar M01 como concluído

- [ ] Não existe alteração de saldo sem `StockMovement` correspondente.
- [ ] Saldos anterior e posterior são exatos nos caminhos críticos.
- [ ] Repetir a mesma operação idempotente não altera o saldo novamente.
- [ ] Dois usuários não conseguem importar a mesma NF-e simultaneamente.
- [ ] Produto, fornecedor, nota, movimentos e financeiro permanecem no mesmo tenant.
- [ ] Compra atualiza custo pelo método definido e deixa memória de cálculo auditável.
- [ ] Fornecedor pode ser operado pela interface, API autorizada e agente usando a mesma regra de domínio.
- [ ] Dados legados continuam legíveis durante e depois da migração.
- [ ] PDV, Pedidos e Cardápio continuam funcionando sem regressão.
- [ ] Testes automatizados, smoke tests e checklist manual estão aprovados.
- [ ] Regras e índices do Firestore foram validados no ambiente de homologação.
- [ ] Documentação arquitetural foi atualizada.

## 8. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Duplicar saldo ao importar nota | Claim transacional + chave idempotente por nota/item |
| Quebrar PDV/Pedidos ao mudar Product | Leitura compatível + migração gradual + testes de caracterização |
| Divergir estoque cliente/servidor | Escrita crítica única no servidor; listeners apenas para leitura |
| Misturar tenants | Validação de `businessId` em cada referência e teste com dois tenants |
| Perder histórico ao excluir produto | Arquivamento e bloqueio de exclusão quando houver referência |
| Gerar financeiro duplicado | Chave determinística vinculada à nota e verificação transacional |
| Aumentar custos do Firestore | Paginação, índices e listeners limitados |
| Levar complexidade industrial ao AEVO | Lotes/validade opcionais; qualidade industrial fora de escopo |

## 9. Dependências do próximo módulo

O M02 — Vendas, PDV, Pedidos e Cardápio — só deve iniciar sua implementação estrutural após a estabilização de:

- contratos de produto;
- operação server-side de baixa/restauração;
- idempotency key de movimentos;
- modelo de variações/BOM;
- política de estoque negativo;
- compatibilidade dos dados legados.

---

## Histórico de decisões

| Data | Decisão | Motivo |
|---|---|---|
| 25/08/2026 | Usar o Gestão Raiz como referência, não como código-fonte para cópia direta | Os produtos têm públicos e arquiteturas distintas |
| 25/08/2026 | Começar por Catálogo, Estoque, Fornecedores e Compras | É a base transacional de vendas, custos, financeiro e fiscal |
| 25/08/2026 | Manter recursos industriais fora do núcleo do AEVO | Evitar complexidade sem demanda de pequenos negócios |
| 25/08/2026 | Tratar lote/validade como capacidade opcional | Há valor para alguns segmentos sem exigir processo industrial |
