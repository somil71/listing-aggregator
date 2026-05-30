# ── Stage 1: Build React dashboard ────────────────────────────────────────
FROM node:20-alpine AS dashboard-build

WORKDIR /build/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./

# Vite inlines VITE_* vars into the bundle at BUILD time. The Clerk publishable
# key is a PUBLIC client key (pk_test_/pk_live_) and must be present here, or
# ClerkProvider boots with publishableKey=undefined and sign-in silently dies.
# Railway exposes service variables as build args — declare the ARG to receive it.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

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

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "src/api/server.js"]
