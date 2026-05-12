# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T16:38:59+00:00
- Workflow commit: 26bbe77f4984c3f4391d25589fd9fd07f284d228
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-12T16:38:42+00:00
GitHub SHA: 26bbe77f4984c3f4391d25589fd9fd07f284d228
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
From https://github.com/vasavas1977/codex-phone11
 * branch            26bbe77f4984c3f4391d25589fd9fd07f284d228 -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  e7422ac Build backend image without Expo prebuild lifecycle

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> e7422ac

HEAD is now at 26bbe77 Run backend bundle as explicit ES module
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-12T16:38:44Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 2.62kB done
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

#6 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#6 CACHED

#7 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#7 CACHED

#8 [backend builder 10/13] COPY drizzle/ ./drizzle/
#8 CACHED

#9 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#9 CACHED

#10 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#10 CACHED

#11 [backend builder  6/13] COPY scripts/ ./scripts/
#11 CACHED

#12 [backend builder 11/13] COPY drizzle.config.ts ./
#12 CACHED

#13 [backend builder  9/13] COPY shared/ ./shared/
#13 CACHED

#14 [backend builder  8/13] COPY server/ ./server/
#14 CACHED

#15 [backend builder  2/13] WORKDIR /app
#15 CACHED

#16 [backend builder 12/13] COPY tsconfig.json ./
#16 CACHED

#17 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
#17 0.693 
#17 0.693   dist/index.mjs  191.6kb
#17 0.693 
#17 0.693 ⚡ Done in 45ms
#17 DONE 0.7s

#18 [backend deps 7/7] RUN pnpm install --frozen-lockfile --prod
#18 CACHED

#19 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone
#19 CACHED

#20 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#20 CACHED

#21 [backend production 5/7] COPY --from=builder /app/dist ./dist
#21 DONE 0.1s

#22 [backend production 6/7] COPY --from=builder /app/drizzle ./drizzle
#22 DONE 0.0s

#23 [backend production 7/7] COPY package.json ./
#23 DONE 0.0s

#24 [backend] exporting to image
#24 exporting layers 0.1s done
#24 exporting manifest sha256:c37954d753fc53774b08c3913e0eb5fdf6ef037c03055c75162d5503c3553104 0.0s done
#24 exporting config sha256:2973325859e9efecc49ce0b6f8f17cfab1e49ba026ac5f72dc3a1e4b3ed23653 0.0s done
#24 exporting attestation manifest sha256:a5336685c6b06f0a707bba629e51e59c1d0750714b85a96425fc31624fc223d3 0.0s done
#24 exporting manifest list sha256:a767df1ce374ad361caf1427c0ebf65325b13fad21a26bc5e58bdb0b37c864e5 0.0s done
#24 naming to docker.io/library/cloudphone11-prod-backend:latest
#24 naming to docker.io/library/cloudphone11-prod-backend:latest done
#24 unpacking to docker.io/library/cloudphone11-prod-backend:latest 0.1s done
#24 DONE 0.3s

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
Error response from daemon: Container 5dc7a67aa71ef6cd51336b1d59122fce2e72461c86d1ed4547c929eee75ce51e is restarting, wait until the container is running
```
