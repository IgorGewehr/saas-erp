# Aevo — Roadmap de Implementacao

**Ultima atualizacao:** 2026-04-24 (rev.4 — pos-Sprint 1 + Sprint 2)
**Baseado em:** AUDIT_REPORT.md + pesquisa competitiva + auditoria pre-producao

---

## Status Atualizado — O que JA EXISTE

### Modulos UI: 15 completos

Dashboard, Agenda, PDV, Kanban, Financeiro, Estoque, Fiscal, Configuracoes, CRM, Conversas, Integracoes Enterprise, Booking Publico, Relatorios, Mural de Notas, Senhas/Cofre

### Features implementadas nesta sessao (2026-04-23/24)

#### Auditoria Pre-Producao
- Auth em 7 rotas fiscais + headers no frontend
- Settings tabs filtradas por role (ADMIN_ONLY_TABS)
- Webhook tokens removidos dos logs
- API keys de integracao buscadas server-side (8 proxy routes)
- Meta token validation (debug_token)
- PDV confirmSale atomico (writeBatch)
- PDV cancelamento de venda com reversao de estoque
- Cascade delete Kanban (board → cards) e CRM (contato → deals + atividades)
- Client stats com increment() (race condition fix)
- checkStockAvailability antes do batch commit
- Timestamps corrigidos (serverTimestamp → ISO)
- TopBar queries com limit(200)
- 9 dependencias nao utilizadas removidas

#### Sprint 1 — Features Independentes (9/9 completas)

| # | Feature | Detalhes |
|---|---------|---------|
| 1 | **Notificacoes Kanban** | Sino na TopBar com dropdown real-time, badge unificado (notifs + msgs), cron para tarefas vencendo/atrasadas, notifica ao atribuir |
| 2 | **Recorrencia financeira** | Toggle no form de lancamento (5 frequencias), cron gera proxima ocorrencia, mutuamente exclusivo com parcelamento |
| 3 | **Google Calendar sync** | OAuth2 completo, tokens criptografados, refresh automatico, sync fire-and-forget ao criar/editar/deletar agendamento |
| 4 | **Apple Calendar (.ics)** | Feed publico GET /api/calendar/[slug]/[userId], URL copiavel no Settings, compativel com Apple Calendar/Outlook |
| 5 | **Automacoes CRM** | 6 triggers (inactive, birthday, post_appointment, lifecycle_change, churn_risk, new_lead), 5 actions (WhatsApp, tag, lifecycle, notify, task), cron engine idempotente |
| 6 | **Formularios intake** | Builder com 8 tipos de campo, pagina publica /forms/[formId], submit rate-limited, historico no LeadDetailPanel |
| 7 | **Gestao reputacao** | Pagina publica /review/[slug], 1-5 estrelas, redirect Google Reviews, aba Avaliacoes nos Relatorios (NPS, distribuicao, ranking profissional) |
| 8 | **AI Analyst** | Chat no Dashboard (mode='analyst'), reutiliza infra agent existente, prompts de analise de dados, visual violet |
| 9 | **Conciliacao bancaria** | Parser OFX + CSV (BR format, BOM, quoted fields), auto-matching engine (valor+data+descricao), UI com stats, filtros, salvar batch |

#### Sprint 2 — Esqueletos com Gateway (4/4 completos)

| # | Feature | Status |
|---|---------|--------|
| 10 | **TEF** | Tipos completos (6 providers). Config em BusinessSettings. Falta: UI no PDV + SDK adquirente |
| 11 | **PIX/Link pagamento** | Tipos completos (4 gateways, PaymentIntent). Config em BusinessSettings. Falta: UI "Gerar PIX" + webhook |
| 12 | **Memberships** | **UI funcional** — aba "Planos" no CRM, CRUD completo, cards visuais, warning quando sem gateway |
| 13 | **No-show protection** | Tipos completos (NoShowPolicy). Config em BusinessSettings. Falta: UI em Settings + booking page |

---

## O que FALTA — Proximas Implementacoes

### Requer integracao de gateway de pagamento

Quando um gateway (Asaas, Pagar.me, Mercado Pago) for integrado:

1. **TEF** — UI "Aguardando pinpad" no PDV, config em Settings, comprovante
2. **PIX QR** — Botao "Gerar PIX" no PDV com QR code, webhook de confirmacao
3. **Link de pagamento** — Enviar via WhatsApp, webhook de confirmacao
4. **Cobranca recorrente** — Memberships com billing automatico
5. **No-show deposit** — Checkout na booking page, cobranca de fee

### Sprint 3 — Longo prazo

| # | Feature | Complexidade |
|---|---------|-------------|
| 14 | Multi-location (multi-filial) | Alta |
| 15 | Widget de booking embeddavel | Media |
| 16 | App mobile nativo (PWA) | Muito Alta |
| 17 | Marketplace de descoberta | Muito Alta |
| 18 | Payroll integrado | Alta |
| 19 | Resource management (salas/equipamentos) | Media |
| 20 | Pre-booking no checkout | Baixa |
| 21 | Referral program | Media |
| 22 | Two-way SMS | Media |

---

## Infraestrutura Pendente (acao manual)

| Item | Comando / Acao |
|------|---------------|
| Deploy Firestore Rules | `npx firebase-tools deploy --only firestore:rules --project service-provider-1cd0d` |
| Deploy Firestore Indexes | `npx firebase-tools deploy --only firestore:indexes --project service-provider-1cd0d` |
| Google Calendar | Criar projeto GCP, ativar Calendar API, preencher GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET |
| Vars de producao | Preencher todas as vars do .env.example no Vercel |
| Sentry (opcional) | Setup externo para error tracking |

---

## Resumo Executivo

| Categoria | Implementado | Pendente |
|-----------|-------------|---------|
| **Modulos UI** | 15 completos | — |
| **API Routes** | 60+ completas | — |
| **Sprint 1** | 9/9 features | — |
| **Sprint 2** | 4/4 esqueletos | Gateway para ativar |
| **Auditoria** | 9 secoes auditadas, 15+ correcoes | Deploy rules/indexes |
| **PDV** | Atomico + NFC-e + fidelidade + gift card + cancelamento | TEF + PIX QR |
| **Financeiro** | 8 tabs incl. conciliacao + recorrencia | — |
| **CRM** | 7 tabs incl. automacoes + formularios + planos | — |
| **Agenda** | Google Calendar + Apple Calendar + lembretes | — |
| **Relatorios** | 6 tabs incl. avaliacoes | — |

---

*Fontes: Trinks, Booksy, Avec, Belasis, Fresha, Square, Vagaro, GlossGenius, Boulevard, Zenoti, Mindbody (abril/2026)*
