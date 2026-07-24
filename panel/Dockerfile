# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM docker.io/node:22-alpine AS builder

WORKDIR /build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/package.json
RUN --mount=type=cache,id=pnpm-builder-store,target=/pnpm/store \
  corepack enable \
  && corepack pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store

COPY . .
RUN pnpm build
RUN corepack pnpm --filter ange-clashboard-server-runtime deploy --prod /runtime/server

FROM docker.io/node:22-alpine

ARG TARGETARCH
ARG TARGETVARIANT

WORKDIR /app

COPY scripts/fetch-mihomo.mjs ./scripts/fetch-mihomo.mjs
RUN TARGETARCH="${TARGETARCH}" TARGETVARIANT="${TARGETVARIANT}" node ./scripts/fetch-mihomo.mjs \
  && chmod +x .tools/mihomo-bin/mihomo \
  && rm -rf ./scripts

COPY --from=builder /build/dist ./dist
COPY --from=builder /runtime/server ./server

ENV NODE_ENV=production
ENV PORT=2048

EXPOSE 2048

CMD ["node", "server/index.mjs"]
