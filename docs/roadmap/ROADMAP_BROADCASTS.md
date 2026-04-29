# Roadmap — Disparos em Massa (Broadcasts)
**Criado:** 2026-04-30 | **Status:** Planejamento → Implementação faseada

> Plano para fechar os 4 gaps identificados no sistema de broadcasts:
> rastreamento granular, UI de templates, canal email e roteamento Baileys.

## Legenda
- `code-only` — implementável só no saas-erp
- `cross-repo` — precisa também de mudança no notification-server
- `meta` — depende de configuração na Meta (não-bloqueante para o código)

---

## O que já existe hoje

- Endpoint [/api/broadcasts/send](../../app/api/broadcasts/send/route.ts) com:
  - Iteração de contatos (array `recipients`)
  - Throttling configurável (`sendRate`, padrão 10 msg/seg)
  - Suporte a WhatsApp Cloud API (text + template + variáveis)
  - Fallback Cloud config: `whatsappCloud` (novo) → legado `whatsapp`
- Tipo `Broadcast` com campos `templateName`, `templateLanguage`, `templateParams`, `stats {total, sent, failed, ...}`
- Tipo `BroadcastMessage` definido (mas nunca escrito)
- Endpoint [/api/channels/whatsapp-templates](../../app/api/channels/whatsapp-templates/route.ts) lista templates aprovados
- UI básica em CRMModule "Nova Campanha" com:
  - Seleção de canal (whatsapp/facebook/instagram)
  - Tipo `template` ou `text`
  - Campo de texto puro para nome do template
- Notification-server externo (porta 3001) com Baileys + SMTP/Gmail prontos via REST

---

## O que está quebrado / faltando

| # | Item | Status | Bloqueia |
|---|------|--------|----------|
| 1 | Rastreamento granular `BroadcastMessage` | Tipo criado, nunca escrito | Reenvio de falhas, analytics, webhooks de delivery |
| 2 | UI de seleção de template + variáveis | Campo de texto bruto | Adoção real da Cloud API por usuários não-técnicos |
| 3 | Canal Email (broadcasts) | 0% no saas-erp | Marketing por email, comunicação não-WhatsApp |
| 4 | Roteamento Baileys em broadcasts | Não rota | Clientes sem Cloud aprovado |

---

## Fase 1 — Rastreamento granular `BroadcastMessage` 🟥
**`code-only`** · Estimativa: 2-3h · **Bloqueante para tudo abaixo**

### Por que primeiro
Sem isso, o resto fica meio cego. Cada outro canal/feature ficaria reescrevendo lógica de tracking.

### Checklist
- [ ] **1.1** Em [/api/broadcasts/send](../../app/api/broadcasts/send/route.ts), criar doc `broadcastMessages/{id}` por contato no loop:
  - Antes do envio: `status: 'pending'`
  - Após envio bem-sucedido: `status: 'sent'`, `externalMessageId`
  - Após falha: `status: 'failed'`, `errorMessage`
- [ ] **1.2** Adicionar update em batch (`writeBatch`) para evitar 200 round-trips em campanhas grandes
- [ ] **1.3** Webhook Meta ([/api/webhooks/meta/route.ts](../../app/api/webhooks/meta/route.ts)) — quando recebe status `delivered` ou `read`, encontra `BroadcastMessage` por `externalMessageId` e atualiza
- [ ] **1.4** UI em CRM → Campanha → painel de detalhes: lista paginada de `BroadcastMessage` com status colorido, botão "Reenviar falhas"
- [ ] **1.5** Endpoint `/api/broadcasts/[id]/retry-failed` que cria novo broadcast só com os contatos que falharam

### Validação
- Disparar campanha com 3 contatos → conferir 3 docs em `broadcastMessages` no Firestore
- Forçar 1 falha (número inválido) → conferir status `'failed'` com `errorMessage`
- Conferir webhook atualiza `deliveredAt` quando Meta confirma entrega

---

## Fase 2 — UI de seleção de template + variáveis 🟧
**`code-only`** · Estimativa: 3-4h

### Por que segundo
Cloud API já funciona. Só falta UX. Fase 1 deixa o tracking pronto para a UI poder mostrar resultados.

### Checklist
- [ ] **2.1** Em [CRMModule.tsx](../../app/components/features/crm/CRMModule.tsx) dialog "Nova Campanha":
  - Substituir campo de texto bruto por dropdown que faz fetch de [/api/channels/whatsapp-templates](../../app/api/channels/whatsapp-templates/route.ts)
  - Mostrar nome, categoria (Utility/Marketing/Auth) e idioma
  - Preview do corpo do template
- [ ] **2.2** Quando usuário escolhe template, parsear placeholders `{{1}}, {{2}}, {{N}}` e mostrar inputs:
  - Cada input tem dropdown lateral "preencher com:" → opções: nome do contato, telefone, valor manual
  - Se valor manual → input de texto
  - Se campo do contato → mapear no envio iterando cada contato
- [ ] **2.3** Persistir mapeamento no `Broadcast.templateParams`:
  - Formato proposto: `[{ kind: 'field', field: 'name' }, { kind: 'literal', value: 'R$ 100' }]`
  - Resolver no servidor por contato durante o envio
