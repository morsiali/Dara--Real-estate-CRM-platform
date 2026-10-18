# Dara — production image. Zero runtime dependencies except the optional "pg" driver for PostgreSQL.
FROM node:22.14-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Installs "pg" (optionalDependency); skips dev-only PGlite.
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22.14-alpine
ENV NODE_ENV=production PORT=4310
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
# Runs as the unprivileged "node" user; ./data holds the email outbox (and SQLite if DATABASE_URL is unset).
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 4310
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4310/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
