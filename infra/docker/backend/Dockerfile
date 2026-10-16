# Full authenticated Phone11 backend; build only with the tracked public context.
# Primary Node22.23.3 amd64/arm64 index and package integrities are recorded in
# infra/docker/backend/public-input-pins.json. No credentials belong in the build.
FROM --platform=$TARGETPLATFORM docker.io/library/node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS production-dependencies
WORKDIR /app
ENV NPM_CONFIG_USERCONFIG=/dev/null
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
COPY modules/phone11-siprix/ ./modules/phone11-siprix/
COPY infra/docker/backend/public-input-pins.json ./infra/docker/backend/public-input-pins.json
COPY scripts/build-phone11-backend.mjs ./scripts/build-phone11-backend.mjs
RUN node scripts/build-phone11-backend.mjs --verify-install-inputs
RUN corepack enable && corepack prepare pnpm@9.12.0+sha512.4abf725084d7bcbafbd728bfc7bee61f2f791f977fd87542b3579dcb23504d170d46337945e4c66485cd12d588a0c0e570ed9c477e7ccdd8507cf05f3f92eaca --activate && test "$(pnpm --version)" = "9.12.0"
ENV COREPACK_ENABLE_NETWORK=0
# Backend dependencies retain their complete package/WASM/native assets. Neither
# the project mobile installer nor dependency lifecycle scripts may run.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM --platform=$TARGETPLATFORM docker.io/library/node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder
WORKDIR /app
ARG TARGETPLATFORM
ARG PHONE11_BUILD_SHA
ENV NPM_CONFIG_USERCONFIG=/dev/null
COPY . .
RUN node scripts/build-phone11-backend.mjs --verify-install-inputs
RUN corepack enable && corepack prepare pnpm@9.12.0+sha512.4abf725084d7bcbafbd728bfc7bee61f2f791f977fd87542b3579dcb23504d170d46337945e4c66485cd12d588a0c0e570ed9c477e7ccdd8507cf05f3f92eaca --activate && test "$(pnpm --version)" = "9.12.0"
ENV COREPACK_ENABLE_NETWORK=0
RUN pnpm install --frozen-lockfile --ignore-scripts
# Resolve the lock-pinned native esbuild package directly. No install.js,
# download fallback, Expo prebuild, SDK acquisition, server or worker startup.
RUN --network=none node scripts/build-phone11-backend.mjs --compile

FROM --platform=$TARGETPLATFORM docker.io/library/node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS production
WORKDIR /app
ARG PHONE11_BUILD_SHA
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PHONE11_BUILD_SHA=$PHONE11_BUILD_SHA \
    RECORDINGS_PATH=/var/lib/phone11/recordings \
    VOICEMAIL_PATH=/var/lib/phone11/voicemail
LABEL org.opencontainers.image.revision=$PHONE11_BUILD_SHA
RUN addgroup -g 1001 -S cloudphone && adduser -S cloudphone -u 1001 -G cloudphone && \
    mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail /var/lib/phone11/chat-media /opt/phone11ai/recordings /opt/phone11ai/voicemail && \
    chmod 0700 /var/lib/phone11/chat-media && \
    chown -R cloudphone:cloudphone /var/lib/phone11 /opt/phone11ai
COPY --from=production-dependencies /app/node_modules ./node_modules
# Preserve the declared link:modules/phone11-siprix target without private SDKs.
COPY --from=production-dependencies /app/modules/phone11-siprix ./modules/phone11-siprix
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY package.json ./
RUN node -e 'const m=require("./dist/build-manifest.json"); if(m.sourceCommit!==process.env.PHONE11_BUILD_SHA) process.exit(1)'
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
EXPOSE 3000/tcp
USER cloudphone
CMD ["node", "dist/index.mjs"]
