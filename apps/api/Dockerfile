FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod=false

# --- Build ---
FROM deps AS build
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/db/ packages/db/
COPY apps/api/ apps/api/
RUN pnpm --filter @aggragif/shared build && \
    pnpm --filter @aggragif/db build && \
    pnpm --filter @aggragif/api build

# --- Prune dev deps ---
RUN pnpm prune --prod

# --- Runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./

EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
