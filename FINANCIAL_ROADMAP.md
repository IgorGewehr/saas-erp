# Roadmap — Módulo Financeiro

Cada item marcado com `[ ]` está pendente. Marque como `[x]` quando implementado.
Itens com 🔧 são implementáveis via código puro. Itens com 🔗 têm dependência externa listada.

---

## FASE 1 — Quick wins (baixo esforço, alto impacto)

### 🔧 1.1 Exportação de relatórios
- [ ] **CSV de transações** — botão "Exportar CSV" na aba Lançamentos, gera arquivo com todas as colunas visíveis filtradas
- [ ] **CSV do DRE** — exportar o demonstrativo de resultado como planilha
- [ ] **CSV do fluxo de caixa** — exportar projeção/histórico mensal
- [ ] **PDF do DRE** — gerar PDF formatado usando `jspdf` + `jspdf-autotable`
- [ ] **PDF de extrato por período** — relatório de transações filtradas em PDF

> Dependências de código: `npm install jspdf jspdf-autotable papaparse`
> Sem dependências externas de serviços.

---

### 🔧 1.2 Filtros avançados combinados nas Transações
- [ ] **Filtro por intervalo de datas** (de/até) independente do mês atual
- [ ] **Filtro por categoria** (dropdown multi-select)
- [ ] **Filtro por conta bancária**
- [ ] **Filtro por método de pagamento**
- [ ] **Filtro por centro de custo / setor**
- [ ] **Filtro por cliente/contato vinculado**
- [ ] **Combinar múltiplos filtros simultaneamente** (AND logic)
- [ ] **Salvar filtro favorito** (localStorage)

> Sem dependências externas. Dados já existem no Firestore com os campos necessários.

---

### 🔧 1.3 Relatório P&L por setor no DRE
- [ ] **Agrupar receitas/despesas por `sectorId`** na aba DRE
- [ ] **Toggle: visão consolidada vs visão por setor**
- [ ] **Gráfico de barras comparando resultado por departamento**
- [ ] **Exportar DRE por setor como CSV**

> O campo `sectorId` já existe em `Transaction`. Só precisa do agrupamento na query e na UI.

---

### 🔧 1.4 Melhorias de UX no dashboard
- [ ] **Indicador de variação mês a mês** nos KPI cards (ex: "+12% vs mês anterior" em verde/vermelho)
- [ ] **Filtro de período no dashboard** (últimos 30d / 3m / 6m / 12m / personalizado)
- [ ] **Gráfico de waterfall** (Receita → Despesas → Resultado) no lugar ou ao lado do bar chart atual
- [ ] **Top 5 despesas por categoria** como ranking com barra de progresso
- [ ] **Top 5 clientes por receita** no overview

> Sem dependências externas. Recharts já está no projeto.

---

## FASE 2 — Diferenciação (médio esforço)

### 🔧 2.1 Anexo de comprovantes nas transações
- [ ] **Adicionar campo `attachments: string[]` ao tipo `Transaction`** (`lib/types/index.ts`)
- [ ] **Botão de upload na tela de lançamento** — aceita PDF, JPG, PNG (max 10MB)
- [ ] **Upload para Firebase Storage** no path `businesses/{businessId}/transactions/{transactionId}/`
- [ ] **Exibir thumbnails/links** na linha da transação na lista
- [ ] **Visualizador inline** para imagens (lightbox)
- [ ] **Download do comprovante** com nome original preservado

> Sem dependências externas. Firebase Storage já está configurado no projeto.

---

### 🔧 2.2 Edição de parcelas individualmente
- [ ] **Editar data de vencimento de parcela única** sem afetar outras do grupo
- [ ] **Cancelar parcela individual** (status `cancelado`) mantendo as demais ativas
- [ ] **Adiar parcela** (nova data de vencimento + registrar no log de auditoria)
- [ ] **Visualizar grupo de parcelas** — ao clicar em uma parcela parcelada, mostrar todas do `installmentGroupId`
- [ ] **Quitar múltiplas parcelas de uma vez** (batch update de status para `pago`)

> Sem dependências externas. Lógica de `installmentGroupId` já existe.

---

### 🔧 2.3 Lock de transações vinculadas a fiscal
- [ ] **Adicionar campo `isLocked: boolean` e `lockedReason?: string` ao tipo `Transaction`**
- [ ] **Bloquear edição/exclusão** quando `saleId` tem documento fiscal emitido (`fiscalDocuments` com status `autorizada`)
- [ ] **Ícone de cadeado** na linha da transação indicando que está bloqueada
- [ ] **Mensagem clara** ao tentar editar: "Esta transação está vinculada a um documento fiscal autorizado e não pode ser alterada"

> Sem dependências externas.

---

