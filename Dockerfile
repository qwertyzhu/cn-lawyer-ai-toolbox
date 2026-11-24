# Lightweight Multi-Stage Production Dockerfile for CN Lawyer AI Toolbox
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
# Install poppler-utils + poppler-data for fast CJK PDF text extraction
RUN apk add --no-cache poppler-utils poppler-data
WORKDIR /app
ENV NODE_ENV=production
ENV BIND_HOST=0.0.0.0
ENV PORT=3681
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /app /data
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/package.json ./package.json
VOLUME ["/data"]
USER node
EXPOSE 3681
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3681/api/health || exit 1
CMD ["node", "server/index.mjs"]
