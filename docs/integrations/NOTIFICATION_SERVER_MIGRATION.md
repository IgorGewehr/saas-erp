# Notification Server — Migração para integração com saas-erp (broadcasts)

> **Status: ✅ APLICADO** — commits `6fd24ca` (notification-server) +
> `6e67af8` / `XXX` (saas-erp). Documento mantido como referência arquitetural.
>
> Mudanças aplicadas no repositório `notification-server`
> (`c:\Users\Gustavo\Documents\Automa\notification-server`) para integração
> com a feature de **broadcasts/campanhas** do saas-erp.
>
> **Estado pós-migração:** servidor retorna `jobId` em envios imediatos,
> reporta bounces via webhook HMAC-assinado, suporta HTML multipart.
> **Apenas email** é integrado — WhatsApp do saas-erp roda nativo (Baileys
> dentro do próprio app), notification-server fica só pro painel admin.

---

## Sumário dos GAPs

| # | Gap | Severidade | Esforço | Quebra produção? |
|---|-----|-----------|---------|------------------|
| 1 | Email enviado como `text` quando saas-erp manda HTML | **ALTO** | 5 min | Sim — emails saem com tags visíveis |
| 2 | `/api/send-email` não retorna `jobId` em envios imediatos | **ALTO** | 10 min | Sim — externalMessageId fica vazio, bounce/delivery não correlaciona |
| 3 | Não existe webhook de bounce (5.3) | Médio | 1-2h | Não — emails que bounce ficam como `sent` no tracking |
| 4 | SMTP per-business mas API key é global (todos tenants compartilham) | Baixo | n/a | Não — design atual aceitável |

**Gap 1 + 2 são bloqueadores reais** — sem eles, o feature de broadcast por
email do saas-erp manda mensagens mas:
- Cliente recebe email com HTML como texto literal (footer aparece quebrado)
- Sistema não consegue rastrear delivered/bounced (externalMessageId vazio)

---

## Gap 1 — Suportar HTML quando saas-erp envia

### Estado atual

`server.js` linha 1051-1057:
```javascript
await emailTransporter.sendMail({
  from,
  to: email,
  subject,
  text: message,
  ...(html ? { html } : {}),
  ...(parsedAttachments.length > 0 ? { attachments: parsedAttachments } : {}),
});
```

O endpoint só usa `html` se o caller mandar explicitamente o campo `html`.
Quando o saas-erp manda `message: "<p>Olá</p><a href='...'>Cancelar</a>"`,
o nodemailer envia como text/plain → cliente vê tags literais.

### Fix aplicado no saas-erp (já está em produção)

O saas-erp agora manda **ambos** os campos:
- `message`: versão text-only (strip de tags)
- `html`: HTML completo com footer de descadastro

```typescript
body: JSON.stringify({
  appId, email, subject,
  message: textFallback,    // ← fallback plain text
  html: messageWithFooter,  // ← HTML rico
}),
```

### Mudança necessária no notification-server

**Nenhuma**. O código atual já aceita `html` opcional no body. Após o fix do
saas-erp, emails serão enviados como multipart (text + html) automaticamente.

---

## Gap 2 — Retornar `jobId` em envio imediato

### Estado atual

`server.js` linha 1061:
```javascript
res.json({ success: true });   // ← envio imediato
```

vs. agendado (linha 1036):
```javascript
return res.json({ success: true, scheduled: true, jobId, scheduledTime: brasiliaTime });
```

**Só envios agendados retornam `jobId`.** Imediatos retornam `{ success: true }`.

### Por que isso quebra o saas-erp

O saas-erp armazena o retorno como `externalMessageId` para correlacionar:
- Webhooks de bounce (notification-server → saas-erp)
- UI de tracking per-mensagem (BroadcastDetailDialog)
- Retry de mensagens falhas

Sem `jobId`, `externalMessageId` fica vazio. Bounce não consegue achar a mensagem original.

### Mudança necessária

Em `server.js`, gerar `jobId` único também para envio imediato:

```javascript
app.post('/api/send-email', internalApiKeyMiddleware, async (req, res) => {
  try {
    const { appId, tenantId, email, subject, message, html, scheduledTime, attachments } = req.body;
    // ... validações ...

    if (scheduledTime) {
      // ... fluxo agendado existente ...
    }

    // ENVIO IMEDIATO — gera jobId mesmo aqui
    const jobId = `email-${appId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const emailTransporter = await ensureSmtpLoaded(appId);
    if (!emailTransporter) {
      return res.status(503).json({ error: 'Email not configured for this app' });
    }

    const from = emailTransporter._smtpFrom || emailTransporter.options?.auth?.user;
    // ...

    broadcastToApp(appId, { type: 'activity', active: true, channel: 'email', appId });
    const sendResult = await emailTransporter.sendMail({
      from,
      to: email,
      subject,
      text: message,
      ...(html ? { html } : {}),
      ...(parsedAttachments.length > 0 ? { attachments: parsedAttachments } : {}),
      // Inclui o jobId no header customizado para correlação no DSN/bounce
      headers: { 'X-Job-Id': jobId },
    });
    broadcastToApp(appId, { type: 'activity', active: false, channel: 'email', appId });
    broadcastLog('info', `[${label}][Email] Enviado -> ${email} (jobId=${jobId})`, appId);

    // ⬇ MUDANÇA — retorna jobId
    res.json({
      success: true,
      jobId,
      messageId: sendResult.messageId, // <-- Message-ID do SMTP, útil pra DSN
    });
  } catch (err) {
    // ...
  }
});
```

**Aplicar o mesmo padrão em `/api/send-whatsapp` e `/api/send-bulk`.**

Para WhatsApp, o `messageId` vem do retorno do Baileys (`sock.sendMessage()`)
no campo `key.id`.

---

## Gap 3 — Webhook de bounce (item 5.3 do roadmap)

### Estado atual

Não existe lógica de bounce reporting. Quando email falha, o nodemailer:
- **Lança erro síncrono** → endpoint retorna 500 (saas-erp marca `failed`)
- **Aceita SMTP mas falha async** (mailbox cheia, hostname inválido, etc.) →
  notification-server não tem visibilidade. Email some.

### Contrato esperado pelo saas-erp

Endpoint `POST /api/webhooks/email-bounce` no saas-erp:
- URL: `${SAAS_ERP_URL}/api/webhooks/email-bounce`
- Auth: header `x-signature: <HMAC-SHA256(rawBody, apiKey) em hex>`
- Body:
  ```json
  {
    "businessId": "<o tenant — equivalente ao appId no notification-server>",
    "externalMessageId": "<o jobId retornado em /api/send-email>",
    "recipientEmail": "destino@example.com",
    "errorReason": "550 5.1.1 user unknown",
    "bouncedAt": "2026-04-30T14:23:11.000Z",
    "bounceType": "hard"
  }
  ```
- Respostas:
  - `200` — bounce processado, `BroadcastMessage` marcado como `failed`
  - `401` — assinatura inválida
  - `404` — mensagem não encontrada (aceitar como OK, não retentar)
  - `5xx` — erro interno do saas-erp (retentar com backoff)

### Mudança necessária no notification-server

#### A) Variáveis de ambiente novas

Adicionar em `.env.example` e `.env`:

```bash
# URL do saas-erp para webhooks de callback (bounce, delivery)
# Ex: https://aevo.tensorroot.com  (sem barra final)
SAAS_ERP_URL=

