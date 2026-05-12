# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T16:08:25+00:00
- Workflow commit: 7bd3313cc170c093afc95824a4db77572f9ce6b7
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-12T16:08:04+00:00
GitHub SHA: 7bd3313cc170c093afc95824a4db77572f9ce6b7
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
hint: Using 'master' as the name for the initial branch. This default branch name
hint: is subject to change. To configure the initial branch name to use in all
hint: of your new repositories, which will suppress this warning, call:
hint: 
hint: 	git config --global init.defaultBranch <name>
hint: 
hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and
hint: 'development'. The just-created branch can be renamed via this command:
hint: 
hint: 	git branch -m <name>
Initialized empty Git repository in /opt/phone11ai/codex-phone11-deploy/.git/
From https://github.com/vasavas1977/codex-phone11
 * branch            7bd3313cc170c093afc95824a4db77572f9ce6b7 -> FETCH_HEAD
Note: switching to 'FETCH_HEAD'.

You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

Or undo this operation with:

  git switch -

Turn off this advice by setting config variable advice.detachedHead to false

HEAD is now at 7bd3313 Redeploy mobile branch backend after Docker fix
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-12T16:08:06Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 2.27kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.1s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend builder  1/12] FROM docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
#4 resolve docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f 0.0s done
#4 DONE 0.0s

#5 [backend internal] load build context
#5 transferring context: 786.71kB 0.0s done
#5 DONE 0.0s

#6 [backend builder  2/12] WORKDIR /app
#6 CACHED

#7 [backend builder  3/12] RUN apk add --no-cache bash
#7 CACHED

#8 [backend builder  4/12] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#8 CACHED

#9 [backend builder  5/12] COPY package.json pnpm-lock.yaml ./
#9 DONE 0.0s

#10 [backend builder  6/12] RUN pnpm install --frozen-lockfile
#10 0.908 Lockfile is up to date, resolution step is skipped
#10 1.074 Progress: resolved 1, reused 0, downloaded 0, added 0
#10 1.372 Packages: +1158
#10 1.372 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#10 1.767 
#10 1.767    ╭──────────────────────────────────────────────────────────────────╮
#10 1.767    │                                                                  │
#10 1.767    │                Update available! 9.12.0 → 11.1.1.                │
#10 1.767    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.1.1   │
#10 1.767    │         Run "corepack install -g pnpm@11.1.1" to update.         │
#10 1.767    │                                                                  │
#10 1.767    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#10 1.767    │                                                                  │
#10 1.767    ╰──────────────────────────────────────────────────────────────────╯
#10 1.767 
#10 2.076 Progress: resolved 1158, reused 0, downloaded 23, added 15
#10 3.085 Progress: resolved 1158, reused 0, downloaded 151, added 143
#10 4.084 Progress: resolved 1158, reused 0, downloaded 310, added 310
#10 5.087 Progress: resolved 1158, reused 0, downloaded 456, added 456
#10 6.087 Progress: resolved 1158, reused 0, downloaded 524, added 523
#10 7.089 Progress: resolved 1158, reused 0, downloaded 557, added 548
#10 8.089 Progress: resolved 1158, reused 0, downloaded 620, added 617
#10 9.089 Progress: resolved 1158, reused 0, downloaded 671, added 658
#10 ...

#11 [backend deps 6/6] RUN pnpm install --frozen-lockfile --prod
#11 0.910 Lockfile is up to date, resolution step is skipped
#11 1.021 Progress: resolved 1, reused 0, downloaded 0, added 0
#11 1.316 Packages: +899
#11 1.316 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#11 1.683 
#11 1.683    ╭──────────────────────────────────────────────────────────────────╮
#11 1.683    │                                                                  │
#11 1.683    │                Update available! 9.12.0 → 11.1.1.                │
#11 1.683    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.1.1   │
#11 1.683    │         Run "corepack install -g pnpm@11.1.1" to update.         │
#11 1.683    │                                                                  │
#11 1.683    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#11 1.683    │                                                                  │
#11 1.683    ╰──────────────────────────────────────────────────────────────────╯
#11 1.683 
#11 2.022 Progress: resolved 899, reused 0, downloaded 41, added 32
#11 3.027 Progress: resolved 899, reused 0, downloaded 167, added 163
#11 4.029 Progress: resolved 899, reused 0, downloaded 336, added 331
#11 5.030 Progress: resolved 899, reused 0, downloaded 469, added 469
#11 6.032 Progress: resolved 899, reused 0, downloaded 523, added 518
#11 7.049 Progress: resolved 899, reused 0, downloaded 558, added 550
#11 8.034 Progress: resolved 899, reused 0, downloaded 640, added 635
#11 9.036 Progress: resolved 899, reused 0, downloaded 695, added 685
#11 10.04 Progress: resolved 899, reused 0, downloaded 739, added 731
#11 ...

