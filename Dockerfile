# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# market-intelligence — production image for the HTTP API
#
# Multi-stage build:
#   1. builder  — install ALL deps (dev included), compile every workspace pkg
#   2. runner   — copy the built workspace, prune to production deps only,
#                 run as non-root, with a container HEALTHCHECK
#
# The API entrypoint (packages/market-intelligence-api/src/main.ts) handles
# SIGTERM/SIGINT with a graceful drain, so orchestrators can stop it cleanly.
# ---------------------------------------------------------------------------

# ---- Stage 1: builder -----------------------------------------------------
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ ./packages/

# Nested package.json files are needed for workspace resolution; source files
# are already included above via packages/.
RUN pnpm install --frozen-lockfile

# Build every workspace package in topological order (tsc emits dist/ + types).
RUN pnpm -r build

# Drop devDependencies from the installed tree so the runner stage stays lean.
RUN pnpm prune --prod

# ---- Stage 2: runner ------------------------------------------------------
FROM node:22-alpine AS runner

RUN corepack enable

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Dedicated non-root user (alpine busybox adduser).
RUN addgroup -S app && adduser -S app -G app

# Copy the pruned workspace: node_modules (with pnpm symlinks), sources, dist.
COPY --from=builder --chown=app:app /app ./

USER app

EXPOSE 8080

# Container-level health check against the API's /health endpoint.
# 3 consecutive failures => container is marked unhealthy.
# busybox wget is available on alpine; stays well under the default
# rate limit (120 req/min per IP).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/health || exit 1

# STOPSIGNAL is SIGTERM by default; the app drains gracefully on SIGTERM.
STOPSIGNAL SIGTERM

CMD ["node", "packages/market-intelligence-api/dist/main.js"]
