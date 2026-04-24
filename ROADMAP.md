# Aevo — Roadmap de Implementacao

**Ultima atualizacao:** 2026-04-23 (rev.3 — pos-auditoria)
**Baseado em:** AUDIT_REPORT.md + pesquisa competitiva + auditoria pre-producao

---

## Estrategia de Implementacao

### Features independentes (sem dependencia externa)
Implementar por completo, na ordem listada.

### Features com dependencia externa (gateway de pagamento / TEF)
Implementar o **esqueleto completo**: tipos, UI, fluxos, validacoes — tudo pronto exceto a chamada real ao gateway. Na UI:
- Botoes/abas ficam **visiveis mas desabilitados** (cinza) com badge "Em breve"
- Ou ficam **ocultos** atras de feature flag (`business.enterprise.payments?.isEnabled`)
- Quando o gateway for integrado, basta conectar ao esqueleto existente

---

## O que JA EXISTE (15 modulos + 50+ API routes)

<details>
<summary>Expandir lista completa de features implementadas</summary>

- Dashboard (KPIs, graficos, metricas)
- Agenda (calendario, 6 status, servicos, comissoes auto, lembretes WhatsApp)
- PDV (carrinho, 8 formas pgto, NFC-e, recibo, fidelidade, gift card, cancelamento atomico com reversao)
- Kanban (4 views, drag-drop, checklists, labels, comentarios, anexos, templates, automacoes, recorrencia)
- Financeiro (7 tabs: visao-geral, lancamentos, contas, fluxo, comissoes, DRE, auditoria)
- Estoque (CRUD, movimentacao, categorias, alertas, BOM/compostos)
- Fiscal (NFe + NFCe + NFSe + SEFAZ + DANFE + carta correcao + inutilizacao)
- Configuracoes (10 abas, roles, setores, canais, enterprise)
- CRM (leads, deals, pipeline, broadcasts, segmentacao, omnichannel inbox)
- Conversas (WhatsApp + Instagram + Facebook, snippets, notas internas, scroll fix)
- Integracoes Enterprise (8 provedores: Stripe, OpenAI, Anthropic, GitHub, Vercel, Resend, Cloudflare, Sentry)
- Booking publico (/booking/[slug] com agente IA)
- Relatorios (5 abas + export PDF)
- Mural de Notas (pessoal/equipe, masonry, color picker, resize)
- Senhas/Cofre (AES-256-GCM, gerador, reveal com audit trail)
- Programa de fidelidade (pontos, resgate, config, atomico)
- Gift cards digitais (criacao, resgate parcial, PDV)
- Comissoes automaticas (por profissional + por servico)
- Presenca online (3 estados, invisible, heartbeat)
- Setores/Departamentos (visibilidade granular em todos os modulos)
- Convite por codigo (6 chars, roles, expiracao)

</details>

---

## PLANO DE IMPLEMENTACAO — Ordem de Ataque

### SPRINT 1 — Features independentes (sem gateway)

#### 1. Notificacoes de tarefas Kanban
- **Prioridade:** ALTA
- **Complexidade:** Media
- **O que fazer:**
  - Colecao `notifications/{id}` com `userId`, `type`, `title`, `body`, `isRead`, `link`, `createdAt`
  - Tipos: `task_due_soon` (1h/1d antes), `task_assigned`, `task_mentioned`, `task_overdue`
  - Cron check (no mesmo `/api/agent/scheduled/run`) — verifica cards com dueDate proximo
  - Badge no sino da TopBar com contagem de nao-lidas
  - Dropdown de notificacoes com mark-as-read
  - onSnapshot para real-time
- **Estimativa:** 1-2 sessoes

#### 2. Recorrencia automatica de lancamentos financeiros
- **Prioridade:** ALTA
- **Complexidade:** Media
- **O que fazer:**
  - Campo `recurrence` em Transaction: `{ frequency: 'monthly'|'weekly'|'biweekly'|'quarterly'|'yearly', nextDueDate, endDate?, isActive }`
  - Cron job gera proxima ocorrencia quando `nextDueDate <= hoje`
  - UI: toggle "Recorrente" no form de lancamento, com seletor de frequencia
  - Opcao de pausar/cancelar recorrencia
- **Estimativa:** 1 sessao

#### 3. Google Calendar sync bidirecional
- **Prioridade:** ALTA
- **Complexidade:** Media-Alta
- **O que fazer:**
  - OAuth2 com Google (Settings → Integracao → Google Calendar)
  - Cada profissional conecta sua conta
  - Sync Aevo → GCal: ao criar/editar/cancelar agendamento, cria/atualiza/remove evento
  - Sync GCal → Aevo: webhook (push notifications) ou polling periodico
  - Campos mapeados: titulo, descricao, data/hora, participantes
  - API route `/api/integrations/google-calendar` com OAuth callback
  - Colecao `calendarSyncTokens/{uid}` para refresh tokens
