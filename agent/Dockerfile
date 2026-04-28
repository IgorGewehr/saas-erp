# syntax=docker/dockerfile:1.7
# Production image for the ServicePro AI agent.
#
# Designed for:
#   - Docker Compose locally ou VPS
#   - Cloudflare Tunnel sitting in front (--proxy-headers respeita X-Forwarded-*)
#   - Qualquer orquestrador que respeite HEALTHCHECK + SIGTERM (Swarm, K8s, Nomad)
#
# Build:   docker build -t servicepro-agent:latest .
# Run:     docker run --rm -p 8080:8080 --env-file .env servicepro-agent:latest
# Compose: docker compose up -d

# ─── Stage 1: Builder — uv cria .venv com lockfile frozen ──────────────────────
FROM python:3.12-slim AS builder

# uv é statically linked — copia só o binário, sem apt-get
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Install deps primeiro — layer cacheável (mudar código NÃO invalida)
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Código da aplicação + sync final (idempotente, mas garante o project instalado)
COPY main.py ./
COPY app ./app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ─── Stage 2: Runtime — imagem enxuta, sem uv, non-root ────────────────────────
FROM python:3.12-slim AS runtime

# tini: reap zombies + forward sinais (SIGTERM limpo no docker stop / k8s)
# curl: usado no HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 1001 agent \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app --shell /sbin/nologin agent

WORKDIR /app

# Copia a .venv e o código do builder (já owned pelo non-root)
COPY --from=builder --chown=agent:agent /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONFAULTHANDLER=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    WORKERS=2 \
    LOG_LEVEL=info \
    APP_ENV=production

USER agent

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# tini como PID 1 → shutdown limpo quando Cloudflare Tunnel / compose / k8s sobe e derruba
ENTRYPOINT ["/usr/bin/tini", "--"]

# Produção: uvicorn multi-worker
#   --proxy-headers → respeita X-Forwarded-Proto/Host do Cloudflare Tunnel (HTTPS correto)
#   --forwarded-allow-ips='*' → accept do túnel (só Cloudflare nos alcança externamente)
CMD ["sh", "-c", "uvicorn main:app --host ${HOST} --port ${PORT} --workers ${WORKERS} --log-level ${LOG_LEVEL} --proxy-headers --forwarded-allow-ips=*"]
