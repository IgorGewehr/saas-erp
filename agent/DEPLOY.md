# Deploy do Agent — Docker + Cloudflare Tunnel

Este serviço é um FastAPI Python — não roda em Vercel/Edge (ambientes só-JS).
A combinação recomendada é **Docker + Cloudflare Tunnel**: container corre
localmente ou em VPS, o tunnel expõe via HTTPS sem abrir portas no firewall.

## Arquitetura

```
┌──────────────┐         ┌─────────────────────┐       ┌──────────────┐
│   Next.js    │  HTTPS  │  Cloudflare Tunnel  │  HTTP │ Docker agent │
│  (Vercel)    │────────▶│  agent.exemplo.com  │──────▶│   :8080      │
└──────────────┘         └─────────────────────┘       └──────────────┘
                                                              │
                                                              ▼
                                                        ┌──────────┐
                                                        │ OpenAI / │
                                                        │ LangSmith│
                                                        └──────────┘
```

- Não precisa abrir porta 8080 no firewall.
- Tunnel já faz TLS + autenticação na borda da Cloudflare.
- Funciona atrás de NAT, CGN, qualquer ISP doméstico.

## Pré-requisitos

- Docker + Docker Compose v2
- Conta Cloudflare (free tier serve)
- `.env` preenchido no diretório `agent/` com todas as vars necessárias

## Arquivos

```
agent/
├── Dockerfile              — produção (multi-stage, non-root, healthcheck)
├── Dockerfile.dev          — hot-reload p/ desenvolvimento
├── docker-compose.yml      — stack principal (agent + cloudflared opcional)
├── docker-compose.dev.yml  — override com volume mount e --reload
├── .dockerignore
└── DEPLOY.md               — este arquivo
```

## Quick start — rodar local sem tunnel

```bash
cd agent

# 1. Preenche .env (copie do .env.example e ajuste)
cp .env.example .env

# 2. Build + up
docker compose up -d

# 3. Verifica
curl http://localhost:8080/health
# → {"status":"ok","service":"servicepro-agent"}

# Logs
docker compose logs -f agent
```

Nesse modo o Next.js local aponta pra `http://localhost:8080` como já faz.

## Dev com hot-reload

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Muda `main.py` ou `app/*.py` → recarrega sozinho via `uvicorn --reload`.

## Produção com Cloudflare Tunnel

### Passo 1 — Criar o tunnel (uma vez)

1. Acesse [Cloudflare dashboard](https://dash.cloudflare.com) → **Zero Trust** → **Networks** → **Tunnels**
2. Clique **Create a tunnel** → **Cloudflared**
3. Dê um nome: `servicepro-agent`
4. Copie o **token** (longa string começando com `eyJ...`)
5. Clique **Next** → configure um **Public Hostname**:
   - Subdomain: `agent`
   - Domain: seu domínio (ex: `servicepro.example.com`)
   - Service: `HTTP` → `http://agent:8080`  (o nome do serviço Docker, não `localhost`)
6. Salve

### Passo 2 — Adicionar token ao `.env`

```bash
echo "CLOUDFLARE_TUNNEL_TOKEN=eyJhbGciOi..." >> agent/.env
```

### Passo 3 — Subir com o profile `tunnel`

```bash
cd agent
docker compose --profile tunnel up -d
```

Isso sobe 2 containers:
- `servicepro-agent` — FastAPI na porta interna 8080
- `servicepro-agent-tunnel` — cloudflared conectado ao seu tunnel

### Passo 4 — Apontar Next.js pro tunnel

No Vercel (ou `.env.local` do Next.js):

```
AGENT_SERVICE_URL=https://agent.servicepro.example.com
```

Pronto — `dispatchInboundToAgent` e `/api/agent/operator/chat` vão chamar o tunnel.

## Quick tunnel ephemeral (teste rápido)

Se você quer só TESTAR sem criar tunnel nomeado:

```bash
# Em outro terminal, enquanto o agent está up:
docker run --rm --network servicepro-agent-net \
  cloudflare/cloudflared:latest tunnel --url http://agent:8080
```

A saída mostra um URL do tipo `https://xyz-abc-123.trycloudflare.com` —
copie e use como `AGENT_SERVICE_URL`. URL expira quando o container fecha.

## Variáveis de ambiente críticas

| Var | Origem | Obs |
|---|---|---|
| `AGENT_SHARED_SECRET` | mesmo do Next.js | HMAC bidirecional, **idêntico** em ambos |
| `OPENAI_API_KEY` | OpenAI | required |
| `NEXT_PUBLIC_API_BASE_URL` | URL do Next.js | se Next.js estiver na Vercel, use o domínio público; se local, `http://host.docker.internal:3000` |
| `LANGCHAIN_API_KEY` | LangSmith | opcional (traces) |
| `LANGCHAIN_PROJECT` | qualquer | default: `servicepro-{env}` |
| `REDACT_PII_IN_TRACES` | `true` recomendado | scrubbing de CPF/CNPJ/phone etc antes de LangSmith |
| `APP_ENV` | `production` | altera default de LANGCHAIN_PROJECT |
| `WORKERS` | `2` | # de processos uvicorn — I/O-bound, sobe se tráfego crescer |
| `CLOUDFLARE_TUNNEL_TOKEN` | dashboard Cloudflare | só necessário com `--profile tunnel` |

## Comandos úteis

```bash
# Status
docker compose ps

# Rebuild após mudança de deps (pyproject.toml)
docker compose build --no-cache agent

# Logs do agent
docker compose logs -f agent

# Logs do tunnel
docker compose --profile tunnel logs -f cloudflared

# Derrubar tudo
docker compose --profile tunnel down

# Shell dentro do container (debug)
docker compose exec agent /bin/sh

# Verificar healthcheck
docker inspect --format='{{.State.Health.Status}}' servicepro-agent
```

## Multi-tenant + múltiplos tunnels

Se você for hospedar para várias empresas, o **mesmo container** atende todos
os tenants — o isolamento é via `business_id` no HMAC header. Não precisa de
tunnel por tenant.

Dimensione `WORKERS` conforme tráfego simultâneo:

| Tenants ativos | WORKERS sugerido | CPUs mínimas |
|---|---|---|
| 1–5 | 2 | 1 core |
| 5–20 | 4 | 2 cores |
| 20–100 | 8 | 4 cores |
| 100+ | Considere Cloud Run / K8s com autoscaling |

## Troubleshooting

**Tunnel sobe mas Next.js não alcança o agent:**
- Verifique se o Public Hostname no Cloudflare aponta pra `http://agent:8080` (não `localhost`)
- Confirme que ambos containers estão na mesma `networks: [agent-net]`

**`401 Invalid signature` nas chamadas:**
- `AGENT_SHARED_SECRET` diferente entre Next.js e agent
- Timestamp skew > 5min (ajuste NTP da máquina host)

**`OpenAI API key not configured`:**
- `.env` não foi montado — confirme que está em `agent/.env` (não na raiz)

**Healthcheck falhando:**
- `docker compose logs agent` → procure por exceptions no boot
- Geralmente falta env var obrigatória

**Cloudflared fica em `ERR_NAME_NOT_RESOLVED`:**
- Se usou Docker Desktop em macOS, nome da network pode ser `agent_agent-net` em vez de `servicepro-agent-net` — ajuste com `--network` explícito