- **Estimativa:** 2-3 sessoes

#### 4. Apple Calendar sync (.ics feed)
- **Prioridade:** MEDIA
- **Complexidade:** Baixa
- **O que fazer:**
  - API route `/api/calendar/[businessSlug]/[userId].ics` — gera feed .ics read-only
  - Inclui agendamentos futuros do profissional
  - URL para assinatura no Apple Calendar / Outlook
  - Atualiza automaticamente (sem webhook)
- **Estimativa:** 0.5 sessao

#### 5. Automacoes por comportamento (triggers CRM)
- **Prioridade:** ALTA
- **Complexidade:** Media-Alta
- **O que fazer:**
  - Colecao `automationRules/{id}`: `trigger`, `conditions[]`, `actions[]`, `isActive`
  - Triggers: `client_inactive_Xdays`, `client_birthday`, `post_appointment`, `deal_stage_change`
  - Actions: `send_whatsapp_template`, `create_task`, `add_tag`, `change_lifecycle_stage`
  - Cron job avalia regras ativas periodicamente
  - UI em Settings ou CRM: builder visual de regras
  - Templates de mensagem com variaveis ({{nome}}, {{servico}}, etc.)
- **Estimativa:** 2-3 sessoes

#### 6. Formularios de intake/anamnese
- **Prioridade:** MEDIA
- **Complexidade:** Media-Alta
- **O que fazer:**
  - Colecao `formTemplates/{id}`: builder com campos (text, textarea, checkbox, radio, select, date, file)
  - Colecao `formResponses/{id}`: respostas preenchidas por cliente
  - Associar template a servico — cliente preenche antes do atendimento
  - Link publico ou envio via WhatsApp
  - Historico de fichas no perfil do cliente (CRM)
  - Templates pre-definidos: anamnese estetica, ficha capilar, consulta inicial
- **Estimativa:** 2-3 sessoes