- [ ] **2.4** Preview "como vai chegar" antes de enviar — pega 1 contato real, renderiza template com valores resolvidos
- [ ] **2.5** Validação client-side: bloquear envio se algum `{{N}}` não foi mapeado

### Validação
- Criar campanha com template `{{1}}, {{2}}` → mapear `{{1}}=nome` e `{{2}}=valor literal`
- Disparar para 3 contatos → conferir que cada um recebeu com seu nome próprio + valor fixo
- Tentar criar sem mapear → bloqueio com mensagem clara

---

## Fase 3 — Canal Email via notification-server 🟨
**`cross-repo`** · Estimativa: 2-3h

### Por que depois do template
Email é simpler que template (sem aprovação Meta). Notification-server já está pronto. Só falta plugar.

### Checklist
- [ ] **3.1** Adicionar `'email'` ao tipo `BroadcastChannel` em [lib/types/index.ts](../../lib/types/index.ts)
- [ ] **3.2** Em [SettingsModule.tsx](../../app/components/features/settings/SettingsModule.tsx) → Enterprise → seção "Notification Server":
  - Inputs `notificationServerUrl` + `notificationServerApiKey` (criptografado via `encryptToken`)
  - Salvos em `business.settings.notificationServer`
  - Botão "Testar conexão" que faz `GET /api/status`
- [ ] **3.3** Em [/api/broadcasts/send](../../app/api/broadcasts/send/route.ts):
  - Adicionar branch `if (channel === 'email')`
  - Lê config do business, decifra API key
  - Itera contatos com `email` válido
  - Chama `POST {url}/api/send-bulk` com `{ appId: businessId, emails: [...] }`
  - Cria `BroadcastMessage` por contato (Fase 1 já fez a infra)
- [ ] **3.4** UI em CRM "Nova Campanha":
  - Mostrar opção "Email" no seletor de canal (apenas se notification-server configurado)
  - Campo "Assunto" + textarea HTML rico para corpo (ou markdown)
  - Filtro de contatos com email válido
- [ ] **3.5** Tratar erros do notification-server graciosamente (offline, API key errada, etc.)

### Validação
- Configurar notification-server URL + key em Settings → Testar conexão funciona
- Criar campanha email com 2 contatos → ambos recebem
- Desconfigurar API key → erro útil aparece no painel da campanha

---

## Fase 4 — Roteamento Baileys em broadcasts 🟪
**`cross-repo`** · Estimativa: 3-4h

### Por que por último
Decisões de arquitetura envolvem trade-offs (chamar baileys-manager local vs. notification-server externo). Melhor com tudo acima já estável.

### Decisão arquitetural a tomar primeiro
**Opção A — Usar baileys-manager local do saas-erp:**
- Prós: já tem sessão ativa quando recebe inbound
- Contras: serverless (Vercel/Netlify) não mantém sessão Baileys entre invocações; precisaria de processo dedicado
- Quando faz sentido: deploy com servidor sempre-ligado (Railway, VPS)

**Opção B — Delegar pro notification-server externo:**
- Prós: notification-server JÁ tem throttling, reconexão, multi-sessão por appId
- Contras: precisa duplicar a sessão Baileys (uma no saas-erp para conversas, uma no notification-server para broadcasts) — pode dar conflito
- Quando faz sentido: notification-server é dedicado pra broadcast e roda separado

**Opção C — Migrar Baileys 100% para notification-server:**
- Prós: source-of-truth única, melhor escalabilidade
- Contras: mudança grande, precisa redirecionar webhooks de inbound

### Checklist (após decisão)
- [ ] **4.1** Decidir entre A/B/C com o time
- [ ] **4.2** Se A: extrair `sendBaileysMessage` do baileys-manager para suportar lote com throttling. Em `/api/broadcasts/send` adicionar branch `whatsapp + baileys`
- [ ] **4.3** Se B/C: definir contrato REST com notification-server, configurar `appId` por business, encaminhar
- [ ] **4.4** UI em CRM "Nova Campanha": detectar canal disponível e mostrar opção "WhatsApp Web (sem template)" quando Baileys ativo
- [ ] **4.5** Avisar usuário do risco (banimento por uso intensivo) com toggle "Aceito o risco"

### Validação
- Disparar broadcast Baileys com 5 contatos
- Conferir throttling (deve levar ~7.5s com 1.5s delay)
- Forçar desconexão do Baileys no meio → campanha pausa e mostra erro

---

## Ordem de execução recomendada

```
Fase 1 (BroadcastMessage tracking)         ← infraestrutura
   ↓
Fase 2 (UI de templates Cloud)             ← user-facing primeiro
   ↓
Fase 3 (Email via notification-server)     ← canal novo "fácil"
   ↓
Fase 4 (Baileys broadcasts)                ← decisão arquitetural maior
```

Cada fase tem **commit + push isolado** após validação. Sem misturar.

---

## Trabalho fora-de-escopo (parking lot)

- Agendamento de campanhas (`scheduledFor` no Broadcast)
- Segmentação avançada (já existe `Segment` no tipo, falta UI completa)
- A/B testing de templates
- Opt-out automático com link de descadastro
- Compliance LGPD (consentimento explícito antes de mandar)
- Webhook de bounce de email
