# Roadmap — Disparos em Massa (Broadcasts)
**Criado:** 2026-04-30 | **Atualizado:** 2026-04-30 (mudança de arquitetura) | **Status:** Planejamento → Implementação faseada

> Plano para implementar disparos em massa. Cliente passa **lista de números/emails**
> direto ao sistema. Aevo dispara WhatsApp (Cloud + Baileys), notification-server
> dispara Email.

## Legenda
- `code-only` — implementável só no saas-erp
- `cross-repo` — precisa também de mudança no notification-server
- `meta` — depende de configuração na Meta (não-bloqueante para o código)

---

## Decisões arquiteturais

| Tópico | Decisão | Por quê |
|--------|---------|---------|
| **Origem dos recipientes** | Lista direta (paste/CSV), não iteração CRM | Casos de uso reais com listas externas (planilhas de leads, exportações etc.) |
| **WhatsApp Cloud broadcast** | Saas-erp dispara direto na Meta API | Já implementado, só falta UI + tracking |
| **WhatsApp Baileys broadcast** | Saas-erp local (baileys-manager existente) | Source-of-truth única; não duplicar sessão |
| **Email broadcast** | Delegado ao notification-server | Notification-server já tem SMTP/Gmail pronto |
| **Granular tracking** | `broadcastMessages/{id}` por recipiente | Permite retry, analytics, webhook de delivery |

### ⚠️ Pré-requisito de infraestrutura

Baileys mantém sessão **em memória** (Map `sessions`). Para broadcasts via Baileys
funcionarem, o saas-erp precisa rodar em ambiente **sempre-ligado** (Railway, VPS,
container persistente). Em **serverless (Vercel/Netlify)** a sessão é perdida entre
invocações — broadcasts via Baileys vão falhar.

**Ação necessária antes da Fase 4:** confirmar onde o saas-erp está hospedado.

---

## O que já existe hoje

- Endpoint [/api/broadcasts/send](../../app/api/broadcasts/send/route.ts):
  - Iteração de `recipients` array
  - Throttling configurável (`sendRate`, padrão 10 msg/seg)
  - Suporte a WhatsApp Cloud API (text + template + variáveis)
- Tipo `Broadcast` com `templateName/Language/Params`, `stats`, `recipients[]`
- Tipo `BroadcastMessage` definido (mas nunca escrito)
- Endpoint [/api/channels/whatsapp-templates](../../app/api/channels/whatsapp-templates/route.ts) lista templates aprovados
- UI básica em CRMModule "Nova Campanha" (mas iterando segmentos/contatos CRM)
- Notification-server externo (porta 3001) com SMTP/Gmail prontos via REST
- baileys-manager local com `sessions: Map<businessId, BaileysSession>` ativa

---

## Gaps identificados

| # | Item | Status atual |
|---|------|--------------|
| 0 | Importar lista de recipientes direto (paste/CSV) | Não existe — só itera CRM |
| 1 | Rastreamento granular `BroadcastMessage` | Tipo criado, nunca escrito |
| 2 | UI de seleção de template + variáveis | Campo de texto bruto |
| 3 | Canal Email (broadcasts) | 0% — só notification para Financeiro isolado |
| 4 | Roteamento Baileys em broadcasts | `/api/broadcasts/send` só conhece Cloud |

---

## Fase 0 — Importação de lista de recipientes 🟦
**`code-only`** · Estimativa: 2h · **NOVA — base de tudo abaixo**

### Por que primeiro
Mudança de UX: input deixa de ser "selecione segmento" e passa a ser "cole/upload lista". Os tipos precisam aceitar recipiente sem `contactId` antes de qualquer outra coisa.

### Checklist
- [ ] **0.1** Atualizar tipo `Broadcast.recipients` em [lib/types/index.ts](../../lib/types/index.ts):
  ```typescript
  recipients: {
    contactId?: string;     // auto-vinculado se número bater com cliente
    name?: string;          // do CSV ou inferido
    phoneNumber?: string;   // E.164
    email?: string;
  }[];
  ```
- [ ] **0.2** Atualizar tipo `BroadcastMessage`:
  - `contactId` → opcional
  - Manter `recipientId` como chave primária (phone/email)
- [ ] **0.3** Criar componente `RecipientListInput` reutilizável:
  - Modo "Colar lista": textarea aceitando 1-por-linha, vírgula, ponto-e-vírgula
  - Modo "Upload CSV": parse client-side com header (name, phone/email)
  - Validação: E.164 para phone, regex para email
  - Dedup automático
  - Contador "X válidos · Y inválidos · Z duplicados"
  - Mostrar até 10 inválidos com motivo
