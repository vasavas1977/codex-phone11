# =============================================================================
# CloudPhone11 — Backend API Server
# =============================================================================
# Role: tRPC API, user auth, database ORM, file storage, LLM proxy, push dispatch
# Base: Node.js 22 Alpine (multi-stage build)
# Ports: 3000/tcp (API)
# =============================================================================

# --- Stage 1: Dependencies ---
FROM node:22-alpine AS deps

WORKDIR /app

# Some shared mobile packages run shell/curl-based postinstall scripts even when
# the backend only needs their JS dependencies.
RUN apk add --no-cache bash curl ca-certificates

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy package manifests and postinstall helpers
COPY package.json pnpm-lock.yaml ./
COPY scripts/ ./scripts/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# --- Stage 2: Build ---
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache bash curl ca-certificates
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml ./
COPY scripts/ ./scripts/
RUN pnpm install --frozen-lockfile

# Copy source
COPY server/ ./server/
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./
COPY tsconfig.json ./

# Build server bundle with esbuild
RUN pnpm build

# --- Stage 3: Production ---
FROM node:22-alpine AS production

LABEL maintainer="CloudPhone11 <ops@cloudphone11.io>"
LABEL description="CloudPhone11 backend API server"

WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S cloudphone && \
    adduser -S cloudphone -u 1001 -G cloudphone

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built server from builder stage
COPY --from=builder /app/dist ./dist

# Copy drizzle migrations
COPY --from=builder /app/drizzle ./drizzle

# Copy package.json for version info
COPY package.json ./

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000/tcp

USER cloudphone

CMD ["node", "dist/index.js"]
