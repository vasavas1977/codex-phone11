# Phone11 V90 Live Backend Provisioning Status

- Time UTC: 2026-05-27T01:22:35+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 93c2913c67c886fe297a0e8e1ebf748981dd632e
- Live EC2 host: 43.210.122.111
- Live EC2 instance: i-0851dd1ea1cfeef71
- Pilot user id: 1
- Latest app SIP password fingerprint from user log: 2b847b074c0ba53a
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 V90 live backend provisioning deploy and evidence ===
Time: 2026-05-27T01:21:51+00:00
Live EC2 host: 43.210.122.111
Expected latest app password fingerprint: 2b847b074c0ba53a
--- Locate live EC2 ---
Found live EC2 instance i-0851dd1ea1cfeef71 in ap-southeast-7a
--- Prepare temporary SSH access ---
{
    "RequestId": "16abb410-1308-4eb9-8ae8-1692c6da14ec",
    "Success": true
}
--- Copy deploy script to live EC2 ---
Warning: Permanently added '43.210.122.111' (ED25519) to the list of known hosts.
--- Redeploy current branch commit to live backend ---
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-27T01:22:07+00:00
GitHub SHA: 93c2913c67c886fe297a0e8e1ebf748981dd632e
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
Runtime env keys:
DB_NAME
DB_<secret-key-redacted>
DB_USER
EXTERNAL_IP
FCM_API_<secret-key-redacted>
FS_ESL_<secret-key-redacted>
JWT_<secret-key-redacted>
PRIVATE_IP
REDIS_<secret-key-redacted>
REDIS_URL
SIP_DOMAIN
STORAGE_BUCKET
From https://github.com/vasavas1977/codex-phone11
 * branch            93c2913c67c886fe297a0e8e1ebf748981dd632e -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  138bc62 Trigger Phone11 V90 live provisioning evidence

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 138bc62

HEAD is now at 93c2913 Rerun live backend provisioning proof after API proxy fix
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-27T01:22:09Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 3.25kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.4s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 4.56kB 0.0s done
#4 DONE 0.0s

#5 [backend builder  1/13] FROM docker.io/library/node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
#5 resolve docker.io/library/node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 0.0s done
#5 DONE 0.0s

#6 [backend production 6/7] COPY --from=builder /app/drizzle ./drizzle
#6 CACHED

#7 [backend builder 11/13] COPY drizzle.config.ts ./
#7 CACHED

#8 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
#8 CACHED

#9 [backend builder 12/13] COPY tsconfig.json ./
#9 CACHED

#10 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#10 CACHED

#11 [backend builder  9/13] COPY shared/ ./shared/
#11 CACHED

#12 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#12 CACHED

#13 [backend builder  6/13] COPY scripts/ ./scripts/
#13 CACHED

#14 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#14 CACHED

#15 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#15 CACHED

#16 [backend builder  2/13] WORKDIR /app
#16 CACHED

#17 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#17 CACHED

#18 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
#18 CACHED

#19 [backend production 5/7] COPY --from=builder /app/dist ./dist
#19 CACHED

#20 [backend builder  8/13] COPY server/ ./server/
#20 CACHED

#21 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#21 CACHED

#22 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#22 CACHED

#23 [backend builder 10/13] COPY drizzle/ ./drizzle/
#23 CACHED

#24 [backend production 7/7] COPY package.json ./
#24 CACHED

#25 [backend] exporting to image
#25 exporting layers done
#25 exporting manifest sha256:7a96a69bb52d8f7d650925be7e32794dfbb8ea5f4efb7dcaf56062ecebfa976a done
#25 exporting config sha256:3020e26253f9d35a851ee242f7f3d4395d79eb9b589f0d86d57b49c1ece22866 done
#25 exporting attestation manifest sha256:1cdec08223d024fd2077d7c093a2c5e7f6ac4388290635f575b804ee16160a9e 0.0s done
#25 exporting manifest list sha256:8d6f82d39f67f3a9be24cef61366ec3d1b1d332887f4cbbda28bc4884c8ca4ba 0.0s done
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
 Container cp11-redis  Healthy
 Container cp11-postgres  Healthy
 Container cp11-backend  Starting
 Container cp11-backend  Started
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Checking RDS managed secret for DB password repair ---
DB env is incomplete; skipping DB password repair.
--- Verifying backend DB env and pilot extension ---
Backend DB env present: host=postgres, user=phone11ai, database=phone11ai, ssl=disabled, password=<set>
Backend PG auth OK as phone11ai on phone11ai
Pilot extension ready: 1001 on sip.phone11.ai
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Waiting for backend health endpoint ---
Health not ready: curl: (56) Recv failure: Connection reset by peer
{"ok":true,"timestamp":1779844945045,"build":"93c2913c67c886fe297a0e8e1ebf748981dd632e","service":"phone11-backend"}
--- Verifying public api.phone11.ai route ---
Public health: {"ok":true,"timestamp":1779844945113,"build":"93c2913c67c886fe297a0e8e1ebf748981dd632e","service":"phone11-backend"}
Redeploy finished.
--- Prepare remote credential evidence script ---
--- Run remote credential evidence script on live EC2 ---
--- Runtime containers ---
cp11-backend cloudphone11-prod-backend Up 11 seconds (healthy)
p11-kamailio ghcr.io/kamailio/kamailio:5.8.4-bookworm Up 2 days
--- Public and local health ---
{"ok":true,"timestamp":1779844954924,"build":"93c2913c67c886fe297a0e8e1ebf748981dd632e","service":"phone11-backend"}
{"ok":true,"timestamp":1779844954932,"build":"93c2913c67c886fe297a0e8e1ebf748981dd632e","service":"phone11-backend"}
--- Backend env keys, names only ---
JWT_SECRET=<redacted>
SIP_DOMAIN=<set>
--- Provisioning credential fingerprint evidence ---
DB env present: host=postgres, user=phone11ai, database=phone11ai, ssl=disabled, password=<set>
LATEST_APP_SIP_PW_FP=2b847b074c0ba53a
DB auth OK: current_user=phone11ai, database=phone11ai
/app/node_modules/.pnpm/pg-pool@3.13.0_pg@8.20.0/node_modules/pg-pool/index.js:45
    Error.captureStackTrace(err)
          ^

error: relation "users" does not exist
    at /app/node_modules/.pnpm/pg-pool@3.13.0_pg@8.20.0/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///app/[eval1]:61:22 {
  length: 104,
  severity: 'ERROR',
  code: '42P01',
  detail: undefined,
  hint: undefined,
  position: '45',
  internalPosition: undefined,
  internalQuery: undefined,
  where: undefined,
  schema: undefined,
  table: undefined,
  column: undefined,
  dataType: undefined,
  constraint: undefined,
  file: 'parse_relation.c',
  line: '1449',
  routine: 'parserOpenTable'
}

Node.js v22.22.3
```