# Secret HMAC para assinar webhooks. Pode ser igual à INTERNAL_API_KEY
# (mais simples) ou separado. saas-erp usa a apiKey salva em
# business.settings.notificationServer.apiKey como secret HMAC — então
# DEVE BATER com o que o tenant configurou no saas-erp.
SAAS_ERP_WEBHOOK_SECRET=
```

> **Nota arquitetural:** hoje todos os businesses do saas-erp salvam a mesma
> `INTERNAL_API_KEY` em `business.settings.notificationServer.apiKey`. Então
> `SAAS_ERP_WEBHOOK_SECRET` pode ser **igual** a `INTERNAL_API_KEY` — saas-erp
> espera que o secret HMAC seja a mesma apiKey usada na autenticação `x-api-key`.
> Se algum dia migrar para apiKey por tenant, precisa diferenciar.

#### B) Helper de envio de bounce

Criar função no `server.js` (próximo aos outros helpers):

```javascript
// ── Bounce reporting → saas-erp webhook ───────────────
async function reportEmailBounce({
  appId,
  externalMessageId,
  recipientEmail,
  errorReason,
  bounceType = 'hard',
}) {
  const saasErpUrl = process.env.SAAS_ERP_URL;
  const webhookSecret = process.env.SAAS_ERP_WEBHOOK_SECRET || INTERNAL_API_KEY;

  if (!saasErpUrl || !webhookSecret) {
    console.warn('[Bounce] SAAS_ERP_URL ou SAAS_ERP_WEBHOOK_SECRET ausente — bounce não reportado');
    return;
  }

  const body = JSON.stringify({
    businessId: appId,           // appId == businessId no saas-erp
    externalMessageId,
    recipientEmail,
    errorReason,
    bouncedAt: new Date().toISOString(),
    bounceType,
  });

  const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

  // Retry com backoff exponencial: 3 tentativas, 1s/2s/4s
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${saasErpUrl}/api/webhooks/email-bounce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature': signature,
        },
        body,
      });
      if (res.ok) {
        console.log(`[Bounce] Reportado para saas-erp: ${recipientEmail} (jobId=${externalMessageId})`);
        return;
      }
      if (res.status === 404) {
        // Mensagem não encontrada — aceito (resume/retry deletou). Não retentar.
        console.log(`[Bounce] saas-erp 404 (mensagem deletada) — ${externalMessageId}`);
        return;
      }
      if (res.status === 401) {
        console.error('[Bounce] saas-erp 401 — verifique SAAS_ERP_WEBHOOK_SECRET');
        return; // Não retentar — config errada
      }
      // 5xx → retry
      console.warn(`[Bounce] saas-erp ${res.status} — tentativa ${attempt + 1}/3`);
    } catch (err) {
      console.warn(`[Bounce] Erro de rede (tentativa ${attempt + 1}/3):`, err.message);
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
  console.error(`[Bounce] Falha definitiva ao reportar bounce de ${recipientEmail}`);
}
```

#### C) Detectar bounces síncronos (erro do nodemailer)

No catch do `/api/send-email` (linha 1062), reportar imediatamente:

```javascript
app.post('/api/send-email', internalApiKeyMiddleware, async (req, res) => {
  const { appId, tenantId, email, subject, message, html, scheduledTime, attachments } = req.body;
  const jobId = `email-${appId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  try {
    // ... fluxo de envio existente, retornando { success: true, jobId } ...
  } catch (err) {
    broadcastToApp(appId, { type: 'activity', active: false, channel: 'email', appId });
    broadcastLog('error', `[Email] Erro ao enviar para ${email}: ${err.message}`);

    // ⬇ NOVO — classifica e reporta bounce síncrono
    const errorMsg = err.message || String(err);
    const isHardBounce = /5\d{2}\b|user unknown|invalid recipient|no such user|mailbox.*not found/i.test(errorMsg);
    const isSoftBounce = /4\d{2}\b|mailbox full|temporarily/i.test(errorMsg);
    const bounceType = isHardBounce ? 'hard' : isSoftBounce ? 'soft' : 'block';

    // Best-effort — não bloqueia a resposta HTTP ao saas-erp
    reportEmailBounce({
      appId,
      externalMessageId: jobId,
      recipientEmail: email,
      errorReason: errorMsg,
      bounceType,
    }).catch(reportErr =>
      console.error('[Bounce] reportEmailBounce falhou:', reportErr.message)
    );

    res.status(500).json({ error: errorMsg, jobId });
  }
});
```

> **Importante:** o `reportEmailBounce` roda em background (sem `await`) para
> não atrasar a resposta HTTP ao saas-erp. Se o saas-erp já recebeu 5xx, ele
> já marca como `failed` localmente — o webhook de bounce só refina o motivo
> e atualiza o tipo de bounce.

#### D) (Opcional, parking-lot) Detectar bounces async via DSN

SMTPs entregam ao MTA mas o servidor de destino pode rejeitar **depois** —
gerando uma DSN (Delivery Status Notification) de volta ao remetente.
Para capturar isso:

1. IMAP cliente conectando à mailbox `SMTP_USER`
2. Pollar inbox a cada 5 min, parsear DSNs (multipart/report; report-type=delivery-status)
3. Extrair Message-ID original (do header `In-Reply-To` ou `Message-ID` do report)
4. Mapear de volta ao `jobId` armazenado no header `X-Job-Id` (gravado no envio)
5. Chamar `reportEmailBounce`

Isso requer **estado persistente** (último UID processado por mailbox) e biblioteca
IMAP (`imap` ou `node-imap`). É feature significativa, ~4-6h de trabalho.

**Para MVP, bounce síncrono cobre 80% dos casos** — recomendo postergar DSN.

---

## Gap 4 — apiKey global vs per-tenant (informativo)

### Como está hoje

- `INTERNAL_API_KEY`: secret único do notification-server, em `.env`
- Todos os tenants do saas-erp salvam **a mesma** key em `business.settings.notificationServer.apiKey`
- Auth funciona, mas se a key vazar, vaza pra todos os tenants

### Quando virar problema

Se algum dia o notification-server for **shared** entre múltiplos saas-erp's
(serviço público), precisa de apiKey por tenant + tabela de apiKeys revogáveis.

### Não fazer agora

Mudança grande, sem retorno imediato. Documentado para futuro.

---

## Checklist de aplicação no notification-server

Em ordem de prioridade:

- [x] **Gap 2.A** — Em `/api/send-email`: gera `jobId` em envio imediato e
      retorna `{ success: true, jobId, messageId }`. ✅
- [ ] **Gap 2.B** — Mesmo tratamento em `/api/send-whatsapp`. **Skip** —
      saas-erp usa Baileys nativo, esse endpoint só serve painel admin.
- [ ] **Gap 2.C** — `/api/send-bulk` retornar jobIds. **Skip** — saas-erp
      itera `/api/send-email` individualmente (controle de pause/throttle).
- [x] **Gap 3.A** — Adicionar `SAAS_ERP_URL` e `SAAS_ERP_WEBHOOK_SECRET` em
      `.env.example`. ✅ — falta atualizar `.env` de produção (ação manual).
- [x] **Gap 3.B** — Implementar `reportEmailBounce()` helper + classifyEmailError(). ✅
- [x] **Gap 3.C** — Hook de bounce síncrono no catch do `/api/send-email`. ✅
- [ ] **Gap 3.D** — (parking lot) DSN parsing async via IMAP.
- [ ] **Atualizar `README.md`** documentando novo `jobId` e `SAAS_ERP_URL`.

### ⚠️ Ação manual necessária em produção

No servidor onde rodam os containers do notification-server:

```bash
# 1. Edite o .env de produção
cd /caminho/para/notification-server
nano .env

# 2. Adicione (no final do arquivo):
SAAS_ERP_URL=https://aevo.tensorroot.com
SAAS_ERP_WEBHOOK_SECRET=          # vazio = usa INTERNAL_API_KEY (recomendado)

# 3. Pull do código + restart:
git pull
docker compose up -d --build
```

Sem essas vars, o servidor continua funcionando — só não reporta bounces.

---

## Variáveis de ambiente — quadro completo

### saas-erp (`.env.local`)

Já configuradas neste commit:
```bash
NEXT_PUBLIC_APP_URL=https://aevo.tensorroot.com   # base do link de descadastro
CRON_SECRET=<hex>                                  # cron de scheduled broadcasts
UNSUBSCRIBE_SECRET=<hex>                           # ← FALTA — gerar com openssl rand -hex 32
```

### notification-server (`.env`)

Já existentes:
```bash
PORT=3001
SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
API_KEY            # auth do painel admin
INTERNAL_API_KEY   # auth dos endpoints de envio (saas-erp manda como x-api-key)
FIREBASE_*         # para persistir SMTP per-tenant
```

A adicionar (Gap 3):
```bash
# URL do saas-erp para callback de bounce
SAAS_ERP_URL=https://aevo.tensorroot.com

# Secret HMAC para assinar webhooks. Pode ser igual à INTERNAL_API_KEY.
SAAS_ERP_WEBHOOK_SECRET=
```

### Configuração no saas-erp (UI per-business)

Em `Configurações → Enterprise → Notification Server`, cada business preenche:
- **URL do servidor** → ex: `https://notify.tensorroot.com`
- **API Key** → o `INTERNAL_API_KEY` do notification-server
- **AppId** (opcional) → default = businessId

Salvo em `businesses/{id}.settings.notificationServer.{url, apiKey, appId}`.
A apiKey é encriptada no Firestore (AES-256-GCM via `encryptToken`).

---

## Fluxo end-to-end após migração

1. **Admin do saas-erp** configura notification-server (url + apiKey) em Settings
2. **Operador** cria broadcast email no CRM
3. **`/api/broadcasts/send`** monta payload com `html` (footer de descadastro injetado)
   e `message` (text fallback) → POST para `${notification_server_url}/api/send-email`
4. **Notification-server** recebe, gera `jobId`, envia via nodemailer (multipart),
   retorna `{ success: true, jobId }`
5. **`/api/broadcasts/send`** salva `externalMessageId = jobId` no `BroadcastMessage`
6. Se nodemailer falha síncrono (5xx SMTP):
   - Notification-server retorna 500 com `{ error, jobId }`
   - Saas-erp marca BroadcastMessage como `failed`
   - Notification-server (em background) chama `/api/webhooks/email-bounce`
     com HMAC, refinando `bounceType` e `errorReason`
7. **Cliente recebe** email com link `${NEXT_PUBLIC_APP_URL}/unsubscribe?token=xxx`
8. **Cliente clica** no link → page `/unsubscribe` valida token → POST grava
   em `marketingOptOuts/`
9. **Próximas campanhas** filtram esse email automaticamente antes do loop de envio
