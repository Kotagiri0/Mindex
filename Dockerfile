FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci

COPY --from=builder /app/dist ./dist
COPY . .

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]