# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T18:14:19+00:00
- Workflow commit: 52b6af9972b8cc5fb849425e3fe91bd685d6debd
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.209.112.208
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-2-252
Time: 2026-05-12T18:12:32+00:00
GitHub SHA: 52b6af9972b8cc5fb849425e3fe91bd685d6debd
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
 * branch            52b6af9972b8cc5fb849425e3fe91bd685d6debd -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  7181992 Trigger public API standalone redeploy

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 7181992

HEAD is now at 52b6af9 Honor legacy DB SSL env settings
--- Deploying standalone public API backend container ---
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

Sending build context to Docker daemon  7.721MB
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
 ---> d74f0d7932da
Step 17/39 : COPY shared/ ./shared/
 ---> ebd5e59c4fd0
Step 18/39 : COPY drizzle/ ./drizzle/
 ---> da38f2863f3b
Step 19/39 : COPY drizzle.config.ts ./
 ---> c6ce5669175a
Step 20/39 : COPY tsconfig.json ./
 ---> d31d9718168b
Step 21/39 : RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
 ---> Running in 1aff9e9fa536
[91m
  dist/index.mjs  192.4kb

⚡ Done in 27ms
[0m ---> Removed intermediate container 1aff9e9fa536
 ---> 03eaae977378
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
 ---> f3123292b0a5
Step 29/39 : COPY --from=builder /app/drizzle ./drizzle
 ---> 818943ffa05d
Step 30/39 : COPY package.json ./
 ---> 93f40903de91
Step 31/39 : ENV NODE_ENV=production
 ---> Running in be0c0b26c2da
 ---> Removed intermediate container be0c0b26c2da
 ---> 3f483932dac3
Step 32/39 : ENV PORT=3000
 ---> Running in 5670d4d6a9a5
 ---> Removed intermediate container 5670d4d6a9a5
 ---> f9798ee99636
Step 33/39 : ENV HOST=0.0.0.0
 ---> Running in 425172fe596f
 ---> Removed intermediate container 425172fe596f
 ---> 7396a6c0a2aa
Step 34/39 : ENV RECORDINGS_PATH=/var/lib/phone11/recordings
 ---> Running in 483f9e905d46
 ---> Removed intermediate container 483f9e905d46
 ---> 5ffaca70c7f2
Step 35/39 : ENV VOICEMAIL_PATH=/var/lib/phone11/voicemail
 ---> Running in 32de66f833eb
 ---> Removed intermediate container 32de66f833eb
 ---> 485de12066d6
Step 36/39 : HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s     CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
 ---> Running in b596381eac3f
 ---> Removed intermediate container b596381eac3f
 ---> a8f3e0067a9b
Step 37/39 : EXPOSE 3000/tcp
 ---> Running in fa6f6defeb06
 ---> Removed intermediate container fa6f6defeb06
 ---> c17d37713247
Step 38/39 : USER cloudphone
 ---> Running in fe00b4250e4c
 ---> Removed intermediate container fe00b4250e4c
 ---> bdd023c363d8
Step 39/39 : CMD ["node", "dist/index.mjs"]
 ---> Running in bd507267b8a1
 ---> Removed intermediate container bd507267b8a1
 ---> e888fb18b1d0
Successfully built e888fb18b1d0
Successfully tagged phone11-backend-public:52b6af9972b8cc5fb849425e3fe91bd685d6debd
--- Freeing port 3000 for backend container ---
 1720123000/tcp:           
16ac226ca6160793161e8b1242711608e09eeb63bffd7eebe7df9965b4cee48a
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
