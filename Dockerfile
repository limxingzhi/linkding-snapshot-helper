FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /snapshots /logs

EXPOSE 8080

CMD ["node", "server.js"]
