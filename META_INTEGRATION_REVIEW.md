# Meta Integration — End-to-End Review & Fix Plan

> Revisao completa realizada em 2026-03-17.
> Este documento serve como referencia para todas as correcoes necessarias.

---

## 1. EMBEDDED SIGNUP (`/api/channels/meta-signup/route.ts`)

### 1.1 Sem autenticacao no endpoint (CRITICO)
- **Problema**: Qualquer pessoa pode POST com qualquer `businessId` e injetar credenciais
- **Localizacao**: Lines 18-35
- **Fix**: Adicionar verificacao Firebase Admin SDK do token Bearer + validar que o user pertence ao businessId e tem role admin/founder

### 1.2 Tokens retornados ao frontend em base64 (CRITICO)
- **Problema**: `Buffer.from(accessToken).toString('base64')` — visivel no Network tab, decodificavel no console
- **Localizacao**: Lines 155, 166
- **Fix**: Salvar tokens criptografados diretamente no Firestore via server-side. NAO retornar tokens ao frontend. Retornar apenas `{ success: true, channels: { whatsapp: { isConnected, displayPhoneNumber, ... } } }` sem tokens.

### 1.3 Sem validacao de escopos (MEDIO)
- **Problema**: Se usuario nega permissoes no FB.login(), falha silenciosa
- **Localizacao**: Lines 67-79
- **Fix**: Verificar que `granularScopes` contem todos os escopos necessarios antes de prosseguir

### 1.4 Sem error handling no debug_token e Graph API calls (MEDIO)
- **Problema**: Nao checa `debugRes.ok`, nao valida `debugData.data`
- **Localizacao**: Lines 61-64, 116-144
- **Fix**: Adicionar `if (!res.ok)` checks e validar estrutura de resposta

### 1.5 Webhook subscription nao verifica response (MEDIO)
- **Problema**: `fetch(subscribed_apps)` ignora erro
- **Localizacao**: Lines 101-109
- **Fix**: Checar `response.ok` e retornar warning ao frontend se falhar

### 1.6 Sempre pega primeiro numero/pagina (BAIXO)
- **Problema**: Ignora multiplos phone numbers ou pages
- **Fix**: Por ora aceitavel — futuro: UI de selecao

---

## 2. WEBHOOK HANDLER (`/api/webhooks/meta/route.ts`)

### 2.1 Sem deduplicacao de mensagens (CRITICO)
- **Problema**: Meta reenvia webhooks; `addDoc` cria duplicatas
- **Localizacao**: Lines 458-471
- **Fix**: Antes de `addDoc`, query `where('externalMessageId', '==', params.messageId)` + `where('businessId', '==', businessId)`. Se existe, skip.

### 2.2 `updateMessageStatus` sem filtro `businessId` (CRITICO)
- **Problema**: Query so filtra por `externalMessageId` — pode atualizar msg de outro tenant
- **Localizacao**: Lines 494-498
- **Fix**: Adicionar `where('businessId', '==', businessId)` na query. Requer passar `businessId` para a funcao.

### 2.3 Mensagens dropadas quando businessId nao resolvido (CRITICO)
- **Problema**: `resolveBusinessId` retorna null → mensagem silenciosamente perdida
- **Localizacao**: Lines 395-405
- **Fix**: Salvar em colecao `webhookFailures` como dead-letter queue para debug

### 2.4 Facebook read receipts nao implementados (CRITICO)
- **Problema**: Watermark logado mas nao persistido — mensagens FB nunca marcadas como lidas
- **Localizacao**: Lines 281-287
- **Fix**: Query mensagens outbound do conversation com `sentAt <= watermark` e `status !== 'read'`, atualizar para 'read'

### 2.5 Instagram delivery + read receipts ignorados (CRITICO)
- **Problema**: `if (event.delivery || event.read) continue;`
- **Localizacao**: Line 311
- **Fix**: Implementar handling similar ao WhatsApp/Facebook para delivery e read

### 2.6 Signature verification desabilitada em dev (ALTO)
- **Problema**: `if (process.env.NODE_ENV === 'production')` — dev nao verifica
- **Localizacao**: Lines 175-181
- **Fix**: Sempre verificar signature. Se precisar testar sem Meta real, usar endpoint separado.

### 2.7 Sem rate limiting (MEDIO)
- **Problema**: Endpoint pode ser spammado
- **Fix**: Considerar rate limit por IP (futuro)

---

## 3. ENVIO DE MENSAGENS

### 3.1 read-receipt e typing usam `atob()` em vez de `decryptToken()` (CRITICO)
- **Problema**: `atob()` nao decripta AES-GCM — vai falhar com tokens criptografados
- **Localizacao**:
  - `app/api/conversations/read-receipt/route.ts` lines 88, 113, 137
  - `app/api/conversations/typing/route.ts` lines 88, 109
- **Fix**: Substituir todos `atob()` por `await decryptToken()`, importar de `@/lib/utils/encryption`

