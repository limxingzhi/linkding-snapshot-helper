FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN mkdir -p /snapshots /logs

EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
