FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM deps AS build
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @aggragif/shared build && \
    pnpm --filter @aggragif/web build

# --- Runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
