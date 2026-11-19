# syntax=docker/dockerfile:1

FROM oven/bun:1-alpine

ENV NODE_ENV=production
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY server.ts sync.ts logger.ts sanitize.ts types.ts ./

RUN mkdir -p /snapshots /logs

EXPOSE 8080

CMD ["bun", "server.ts"]
