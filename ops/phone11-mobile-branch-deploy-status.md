# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T16:01:17+00:00
- Workflow commit: 9f8f07d5df588ce41dbbdae2c6c5f28b82a36730
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend deployment ===
Host: ip-10-0-1-69
Time: 2026-05-12T16:00:56+00:00
GitHub SHA: 9f8f07d5df588ce41dbbdae2c6c5f28b82a36730
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Live project path: /opt/phone11ai/cloudphone11
Pilot user id: 1
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
--- Aligning Postgres role password with runtime env ---
ALTER ROLE
Database role password aligned.
--- Validating compose config ---
--- Rebuilding and restarting backend from mobile branch ---
time="2026-05-12T16:00:58Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 2.08kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.4s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 786.71kB 0.0s done
#4 DONE 0.0s

#5 [backend builder  1/11] FROM docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
#5 resolve docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f 0.0s done
#5 DONE 0.0s

#6 [backend builder  2/11] WORKDIR /app
#6 CACHED

#7 [backend builder  3/11] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#7 CACHED

#8 [backend builder  4/11] COPY package.json pnpm-lock.yaml ./
#8 DONE 0.1s

#9 [backend builder  5/11] RUN pnpm install --frozen-lockfile
#9 0.952 Lockfile is up to date, resolution step is skipped
#9 1.110 Progress: resolved 1, reused 0, downloaded 0, added 0
#9 1.405 Packages: +1158
#9 1.405 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#9 1.919 
#9 1.919    ╭──────────────────────────────────────────────────────────────────╮
#9 1.919    │                                                                  │
#9 1.919    │                Update available! 9.12.0 → 11.1.1.                │
#9 1.919    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.1.1   │
#9 1.919    │         Run "corepack install -g pnpm@11.1.1" to update.         │
#9 1.919    │                                                                  │
#9 1.919    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#9 1.919    │                                                                  │
#9 1.919    ╰──────────────────────────────────────────────────────────────────╯
#9 1.919 
#9 2.114 Progress: resolved 1158, reused 0, downloaded 26, added 19
#9 3.115 Progress: resolved 1158, reused 0, downloaded 145, added 144
#9 4.115 Progress: resolved 1158, reused 0, downloaded 307, added 307
#9 5.117 Progress: resolved 1158, reused 0, downloaded 391, added 386
#9 6.118 Progress: resolved 1158, reused 0, downloaded 494, added 481
#9 7.119 Progress: resolved 1158, reused 0, downloaded 567, added 557
#9 8.119 Progress: resolved 1158, reused 0, downloaded 664, added 654
#9 9.120 Progress: resolved 1158, reused 0, downloaded 725, added 716
#9 ...

#10 [backend deps 5/5] RUN pnpm install --frozen-lockfile --prod
#10 0.947 Lockfile is up to date, resolution step is skipped
#10 1.045 Progress: resolved 1, reused 0, downloaded 0, added 0
#10 1.338 Packages: +899
#10 1.338 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#10 1.781 
#10 1.781    ╭──────────────────────────────────────────────────────────────────╮
#10 1.781    │                                                                  │
#10 1.781    │                Update available! 9.12.0 → 11.1.1.                │
#10 1.781    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.1.1   │
#10 1.781    │         Run "corepack install -g pnpm@11.1.1" to update.         │
#10 1.781    │                                                                  │
#10 1.781    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#10 1.781    │                                                                  │
#10 1.781    ╰──────────────────────────────────────────────────────────────────╯
#10 1.781 
#10 2.046 Progress: resolved 899, reused 0, downloaded 34, added 30
#10 3.053 Progress: resolved 899, reused 0, downloaded 154, added 153
#10 4.061 Progress: resolved 899, reused 0, downloaded 316, added 314
#10 5.061 Progress: resolved 899, reused 0, downloaded 404, added 402
#10 6.061 Progress: resolved 899, reused 0, downloaded 507, added 497
#10 7.065 Progress: resolved 899, reused 0, downloaded 551, added 537
#10 8.062 Progress: resolved 899, reused 0, downloaded 638, added 629
#10 9.062 Progress: resolved 899, reused 0, downloaded 699, added 689
#10 10.06 Progress: resolved 899, reused 0, downloaded 794, added 792
#10 ...

#9 [backend builder  5/11] RUN pnpm install --frozen-lockfile
#9 10.14 Progress: resolved 1158, reused 0, downloaded 839, added 832
#9 11.15 Progress: resolved 1158, reused 0, downloaded 898, added 888
#9 12.15 Progress: resolved 1158, reused 0, downloaded 959, added 956
#9 13.15 Progress: resolved 1158, reused 0, downloaded 1086, added 1086
#9 14.15 Progress: resolved 1158, reused 0, downloaded 1157, added 1157
#9 14.24 Progress: resolved 1158, reused 0, downloaded 1158, added 1158, done
#9 14.71 .../node_modules/unrs-resolver postinstall$ napi-postinstall unrs-resolver 1.11.1 check
#9 14.71 .../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
#9 14.71 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#9 14.71 .../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
#9 14.74 .../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
#9 14.81 .../node_modules/unrs-resolver postinstall: Done
#9 14.82 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#9 14.83 .../node_modules/react-native-pjsip postinstall: sh: bash: not found
#9 14.83  ELIFECYCLE  Command failed.
#9 ...

#10 [backend deps 5/5] RUN pnpm install --frozen-lockfile --prod
#10 11.07 Progress: resolved 899, reused 0, downloaded 847, added 838
#10 11.88 Progress: resolved 899, reused 0, downloaded 899, added 899, done
#10 12.66 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#10 12.66 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#10 12.69 .../node_modules/react-native-pjsip postinstall: sh: bash: not found
#10 12.69  ELIFECYCLE  Command failed.
#10 ERROR: process "/bin/sh -c pnpm install --frozen-lockfile --prod" did not complete successfully: exit code: 1

#9 [backend builder  5/11] RUN pnpm install --frozen-lockfile
#9 ERROR: process "/bin/sh -c pnpm install --frozen-lockfile" did not complete successfully: exit code: 1
------
 > [backend deps 5/5] RUN pnpm install --frozen-lockfile --prod:
7.065 Progress: resolved 899, reused 0, downloaded 551, added 537
8.062 Progress: resolved 899, reused 0, downloaded 638, added 629
9.062 Progress: resolved 899, reused 0, downloaded 699, added 689
10.06 Progress: resolved 899, reused 0, downloaded 794, added 792
11.07 Progress: resolved 899, reused 0, downloaded 847, added 838
11.88 Progress: resolved 899, reused 0, downloaded 899, added 899, done
12.66 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
12.66 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
12.69 .../node_modules/react-native-pjsip postinstall: sh: bash: not found
12.69  ELIFECYCLE  Command failed.
------
------
 > [backend builder  5/11] RUN pnpm install --frozen-lockfile:
14.24 Progress: resolved 1158, reused 0, downloaded 1158, added 1158, done
14.71 .../node_modules/unrs-resolver postinstall$ napi-postinstall unrs-resolver 1.11.1 check
14.71 .../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
14.71 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
14.71 .../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
14.74 .../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
14.81 .../node_modules/unrs-resolver postinstall: Done
14.82 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
14.83 .../node_modules/react-native-pjsip postinstall: sh: bash: not found
14.83  ELIFECYCLE  Command failed.
------
failed to solve: process "/bin/sh -c pnpm install --frozen-lockfile --prod" did not complete successfully: exit code: 1
```
