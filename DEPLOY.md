# Deploy — ServicePro em Docker + Cloudflare Tunnel

Dois stacks separados, cada um com seu próprio tunnel:

```
┌──────────────────────────────┐      ┌─────────────────────────────┐
│ servicepro-app-net (bridge)  │      │ servicepro-agent-net (bridge)│
│                              │      │                              │
│  ┌────────────────┐          │      │  ┌────────────────┐          │
│  │ Next.js (app)  │          │      │  │ Python agent   │          │
│  │ container :3000│          │      │  │ container :8080│          │
│  │ host  :8756    │          │      │  │ host  :8129    │          │
│  └────────────────┘          │      │  └────────────────┘          │
│         ▲                    │      │         ▲                    │
│         │                    │      │         │                    │
│  ┌──────┴────────┐           │      │  ┌──────┴────────┐           │
│  │ cloudflared   │           │      │  │ cloudflared   │           │
│  │ (tunnel #1)   │           │      │  │ (tunnel #2)   │           │
│  └───────────────┘           │      │  └───────────────┘           │
└──────────────────────────────┘      └──────────────────────────────┘
           │                                      │
           ▼ HTTPS                                ▼ HTTPS
  app.seudominio.com                    agent.seudominio.com
```

Cada stack tem seu token, sua rede Docker, e seu hostname público.
Zero exposição de porta no firewall do seu Windows server — o tunnel faz TLS e alcance externo.

---

## Pré-requisitos

No Windows server:
- **Docker Desktop** (usa WSL2 por baixo)
- Conta Cloudflare (free tier serve)
- Domínio na Cloudflare (pode ser subdomínio de domínio que você já tem)

No repositório clonado:
```
saas-erp/
├── Dockerfile              ← Next.js app
├── docker-compose.yml      ← Next.js stack (app + tunnel)
├── .dockerignore
├── .env                    ← você cria (copia do .env.example)
└── agent/
    ├── Dockerfile          ← Python agent
    ├── docker-compose.yml  ← Agent stack (agent + tunnel)
    ├── .dockerignore
    └── .env                ← você cria
```

---

## Passo 1 — Criar 2 tunnels na Cloudflare