#### 7. Gestao de reputacao (review prompts + NPS)
- **Prioridade:** MEDIA
- **Complexidade:** Media
- **O que fazer:**
  - Envio automatico de pedido de avaliacao apos atendimento (via automacao #5)
  - Link direto para Google Reviews (configuravel por negocio)
  - Pagina interna `/review/[businessSlug]` com formulario simples (1-5 estrelas + comentario)
  - Colecao `reviews/{id}`: rating, comment, clientId, professionalId, serviceId
  - Dashboard de avaliacoes no modulo Relatorios (nova aba)
  - NPS calculado por profissional e por servico
- **Estimativa:** 1-2 sessoes

#### 8. AI Analyst (chat sobre dados do negocio)
- **Prioridade:** MEDIA
- **Complexidade:** Media (infra IA ja existe)
- **O que fazer:**
  - Chat no Dashboard: admin faz perguntas em linguagem natural
  - "Quem sao meus top 10 clientes?" / "Qual servico da mais lucro?" / "Quantos no-shows tive este mes?"
  - Agente consulta Firestore via function calling e gera resposta
  - Usa OpenAI ou Anthropic (configuravel por negocio)
  - Historico de perguntas/respostas por sessao
- **Estimativa:** 2 sessoes

#### 9. Conciliacao bancaria
- **Prioridade:** MEDIA
- **Complexidade:** Alta
- **O que fazer:**
  - Upload de extrato CSV/OFX no Financeiro
  - Parser de formatos (Banco do Brasil, Itau, Bradesco, Nubank, Inter)
  - Matching automatico extrato ↔ transacoes do sistema (por valor + data +/- 3 dias)
  - UI de reconciliacao: matched (verde), pendente (amarelo), divergente (vermelho)
  - Reconciliacao manual para itens nao-matched
  - Status por transacao: conciliado / pendente / divergente
- **Estimativa:** 2-3 sessoes

---

### SPRINT 2 — Esqueletos (dependem de gateway externo)

> Implementar tipos, UI, fluxos e validacoes. Botoes desabilitados com "Em breve" ou ocultos.
> Quando o gateway for integrado, basta conectar.

#### 10. TEF — Transferencia Eletronica de Fundos
- **Prioridade:** ALTA (esqueleto)
- **Complexidade:** Alta (esqueleto: media)
- **O que fazer (esqueleto):**
  - Tipo `TEFConfig`: provider (stone|cielo|rede|getnet|safrapay|pagseguro), terminalId, merchantId, isActive
  - Tipo `TEFTransaction`: saleId, amount, installments, cardBrand, authCode, nsu, status, receipt
  - UI no PDV: ao selecionar credito/debito com TEF ativo, exibe "Aguardando pinpad..." (tela de status)
  - Fluxo: PDV envia comando → agente local (Electron/desktop companion) comunica com pinpad → retorna resultado
  - Settings → Empresa → TEF: configurar provider e terminal
  - API route `/api/tef/transaction` (esqueleto — retorna mock em dev)
  - Comprovante TEF (via, cliente, estabelecimento) integrado ao recibo do PDV
  - `paymentMethod: 'credito_tef' | 'debito_tef'` adicionado ao tipo Payment
- **O que fica cinza:**
  - Botao "Iniciar TEF" no PDV — badge "Em breve — configure TEF em Configuracoes"
  - Aba TEF em Settings desabilitada ate configuracao
- **Quando ativar:** Integrar com SDK do adquirente (Stone TEF, Cielo LIO, Rede e-Rede, etc.)

#### 11. Pagamento real integrado (PIX QR + link de pagamento)
- **Prioridade:** ALTA (esqueleto)
- **Complexidade:** Alta (esqueleto: media)
- **O que fazer (esqueleto):**
  - Tipo `PaymentGatewayConfig`: provider (asaas|pagarme|mercadopago|stripe), apiKey, webhookSecret, isActive
  - Tipo `PaymentIntent`: amount, method (pix|credit|debit|boleto), status, qrCode?, paymentUrl?, gatewayId
  - UI no PDV: botao "Gerar PIX" exibe QR code + copia-e-cola (esqueleto com QR mockado)
  - UI no PDV: botao "Enviar link de pagamento" via WhatsApp (esqueleto — gera link placeholder)
  - Webhook route `/api/payments/webhook` (esqueleto — loga payload)
  - Settings → Empresa → Pagamentos: configurar gateway
  - Cada negocio configura suas proprias credenciais
- **O que fica cinza:**
  - Botoes "Gerar PIX" e "Link de pagamento" — badge "Em breve"
  - Aba Pagamentos em Settings desabilitada
- **Quando ativar:** Cadastrar no Asaas/Pagar.me, obter API keys, preencher config

#### 12. Memberships / Assinaturas / Pacotes
- **Prioridade:** ALTA (esqueleto)
- **Complexidade:** Alta (esqueleto: media)
- **O que fazer (esqueleto):**
  - Tipo `Membership`: name, description, services[], price, billingCycle (monthly|quarterly|yearly), maxUsesPerCycle
  - Tipo `ClientMembership`: clientId, membershipId, status (active|paused|cancelled|expired), startDate, nextBillingDate, usesThisCycle
  - Colecao `memberships/{id}` e `clientMemberships/{id}` com businessId
  - UI: aba "Planos" no CRM ou modulo dedicado — CRUD de planos
  - UI: no perfil do cliente, aba "Assinatura" — atribuir plano, ver uso, pausar/cancelar
  - PDV: detecta plano ativo → desconto automatico para servicos inclusos
  - Alerta quando uso excede limite do ciclo
- **O que fica cinza:**
  - Botao "Assinar plano" — badge "Em breve — requer gateway de pagamento"
  - Cobranca recorrente desabilitada (manualmente o admin marca como pago)
- **Quando ativar:** Gateway de pagamento (#11) integrado com billing recorrente

#### 13. No-show protection (deposito / cartao on file)
- **Prioridade:** ALTA (esqueleto)
- **Complexidade:** Alta (esqueleto: media)
- **O que fazer (esqueleto):**
  - Tipo `NoShowPolicy`: requireDeposit, depositPercentage, depositFixedAmount, cancellationDeadlineHours, noShowFeePercentage
  - Campo `noShowPolicy` em Business.settings
  - Booking page: etapa de "garantia" antes de confirmar agendamento (mostra politica)
  - Settings → Empresa → Politica de No-show: configurar regras
  - Ao marcar agendamento como "faltou": calcula fee, registra como transacao pendente
  - Historico de no-shows no perfil do cliente
- **O que fica cinza:**
  - Cobranca do deposito — badge "Em breve — requer gateway de pagamento"
  - Campo de cartao na booking page desabilitado
- **Quando ativar:** Gateway (#11) + tokenizacao de cartao

---

### SPRINT 3 — Bonus / Longo prazo

| # | Feature | Complexidade | Deps |
|---|---------|-------------|------|
| 14 | Multi-location (multi-filial) | Alta | — |
| 15 | Widget de booking embeddavel | Media | — |
| 16 | App mobile nativo (PWA) | Muito Alta | — |
| 17 | Marketplace de descoberta | Muito Alta | — |
| 18 | Payroll integrado | Alta | — |
| 19 | Resource management (salas/equipamentos) | Media | — |
| 20 | Pre-booking no checkout | Baixa | — |
| 21 | Referral program | Media | Gateway |
| 22 | Two-way SMS | Media | Provedor SMS |
| 23 | Branded app por negocio | Muito Alta | — |

---

## Tipos que Precisam ser Criados (lib/types/index.ts)

### Sprint 1
```typescript
// Notificacoes
Notification: { id, userId, businessId, type, title, body, isRead, link?, relatedId?, createdAt }
NotificationType: 'task_due_soon' | 'task_assigned' | 'task_mentioned' | 'task_overdue' | 'appointment_reminder' | 'review_received'

// Recorrencia financeira
TransactionRecurrence: { frequency, nextDueDate, endDate?, isActive, parentTransactionId }

// Google Calendar
CalendarSyncToken: { uid, businessId, provider, accessToken, refreshToken, expiresAt, calendarId }

// Automacoes CRM
AutomationRule: { id, businessId, name, trigger, conditions[], actions[], isActive, lastRunAt?, createdAt }
AutomationTrigger: 'client_inactive' | 'client_birthday' | 'post_appointment' | 'deal_stage_change' | 'new_lead'
AutomationAction: 'send_whatsapp' | 'create_task' | 'add_tag' | 'change_stage' | 'send_email'

// Formularios
FormTemplate: { id, businessId, name, serviceId?, fields: FormField[], isActive, createdAt }
FormField: { id, type, label, required, options?, placeholder? }
FormResponse: { id, businessId, templateId, clientId, appointmentId?, responses: Record<string, any>, createdAt }

// Reviews
Review: { id, businessId, clientId?, professionalId?, serviceId?, rating, comment?, source, createdAt }
```

### Sprint 2 (esqueletos)
```typescript
// TEF
TEFConfig: { provider, terminalId, merchantId, isActive, connectedAt }
TEFTransaction: { id, businessId, saleId, amount, installments, cardBrand, authCode, nsu, status, receipt?, createdAt }
TEFProvider: 'stone' | 'cielo' | 'rede' | 'getnet' | 'safrapay' | 'pagseguro'

// Pagamento real
PaymentGatewayConfig: { provider, apiKey, webhookSecret, isActive, sandbox }
PaymentIntent: { id, businessId, saleId?, amount, method, status, qrCode?, paymentUrl?, gatewayId?, paidAt?, createdAt }
PaymentGatewayProvider: 'asaas' | 'pagarme' | 'mercadopago' | 'stripe'

// Memberships
Membership: { id, businessId, name, description, services[], price, billingCycle, maxUsesPerCycle, isActive, createdAt }
ClientMembership: { id, businessId, clientId, membershipId, status, startDate, nextBillingDate, usesThisCycle, createdAt }
MembershipStatus: 'active' | 'paused' | 'cancelled' | 'expired'

// No-show
NoShowPolicy: { requireDeposit, depositPercentage?, depositFixedAmount?, cancellationDeadlineHours, noShowFeePercentage }
```

---

## Vantagens Competitivas UNICAS do Aevo

| Vantagem | Detalhe |
|----------|---------|
| **Omnichannel real** | WhatsApp + Instagram + Facebook integrados com CRM + Financeiro |
| **Fiscal completo** | NFe + NFCe + NFSe com SEFAZ real |
| **Kanban avancado** | 4 views com setores — nenhum concorrente tem |
| **Agente IA** | Booking via chat, lembretes automaticos, integracao OpenAI/Anthropic |
| **Cofre de senhas** | AES-256-GCM com audit trail — unico no segmento |
| **Mural de notas** | Google Keep interno para equipe |
| **TEF integrado** | (em breve) Pinpad direto no PDV |
| **Setores/Departamentos** | Visibilidade granular em todos os modulos |
| **Enterprise integrations** | 8 provedores (Stripe, GitHub, Vercel, etc.) |
| **Multi-tenant com roles** | 5 niveis (founder → viewer) + convites por codigo |

---

## Resumo Executivo

| Categoria | Implementado | Proximo |
|-----------|-------------|---------|
| **Modulos UI** | 15 completos | Notificacoes, Automacoes CRM |
| **API Routes** | 50+ completas | Google Calendar, TEF, Payments |
| **PDV** | Atomico + NFC-e + fidelidade + gift card + cancelamento | TEF + PIX QR |
| **Fiscal** | NFe + NFCe + NFSe + SEFAZ completo | — |
| **Financeiro** | 7 tabs + DRE + aging + fluxo caixa | Recorrencia + conciliacao |
| **Agendamento** | CRUD + booking + comissoes + lembretes | Google Calendar sync |
| **CRM** | Pipeline + broadcasts + segmentacao | Automacoes + scoring |
| **Kanban** | 4 views + templates + automacoes | Notificacoes |
| **Pagamento** | 8 metodos locais | TEF + PIX + link (esqueleto) |

---

*Fontes: Trinks, Booksy, Avec, Belasis, Fresha, Square, Vagaro, GlossGenius, Boulevard, Zenoti, Mindbody (abril/2026)*