- [ ] **0.4** Auto-link com clientes CRM existentes (busca em `clients` por `phone`/`whatsapp`/`email`) — preenche `contactId` se houver match
- [ ] **0.5** Substituir o input de segmento na UI de "Nova Campanha" pelo novo componente

### Validação
- Colar 5 números (2 válidos BR + 1 inválido + 1 duplicado + 1 sem DDI) → mostra contagem correta
- Upload CSV com 100 números → todos parseados em < 1s
- 1 número que existe como cliente CRM → `contactId` preenchido automaticamente

---

## Fase 1 — Rastreamento granular `BroadcastMessage` 🟥
**`code-only`** · Estimativa: 2-3h · **Bloqueante para retry/analytics**

### Por que segundo
Sem isso o resto fica cego. Cada outro canal/feature ficaria reescrevendo lógica de tracking.

### Checklist
- [ ] **1.1** Em [/api/broadcasts/send](../../app/api/broadcasts/send/route.ts), criar `broadcastMessages/{id}` por recipiente:
  - Antes do envio: `status: 'pending'`
  - Após sucesso: `status: 'sent'` + `externalMessageId`
  - Após falha: `status: 'failed'` + `errorMessage`
- [ ] **1.2** Usar `writeBatch` (Firebase admin) para evitar 200 round-trips em campanhas grandes — flush a cada 100 mensagens
- [ ] **1.3** Webhook Meta ([/api/webhooks/meta/route.ts](../../app/api/webhooks/meta/route.ts)) — quando recebe status `delivered`/`read`, busca `BroadcastMessage` por `externalMessageId` e atualiza `deliveredAt`/`readAt`
- [ ] **1.4** UI em CRM → Campanha → painel de detalhes:
  - Lista paginada de `BroadcastMessage`
  - Filtro por status (pending/sent/delivered/read/failed)
  - Coluna `errorMessage` para failed
  - Botão "Reenviar todos os falhados"
- [ ] **1.5** Endpoint `/api/broadcasts/[id]/retry-failed` que cria novo broadcast só com falhados

### Validação
- Disparar campanha com 3 recipientes → conferir 3 docs em `broadcastMessages` no Firestore
- Forçar 1 falha (número inválido) → conferir status `'failed'` com `errorMessage`
- Webhook Meta atualiza `deliveredAt` quando entrega confirma

---

## Fase 2 — UI de seleção de template + variáveis 🟧
**`code-only`** · Estimativa: 3-4h

### Por que terceiro
Cloud API já funciona. Só falta UX. Fase 0+1 deixam infra pronta.

### Checklist
- [ ] **2.1** Em [CRMModule.tsx](../../app/components/features/crm/CRMModule.tsx) dialog "Nova Campanha":
  - Substituir campo de texto bruto por dropdown com fetch de `/api/channels/whatsapp-templates`
  - Mostrar nome, categoria (Utility/Marketing/Auth) e idioma
  - Preview do corpo do template
- [ ] **2.2** Quando usuário escolhe template, parsear `{{1}}, {{2}}, {{N}}` e mostrar inputs:
  - Cada input com dropdown lateral "preencher com:"
  - Opções: nome do contato (só se `contactId` existe), telefone, **valor literal**, valor por linha do CSV
  - Importante: como recipiente pode não ter CRM, "valor literal" precisa estar sempre disponível
- [ ] **2.3** Persistir mapeamento no `Broadcast.templateParams`:
  - Formato: `[{ kind: 'field' | 'literal' | 'csvColumn', value: string }]`
  - Resolver no servidor por recipiente durante envio
- [ ] **2.4** Preview "como vai chegar" — pega 1 recipiente real, renderiza template com valores resolvidos
- [ ] **2.5** Validação client-side: bloquear envio se algum `{{N}}` não foi mapeado

### Validação
- Criar campanha com template `{{1}}, {{2}}` → mapear `{{1}}=nome` e `{{2}}=valor literal`
- Disparar para 3 recipientes → cada um recebe com seu nome + valor fixo
- Usar template numa lista pura (sem CRM) → só permite "literal" ou "csv column"

---

## Fase 3 — Canal Email via notification-server 🟨
**`cross-repo`** · Estimativa: 2-3h

### Por que depois do template
Email é mais simples que template (sem aprovação Meta). Notification-server já está pronto.

