# Aevo — Roadmap de Implementacao

**Ultima atualizacao:** 2026-04-21 (rev.2)
**Baseado em:** AUDIT_REPORT.md + pesquisa competitiva (Trinks, Booksy, Fresha, Square, Vagaro, GlossGenius, Boulevard, Zenoti, Mindbody, Avec, Belasis)

---

## Status Atualizado — O que JA EXISTE (verificado no codigo)

### Modulos 100% implementados (12 modulos)

| # | Modulo | Arquivo | Observacao |
|---|--------|---------|------------|
| 1 | Dashboard | `dashboard/DashboardModule.tsx` | KPIs, graficos, metricas em tempo real |
| 2 | Agenda | `agenda/AgendaModule.tsx` | Calendario semana/mes/dia, 6 status, gestao de servicos |
| 3 | PDV | `pdv/PDVModule.tsx` | Catalogo, carrinho, 6 formas pgto, NFC-e toggle, recibo |
| 4 | Kanban | `kanban/KanbanModule.tsx` | Board + List + Calendar + MyTasks views, drag-drop, checklists |
| 5 | Financeiro | `financial/FinancialModule.tsx` | 6 tabs: visao-geral, lancamentos, contas, fluxo, comissoes, auditoria |
| 6 | Estoque | `inventory/InventoryModule.tsx` | CRUD completo, movimentacao, categorias, grid/list |
| 7 | Fiscal | `fiscal/FiscalModule.tsx` | NFe + NFCe + NFSe + SEFAZ completo |
| 8 | Configuracoes | `settings/SettingsModule.tsx` | Perfil, empresa, fiscal, usuarios, setores, canais, enterprise |
| 9 | CRM | `crm/CRMModule.tsx` | Leads, deals, pipeline, campanhas/broadcasts, omnichannel inbox |
| 10 | Conversas | `conversations/ConversasModule.tsx` | WhatsApp + Instagram + Facebook, snippets, notas internas |
| 11 | Integracoes | `integrations/IntegrationsModule.tsx` | Dashboard enterprise multi-tab (Stripe, OpenAI, Anthropic, etc.) |
| 12 | Booking Publico | `booking/[slug]/page.tsx` | Pagina publica sem auth, chat com agente IA, agendamento autonomo |

### Features transversais ja implementadas

| Feature | Onde | Detalhes |
|---------|------|---------|
| Comissoes automaticas | `lib/services/commission.ts` + Agenda + Financeiro | Criacao/cancelamento auto, taxa por profissional e por servico, tab dedicada no Financeiro |
| Comissao por servico UI | `agenda/AgendaModule.tsx` | Campo commissionRate no ServiceManagementDialog |
| PDV → NFC-e | `pdv/PDVModule.tsx` | Toggle NFC-e no checkout, emissao via /api/fiscal/emit |
| PDV → Recibo | `pdv/PDVModule.tsx` | window.print com layout termico, inclui chave NFC-e |
| Programa de fidelidade | `lib/services/loyalty.ts` + PDV + Settings | Pontos por real, resgate como pagamento, config por negocio |
| Gift cards digitais | `lib/services/giftCard.ts` + PDV | Criacao, lookup por codigo, resgate parcial, venda no PDV |
| DRE | `financial/FinancialModule.tsx` | Tab DRE com periodos mensal/trimestral/anual, export PDF |
| Fluxo de caixa projetado | `financial/FinancialModule.tsx` | Tab "Fluxo" com previsto vs realizado, grafico |
| Contas a pagar/receber | `financial/FinancialModule.tsx` | dueDate, parcelas (ate 12x), alertas de vencimento, aging report |
| Lembretes automaticos | `api/agent/scheduled/run/route.ts` | Cron horario: lembrete, confirmacao, follow-up via WhatsApp |
| Relatorios dedicados | `reports/ReportsModule.tsx` | 5 abas: vendas, agenda, financeiro, clientes, comissoes + PDF |
| Kanban avancado | `kanban/KanbanModule.tsx` | 4 views + comentarios + anexos + templates + automacoes + recorrencia |
| Setores/Departamentos | AuthProvider + Settings | Visibilidade granular em Conversas, Kanban, CRM, Financeiro |
| Presenca online | AuthProvider + TopBar | 3 estados (online/busy/offline), invisible mode, heartbeat |

---

## O que FALTA — Ordenado por Prioridade

### FASE 1 — Table-stakes (sem isso nao compete)

> Features presentes em 8+ concorrentes. Sao consideradas basicas pelo mercado.