### 🔧 2.4 Aging report aprimorado
- [ ] **Filtrar aging por tipo** (só a receber / só a pagar / ambos)
- [ ] **Aging por cliente** — quem deve mais e há quanto tempo
- [ ] **Ação rápida no aging** — marcar como pago diretamente do card
- [ ] **Alerta de e-mail/notificação** para vencimentos do dia e próximos 3 dias

> Notificações por e-mail requerem serviço de e-mail (ver seção de dependências externas).

---

### 🔧 2.5 Conciliação bancária — melhorias
- [ ] **Matching por valor + data** com tolerância configurável (ex: ±1 dia, ±R$0,01 para taxas)
- [ ] **Regras de conciliação automática** salvas por conta (ex: "toda entrada de R$ X da empresa Y = categoria Serviços")
- [ ] **Status "necessita revisão"** antes de confirmar match final
- [ ] **Relatório de itens não conciliados** por período

> Sem dependências externas. OFX/CSV parser já existe no projeto.

---

## FASE 3 — Diferencial de mercado (alto esforço)

### 🔧 3.1 Budget vs Realizado
- [ ] **Novo tipo `Budget`** em `lib/types/index.ts` com campos: `businessId`, `year`, `month`, `category`, `type`, `amount`, `createdAt`
- [ ] **Nova coleção Firestore `budgets`**
- [ ] **Tela de configuração de orçamento** — definir meta por categoria/mês
- [ ] **Aba "Orçamento" no módulo financeiro** com tabela Budget vs Realizado
- [ ] **Indicador de variação** (R$ e %) por categoria
- [ ] **Gráfico de barras agrupadas** (orçado vs realizado) por categoria
- [ ] **Alerta quando atingir 80% do orçamento** de uma categoria
- [ ] **Copiar orçamento do mês anterior** como base

> Sem dependências externas.

---

### 🔧 3.2 Previsão de fluxo de caixa (rolling 13 semanas)
- [ ] **Algoritmo de projeção** baseado em:
  - Transações `pendente` com `dueDate` futuro (compromissos já lançados)
  - Recorrências ativas (calcular próximas N ocorrências a partir de `nextDueDate`)
  - Parcelamentos futuros (parcelas com status `pendente` e `dueDate` futuro)
- [ ] **Visualização semanal** (13 semanas à frente) com saldo projetado por semana
- [ ] **Linha de saldo atual** como ponto de partida
- [ ] **Cenário otimista / pessimista** (toggle: incluir ou excluir pendentes em atraso)
- [ ] **Exportar previsão como CSV**

> Sem dependências externas. Todos os dados necessários já estão no Firestore.

---

### 🔧 3.3 DAS / Simples Nacional tracking
- [ ] **Novo tipo `DasRecord`**: `businessId`, `competencia` (AAAAMM), `valorDas`, `vencimento`, `status` (pendente|pago|atrasado), `pagoEm?`, `recibo?`
- [ ] **Nova coleção `dasRecords`**
- [ ] **Calculadora de DAS** com base na receita bruta do mês (NFSe emitidas + vendas PDV)
- [ ] **Widget no dashboard** mostrando DAS do mês atual e vencimento (dia 20)
- [ ] **Histórico de DAS pagos** com comprovante uploadável
- [ ] **Alerta 5 dias antes do vencimento**
- [ ] **Tabela de alíquotas do Simples** por faixa de receita e atividade (Anexo I-V)

> ⚠️ Complexidade: alíquotas do Simples variam por Anexo (I a V) e faixa de receita bruta acumulada 12 meses.
> Requer manutenção da tabela de alíquotas por ano-calendário (PGDAS-D).
> Sem dependência de API externa — tabela pode ser hardcoded e atualizada anualmente.

---

### 🔧 3.4 Comissões (aprimorar módulo existente)
- [ ] **Regras de comissão por operador** — percentual por categoria de produto/serviço
- [ ] **Cálculo automático** ao fechar venda no PDV
- [ ] **Relatório de comissões por período** com total a pagar por colaborador
- [ ] **Marcar comissão como paga** e registrar data/método de pagamento
- [ ] **Exportar folha de comissões** em CSV/PDF

> O módulo de Comissões já existe mas a lógica de cálculo não estava visível no audit.

---

### 🔗 3.5 PIX — recebimento com QR Code
- [ ] **Gerar QR Code PIX estático** para conta da empresa (sem integração bancária)
- [ ] **Gerar QR Code PIX dinâmico** vinculado a uma transação específica
- [ ] **Confirmar recebimento automaticamente** via webhook do banco

> 🔗 **Dependência externa**: Integração com banco via API PIX (Open Finance BR / Febraban)
> Provedores: **Gerencianet/Efí Bank**, **PagSeguro**, **Asaas**, **Pagar.me**, **Mercado Pago**
> Requer: conta PJ no provedor, credenciais OAuth2, certificado digital para API do Banco Central
> Custo: 0,33% por transação PIX recebido (taxa de mercado)

