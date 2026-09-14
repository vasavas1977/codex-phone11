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
COPY tsconfig.json ./
RUN pnpm exec esbuild server/lab-fcm-cloud-run.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/lab-fcm-cloud-run.mjs

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist/lab-fcm-cloud-run.mjs ./dist/lab-fcm-cloud-run.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -q --spider http://127.0.0.1:8080/health || exit 1
CMD ["node","dist/lab-fcm-cloud-run.mjs"]