1. Acesse [dash.cloudflare.com](https://dash.cloudflare.com) → **Zero Trust** → **Networks** → **Tunnels**
2. Crie o **primeiro tunnel**:
   - Name: `servicepro-app`
   - Copie o **token** (começa com `eyJhbGciOi...`)
3. Configure o Public Hostname dele:
   
   | Campo | Valor |
   |---|---|
   | Subdomain | `app` (ou o que preferir) |
   | Domain | `seudominio.com` |
   | Path | (deixe vazio) |
   | **Type** | **`HTTP`** |
   | **URL** | **`app:3000`** |
   
   > ⚠️ **IMPORTANTE**: Na URL NÃO é `localhost:3000` — é `app:3000` (o nome do serviço Docker). Quando o `cloudflared` sobe dentro do mesmo `docker-compose`, ele usa o DNS da rede Docker pra achar o container pelo nome `app`. Localhost dentro do container seria o próprio cloudflared, não o next.js.

4. Crie o **segundo tunnel**:
   - Name: `servicepro-agent`
   - Copie o **token** (diferente do primeiro)
5. Configure o Public Hostname:

   | Campo | Valor |
   |---|---|
   | Subdomain | `agent` (ou o que preferir) |
   | Domain | `seudominio.com` |
   | Path | (deixe vazio) |
   | **Type** | **`HTTP`** |
   | **URL** | **`agent:8080`** |
   
   > Mesma regra: `agent:8080` (nome do serviço Docker + porta interna). **NÃO** use `localhost:8129` — a porta 8129 é só no host, e de dentro do container do cloudflared ela não existe.

---

## Passo 2 — Preencher os `.env`

### `saas-erp/.env` (Next.js app)

```bash
# Firebase (NEXT_PUBLIC_* são expostas ao browser)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=service-provider-1cd0d
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Firebase Admin — escolha 1 dos 2 métodos:
# A) Service account em JSON file (montado via volume no compose)
#    Coloque o arquivo em saas-erp/firebase-admin-service-account.json
#    O compose já monta ele em /app/firebase-admin-service-account.json
# B) Service account em env var (JSON stringificado base64 ou direto)
# FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"..."}

# Agent — HMAC shared secret (MESMO valor no .env do agent)
AGENT_SHARED_SECRET=long-random-string-aqui-min-32-chars

# Agent — URL do agent exposto via Cloudflare
AGENT_SERVICE_URL=https://agent.seudominio.com

# Meta / WhatsApp Cloud API
NEXT_PUBLIC_META_APP_ID=...
META_APP_SECRET=...
META_CONFIG_ID=...

# Cron Secret (usado por Vercel Cron se migrar depois, opcional)
CRON_SECRET=outro-random-string

# Porta do app no host (default 8756)
APP_PORT=8756

# Token do tunnel da app (do Passo 1)
CLOUDFLARE_TUNNEL_TOKEN=eyJhbGciOi... (primeiro token — servicepro-app)
```

### `saas-erp/agent/.env` (Python agent)

```bash
# HMAC — MESMO valor do saas-erp/.env
AGENT_SHARED_SECRET=long-random-string-aqui-min-32-chars

# OpenAI
OPENAI_API_KEY=sk-...

# URL pública do Next.js (o agent chama rest endpoints nele)
NEXT_PUBLIC_API_BASE_URL=https://app.seudominio.com

# LangSmith
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_pt_...
LANGCHAIN_PROJECT=servicepro-prod
APP_ENV=production

# Server
HOST=0.0.0.0
PORT=8080
WORKERS=2
LOG_LEVEL=info

# Safety
AGENT_MAX_ITERATIONS=8
REDACT_PII_IN_TRACES=true

# Porta do agent no host (default 8129)
AGENT_PORT=8129

# Token do tunnel do agent (SEGUNDO token do Passo 1)
CLOUDFLARE_TUNNEL_TOKEN=eyJhbGciOi... (servicepro-agent — diferente do de cima)
```

> ⚠️ Cada `.env` tem **SEU PRÓPRIO** `CLOUDFLARE_TUNNEL_TOKEN`. São 2 tokens diferentes (1 por tunnel).

---

## Passo 3 — Build + run

```powershell
# Terminal 1 — Next.js app
cd C:\caminho\para\saas-erp
docker compose --profile tunnel up -d --build

# Verifica
docker compose ps
docker compose logs -f app

# Terminal 2 — Python agent
cd C:\caminho\para\saas-erp\agent
docker compose --profile tunnel up -d --build

# Verifica
docker compose ps
docker compose logs -f agent
```

Primeiros builds: ~5-10min cada (Next.js) e ~3-5min (agent) dependendo da sua internet. Builds subsequentes: ~30-60s (layers cacheadas).

---

## Passo 4 — Validar

```powershell
# Health local (opcional)
curl http://localhost:8756/       # Next.js
curl http://localhost:8129/health # Agent

# Health público (via tunnel — deve responder de fora também)
curl https://app.seudominio.com/
curl https://agent.seudominio.com/health
```

No dashboard Cloudflare, em Networks → Tunnels, os 2 tunnels devem estar com status **Healthy** (verde).

Acesse `https://app.seudominio.com` no browser → dashboard ServicePro deve carregar.

---

## Resumo dos valores a preencher no dashboard Cloudflare

Isso é o que você perguntou. Quando estiver criando o **Public Hostname** de cada tunnel:

### Tunnel `servicepro-app` (Next.js)

| Campo | Valor |
|---|---|
| Type | `HTTP` |
| URL | `app:3000` |

### Tunnel `servicepro-agent` (Python)

| Campo | Valor |
|---|---|
| Type | `HTTP` |
| URL | `agent:8080` |

> **Por que não `localhost`?** Porque o `cloudflared` está rodando em um container Docker — dentro dele, `localhost` é o próprio cloudflared, não o app. O Docker Compose cria DNS interno onde cada service é resolvível pelo nome (`app`, `agent`). A porta é a **porta INTERNA do container** (3000 pro Next.js, 8080 pro agent), NÃO a porta exposta no host (8756/8129).
>
> **Regra geral**: `<nome-do-service-compose>:<porta-interna>`

---

## Portas aleatórias — explicação

Eu já mapeei assim nos compose files:
- App: `"8756:3000"` → Next.js internamente ouve 3000, exposto no host como 8756
- Agent: `"8129:8080"` → Agent internamente ouve 8080, exposto no host como 8129

Se você quiser outros números ainda mais aleatórios, só muda em:
- `saas-erp/.env`: `APP_PORT=xxxxx`
- `saas-erp/agent/.env`: `AGENT_PORT=yyyyy`

Os valores dentro dos containers (`3000` e `8080`) NÃO precisam mudar — só o lado externo que você expõe no host.

---

## Comandos úteis

```powershell
# Ver status dos 2 stacks
cd saas-erp && docker compose ps
cd saas-erp\agent && docker compose ps

# Rebuild após mudança de código ou deps
docker compose build --no-cache

# Logs do tunnel
docker compose --profile tunnel logs -f cloudflared

# Derrubar tudo
cd saas-erp && docker compose --profile tunnel down
cd saas-erp\agent && docker compose --profile tunnel down

# Shell dentro de um container (debug)
docker compose exec app /bin/sh
docker compose exec agent /bin/sh
```

---

## Troubleshooting

**"Tunnel conectado mas 502/503 Bad Gateway":**
- URL do Public Hostname está errado (provavelmente com `localhost` em vez do service name)
- Container do app não está healthy ainda (espera ~40s no primeiro start)
- `docker compose logs app` pra ver se Next.js subiu

**"Agent retorna 401 Invalid signature":**
- `AGENT_SHARED_SECRET` diferente entre os 2 `.env`
- Confere que é o MESMO valor em `saas-erp/.env` e `saas-erp/agent/.env`

**"Can't access firebase-admin-service-account.json":**
- Arquivo não foi colocado em `saas-erp/firebase-admin-service-account.json`
- OU use `FIREBASE_SERVICE_ACCOUNT` env var (conteúdo do JSON como string)

**"whatsapp-sessions vazio após restart":**
- Esqueceu do volume `./whatsapp-sessions:/app/whatsapp-sessions`
- Cria a pasta `saas-erp/whatsapp-sessions/` se não existir

**Windows: "bind mount falha":**
- Docker Desktop precisa ter "File sharing" habilitado no drive do projeto
- Settings → Resources → File Sharing → adicionar `C:\`
