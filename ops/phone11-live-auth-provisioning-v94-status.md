# Phone11 V94 Live Auth Table And SIP Credential Proof Status

- Time UTC: 2026-05-27T01:30:31+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 49956c2525ed8d76c5db37bd6af0309347eb97e6
- Live EC2 host: 43.210.122.111
- Live EC2 instance: i-0851dd1ea1cfeef71
- Pilot user id: 1
- Pilot extension: 1001
- Latest app SIP password fingerprint from user log: 2b847b074c0ba53a
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 V94 live auth table and SIP credential proof ===
Time: 2026-05-27T01:29:40+00:00
Live EC2 host: 43.210.122.111
Pilot extension: 1001
Latest failed app credential fingerprint: 2b847b074c0ba53a
--- Locate live EC2 ---
Found live EC2 instance i-0851dd1ea1cfeef71 in ap-southeast-7a
--- Prepare temporary SSH access ---
{
    "RequestId": "4e56a86c-71ac-410e-90fa-02febe22b4a9",
    "Success": true
}
--- Copy deploy script to live EC2 ---
Warning: Permanently added '43.210.122.111' (ED25519) to the list of known hosts.
--- Redeploy current branch commit to live backend ---
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-27T01:29:54+00:00
GitHub SHA: 49956c2525ed8d76c5db37bd6af0309347eb97e6
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
 * branch            49956c2525ed8d76c5db37bd6af0309347eb97e6 -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  93c2913 Rerun live backend provisioning proof after API proxy fix

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 93c2913

HEAD is now at 49956c2 Add live auth table and SIP credential proof workflow
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-27T01:29:56Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 3.25kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.1s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 8.94kB done
#4 DONE 0.0s

#5 [backend builder  1/13] FROM docker.io/library/node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
#5 resolve docker.io/library/node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 0.0s done
#5 DONE 0.0s

#6 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#6 CACHED

#7 [backend builder  6/13] COPY scripts/ ./scripts/
#7 CACHED

#8 [backend builder  2/13] WORKDIR /app
#8 CACHED

#9 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#9 CACHED

#10 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
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
#17 0.715 
#17 0.715   dist/index.mjs  193.8kb
#17 0.715 
#17 0.715 ⚡ Done in 44ms
#17 DONE 0.8s

#18 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
#18 CACHED

#19 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#19 CACHED

#20 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
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
#25 exporting manifest sha256:a3afc59020adc8a5a4ba0e6d95b3e620ae34dd5ece8c932d41bc3df99b57d94e 0.0s done
#25 exporting config sha256:893957a5bf8f4194c1917162d11ef7ef68de9029df5ac5b68328cfb0e2516972 0.0s done
#25 exporting attestation manifest sha256:3b11e9a652744ec4910cf2b4ec6e11b563a15acfc2aec741df54cc484e4cbef5 0.0s done
#25 exporting manifest list sha256:53e4560359e405e66b3c0fd37fd2714b47ab145340a0afe9ea285854ba5e3616 0.0s done
#25 naming to docker.io/library/cloudphone11-prod-backend:latest done
#25 unpacking to docker.io/library/cloudphone11-prod-backend:latest 0.1s done
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
{"ok":true,"timestamp":1779845420900,"build":"49956c2525ed8d76c5db37bd6af0309347eb97e6","service":"phone11-backend"}
--- Verifying public api.phone11.ai route ---
Public health: {"ok":true,"timestamp":1779845420967,"build":"49956c2525ed8d76c5db37bd6af0309347eb97e6","service":"phone11-backend"}
Redeploy finished.
--- Prepare remote proof script ---
--- Run remote proof script on live EC2 ---
--- Runtime containers ---
cp11-backend cloudphone11-prod-backend Up 12 seconds (healthy)
p11-kamailio ghcr.io/kamailio/kamailio:5.8.4-bookworm Up 2 days
--- Public and local health ---
{"ok":true,"timestamp":1779845431047,"build":"49956c2525ed8d76c5db37bd6af0309347eb97e6","service":"phone11-backend"}
{"ok":true,"timestamp":1779845431054,"build":"49956c2525ed8d76c5db37bd6af0309347eb97e6","service":"phone11-backend"}
--- Backend env keys, names only ---
JWT_SECRET=<redacted>
SIP_DOMAIN=<set>
--- Live database auth table and credential proof ---
DB env present: host=postgres, user=phone11ai, database=phone11ai, ssl=disabled, password=<set>
LATEST_APP_SIP_PW_FP=2b847b074c0ba53a
DB auth OK: current_user=phone11ai, database=phone11ai
AUTH_USERS_TABLE=users
DB credential rows: count=3
DB_CREDENTIAL extension=1001 assignedUser=1 accountUsername=1001 domain=sip.phone11.ai extensionPw={"present":true,"len":36,"fp":"6ed481a55a18a945"} subscriberPw={"present":true,"len":36,"fp":"6ed481a55a18a945"} secretCiphertextTextLen=0
DB_CREDENTIAL extension=1020 assignedUser=1 accountUsername=1020 domain=sip.phone11.ai extensionPw={"present":true,"len":24,"fp":"6b07148b7f21c2ce"} subscriberPw={"present":true,"len":24,"fp":"6b07148b7f21c2ce"} secretCiphertextTextLen=0
DB_CREDENTIAL extension=1020 assignedUser=1 accountUsername=1020 domain=sip.phone11.ai extensionPw={"present":true,"len":24,"fp":"6b07148b7f21c2ce"} subscriberPw={"present":true,"len":24,"fp":"6b07148b7f21c2ce"} secretCiphertextTextLen=0
V94_EXPECTED_PROVISIONING_PASSWORD_SOURCE=subscriber username=1001 domain=sip.phone11.ai fp=6ed481a55a18a945 len=36
V94_STALE_APP_PASSWORD_CONFIRMED=true oldAppFp=2b847b074c0ba53a liveProvisioningFp=6ed481a55a18a945
V94_LIVE_AUTH_AND_SIP_CREDENTIAL_READY=true extension=1001 fp=6ed481a55a18a945 len=36
V94 live auth table and SIP credential proof succeeded.
```
