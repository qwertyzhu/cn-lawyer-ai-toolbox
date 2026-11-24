# Lightweight Multi-Stage Production Dockerfile for CN Lawyer AI Toolbox
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
# Install poppler-utils + poppler-data for fast CJK PDF text extraction
RUN apk add --no-cache poppler-utils poppler-data
WORKDIR /app
ENV NODE_ENV=production
ENV BIND_HOST=0.0.0.0
ENV PORT=3681
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./package.json
EXPOSE 3681
CMD ["node", "server/index.mjs"]