#### ~~1. Lembretes automaticos de agendamento (WhatsApp/SMS)~~
✅ **IMPLEMENTADO** (2026-04)
- `app/api/agent/scheduled/run/route.ts` — cron horario via Vercel
- 3 automacoes: lembrete (Xh antes), confirmacao (24-26h antes), follow-up (12-36h apos)
- Idempotente com campos sentAt no documento do agendamento
- Envio via Meta API com assinatura HMAC

#### 2. No-show protection (deposito/cartao on file)
- **Prioridade:** CRITICA
- **Quem tem:** Booksy, Fresha, Square, Boulevard, Zenoti
- **Impacto:** Protege receita do prestador, reduz cancelamentos de ultima hora
- **Estado atual:** NAO EXISTE
- **O que fazer:**
  - Opcao de exigir deposito antecipado ao agendar (% do valor ou fixo)
  - Cartao on file: cliente cadastra cartao na booking page
  - Fee automatica por no-show (configuravel por negocio)
  - Politica de cancelamento configuravel (ate Xh antes = sem cobranca)
- **Complexidade:** Alta (requer gateway de pagamento real)
- **Dependencias:** Pagamento real integrado (#8)

#### ~~3. Comissao por servico — UI de configuracao~~
✅ **IMPLEMENTADO** (2026-04)
- Campo `commissionRate` no ServiceManagementDialog (AgendaModule)
- Input numerico 0-100% salvo no documento do servico

---

### FASE 2 — Diferenciacao competitiva

> Features presentes em 5-7 concorrentes. Diferenciam dos basicos.

#### ~~4. Relatorios dedicados (modulo)~~
✅ **IMPLEMENTADO** (2026-04)
- `app/components/features/reports/ReportsModule.tsx`
- 5 abas: Vendas, Agenda, Financeiro, Clientes, Comissoes
- KPI cards, graficos, filtros por periodo, exportacao PDF

#### 5. Memberships / Assinaturas / Pacotes recorrentes
- **Prioridade:** ALTA
- **Quem tem:** Trinks, Booksy, Fresha, Vagaro, GlossGenius, Boulevard, Zenoti, Mindbody
- **Impacto:** Receita recorrente previsivel, fidelizacao
- **Estado atual:** NAO EXISTE
- **O que fazer:**
  - Tipo `Membership`: nome, servicos inclusos, preco mensal, vigencia
  - Cliente assina plano → cobranca recorrente (requer gateway)
  - Controle de uso (quantos servicos usou no mes)
  - Desconto automatico no PDV quando cliente tem plano ativo
  - Gestao em Settings ou CRM
- **Complexidade:** Alta
- **Dependencias:** Gateway de pagamento real

#### ~~6. Programa de fidelidade (pontos/rewards)~~
✅ **IMPLEMENTADO** (2026-04)
- `lib/services/loyalty.ts` — calculo, acumulo, resgate, historico
- Config em Settings → Empresa: pontosPerReal, valorEmCentavos, minResgate, expiracao
- Integrado no PDV como pagamento ('pontos'), badge no ClientsModule
- Transacoes atomicas via Firestore runTransaction

#### 7. Google Calendar sync bidirecional
- **Prioridade:** ALTA
- **Quem tem:** Square, Booksy, Fresha, Vagaro
- **Estado atual:** NAO EXISTE — agenda interna apenas
- **O que fazer:**
  - OAuth2 com Google (Settings → Integracoes)
  - Sync bilateral: agendamentos Aevo ↔ Google Calendar
  - Por profissional (cada operador conecta sua conta)
  - Webhook ou polling para sync em tempo real
- **Complexidade:** Media-Alta

#### 8. Pagamento real integrado (PIX QR + link de pagamento)
- **Prioridade:** ALTA
- **Quem tem:** Trinks (Stone), Fresha, Square, todos internacionais
- **Estado atual:** PDV registra metodo de pagamento, mas NAO processa. Stripe so faz analytics.
- **O que fazer:**
  - Integrar gateway brasileiro (Asaas, Pagar.me ou Mercado Pago)
  - PIX: gerar QR code no PDV, webhook confirma pagamento
  - Link de pagamento: enviar via WhatsApp para o cliente
  - Cartao: processar via gateway
  - Cada negocio configura suas credenciais (Settings → Enterprise)
- **Complexidade:** Alta

#### ~~9. Gift cards digitais~~
✅ **IMPLEMENTADO** (2026-04)
- `lib/services/giftCard.ts` — criacao, lookup, resgate parcial
- Codigo unico 8 chars, status tracking (active/used/expired)
- Integrado no PDV como pagamento ('gift_card') + modal de venda
- Validade configuravel

---

### FASE 3 — Premium / Diferencial avancado

> Features presentes em 3-4 concorrentes. Posicionam como plataforma premium.

#### 10. Formularios de intake/anamnese por servico
- **Prioridade:** MEDIA
- **Quem tem:** Vagaro, GlossGenius, Boulevard, Zenoti, Mindbody
- **O que fazer:**
  - Builder de formularios customizaveis por servico
  - Cliente preenche antes do atendimento (via booking page ou link)
  - Historico de fichas no perfil do cliente
  - Templates pre-definidos (anamnese estetica, ficha capilar, etc.)
- **Complexidade:** Media-Alta

#### 11. Gestao de reputacao (review prompts)
- **Prioridade:** MEDIA
- **Quem tem:** GlossGenius, Zenoti, Mindbody
- **Impacto:** Reviews automaticos melhoram ranking no Google
- **O que fazer:**
  - Envio automatico de pedido de avaliacao apos atendimento (WhatsApp/email)
  - Link direto para Google Reviews ou pagina interna
  - Dashboard de avaliacoes recebidas
  - NPS (Net Promoter Score) por profissional
- **Complexidade:** Media

#### 12. AI Analyst (perguntas em linguagem natural sobre dados)
- **Prioridade:** MEDIA
- **Quem tem:** GlossGenius, Zenoti, Mindbody, Square
- **Vantagem Aevo:** Ja temos integracoes OpenAI + Anthropic + Agente IA
- **O que fazer:**
  - Chat no Dashboard onde admin pergunta sobre dados do negocio
  - "Quem sao meus top 10 clientes?" / "Qual servico da mais lucro?" / "Qual dia da semana tenho mais no-shows?"
  - Agente consulta Firestore e gera resposta + graficos
- **Complexidade:** Media (infraestrutura IA ja existe)

#### 13. Automacoes por comportamento (triggers)
- **Prioridade:** MEDIA
- **Quem tem:** Fresha, Mindbody, Trinks
- **O que fazer:**
  - Reengajamento: cliente inativo ha X dias → mensagem automatica
  - Aniversario: parabens + desconto via WhatsApp
  - Pos-atendimento: agradecimento + pedido de avaliacao
  - Configuravel por negocio (tipos de trigger, templates, canais)
- **Complexidade:** Media-Alta

#### ~~14. DRE (Demonstrativo de Resultado do Exercicio)~~
✅ **IMPLEMENTADO** (2026-04)
- Tab "DRE" no FinancialModule com DREContent component
- Receita Bruta → Deducoes → Liquida → CPV → Lucro Bruto → Despesas → Resultado
- Periodos: mensal, trimestral, anual
- Exportacao PDF via jsPDF + jspdf-autotable
- Categorias configuradas: CPV, Deducao, Financeiro

#### 15. Conciliacao bancaria
- **Prioridade:** MEDIA
- **Quem tem:** ERPs financeiros completos
- **Estado atual:** NAO EXISTE — contas bancarias sao apenas listagem
- **O que fazer:**
  - Upload de extrato (CSV/OFX)
  - Matching automatico extrato ↔ transacoes do sistema
  - Reconciliacao manual para itens nao-matched
  - Status: conciliado / pendente / divergente
- **Complexidade:** Alta

#### 16. Multi-location management (multi-filial)
- **Prioridade:** MEDIA
- **Quem tem:** Avec, Zenoti, Mindbody
- **O que fazer:**
  - Um business pode ter multiplas unidades (locations)
  - Dashboard consolidado + visao por unidade
  - Profissionais podem atuar em mais de uma unidade
  - Estoque por unidade
- **Complexidade:** Alta (impacta modelo de dados inteiro)

---

### FASE 4 — Bonus / Longo prazo

> Features de nicho ou que requerem infraestrutura significativa.

| # | Feature | Quem tem | Complexidade |
|---|---------|----------|-------------|
| 17 | App mobile nativo (PWA ou React Native) | Trinks, Booksy, Fresha, Vagaro | Muito Alta |
| 18 | Marketplace de descoberta (clientes encontram salao) | Trinks, Booksy, Fresha, Mindbody | Muito Alta |
| 19 | Widget de booking embeddavel para websites | Fresha, Boulevard | Media |
| 20 | Payroll integrado (folha de pagamento) | Vagaro, Zenoti | Alta |
| 21 | Gestao de gorjetas (tips) | Zenoti, Boulevard, Vagaro | Baixa |
| 22 | Resource management (salas/equipamentos reservaveis) | Boulevard, Mindbody | Media |
| 23 | Pre-booking no checkout (agendar retorno ao pagar) | Boulevard | Baixa |
| 24 | HIPAA compliance (para medspas/clinicas) | Boulevard, Zenoti | Alta |
| 25 | Referral program (indicacao com incentivos) | Mindbody | Media |
| 26 | Apple Calendar sync (CalDAV/.ics) | Standard | Baixa |
| 27 | Two-way SMS com clientes | Zenoti | Media |
| 28 | Branded app personalizado por negocio | Mindbody | Muito Alta |

---

## Vantagens competitivas UNICAS do Aevo

Features que **nenhum concorrente combina** na mesma plataforma:

| Vantagem | Detalhe |
|----------|---------|
| **Omnichannel real** | WhatsApp + Instagram + Facebook integrados com CRM + Financeiro |
| **Fiscal completo** | NFe + NFCe + NFSe com SEFAZ real — Trinks e Avec so tocam superficialmente |
| **Kanban avancado** | 4 views (board/list/calendar/mytasks) com setores — nenhum concorrente tem |
| **Agente IA** | Booking publico via chat com IA, integracao OpenAI/Anthropic |
| **Setores/Departamentos** | Visibilidade granular em todos os modulos |
| **Enterprise integrations** | Stripe, GitHub, Vercel, Resend, Discord, etc. |
| **Multi-tenant com roles** | 5 niveis de acesso (founder → viewer) com convites por codigo |

---

## Resumo Executivo Atualizado

| Categoria | Implementado | Faltando |
|-----------|-------------|----------|
| **Modulos UI** | 13 completos (incl. Booking + Relatorios) | — |
| **API Routes** | 50/50 completas | 0 placeholders |
| **PDV** | Venda + estoque + NFC-e + recibo + fidelidade + gift cards | Pagamento real (gateway) |
| **Fiscal** | NFe + NFCe + NFSe + SEFAZ + PDV | — Completo |
| **Financeiro** | 7 tabs: visao-geral, lancamentos, contas, fluxo, comissoes, dre, auditoria | Conciliacao bancaria, recorrencia |
| **Agendamento** | CRUD + booking + comissoes + lembretes auto | No-show protection |
| **Omnichannel** | WhatsApp + Meta + lembretes automaticos | Reengajamento, triggers |
| **CRM** | Contatos + deals + pipeline + broadcasts | Scoring auto, triggers |
| **Kanban** | Board + List + Calendar + MyTasks + comments + attachments + templates + automations + recurrence | Notificacoes |
| **Pagamento** | Registro local, 8 metodos (incl. pontos + gift card) | Gateway real (PIX QR, link pgto) |

### Tudo que ja foi implementado (verificado no codigo):

- ✅ PDV → NFC-e + Recibo
- ✅ Comissao automatica de profissionais (lib/services/commission.ts)
- ✅ Comissao por servico UI (campo no ServiceManagementDialog)
- ✅ Booking publico (/booking/[slug] com agente IA)
- ✅ Contas a pagar/receber (dueDate + parcelas + alertas + aging report)
- ✅ Fluxo de caixa projetado (tab Fluxo)
- ✅ Lembretes automaticos WhatsApp (cron horario)
- ✅ Relatorios dedicados (5 abas + PDF)
- ✅ Programa de fidelidade (pontos/resgate/config)
- ✅ Gift cards digitais (criacao/resgate/PDV)
- ✅ DRE (tab no Financeiro, export PDF)
- ✅ Aging report financeiro (buckets de vencimento)
- ✅ NFS-e completa (combobox LC 116)
- ✅ Kanban avancado (comentarios, anexos, templates, automacoes, recorrencia)
- ✅ Kanban 4 views (Board, Lista, Calendario, Minhas Tarefas)

### Proxima implementacao sugerida (em ordem):

1. **Google Calendar sync** — pedido frequente, media-alta complexidade
2. **Pagamento real (PIX QR + link)** — requer gateway brasileiro
3. **Memberships/Assinaturas** — depende de gateway
4. **No-show protection** — depende de gateway
5. **Formularios de intake/anamnese** — media-alta complexidade
6. **Gestao de reputacao (review prompts)** — media complexidade
7. **AI Analyst** — infra IA ja existe, aplicar sobre dados do Firestore
8. **Automacoes por comportamento** — reengajamento, aniversario, pos-atendimento
9. **Conciliacao bancaria** — upload extrato, matching automatico

---

*Fontes da pesquisa competitiva: Trinks, Booksy, Avec, Belasis, Fresha, Square Appointments, Vagaro, GlossGenius, Boulevard, Zenoti, Mindbody (abril/2026)*
