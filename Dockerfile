# syntax=docker/dockerfile:1

FROM oven/bun:1-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY server.ts sync.ts logger.ts sanitize.ts types.ts ./
COPY .agents/skills/html-to-txt ./.agents/skills/html-to-txt

RUN mkdir -p /snapshots /logs

EXPOSE 8080

CMD ["bun", "server.ts"]
