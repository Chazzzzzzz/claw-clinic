FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Build stage ──────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY workers/package.json workers/

RUN pnpm install --frozen-lockfile || pnpm install

COPY shared/tsconfig.json shared/
COPY shared/src/ shared/src/
COPY workers/tsconfig.json workers/
COPY workers/src/ workers/src/

RUN pnpm -r build

# ── Runtime stage ────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY workers/package.json workers/

RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

COPY --from=build /app/shared/dist/ shared/dist/
COPY --from=build /app/workers/dist/ workers/dist/

# Cloud Run injects PORT env var (default 8080)
EXPOSE 8080
CMD ["node", "workers/dist/index.js"]