### 3.2 Auth do servidor usa client SDK (ALTO)
- **Problema**: `getAuth().currentUser` = sempre null em server context (API route)
- **Localizacao**: `app/api/conversations/send/route.ts` lines 85-108
- **Fix**: Usar Firebase Admin SDK para `auth.verifyIdToken(token)`

### 3.3 Sem validacao de ownership (ALTO)
- **Problema**: User de business A poderia enviar pelo business B
- **Fix**: Apos verificar token, buscar `users/{uid}.businessId` e comparar com `businessId` do request

### 3.4 Fire-and-forget sem fallback (MEDIO)
- **Problema**: Frontend nao atualiza status para 'failed' se API falhar
- **Localizacao**: `ConversasModule.tsx` lines 1728-1749
- **Fix**: Checar response status e atualizar mensagem para 'failed' se erro

---

## 4. BROADCASTS (`/api/broadcasts/send/route.ts`)

### 4.1 Token decodificado com Buffer.from em vez de decryptToken (ALTO)
- **Problema**: `Buffer.from(accessToken, 'base64').toString()` — inconsistente com encryption
- **Localizacao**: Line 53
- **Fix**: Usar `await decryptToken(accessToken)` ou buscar token server-side do Firestore

### 4.2 Sem Firestore rules para broadcasts (ALTO)
- **Problema**: Colecoes `broadcasts` e `broadcastMessages` sem restricao
- **Fix**: Adicionar regras em `firestore.rules`

### 4.3 Broadcast stats nao atualizados apos envio (MEDIO)
- **Problema**: Send API retorna resultados mas nao atualiza `broadcasts/{id}.stats`
- **Fix**: Apos loop de envio, atualizar stats e status do broadcast

---

## 5. TIPOS (`lib/types/index.ts`)

### 5.1 FacebookChannelConfig falta `pageName` (MEDIO)
- **Problema**: Embedded Signup retorna `pageName` mas tipo nao inclui
- **Fix**: Adicionar campos opcionais: `pageName?`, `displayPhoneNumber?` ao WhatsApp, `accountName?` ao Instagram

### 5.2 ChannelConfig no SettingsModule inconsistente com types centrais (MEDIO)
- **Problema**: `ChannelConfig` redefinido localmente no SettingsModule com campos diferentes
- **Fix**: Usar `ChannelCredentials` de `lib/types/index.ts`

---

## 6. FRONTEND (ConversasModule)

### 6.1 Sem paginacao de mensagens (ALTO — performance)
- **Problema**: Todas as mensagens carregadas via onSnapshot sem limit
- **Fix**: Futuro — adicionar `limit()` + load more

### 6.2 Sem link com CRM contacts (MEDIO — feature gap)
- **Problema**: Conversas nao vinculadas a crmContacts
- **Fix**: Futuro — lookup por channelIdentities

---

## Mapa de Dependencias entre Fixes

```
Firebase Admin SDK setup ──► Auth em meta-signup
                          ──► Auth em conversations/send
                          ──► Auth em broadcasts/send

Token encryption fix ──► read-receipt atob→decryptToken
                     ──► typing atob→decryptToken
                     ──► meta-signup: salvar encrypted server-side
                     ──► broadcasts: usar decryptToken

Webhook handler fixes (independentes entre si):
  ├── Deduplicacao
  ├── businessId no updateMessageStatus
  ├── Dead-letter queue
  ├── Facebook read receipts
  ├── Instagram delivery/read receipts
  └── Remover dev bypass de signature

Types update (deve ser feito ANTES dos outros):
  └── Atualizar ChannelConfig types
```

---

## Ordem de Execucao Recomendada

### Wave 1 (Paralelo — sem dependencias)
- **A**: Atualizar types em `lib/types/index.ts` (FacebookChannelConfig, etc.)
- **B**: Fixes no webhook handler (dedup, businessId, dead-letter, receipts, signature)
- **C**: Fix `atob()` → `decryptToken()` em read-receipt e typing

### Wave 2 (Paralelo — apos Wave 1)
- **D**: Firebase Admin SDK + auth no meta-signup + conversations/send
- **E**: Meta-signup: nao retornar tokens, salvar server-side encrypted
- **F**: Firestore rules para broadcasts/broadcastMessages
- **G**: Broadcast send: usar decryptToken, atualizar stats

### Wave 3 (Concluido 2026-03-17)
- ~~Paginacao de mensagens~~ DONE — `ConversasModule.tsx`: limit(50) + load more + scroll preservation
- ~~Link CRM contacts~~ DONE — `webhooks/meta/route.ts`: auto-link por channelIdentities e phone
- ~~Rate limiting~~ DONE — `lib/utils/rateLimit.ts` + aplicado em webhook (200/min), send (30/min), read-receipt (60/min), typing (60/min), broadcasts (5/min)
- UI de selecao de multiplos numeros/paginas — FUTURO

### Status Final
Todas as waves (1, 2 e 3) concluidas. Todos os builds passando sem erros.
