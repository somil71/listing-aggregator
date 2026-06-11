# ── Stage 1: Build React dashboard ────────────────────────────────────────
FROM node:20-alpine AS dashboard-build

WORKDIR /build/dashboard

# Copy the committed .env first — this instruction has never existed in any
# cached layer, so BuildKit cannot use inline cache here. The cache miss
# cascades: all subsequent steps run fresh, so `npm run build` picks up
# VITE_CLERK_PUBLISHABLE_KEY from dashboard/.env automatically.
COPY dashboard/.env ./
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ── Stage 2: Production server ─────────────────────────────────────────────
FROM node:20-alpine

# Chromium dependencies for Puppeteer / whatsapp-web.js
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    su-exec \
    && rm -rf /var/cache/apk/*

# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy source (secrets must be injected at runtime via env vars, not baked into image)
COPY src/ ./src/

# Copy built dashboard from stage 1
COPY --from=dashboard-build /build/dashboard/dist ./dashboard/dist

# Create runtime directories and a non-root user
RUN mkdir -p data/db data/media data/wwebjs-auth logs reports \
    && addgroup -g 1001 -S nodejs \
    && adduser  -S nodejs -u 1001 \
    && chown -R nodejs:nodejs /app

# Volume mounts (e.g. Railway's /app/data) arrive root-owned, so the container
# starts as root: the entrypoint chowns the mount to nodejs and immediately
# drops privileges via su-exec. No USER directive — the entrypoint enforces it.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "src/api/server.js"]
