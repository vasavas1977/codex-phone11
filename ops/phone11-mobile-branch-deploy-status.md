# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T17:40:36+00:00
- Workflow commit: 49afbe071382d8a61d7006c03d6c29a3e6b27ec9
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-12T17:40:13+00:00
GitHub SHA: 49afbe071382d8a61d7006c03d6c29a3e6b27ec9
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
From https://github.com/vasavas1977/codex-phone11
 * branch            49afbe071382d8a61d7006c03d6c29a3e6b27ec9 -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  0c6a477 Use writable backend recording storage paths

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 0c6a477

HEAD is now at 49afbe0 Pass backend build marker into production compose
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-12T17:40:15Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 3.25kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.5s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 6.55kB done
#4 DONE 0.0s

#5 [backend builder  1/13] FROM docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
#5 resolve docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f 0.0s done
#5 DONE 0.0s

#6 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#6 CACHED

#7 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#7 CACHED

#8 [backend builder  2/13] WORKDIR /app
#8 CACHED

#9 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#9 CACHED

#10 [backend builder  6/13] COPY scripts/ ./scripts/
#10 CACHED

#11 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#11 CACHED

#12 [backend builder  8/13] COPY server/ ./server/
#12 DONE 0.1s

#13 [backend builder  9/13] COPY shared/ ./shared/
#13 DONE 0.0s

#14 [backend builder 10/13] COPY drizzle/ ./drizzle/
#14 DONE 0.0s

#15 [backend builder 11/13] COPY drizzle.config.ts ./
#15 DONE 0.0s

#16 [backend builder 12/13] COPY tsconfig.json ./
#16 DONE 0.0s

#17 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
#17 0.667 
#17 0.667   dist/index.mjs  191.7kb
#17 0.667 
#17 0.667 ⚡ Done in 44ms
#17 DONE 0.7s

#18 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#18 CACHED

#19 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#19 CACHED

#20 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
#20 CACHED

#21 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#21 CACHED

#22 [backend production 5/7] COPY --from=builder /app/dist ./dist
#22 DONE 0.1s

#23 [backend production 6/7] COPY --from=builder /app/drizzle ./drizzle
#23 DONE 0.0s

#24 [backend production 7/7] COPY package.json ./
#24 DONE 0.0s

#25 [backend] exporting to image
#25 exporting layers 0.1s done
#25 exporting manifest sha256:fe93060c7f6462c2260859a62cc4d5b2c45ff4305f2e850b739ab7b648561288 0.0s done
#25 exporting config sha256:fceae8328ee185fd40952d3f7971e22dc8d323b701ea0a11d7e2a359dc3c6432 0.0s done
#25 exporting attestation manifest sha256:975ab2205a0fff58cafea7b5a35cc1fb1c3e4d0bde68de0975268815e799a294 0.0s done
#25 exporting manifest list sha256:cf32df9fe464273c395277acb8db2bcf920e1b0691b3f64af55553f183bd2e7d 0.0s done
#25 naming to docker.io/library/cloudphone11-prod-backend:latest done
#25 unpacking to docker.io/library/cloudphone11-prod-backend:latest 0.0s done
#25 DONE 0.3s

#26 [backend] resolving provenance for metadata file
#26 DONE 0.0s
 backend  Built
 Container cp11-redis  Running
 Container cp11-postgres  Running
 Container cp11-backend  Recreate
 Container cp11-backend  Recreated
 Container cp11-postgres  Waiting
 Container cp11-redis  Waiting
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
{"ok":true,"timestamp":1778607636370,"build":"unknown","service":"phone11-backend"}
Redeploy finished.
```
