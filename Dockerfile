# syntax=docker/dockerfile:1.7
# ServicePro Next.js app — production image (pre-built).
#
# Next.js 15.5 has a CSS extraction bug on Linux that prevents building
# inside Docker. The app must be built locally first:
#
#   npm run build          ← build on Windows/Mac (generates .next/)
#   docker compose build   ← packages the pre-built output
#   docker compose --profile tunnel up -d
#
# The .next/ directory is included in the build context (not in .dockerignore).

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    tini \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nextjs \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app --shell /sbin/nologin nextjs

WORKDIR /app

# Copy pre-built app (standalone nests files under the project path)
COPY --chown=nextjs:nextjs .next/standalone/air/saas-erp ./
COPY --chown=nextjs:nextjs .next/static ./.next/static
COPY --chown=nextjs:nextjs public ./public

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
