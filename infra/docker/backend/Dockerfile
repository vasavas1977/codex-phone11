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

# Some shared mobile/native packages run bash/curl-based postinstall scripts.
RUN apk add --no-cache bash curl

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy package manifests
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# --- Stage 2: Build ---
FROM node:22-alpine AS builder

WORKDIR /app

# Some shared mobile/native packages run bash/curl-based postinstall scripts.
RUN apk add --no-cache bash curl

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# The server imports ws directly, but the current monorepo lockfile does not
# list it as a top-level backend dependency yet. Install it inside the image so
# the production backend can boot while we keep mobile dependencies untouched.
RUN pnpm add ws@8.18.3 --prod --ignore-scripts

# Copy source
COPY server/ ./server/
COPY shared/ ./shared/
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./
COPY tsconfig.json ./
COPY scripts/ ./scripts/

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

# The server bundle keeps external Node packages, including ws, at runtime.
# Copy the builder install so runtime-only packages that are reached through
# development tooling transitive deps are still present until dependencies are
# split into a backend-only package.
COPY --from=builder /app/node_modules ./node_modules

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
