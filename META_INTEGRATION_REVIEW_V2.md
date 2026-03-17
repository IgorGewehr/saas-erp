# Meta Integration — Review V2 (Post-Fix Audit)

> Auditoria realizada em 2026-03-17 contra documentacao oficial da Meta, repos de referencia (Chatwoot), e revisao profunda de codigo.

---

## Status das Correcoes Anteriores (Waves 1-3)

| Fix | Status |
|-----|--------|
| Deduplicacao de mensagens no webhook | DONE (porem posicao incorreta — ver issue #1) |
| businessId no updateMessageStatus | DONE |
| Dead-letter queue | DONE |
| Facebook/Instagram read receipts | DONE |
| Signature verification sem bypass dev | DONE |
| atob → decryptToken em read-receipt/typing | DONE |
| Auth + tokens server-side no meta-signup | DONE |
| Firestore rules broadcasts/broadcastMessages | DONE |
| Broadcast stats update | DONE |
| Rate limiting em todos os endpoints | DONE |
| Paginacao de mensagens | DONE |
| CRM auto-link no webhook | DONE |
| Types atualizados (pageName, displayPhoneNumber, etc.) | DONE |

---

## Novos Issues Encontrados — Priorizados

### ARQUITETURAIS (Fundacionais — afetam tudo)

#### A1. Firebase Admin SDK ausente (CRITICO)
- **Problema**: Todas as API routes usam Firebase Client SDK. `getAuth().currentUser` e sempre null no server. Auth e efetivamente um no-op.
- **Impacto**: Qualquer request com `Bearer qualquer-coisa` passa autenticacao
- **Afeta**: send, read-receipt, typing, meta-signup, broadcasts
- **Fix**: Instalar `firebase-admin`, inicializar com service account, usar `admin.auth().verifyIdToken(token)` em todas as routes

#### A2. Encryption key hardcoded + exposta no client (CRITICO)
- **Problema**: Fallback para `'sp-default-key-change-in-prod-32ch'` se env var nao setada. `NEXT_PUBLIC_ENCRYPTION_KEY` expoe key no browser bundle
- **Impacto**: Qualquer usuario pode decriptar tokens do Firestore
- **Fix**: Remover fallback hardcoded (throw error), remover `NEXT_PUBLIC_` prefix, encriptacao somente server-side

#### A3. Channel credentials acessiveis a todos os membros (CRITICO)
- **Problema**: Firestore rule permite read de `businesses/{id}` para qualquer membro (incluindo viewer/operator). Documento inclui accessToken encriptado.
- **Combinado com A2**: Viewer pode ler token + decriptar = acesso total ao WhatsApp/FB/IG da empresa
- **Fix**: Mover credentials para subcollection `businesses/{id}/channelCredentials/{channel}` com rule admin-only, OU buscar tokens somente server-side

#### A4. Webhook handler usa Client SDK sem auth context (CRITICO)
- **Problema**: Webhook roda sem usuario autenticado. Firestore rules que checam `isAuthenticated()` deveriam bloquear writes do webhook
- **Por que funciona**: Provavelmente rules ainda nao estao deployed em producao, ou projeto esta em test mode
- **Fix**: Migrar webhook para `firebase-admin` SDK que bypassa rules

#### A5. Nao existe verificacao de ownership do businessId (ALTO)
- **Problema**: Routes aceitam `businessId` do request body sem verificar que o usuario pertence aquele business
- **Fix**: Apos verificar token (A1), buscar `users/{uid}.businessId` e comparar

---

### INSTAGRAM (Implementacao Potencialmente Incorreta)

#### I1. Endpoint incorreto para Instagram DM (CRITICO — verificar)
- **Docs oficiais recentes**: Instagram Messaging API usa `graph.instagram.com/<IG_ID>/messages` (nao `graph.facebook.com/me/messages`)
- **Nosso codigo**: Usa `graph.facebook.com/v21.0/me/messages` com pageAccessToken
- **NOTA**: Isso pode funcionar para contas conectadas via Facebook Page (legacy), mas a API oficial do Instagram e diferente
- **Verificacao necessaria**: Testar se o envio via `graph.facebook.com/me/messages` realmente funciona para Instagram DM. Se sim, e um alias valido. Se nao, precisa corrigir.

#### I2. Instagram pode requerer token diferente
- **Docs**: Instagram API pode requerer Instagram User Access Token em vez de Page Access Token
- **NOTA**: Depende de como a conta foi conectada (via Embedded Signup, o page token pode funcionar)
- **Acao**: Testar em producao

#### I3. Instagram tem limite de 1000 bytes UTF-8 por mensagem
- **Nosso codigo**: Nao valida tamanho
- **Fix**: Adicionar validacao antes de enviar

---

### TOKEN LIFECYCLE (Disponibilidade)

#### T1. Token nao trocado por long-lived (CRITICO)
- **Problema**: Code exchange retorna short-lived token (~1h). Codigo nao troca por long-lived (60 dias) nem System User token (permanente)
- **Impacto**: Apos ~1h do signup, TODOS os envios param de funcionar
- **Fix no meta-signup**: Apos obter access_token, chamar `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token={token}` para obter long-lived token

#### T2. Sem mecanismo de refresh de tokens
- **Problema**: Nenhum cron/job verifica expiracao. Quando token expira, tudo para silenciosamente
- **Fix**: Implementar check pre-envio (`if tokenExpiresAt && Date.now() > tokenExpiresAt - 7d, alert admin`) + logica de refresh

#### T3. tokenExpiresAt setado como null
- **Problema**: Meta-signup define `tokenExpiresAt: null` (linha 199)
- **Fix**: Calcular baseado no tipo de token (1h short, 60d long-lived, null para System User)

---

### WEBHOOK HANDLER

#### W1. Deduplicacao acontece APOS update da conversa (ALTO)
- **Problema**: Ordem atual: update conversation (incrementa unreadCount) → check duplicata → save message. Se duplicata, unreadCount ja foi incrementado
- **Fix**: Mover check de duplicata ANTES do update da conversa

#### W2. Rate limit retorna 429 ao Meta (ALTO)
- **Problema**: Meta espera SEMPRE 200 OK. Se recebe 429, faz retry e eventualmente desabilita webhook
- **Fix**: Remover rate limit do webhook endpoint, ou retornar 200 mas pular processamento

#### W3. Sem download de media do WhatsApp (ALTO)
- **Problema**: Media messages (imagem, audio, video) salvam apenas `[Imagem]` como texto. Media URL do WhatsApp expira em 30 dias
- **Fix**: Chamar `GET /{media-id}` → download binario → upload Firebase Storage → salvar URL permanente

#### W4. Facebook/Instagram media inbound ignorada (ALTO)
- **Problema**: Handlers so processam `event.message.text`. Se usuario envia imagem/video/arquivo via FB ou IG, mensagem e dropada
- **Fix**: Checar `event.message.attachments` e extrair tipo/URL

#### W5. Postback events nao processados (MEDIO)
- **Problema**: Quando usuario clica botao em mensagem estruturada, evento de postback e ignorado

#### W6. WhatsApp reaction/button/context nao processados (MEDIO)
- **Problema**: Reactions (emoji), button clicks (quick replies), e reply context (quote) nao sao parseados

#### W7. Status `failed` nao salva error details (MEDIO)
- **Problema**: Quando mensagem falha, `errors[]` do webhook nao e salvo no documento. Impossivel debugar

#### W8. webhookFailures sem businessId e sem TTL (BAIXO)
- **Problema**: Dead-letter docs nao tem businessId nem limpeza automatica

---

### ENVIO DE MENSAGENS

#### S1. Missing `messaging_type` para Facebook (ALTO)
- **Problema**: Facebook requer `messaging_type: 'RESPONSE'` no payload. Sem ele, pode falhar ou ser recusado
- **Fix**: Adicionar `messaging_type: 'RESPONSE'` como default

#### S2. Missing `preview_url: true` para WhatsApp (MEDIO)
- **Problema**: URLs em mensagens de texto nao geram preview para o destinatario
- **Fix**: Adicionar `preview_url: true` no objeto text

#### S3. Sem tratamento de error codes especificos da Meta (ALTO)
- **Problema**: Todos os erros tratados igualmente. Nao distingue rate limit (130429, retry), 24h window (131047, usar template), token expirado (190, alertar admin), policy violation (368, parar envios)
- **Fix**: Parse `data.error.code` e retornar mensagem acionavel ao frontend

#### S4. Template params nao validados server-side (MEDIO)
- **Problema**: `templateParams` passados direto sem validar formato (components array)

#### S5. Broadcast usa `MESSAGE_TAG: CONFIRMED_EVENT_UPDATE` para marketing (CRITICO)
- **Problema**: Tag so valida para atualizacoes de eventos reais. Usar para marketing viola policies da Meta e pode resultar em ban do app
- **Fix**: Usar template messages para WhatsApp broadcasts. Para Facebook, usar Marketing Messages API ou remover

#### S6. Broadcast recebe accessToken do client (ALTO)
- **Problema**: Token encriptado enviado no body do request pelo frontend
- **Fix**: Buscar token server-side do Firestore pelo businessId

---

### ENCRYPTION

#### E1. Fallback silencioso para btoa() (CRITICO)
- **Problema**: Se Web Crypto falha, tokens sao salvos em base64 puro (reversivel trivialmente). Sem warning.
- **Fix**: Throw error em vez de fallback. Ou usar `crypto` do Node.js (sempre disponivel em API routes)

#### E2. Sem KDF (key derivation function) (MEDIO)
- **Problema**: Key e padded com zeros e usada diretamente. Deveria usar PBKDF2 ou HKDF
- **Fix**: `crypto.subtle.deriveKey()` com PBKDF2

---

### FIRESTORE RULES

#### F1. Collections sem rules: webhookFailures, sectors, snippets, segments (MEDIO)
- **Problema**: Caem no catch-all deny. Webhook nao consegue escrever em webhookFailures
- **Fix**: Adicionar rules ou migrar webhook para Admin SDK (A4)

#### F2. Sem check de unicidade de channel identifiers (MEDIO)
- **Problema**: Duas empresas poderiam registrar mesmo phoneNumberId. resolveBusinessId retornaria a primeira
- **Fix**: No meta-signup, verificar unicidade antes de salvar

---

## Prioridade de Correcao

### Wave 4 — Fundacional (Concluido 2026-03-17)
1. ~~**A1**: Firebase Admin SDK em todas as routes~~ DONE — `firebase-admin` instalado, `lib/config/firebaseAdmin.ts` + `lib/utils/verifyAuth.ts` criados, aplicado em send, read-receipt, typing, meta-signup, broadcasts
2. ~~**A2**: Fix encryption key (remover fallback, remover NEXT_PUBLIC_)~~ DONE — hardcoded key removido, throw error se ENCRYPTION_KEY ausente, migrado para Node.js crypto
3. ~~**T1**: Token exchange para long-lived no meta-signup~~ DONE — exchange para token 60 dias, tokenExpiresAt calculado
4. ~~**W1**: Mover deduplicacao antes do update de conversa~~ DONE — check de duplicata agora e step 2, antes de find/create conversation
5. ~~**W2**: Remover rate limit 429 do webhook (retornar 200 sempre)~~ DONE — retorna 200 com skip de processamento
6. ~~**S5**: Remover MESSAGE_TAG do broadcast Facebook~~ DONE — agora usa messaging_type: 'UPDATE'
7. ~~**E1**: Remover fallback btoa na encryption~~ DONE — fallback removido, throw error + legacy migration path com validacao
8. ~~**A5**: Verificacao de businessId ownership~~ DONE — verifyAuth valida user.businessId === request.businessId
9. ~~**S6**: Broadcast buscar token server-side~~ DONE — accessToken removido do body, buscado via adminDb

### Waves 5-7 — Seguranca + Funcionalidade + Polish (Concluido 2026-03-17)

**Seguranca:**
- ~~**F2**: Check unicidade de channel identifiers~~ DONE — meta-signup verifica se phoneNumberId/pageId/accountId ja esta em uso por outro business (retorna 409)
- ~~**F1**: Firestore rules para collections faltantes~~ DONE — webhookFailures, sectors, snippets, segments
- **A3**: Mover credentials para subcollection — DESNECESSARIO apos Wave 4 (ENCRYPTION_KEY nao e mais NEXT_PUBLIC_, tokens so decriptados server-side)

**Funcionalidade:**
- ~~**W3**: WhatsApp media handling~~ DONE — mediaId, mediaMimeType extraidos e salvos. extractMessageContent retorna ExtractedContent
- ~~**W4**: Facebook/Instagram media inbound~~ DONE — event.message.attachments processado com tipo e URL
- ~~**S1**: `messaging_type: 'RESPONSE'` para Facebook/Instagram~~ DONE
- ~~**S3**: Error codes especificos da Meta~~ DONE — handleMetaApiError com 130429, 131047, 131051, 131026, 190, 368, 10
- ~~**T2**: Token expiry pre-check~~ DONE — verifica tokenExpiresAt antes de enviar, warn 7 dias antes
- ~~**W6**: Reactions, buttons, reply context~~ DONE — reaction, button, interactive, context.id parseados
- ~~**W5**: Postback handling~~ DONE — Facebook e Instagram postbacks salvos como mensagens

**Polish:**
- ~~**S2**: `preview_url: true` para WhatsApp~~ DONE
- ~~**W7**: Error details no status failed~~ DONE — failedReason e failedCode salvos no documento
- ~~**S4**: Template params validation~~ DONE — valida templateName obrigatorio e templateParams array
- ~~Status regression guard~~ DONE — STATUS_ORDER previne regressao (ex: sent apos read)
- **I1/I2**: Verificar endpoint Instagram — PENDENTE (requer teste em producao)
- **I3**: Validacao tamanho Instagram — PENDENTE (menor prioridade)
- **E2**: KDF para encryption key — PENDENTE (menor prioridade)

---

## Status Final — Todas as Waves

| Wave | Status | Itens |
|------|--------|-------|
| Wave 1 | DONE | Types, webhook fixes, atob→decryptToken |
| Wave 2 | DONE | Auth meta-signup, tokens server-side, Firestore rules broadcasts, broadcast stats |
| Wave 3 | DONE | Paginacao mensagens, CRM auto-link, rate limiting |
| Wave 4 | DONE | Firebase Admin SDK, encryption fix, long-lived token, dedup fix, webhook 200, broadcast policy, businessId ownership |
| Waves 5-7 | DONE | Channel uniqueness, Firestore rules completas, media handling, error codes, token expiry, reactions/buttons/postback, preview_url, status regression guard |

### Pendentes (menor prioridade)
- I1/I2: Verificar se Instagram DM funciona via graph.facebook.com ou precisa graph.instagram.com (teste em producao)
- I3: Validacao de tamanho 1000 bytes para Instagram
- E2: KDF (PBKDF2/HKDF) para derivacao da encryption key
- A4: Migrar webhook handler para Firebase Admin SDK (Firestore writes)
- Download efetivo de media WhatsApp (GET /{media-id} → Firebase Storage) — atualmente salva mediaId para fetch posterior
