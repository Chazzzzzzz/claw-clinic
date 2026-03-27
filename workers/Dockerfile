FROM node:22-slim AS build
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY workers/package.json workers/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY shared/ shared/
COPY workers/ workers/

# Build (shared first, then workers)
RUN pnpm -C shared build && pnpm -C workers build

# Production image
FROM node:22-slim
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/shared/package.json /app/shared/dist/ shared/
COPY --from=build /app/workers/package.json /app/workers/dist/ workers/
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/shared/node_modules/ shared/node_modules/
COPY --from=build /app/workers/node_modules/ workers/node_modules/

EXPOSE 8080
ENV PORT=8080

CMD ["node", "workers/index.js"]
