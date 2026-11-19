# syntax=docker/dockerfile:1

FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY server.ts sync.ts logger.ts sanitize.ts types.ts ./
RUN bun x tsc --noEmit

RUN rm -rf node_modules && bun install --frozen-lockfile --production


FROM oven/bun:1-alpine AS deploy

ENV NODE_ENV=production
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /app

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server.ts /app/sync.ts /app/logger.ts /app/sanitize.ts /app/types.ts ./

RUN mkdir -p /snapshots /logs

EXPOSE 8080

CMD ["bun", "server.ts"]
