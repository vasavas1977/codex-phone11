# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T16:35:04+00:00
- Workflow commit: e7422ac74beba9c3799de22fe693ceab5ebf449c
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-12T16:34:16+00:00
GitHub SHA: e7422ac74beba9c3799de22fe693ceab5ebf449c
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
From https://github.com/vasavas1977/codex-phone11
 * branch            e7422ac74beba9c3799de22fe693ceab5ebf449c -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  bc1d089 Trigger mobile branch redeploy after Dockerfile fix

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> bc1d089

HEAD is now at e7422ac Build backend image without Expo prebuild lifecycle
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-12T16:34:18Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 2.60kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.2s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 3.85kB 0.0s done
#4 DONE 0.0s

#5 [backend builder  1/13] FROM docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
#5 resolve docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f 0.0s done
#5 DONE 0.0s

#6 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#6 CACHED

#7 [backend builder  2/13] WORKDIR /app
#7 CACHED

#8 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#8 CACHED

#9 [backend builder  6/13] COPY scripts/ ./scripts/
#9 CACHED

#10 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#10 CACHED

#11 [backend deps 7/7] RUN pnpm install --frozen-lockfile --prod
#11 CACHED

#12 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#12 CACHED

#13 [backend builder  8/13] COPY server/ ./server/
#13 CACHED

#14 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone
#14 CACHED

#15 [backend builder  9/13] COPY shared/ ./shared/
#15 DONE 0.1s

#16 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#16 ...

#17 [backend builder 10/13] COPY drizzle/ ./drizzle/
#17 DONE 0.1s

#18 [backend builder 11/13] COPY drizzle.config.ts ./
#18 DONE 0.1s

#19 [backend builder 12/13] COPY tsconfig.json ./
#19 DONE 0.1s

#20 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
#20 0.582 
#20 0.582   dist/index.js  191.6kb
#20 0.582 
#20 0.582 ⚡ Done in 28ms
#20 DONE 0.7s

#16 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#16 DONE 6.8s

#21 [backend production 5/7] COPY --from=builder /app/dist ./dist
#21 DONE 0.3s

#22 [backend production 6/7] COPY --from=builder /app/drizzle ./drizzle
#22 DONE 0.0s

#23 [backend production 7/7] COPY package.json ./
#23 DONE 0.0s

#24 [backend] exporting to image
#24 exporting layers
#24 exporting layers 18.8s done
#24 exporting manifest sha256:d3fbe5cd98b7b06f9ba83d084d4f7e4bb76932a924dde0a2aba43591be37dc3b done
#24 exporting config sha256:f6e08b488175805016d2c8f4ac7e91403e838e703aa9203b32a7d78257378c86 done
#24 exporting attestation manifest sha256:8614926bf2a236b56ff7e0156bcf7fb43824b383990c1c3ce0f51421389e758a 0.0s done
#24 exporting manifest list sha256:c713acd0f42f349ccb512c8a5f5dfbb7349380288e24fe25ea81a5d7138b48d1 done
#24 naming to docker.io/library/cloudphone11-prod-backend:latest done
#24 unpacking to docker.io/library/cloudphone11-prod-backend:latest
#24 unpacking to docker.io/library/cloudphone11-prod-backend:latest 6.7s done
#24 DONE 25.5s

#25 [backend] resolving provenance for metadata file
#25 DONE 0.0s
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
--- Verifying backend DB env and pilot extension ---
Error response from daemon: Container ab1d91ab5adb420238728767221fcb23e2a51f44080864ede342e8822d9859d5 is restarting, wait until the container is running
```
