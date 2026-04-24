# syntax=docker/dockerfile:1.7
# ServicePro Next.js app — production image.
#
# Uses Next.js output: 'standalone' (already set em next.config.js) —
# imagem final fica ~200MB com apenas o que o runtime precisa.
#
# Build:   docker build -t servicepro-app:latest .
# Run:     docker run --rm -p 8756:3000 --env-file .env servicepro-app:latest
# Compose: docker compose up -d

# ─── Stage 1: Install deps ─────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

# ffmpeg nativo é usado pela conversão OGG→M4A de áudios (Baileys + Meta audio).
# Instalar via apt é menor e mais confiável que @ffmpeg-installer/ffmpeg bundle.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
# --ignore-scripts evita postinstall problemáticos; só produção
RUN --mount=type=cache,target=/root/.npm \
    npm ci --production=false --ignore-scripts

# ─── Stage 2: Build Next.js ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build — next.config.js tem output: 'standalone', gera .next/standalone/
RUN npm run build

# ─── Stage 3: Runtime — enxuto, non-root ───────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# ffmpeg precisa estar no runtime também (Baileys/conversor chama o binário)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    tini \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 1001 nextjs \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app --shell /sbin/nologin nextjs

WORKDIR /app

# Copia o standalone (server.js auto-gerado pelo Next) + public/ + static/
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

# Firebase admin usa caminho ./firebase-admin-service-account.json se presente
# (vai ser montado via volume no compose — não entra na imagem)

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# server.js é o entrypoint que Next.js standalone gera
CMD ["node", "server.js"]
