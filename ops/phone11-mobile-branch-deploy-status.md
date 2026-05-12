# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T17:46:34+00:00
- Workflow commit: 75de39e1171b82a38814e9c0744464ee33688068
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: failure
- Exit code: 61

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-12T17:46:16+00:00
GitHub SHA: 75de39e1171b82a38814e9c0744464ee33688068
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
From https://github.com/vasavas1977/codex-phone11
 * branch            75de39e1171b82a38814e9c0744464ee33688068 -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  140e12a Verify public API route during backend redeploy

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 140e12a

HEAD is now at 75de39e Add public API route diagnostics
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-12T17:46:18Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 3.25kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.2s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 2.78kB done
#4 DONE 0.0s

#5 [backend builder  1/13] FROM docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
#5 resolve docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f 0.0s done
#5 DONE 0.0s

#6 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#6 CACHED

#7 [backend production 6/7] COPY --from=builder /app/drizzle ./drizzle
#7 CACHED

#8 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#8 CACHED

#9 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#9 CACHED

#10 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
#10 CACHED

#11 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#11 CACHED

#12 [backend builder  8/13] COPY server/ ./server/
#12 CACHED

#13 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
#13 CACHED

#14 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#14 CACHED

#15 [backend builder  2/13] WORKDIR /app
#15 CACHED

#16 [backend builder 11/13] COPY drizzle.config.ts ./
#16 CACHED

#17 [backend builder 12/13] COPY tsconfig.json ./
#17 CACHED

#18 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#18 CACHED

#19 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#19 CACHED

#20 [backend builder  6/13] COPY scripts/ ./scripts/
#20 CACHED

#21 [backend production 5/7] COPY --from=builder /app/dist ./dist
#21 CACHED

#22 [backend builder 10/13] COPY drizzle/ ./drizzle/
#22 CACHED

#23 [backend builder  9/13] COPY shared/ ./shared/
#23 CACHED

#24 [backend production 7/7] COPY package.json ./
#24 CACHED

#25 [backend] exporting to image
#25 exporting layers done
#25 exporting manifest sha256:fe93060c7f6462c2260859a62cc4d5b2c45ff4305f2e850b739ab7b648561288 done
#25 exporting config sha256:fceae8328ee185fd40952d3f7971e22dc8d323b701ea0a11d7e2a359dc3c6432 done
#25 exporting attestation manifest sha256:710cbbe4c069dd90dc5688afa79b84ca8bdf78f66c402ec2c60452262c93b7bf 0.0s done
#25 exporting manifest list sha256:0fa341d8fa55cc59991b08d382161b40a3646056c734460cdfe95849b61c6014 0.0s done
#25 naming to docker.io/library/cloudphone11-prod-backend:latest
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
--- Verifying backend DB env and pilot extension ---
Backend PG env present: host=postgres, user=phone11ai, database=phone11ai, password=<set>
Backend PG auth OK as phone11ai on phone11ai
Pilot extension ready: 1020 on sip.phone11.ai
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Waiting for backend health endpoint ---
Health not ready: curl: (56) Recv failure: Connection reset by peer
{"ok":true,"timestamp":1778607993674,"build":"75de39e1171b82a38814e9c0744464ee33688068","service":"phone11-backend"}
--- Verifying public api.phone11.ai route ---
Public health: {"ok":true,"timestamp":1778607993709}
ERROR: public API answered, but it is not serving this deploy commit.
Expected build marker: 75de39e1171b82a38814e9c0744464ee33688068
--- Public API route diagnostics ---
DNS for api.phone11.ai:
43.209.112.208  STREAM api.phone11.ai
43.209.112.208  DGRAM  
43.209.112.208  RAW    
Listening ports 80/443/3000/3001:
LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=864803,fd=5),("nginx",pid=864802,fd=5),("nginx",pid=864801,fd=5),("nginx",pid=864800,fd=5),("nginx",pid=306726,fd=5))     
LISTEN 0      4096       127.0.0.1:3000       0.0.0.0:*    users:(("docker-proxy",pid=3940700,fd=7))                                                                                                     
LISTEN 0      511                *:3001             *:*    users:(("node",pid=1140499,fd=21))                                                                                                            
Docker containers:
cp11-backend cloudphone11-prod-backend 127.0.0.1:3000->3000/tcp
cp11-redis redis:7-alpine 6379/tcp
cp11-postgres postgres:16-alpine 127.0.0.1:5432->5432/tcp
p11-rtpengine drachtio/rtpengine:latest 
p11-kamailio ghcr.io/kamailio/kamailio:5.8.4-bookworm 
p11-freeswitch safarov/freeswitch:latest 
p11-redis redis:7-alpine 
Direct backend health:
{"ok":true,"timestamp":1778607993795,"build":"75de39e1171b82a38814e9c0744464ee33688068","service":"phone11-backend"}
Local HTTP Host-route health:
{"ok":true,"timestamp":1778607993800,"build":"75de39e1171b82a38814e9c0744464ee33688068","service":"phone11-backend"}
Local HTTPS Host-route health:

Nginx proxy snippets:

# configuration file /etc/nginx/sites-enabled/phone11ai:
server {
    listen 80;
    server_name phone11.ai 1toall.phone11.ai api.phone11.ai;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
--
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://10.0.1.69:8088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
curl: (7) Failed to connect to api.phone11.ai port 443 after 0 ms: Couldn't connect to server
```
