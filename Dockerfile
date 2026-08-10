# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY server.ts sync.ts logger.ts sanitize.ts types.ts ./
RUN npx tsc -p tsconfig.build.json

FROM node:24-alpine
ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN mkdir -p /snapshots /logs

EXPOSE 8080

CMD ["node", "dist/server.js"]