---

### 🔗 3.6 Boleto bancário
- [ ] **Gerar boleto vinculado a transação** (conta a receber)
- [ ] **Baixa automática ao pagar** via webhook do banco/provedor
- [ ] **Cancelar boleto** antes do vencimento
- [ ] **Reenvio por e-mail** ao cliente

> 🔗 **Dependência externa**: Integração com banco/provedor emissor de boletos
> Provedores: **Asaas**, **Gerencianet/Efí**, **PagSeguro**, **Iugu**, **Pagar.me**
> Requer: conta PJ homologada, cadastro de cedente, CNPJ da empresa

---

### 🔗 3.7 OCR de recibos e notas fiscais
- [ ] **Upload de imagem/PDF de comprovante**
- [ ] **Extração automática**: valor, data, fornecedor, CNPJ, descrição
- [ ] **Pré-preencher formulário de lançamento** com dados extraídos
- [ ] **Revisão humana** antes de confirmar

> 🔗 **Dependência externa**: API de OCR
> Opções:
> - **Google Cloud Vision API** — R$0,0015/imagem, alta precisão em português
> - **AWS Textract** — similar ao Google, melhor para tabelas/formulários
> - **Azure Document Intelligence** — bom para NF-e em PDF
> Integração via API Route server-side (chave não exposta ao cliente)

---

### 🔗 3.8 Open Banking / Importação automática de extratos
- [ ] **Conectar conta bancária via Open Finance Brasil**
- [ ] **Importação automática diária** de lançamentos bancários
- [ ] **Conciliação automática** contra transações do sistema
- [ ] **Suporte a múltiplos bancos**: Itaú, Bradesco, Santander, Nubank, Inter

> 🔗 **Dependência externa**: Certificação no Open Finance Brasil (BACEN)
> Ou via agregador: **Belvo** (foco LATAM), **Pluggy** (API brasileira de Open Finance), **Quanto**
> Requer: contrato com provedor, CNPJ registrado, certificação mTLS
> Custo: varia por provedor e volume de chamadas

---

### 🔗 3.9 Notificações de vencimento por e-mail/WhatsApp
- [ ] **E-mail de lembrete** 3 dias antes do vencimento (contas a pagar)
- [ ] **E-mail de cobrança** para contas a receber vencidas
- [ ] **WhatsApp de cobrança** para clientes com pagamento em atraso
- [ ] **Configurar quais alertas enviar** por tipo de transação

> 🔗 **Dependências externas**:
> - E-mail: **Resend** (já tem integração no projeto), **SendGrid**, **Amazon SES**
> - WhatsApp: já tem integração com WABA no projeto — usar a API de envio existente
> - Agendamento: usar o sistema de Cron Jobs existente (`/api/agent/scheduled/run`)

---

## Resumo de dependências externas

| Serviço | Feature | Provedor sugerido | Custo estimado |
|---|---|---|---|
| API PIX dinâmico | 3.5 | Asaas ou Gerencianet/Efí | 0,33% por PIX recebido |
| Boleto bancário | 3.6 | Asaas ou Iugu | ~R$2-4 por boleto |
| OCR de documentos | 3.7 | Google Cloud Vision | ~R$0,008 por imagem |
| Open Banking | 3.8 | Pluggy (BR) ou Belvo | sob consulta |
| E-mail transacional | 3.9 | Resend (já no projeto) | gratuito até 3k/mês |
| WhatsApp cobrança | 3.9 | WABA (já no projeto) | custo por mensagem Meta |

---

## Ordem de implementação recomendada

```
1.1 Export CSV/PDF          ← começa aqui, impacto imediato para todos os usuários
1.2 Filtros avançados       ← complementa o export
1.3 DRE por setor           ← usa dados que já existem
1.4 UX dashboard            ← polimento visual
2.1 Anexos nas transações   ← muito pedido por usuários
2.2 Edição de parcelas      ← resolve dor de uso recorrente
2.3 Lock fiscal             ← integridade dos dados
2.4 Aging aprimorado        ← visibilidade de inadimplência
2.5 Conciliação melhorada   ← qualidade da reconciliação
3.1 Budget vs Realizado     ← diferencial de mercado
3.2 Previsão de caixa       ← diferencial de mercado
3.3 DAS tracking            ← específico para BR, nenhum concorrente faz
3.4 Comissões               ← aprimorar o que já existe
3.5 PIX QR Code             ← requer provedor externo
3.6 Boleto                  ← requer provedor externo
3.7 OCR                     ← requer API externa
3.8 Open Banking            ← requer certificação
3.9 Notificações            ← parcialmente com infra existente
```

---

_Última atualização: 2026-04-27_
