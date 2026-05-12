# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T16:57:30+00:00
- Workflow commit: 1fc6e9fab005ce5f1323e73d09b449fc4b75cd0d
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-12T16:56:24+00:00
GitHub SHA: 1fc6e9fab005ce5f1323e73d09b449fc4b75cd0d
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
From https://github.com/vasavas1977/codex-phone11
 * branch            1fc6e9fab005ce5f1323e73d09b449fc4b75cd0d -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  37537f4 Expose transitive ws package to backend runtime

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 37537f4

HEAD is now at 1fc6e9f Trigger redeploy after ws runtime fix
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-12T16:56:26Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 3.03kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 0.8s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 2.78kB done
#4 DONE 0.0s

#5 [backend builder  1/13] FROM docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
#5 resolve docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f 0.0s done
#5 DONE 0.0s

#6 [backend builder 11/13] COPY drizzle.config.ts ./
#6 CACHED

#7 [backend builder  9/13] COPY shared/ ./shared/
#7 CACHED

#8 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#8 CACHED

#9 [backend builder  8/13] COPY server/ ./server/
#9 CACHED

#10 [backend builder  6/13] COPY scripts/ ./scripts/
#10 CACHED

#11 [backend production 6/7] COPY --from=builder /app/drizzle ./drizzle
#11 CACHED

#12 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#12 CACHED

#13 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone
#13 CACHED

#14 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#14 CACHED

#15 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#15 CACHED

#16 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#16 CACHED

#17 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#17 CACHED

#18 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
#18 CACHED

#19 [backend production 5/7] COPY --from=builder /app/dist ./dist
#19 CACHED

#20 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#20 CACHED

#21 [backend builder 10/13] COPY drizzle/ ./drizzle/
#21 CACHED

#22 [backend builder 12/13] COPY tsconfig.json ./
#22 CACHED

#23 [backend builder  2/13] WORKDIR /app
#23 CACHED

#24 [backend production 7/7] COPY package.json ./
#24 CACHED

#25 [backend] exporting to image
#25 exporting layers done
#25 exporting manifest sha256:ef14a556baaa1b0a2cd4c3afa9d19212c19090d42718c40bd862e7131a978c82 done
#25 exporting config sha256:8c162db8c139293314175020d585ba5553c61babdc0142e434206a172aa0e3ca done
#25 exporting attestation manifest sha256:d38224214044e5e4b87001e7c3a7fc0d12ca27330f2e280bef78ddce57108c22 0.0s done
#25 exporting manifest list sha256:3d0ae4c0c79e0e5bfc31450fec180082423d4d8edf46ed7f858dc64422ceba9c
#25 exporting manifest list sha256:3d0ae4c0c79e0e5bfc31450fec180082423d4d8edf46ed7f858dc64422ceba9c 0.0s done
#25 naming to docker.io/library/cloudphone11-prod-backend:latest done
#25 unpacking to docker.io/library/cloudphone11-prod-backend:latest done
#25 DONE 0.1s

#26 [backend] resolving provenance for metadata file
#26 DONE 0.0s
 backend  Built
 Container cp11-redis  Running
 Container cp11-postgres  Running
 Container cp11-backend  Recreate
 Container cp11-backend  Recreated
 Container cp11-redis  Waiting
 Container cp11-postgres  Waiting
 Container cp11-postgres  Healthy
 Container cp11-redis  Healthy
 Container cp11-backend  Starting
 Container cp11-backend  Started
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Verifying backend DB env and pilot extension ---
Backend PG env present: host=postgres, user=phone11ai, database=phone11ai, password=<set>
Backend PG auth OK as phone11ai on phone11ai
Pilot extension ready: 1020 on sip.phone11.ai
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Waiting for backend health endpoint ---
Health not ready: curl: (56) Recv failure: Connection reset by peer
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (56) Recv failure: Connection reset by peer
Health not ready: curl: (56) Recv failure: Connection reset by peer
Health not ready: curl: (56) Recv failure: Connection reset by peer
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (56) Recv failure: Connection reset by peer
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
ERROR: backend health endpoint did not become ready. Recent backend logs:
[OAuth] Initialized with baseURL: 
Error: EACCES: permission denied, mkdir '/opt/phone11ai/recordings'
    at Module.mkdirSync (node:fs:1370:26)
    at file:///app/dist/index.mjs:4631:8
    at Array.forEach (<anonymous>)
    at file:///app/dist/index.mjs:4629:35
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {
  errno: -13,
  code: 'EACCES',
  syscall: 'mkdir',
  path: '/opt/phone11ai/recordings'
}

Node.js v22.22.2
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
node:fs:1370
  const result = binding.mkdir(
                         ^

Error: EACCES: permission denied, mkdir '/opt/phone11ai/recordings'
    at Module.mkdirSync (node:fs:1370:26)
    at file:///app/dist/index.mjs:4631:8
    at Array.forEach (<anonymous>)
    at file:///app/dist/index.mjs:4629:35
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {
  errno: -13,
  code: 'EACCES',
  syscall: 'mkdir',
  path: '/opt/phone11ai/recordings'
}

Node.js v22.22.2
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
node:fs:1370
  const result = binding.mkdir(
                         ^

Error: EACCES: permission denied, mkdir '/opt/phone11ai/recordings'
    at Module.mkdirSync (node:fs:1370:26)
    at file:///app/dist/index.mjs:4631:8
    at Array.forEach (<anonymous>)
    at file:///app/dist/index.mjs:4629:35
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {
  errno: -13,
  code: 'EACCES',
  syscall: 'mkdir',
  path: '/opt/phone11ai/recordings'
}

Node.js v22.22.2
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
node:fs:1370
  const result = binding.mkdir(
                         ^

Error: EACCES: permission denied, mkdir '/opt/phone11ai/recordings'
    at Module.mkdirSync (node:fs:1370:26)
    at file:///app/dist/index.mjs:4631:8
    at Array.forEach (<anonymous>)
    at file:///app/dist/index.mjs:4629:35
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {
  errno: -13,
  code: 'EACCES',
  syscall: 'mkdir',
  path: '/opt/phone11ai/recordings'
}

Node.js v22.22.2
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
node:fs:1370
  const result = binding.mkdir(
                         ^

Error: EACCES: permission denied, mkdir '/opt/phone11ai/recordings'
    at Module.mkdirSync (node:fs:1370:26)
    at file:///app/dist/index.mjs:4631:8
    at Array.forEach (<anonymous>)
    at file:///app/dist/index.mjs:4629:35
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {
  errno: -13,
  code: 'EACCES',
  syscall: 'mkdir',
  path: '/opt/phone11ai/recordings'
}

Node.js v22.22.2
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
node:fs:1370
  const result = binding.mkdir(
                         ^

Error: EACCES: permission denied, mkdir '/opt/phone11ai/recordings'
    at Module.mkdirSync (node:fs:1370:26)
    at file:///app/dist/index.mjs:4631:8
    at Array.forEach (<anonymous>)
    at file:///app/dist/index.mjs:4629:35
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {
  errno: -13,
  code: 'EACCES',
  syscall: 'mkdir',
  path: '/opt/phone11ai/recordings'
}

Node.js v22.22.2
[OAuth] Initialized with baseURL: 
[OAuth] Initialized with baseURL: 
[OAuth] Initialized with baseURL: 
[OAuth] Initialized with baseURL: 
```
