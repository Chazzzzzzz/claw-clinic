FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Build stage ──────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY workers/package.json workers/
COPY mcp/package.json mcp/

RUN pnpm install --frozen-lockfile || pnpm install

COPY shared/tsconfig.json shared/
COPY shared/src/ shared/src/
COPY workers/tsconfig.json workers/
COPY workers/src/ workers/src/
COPY mcp/tsconfig.json mcp/
COPY mcp/src/ mcp/src/

RUN pnpm -r build

# ── Runtime stage ────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY workers/package.json workers/
COPY mcp/package.json mcp/

RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

COPY --from=build /app/shared/dist/ shared/dist/
COPY --from=build /app/workers/dist/ workers/dist/
COPY --from=build /app/mcp/dist/ mcp/dist/

# Cloud Run injects PORT env var (default 8080)
# ANTHROPIC_API_KEY should be set via Cloud Run secrets
EXPOSE 8080
CMD ["node", "mcp/dist/index.js", "--http"]