### Checklist
- [ ] **3.1** Adicionar `'email'` ao tipo `BroadcastChannel` em [lib/types/index.ts](../../lib/types/index.ts)
- [ ] **3.2** Em SettingsModule → Enterprise → seção "Notification Server":
  - Inputs `notificationServerUrl` + `notificationServerApiKey` (criptografado via `encryptToken`)
  - Salvos em `business.settings.notificationServer`
  - Botão "Testar conexão" → `GET /api/status`
- [ ] **3.3** Em [/api/broadcasts/send](../../app/api/broadcasts/send/route.ts):
  - Branch `if (channel === 'email')`
  - Lê config do business, decifra API key
  - Filtra recipientes com `email` válido
  - Chama `POST {url}/api/send-bulk` com `{ appId: businessId, emails: [...] }`
  - Cria `BroadcastMessage` por recipiente (Fase 1 fez a infra)
- [ ] **3.4** UI em CRM "Nova Campanha":
  - Mostrar opção "Email" no canal (apenas se notification-server configurado)
  - Campos: Assunto + corpo (HTML rico ou markdown)
  - Reusa Fase 0 (`RecipientListInput`) com modo email
- [ ] **3.5** Tratar erros do notification-server (offline, key errada) com mensagem clara

### Validação
- Configurar notification-server URL+key → "Testar conexão" funciona
- Criar campanha email com 2 recipientes → ambos recebem
- Desconfigurar → erro útil aparece

---

## Fase 4 — Baileys broadcasts (LOCAL no Aevo) 🟪
**`code-only`** (depende de deploy correto) · Estimativa: 3-4h

### Pré-requisito
**Confirmar deploy não-serverless.** Se rodando em Vercel/Netlify, esta fase requer migração para Railway/VPS antes.

### Checklist
- [ ] **4.0** Confirmar onde o saas-erp está rodando (Vercel? Railway? Outro?)
- [ ] **4.1** Em [baileys-manager.ts](../../app/api/whatsapp/baileys-manager.ts), adicionar função `sendBulkBaileys`:
  - Aceita lista de `{ phone, message }`
  - Itera com delay configurável (recomendado 2-5s entre mensagens)
  - Retorna resultado por mensagem (sucesso/falha)
  - Cancelável via flag externa (caso usuário pause)
- [ ] **4.2** Em [/api/broadcasts/send](../../app/api/broadcasts/send/route.ts) adicionar branch:
  - Se canal `whatsapp` E `connectedVia: 'baileys'` (do business config) → chamar Baileys local
  - Se canal `whatsapp` E config Cloud → manter fluxo Meta (atual)
- [ ] **4.3** UI em CRM "Nova Campanha" — quando WhatsApp escolhido E business tem Baileys conectado:
  - Toggle "Enviar via WhatsApp Web (Baileys)" / "Enviar via WhatsApp Business (Cloud)"
  - Aviso visível para Baileys: "Risco de banimento. Use com moderação."
  - Limite recomendado: 200 msg/dia para Baileys (configurável)
- [ ] **4.4** Tracking via `BroadcastMessage` igual outros canais (Fase 1)
- [ ] **4.5** Pause/cancel: documento `Broadcast.status: 'paused'` é checado no loop de envio

### Validação
- Disparar broadcast Baileys com 5 recipientes → leva ~10-25s com delay
- Pausar no meio → loop interrompe, restantes ficam `pending`
- Forçar desconexão Baileys no meio → mensagens restantes viram `failed`
- Conferir saas-erp continua respondendo conversas individuais durante broadcast

---

## Ordem de execução

```
Fase 0 (Lista de recipientes)              ← input
   ↓
Fase 1 (BroadcastMessage tracking)         ← infraestrutura
   ↓
Fase 2 (UI de templates Cloud)             ← user-facing primeiro
   ↓
Fase 3 (Email via notification-server)     ← canal novo "fácil"
   ↓
Fase 4 (Baileys broadcasts local)          ← depende de deploy correto
```

Cada fase tem **commit + push isolado** após validação. Sem misturar.

---

## Trabalho fora-de-escopo (parking lot)

- Agendamento de campanhas (`scheduledFor`)
- Salvar listas reusáveis (`BroadcastList` collection)
- Segmentação avançada (já existe `Segment`, falta UI completa)
- A/B testing de templates
- Opt-out automático com link de descadastro
- Compliance LGPD (consentimento explícito antes de mandar)
- Webhook de bounce de email
- Rate limit por business (anti-abuse)
- Métricas agregadas: CTR, taxa de entrega, tempo médio até leitura
