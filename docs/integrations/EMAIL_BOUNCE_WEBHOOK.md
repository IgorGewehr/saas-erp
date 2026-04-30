# Email Bounce Webhook — Contrato com Notification Server

> Endpoint do **saas-erp** que recebe notificações de bounce do **notification-server**
> quando emails de broadcast falham downstream (rejeitados pelo SMTP do destinatário,
> hard bounce, caixa cheia, lista de bloqueio, etc.).

## Endpoint

```
POST /api/webhooks/email-bounce
```

URL completa: `https://{saas-erp-host}/api/webhooks/email-bounce`

## Autenticação

HMAC-SHA256 do body request usando a **apiKey do notification-server** como segredo.

A apiKey é a mesma que o saas-erp armazenou criptografada em
`businesses/{businessId}.settings.notificationServer.apiKey` no Firestore.
O notification-server tem essa key em sua própria configuração.

### Como assinar (no notification-server):

```javascript
const crypto = require('crypto');
const body = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', API_KEY).update(body).digest('hex');

await fetch(`${SAAS_ERP_URL}/api/webhooks/email-bounce`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-signature': signature,
  },
  body,
});
```

## Body schema

```typescript
{
  businessId: string;          // tenant — usa pra validar HMAC e encontrar a mensagem
  externalMessageId: string;   // jobId que o /api/send-email retornou no envio original
  recipientEmail: string;      // email que falhou
  errorReason: string;         // mensagem do servidor SMTP/provider (ex: "550 5.1.1 user unknown")
  bouncedAt?: string;          // ISO 8601, default: timestamp atual no servidor
  bounceType?: 'hard' | 'soft' | 'block' | 'unsubscribe';  // default: 'hard'
}
```

## Respostas

| Status | Significado | Ação do notification-server |
|--------|-------------|------------------------------|
| `200`  | Bounce processado com sucesso | OK, marcar como entregue |
| `401`  | Assinatura HMAC inválida | Erro de configuração — verificar apiKey |
| `404`  | BroadcastMessage não encontrado | Aceitar — mensagem foi deletada (resume/retry) |
| `422`  | Body inválido (campos obrigatórios faltando) | Não retentar — bug no payload |
| `500`  | Erro interno do saas-erp | Pode retentar com backoff |

## Comportamento

Quando o webhook é processado com sucesso:

1. **`broadcastMessages/{id}`** é atualizado:
   - `status: 'failed'`
   - `errorMessage: 'Bounce (hard): {errorReason}'`
   - `bouncedAt: {bouncedAt}`

2. **`broadcasts/{id}.stats`** é atualizado:
   - `failed` incrementa em 1
   - Se a mensagem estava `'sent'` antes, `sent` decrementa
   - Se estava `'delivered'` antes (raro pra bounce), `delivered` decrementa

3. **Idempotência**: se a mensagem já estava com status `'failed'`, retorna 200 com `idempotent: true` sem reprocessar.

## Quando o notification-server deve enviar

**Hard bounces** (delivery permanently failed):
- SMTP 5.x.x respostas (550 user unknown, 553 mailbox not found, etc.)
- Domínio inexistente (NXDOMAIN no MX)
- Email syntax error rejeitado pelo MTA

**Soft bounces** (recommend só após N tentativas):
- 4.x.x temporários (caixa cheia, deferred)
- Apenas após o notification-server desistir de retentar

**Block / Unsubscribe**:
- Provider marcou como spam
- Lista de unsubscribe interna

**NÃO enviar para**:
- Emails que retornaram 250 OK no SMTP (entregues)
- Erros transientes que ainda vão retentar

## Exemplo curl

```bash
PAYLOAD='{"businessId":"abc123","externalMessageId":"job_xyz","recipientEmail":"invalid@example.com","errorReason":"550 5.1.1 user unknown","bounceType":"hard"}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "API_KEY_HERE" | awk '{print $2}')

curl -X POST https://saas-erp.example.com/api/webhooks/email-bounce \
  -H "Content-Type: application/json" \
  -H "x-signature: $SIG" \
  -d "$PAYLOAD"
```

## Implementação no notification-server (sugerida)

O notification-server precisa monitorar bounces de duas formas:

1. **Sync** (já implementado parcialmente): se o `transporter.sendMail()` rejeita
   imediatamente com 5xx, a resposta da call POST `/api/send-email` já é 5xx —
   saas-erp já trata como `'failed'` no fluxo normal. **Não precisa de webhook**.

2. **Async** (este webhook é necessário): se SMTP aceitou 250 OK mas depois o
   destinatário gerou um DSN (Delivery Status Notification) por bounce. O
   notification-server precisa:
   - Configurar uma caixa `bounces@{domain}` que recebe os DSN
   - Parser de DSN extrai o `recipientEmail` e `errorReason`
   - Para encontrar o `externalMessageId`, usar header customizado no envio
     original (ex: `X-Notification-Job-Id: {jobId}`) que é refletido no DSN
   - Quando bounce parseado, chama este webhook

Alternativa: usar serviço de email (SendGrid, Postmark, Mailgun) que já fornece
webhooks de bounce nativos — notification-server só precisa adaptar o formato
do provider para nosso schema acima.
