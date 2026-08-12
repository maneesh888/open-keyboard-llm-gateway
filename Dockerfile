ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM ${NODE_IMAGE}
RUN apk add --no-cache curl tini
RUN addgroup -S gateway && adduser -S gateway -G gateway
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY Vendor/semantic-prompt-contract/ ./Vendor/semantic-prompt-contract/

RUN mkdir -p /app/config && chown -R gateway:gateway /app
USER gateway

ENV PORT=8080
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENV CONFIG_PATH=/app/config/config.json
ENV KEYS_PATH=/app/config/keys.json

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -sf http://localhost:8080/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
