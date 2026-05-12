# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T18:08:53+00:00
- Workflow commit: 7181992a18c76970afc5b3d203565145b45f64be
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.209.112.208
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-2-252
Time: 2026-05-12T18:07:43+00:00
GitHub SHA: 7181992a18c76970afc5b3d203565145b45f64be
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
Runtime env keys:
DB_HOST
DB_NAME
DB_<secret-key-redacted>
DB_USER
FCM_API_<secret-key-redacted>
FS_ESL_<secret-key-redacted>
JWT_<secret-key-redacted>
REDIS_HOST
SIP_DOMAIN
STORAGE_BUCKET
VOIP_SERVER_IP
From https://github.com/vasavas1977/codex-phone11
 * branch            7181992a18c76970afc5b3d203565145b45f64be -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  93ec454 Support standalone public API host deploy

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 93ec454

HEAD is now at 7181992 Trigger public API standalone redeploy
--- Deploying standalone public API backend container ---
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

Sending build context to Docker daemon  6.627MB
Step 1/39 : FROM node:22-alpine AS deps
 ---> 8ea2348b068a
Step 2/39 : WORKDIR /app
 ---> Using cache
 ---> b02b70c5218d
Step 3/39 : RUN apk add --no-cache bash curl ca-certificates
 ---> Using cache
 ---> 5d8d4084f8a0
Step 4/39 : RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
 ---> Using cache
 ---> 9d67bcbb4e5c
Step 5/39 : COPY package.json pnpm-lock.yaml ./
 ---> Using cache
 ---> 5e8d75307f9b
Step 6/39 : COPY scripts/ ./scripts/
 ---> Using cache
 ---> 729d87dd46b1
Step 7/39 : RUN pnpm install --frozen-lockfile --prod
 ---> Using cache
 ---> 290bf8819bd7
Step 8/39 : RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
 ---> Using cache
 ---> 9398b4cbcd63
Step 9/39 : FROM node:22-alpine AS builder
 ---> 8ea2348b068a
Step 10/39 : WORKDIR /app
 ---> Using cache
 ---> b02b70c5218d
Step 11/39 : RUN apk add --no-cache bash curl ca-certificates
 ---> Using cache
 ---> 5d8d4084f8a0
Step 12/39 : RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
 ---> Using cache
 ---> 9d67bcbb4e5c
Step 13/39 : COPY package.json pnpm-lock.yaml ./
 ---> Using cache
 ---> 5e8d75307f9b
Step 14/39 : COPY scripts/ ./scripts/
 ---> Using cache
 ---> 729d87dd46b1
Step 15/39 : RUN pnpm install --frozen-lockfile
 ---> Using cache
 ---> 672ec2011876
Step 16/39 : COPY server/ ./server/
 ---> Using cache
 ---> 64ccba20551a
Step 17/39 : COPY shared/ ./shared/
 ---> Using cache
 ---> 869ae0eeba3d
Step 18/39 : COPY drizzle/ ./drizzle/
 ---> Using cache
 ---> b92d7133fbb1
Step 19/39 : COPY drizzle.config.ts ./
 ---> Using cache
 ---> 94eb5c6b938d
Step 20/39 : COPY tsconfig.json ./
 ---> Using cache
 ---> 8221b7a6e2e6
Step 21/39 : RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
 ---> Using cache
 ---> a5145b50a344
Step 22/39 : FROM node:22-alpine AS production
 ---> 8ea2348b068a
Step 23/39 : LABEL maintainer="CloudPhone11 <ops@cloudphone11.io>"
 ---> Using cache
 ---> 01ba77a48683
Step 24/39 : LABEL description="CloudPhone11 backend API server"
 ---> Using cache
 ---> 2c4e5f61f0df
Step 25/39 : WORKDIR /app
 ---> Using cache
 ---> cc1aa9b2ee19
Step 26/39 : RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
 ---> Using cache
 ---> 5a4724155c6b
Step 27/39 : COPY --from=deps /app/node_modules ./node_modules
 ---> Using cache
 ---> b385007c5e0c
Step 28/39 : COPY --from=builder /app/dist ./dist
 ---> Using cache
 ---> ec6dfd9f8be8
Step 29/39 : COPY --from=builder /app/drizzle ./drizzle
 ---> Using cache
 ---> 14a5feb01a88
Step 30/39 : COPY package.json ./
 ---> Using cache
 ---> af71b1c6d5b3
Step 31/39 : ENV NODE_ENV=production
 ---> Using cache
 ---> 31c9fa81246a
Step 32/39 : ENV PORT=3000
 ---> Running in d9a8f10b7a58
 ---> Removed intermediate container d9a8f10b7a58
 ---> 4451f38ffe83
Step 33/39 : ENV HOST=0.0.0.0
 ---> Running in 368120585aec
 ---> Removed intermediate container 368120585aec
 ---> 973d4ca68f33
Step 34/39 : ENV RECORDINGS_PATH=/var/lib/phone11/recordings
 ---> Running in 7604fdba1946
 ---> Removed intermediate container 7604fdba1946
 ---> 47bcdb47b9f1
Step 35/39 : ENV VOICEMAIL_PATH=/var/lib/phone11/voicemail
 ---> Running in 59bff784b05a
 ---> Removed intermediate container 59bff784b05a
 ---> 2c9941ca6c3c
Step 36/39 : HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s     CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
 ---> Running in bf178c175eb7
 ---> Removed intermediate container bf178c175eb7
 ---> c27bef51995f
Step 37/39 : EXPOSE 3000/tcp
 ---> Running in 332cc0ecb244
 ---> Removed intermediate container 332cc0ecb244
 ---> a5fd2751c8f6
Step 38/39 : USER cloudphone
 ---> Running in bd91d0e7e6a2
 ---> Removed intermediate container bd91d0e7e6a2
 ---> 5cc9515bf160
Step 39/39 : CMD ["node", "dist/index.mjs"]
 ---> Running in fd60aba74be2
 ---> Removed intermediate container fd60aba74be2
 ---> 160545ffcb5a
Successfully built 160545ffcb5a
Successfully tagged phone11-backend-public:7181992a18c76970afc5b3d203565145b45f64be
--- Freeing port 3000 for backend container ---
8b2326406dd3e49c968997b6ebb9b019bcc9a35e06da629154f3361deea7db87
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Verifying backend DB env and pilot extension ---
Backend DB env present: host=phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com, user=phone11ai, database=phone11ai, password=<set>
/app/node_modules/.pnpm/pg-pool@3.13.0_pg@8.20.0/node_modules/pg-pool/index.js:45
    Error.captureStackTrace(err)
          ^

error: no pg_hba.conf entry for host "10.0.2.252", user "phone11ai", database "phone11ai", no encryption
    at /app/node_modules/.pnpm/pg-pool@3.13.0_pg@8.20.0/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///app/[eval1]:16:16 {
  length: 160,
  severity: 'FATAL',
  code: '28000',
  detail: undefined,
  hint: undefined,
  position: undefined,
  internalPosition: undefined,
  internalQuery: undefined,
  where: undefined,
  schema: undefined,
  table: undefined,
  column: undefined,
  dataType: undefined,
  constraint: undefined,
  file: 'auth.c',
  line: '542',
  routine: 'ClientAuthentication'
}

Node.js v22.22.2
```
