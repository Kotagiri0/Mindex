FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

ARG GROQ_API_KEY
ENV GROQ_API_KEY=$GROQ_API_KEY

COPY . .
RUN npm run build

# ---

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache ffmpeg

COPY package*.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]