#10 [backend builder  6/12] RUN pnpm install --frozen-lockfile
#10 10.09 Progress: resolved 1158, reused 0, downloaded 716, added 710
#10 11.10 Progress: resolved 1158, reused 0, downloaded 787, added 781
#10 12.10 Progress: resolved 1158, reused 0, downloaded 837, added 826
#10 13.10 Progress: resolved 1158, reused 0, downloaded 939, added 939
#10 14.10 Progress: resolved 1158, reused 0, downloaded 1029, added 1029
#10 15.08 Progress: resolved 1158, reused 0, downloaded 1158, added 1158, done
#10 15.50 .../node_modules/unrs-resolver postinstall$ napi-postinstall unrs-resolver 1.11.1 check
#10 15.50 .../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
#10 15.50 .../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
#10 15.50 .../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
#10 15.51 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#10 15.62 .../node_modules/unrs-resolver postinstall: Done
#10 15.63 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#10 15.64 .../node_modules/react-native-pjsip postinstall: libs.sh: line 4: type: curl: not found
#10 15.64 .../node_modules/react-native-pjsip postinstall: Missed curl dependency
#10 15.64 .../node_modules/react-native-pjsip postinstall: Failed
#10 15.64  ELIFECYCLE  Command failed with exit code 1.
#10 ...

#11 [backend deps 6/6] RUN pnpm install --frozen-lockfile --prod
#11 11.04 Progress: resolved 899, reused 0, downloaded 822, added 819
#11 12.04 Progress: resolved 899, reused 0, downloaded 866, added 853
#11 12.58 Progress: resolved 899, reused 0, downloaded 899, added 899, done
#11 13.31 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#11 13.32 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#11 13.57 .../node_modules/react-native-pjsip postinstall: libs.sh: line 4: type: curl: not found
#11 13.57 .../node_modules/react-native-pjsip postinstall: Missed curl dependency
#11 13.57 .../node_modules/react-native-pjsip postinstall: Failed
#11 13.58  ELIFECYCLE  Command failed with exit code 1.
#11 ERROR: process "/bin/sh -c pnpm install --frozen-lockfile --prod" did not complete successfully: exit code: 1

#10 [backend builder  6/12] RUN pnpm install --frozen-lockfile
#10 ERROR: process "/bin/sh -c pnpm install --frozen-lockfile" did not complete successfully: exit code: 1
------
 > [backend deps 6/6] RUN pnpm install --frozen-lockfile --prod:
10.04 Progress: resolved 899, reused 0, downloaded 739, added 731
11.04 Progress: resolved 899, reused 0, downloaded 822, added 819
12.04 Progress: resolved 899, reused 0, downloaded 866, added 853
12.58 Progress: resolved 899, reused 0, downloaded 899, added 899, done
13.31 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
13.32 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
13.57 .../node_modules/react-native-pjsip postinstall: libs.sh: line 4: type: curl: not found
13.57 .../node_modules/react-native-pjsip postinstall: Missed curl dependency
13.57 .../node_modules/react-native-pjsip postinstall: Failed
13.58  ELIFECYCLE  Command failed with exit code 1.
------
------
 > [backend builder  6/12] RUN pnpm install --frozen-lockfile:
15.50 .../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
15.50 .../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
15.50 .../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
15.51 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
15.62 .../node_modules/unrs-resolver postinstall: Done
15.63 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
15.64 .../node_modules/react-native-pjsip postinstall: libs.sh: line 4: type: curl: not found
15.64 .../node_modules/react-native-pjsip postinstall: Missed curl dependency
15.64 .../node_modules/react-native-pjsip postinstall: Failed
15.64  ELIFECYCLE  Command failed with exit code 1.
------
failed to solve: process "/bin/sh -c pnpm install --frozen-lockfile --prod" did not complete successfully: exit code: 1
```
