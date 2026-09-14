FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml ./
COPY modules/phone11-siprix/package.json ./modules/phone11-siprix/package.json
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml ./
COPY modules/phone11-siprix/package.json ./modules/phone11-siprix/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY shared/ ./shared/
COPY drizzle/ ./drizzle/
COPY tsconfig.json ./
RUN pnpm exec esbuild scripts/phone11-android-staging-seed.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/staging-seed.mjs
RUN pnpm exec esbuild scripts/phone11-auth-admin.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/auth-admin.mjs
RUN pnpm exec esbuild scripts/phone11-android-staging-push-migrate.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/push-migrate.mjs
RUN pnpm exec esbuild scripts/phone11-android-staging-runtime-grants.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/runtime-grants.mjs

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/push/migration.sql ./server/push/migration.sql
COPY --from=build /app/server/push/wake-migration.sql ./server/push/wake-migration.sql
COPY infra/cloud-run/phone11-stage-migrator/entrypoint.sh ./entrypoint.sh
RUN chmod 0555 ./entrypoint.sh
USER node
ENTRYPOINT ["/app/entrypoint.sh"]
