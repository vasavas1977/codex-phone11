# Full backend packaging

This packages the real authenticated server and its four existing entry points. It does not start an API, run migration SQL, contact a provider or establish compatibility with the current live application.

The public API currently reports the opaque build label `team-chat-media-d41fc504` on 43.209.112.208. That suffix is not verified Git ancestry. The owner-selected PBX host 43.210.122.111 is separate. Observe the actual container/route/app-auth-PBX database topology before choosing deployment configuration; do not move the API or point a candidate at production by default. Root's new protected PBX backup has a separate actual review; it is not automatically a backup of the API's unknown database.

## Build inputs

`public-inputs/` preserves anonymous primary registry metadata GET results. The official immutable Node22-alpine index is pinned in the Dockerfile; its recorded AMD64 and ARM64 images report Node22.23.3. This is an explicit update from the earlier qualification Node22.23.2. This source author did not run a Node22.23.3 image or compiler; Root's later genuine CI build evidence is separate.

The public pin file fixes pnpm9.12.0 with its SHA512 Corepack specification, esbuild0.25.12 and both Linux native package integrities, the unchanged package/lock and four patches. Docker's two installs use `--frozen-lockfile --ignore-scripts`; the root mobile installer, Expo prebuild and dependency postinstalls cannot acquire SDKs or execute implicitly. The build helper resolves the installed architecture-specific esbuild binary directly; it does not use esbuild's installer/download fallback. Package installs still require controlled public registry access in the future ordinary build. No registry credentials belong in context or build arguments.

Complete production `node_modules` trees are retained. The source-linked phone11-siprix package target is copied so its declared link is not dangling; no private/vendor SDK is included. JPEG/WebP decoder JS and WASM must exist with the expected package versions and valid WASM headers before compiling. These eager decoder paths matter even with scheduled background workers disabled. Native/package functional compatibility remains an actual image/staging test.

## Exact public context

`infra/docker/backend/context-files.json` is an exact file allowlist. `.dockerignore` denies every other path. The helper opens the selected regular single-link source leaves without following links, holds them through copying, rechecks metadata, and copies only public tracked inputs. Env/key/registry config/vendor SDK paths are rejected before reading. It checks each selected file against the actual HEAD blob, without reading unrelated workspace files through Git status. Untracked declared packaging inputs may be inspected during review but cannot produce a release context. Dirty or unmatched source refuses preparation.

After Root reviews/integrates the exact commit, the ordinary preparation command is:

```sh
python3 -I -B scripts/prepare-phone11-backend-context.py --prepare "$RUNNER_TEMP/phone11-backend-context"
```

The new private output directory must not exist. Existing paths and partial failures are retained; no automatic cleanup or source mutation occurs. `--check` reads public source only and can describe an unfinished working tree without declaring it release ready. It is not an image build.

The existing workflow remains manually dispatched, with the same permissions. Its boolean `publish` defaults to true, preserving the AWS/ECR push path, and now refuses a missing exact `cloudphone11/backend` repository before building; it never creates resources. The currently observed PBX AWS account lacks this repository, while the CI credentials' account identity remains unverified. Do not infer a publishing destination or create one from that observation.

With `publish=false`, region validation, AWS credentials and ECR login/repository checks are skipped. The native AMD64 job loads only the local `phone11-backend-check:<commit>` image with push disabled. A finite JSON artifact records its inspected image ID, matching revision and Linux/AMD64 platform; it contains no full image, environment or configuration. This is a genuine build check when separately dispatched, and does not establish application readiness.

Both modes prepare the exact public context and pass the GitHub commit as PHONE11_BUILD_SHA. The available ARM64 base descriptor does not create an ARM64 CI/emulation claim. If actual topology requires ARM64, separately select/review an appropriate native runner before dispatch. No workflow was dispatched here.

## Isolated process smoke in build-only CI

After image metadata, build-only CI runs `smoke-phone11-backend-image.py`. It binds that exact loaded image ID/revision/platform, refuses image volumes, then creates one commit/nonce-labelled container with pull disabled, network none, no published ports, read-only root, UID1001, dropped capabilities, no-new-privileges, 128 PIDs, 512MiB RAM/no extra swap, one CPU and a 64MiB non-executable tmpfs. The Docker client uses a new empty private config and fixed local socket with a clean environment. Only explicit synthetic unused loopback-port1 DB/cache/ESL settings and synthetic auth/SIP secrets enter the container. No production credentials are inherited.

The real image command starts `dist/index.mjs` as api-candidate. The only request is an inside-container Node/fetch probe of `/api/health`, with a 30s deadline and exact build/service/role/field checks. No auth, tRPC, migration, provider or customer request runs. Ownership/image/security are checked before exec and stop; cleanup rechecks nonce/name/image/ID before removing only that container. Passing also requires graceful exit0, no OOM and removal. The Docker command budget is 120s, with 90s for primary work and 30s reserved for cleanup; the outer workflow step is bounded to 3min. Unknown creation or ownership/cleanup failures remain refusals and never trigger another create attempt or shared cleanup.

Local container logs are capped at 16KiB/one file. On failure, an ownership-checked reader caps collection to 64 lines, 16384 bytes and 10s, emits only a finite matching-log classification (not an established root cause), and retains bytes in a new file with mode 0600 at `$RUNNER_TEMP/phone11-backend-smoke-private.log` before owned cleanup. That private path is never printed or uploaded. An explicitly authorized operator may inspect it host-privately before runner teardown; its persistence after teardown is not claimed. An unknown failure must be diagnosed before a rerun. The public one-day artifact contains only finite smoke/identity/cleanup fields; it never contains raw logs, configuration or environment.

This proves process startup/health/shutdown only when the future CI step actually runs. It does not establish DB/auth readiness,27-handler acceptance, live feature compatibility or permission to deploy. Current focused tests substitute Docker, use owned public child processes for byte/deadline handling, and execute the exact health JavaScript in a VM with substituted fetch; no image or application starts in these tests.

## Fixed-start diagnostic successor and public runtime permissions

Root's e737 build-only run 38847312390 built the image but refused at container start: start was dispatched, health was not accepted, the owned stopped container reported exit 128/no OOM, and owned cleanup completed. Its Docker-start stderr was not retained and application logs were unavailable. The cause remains unknown; no application startup was established. Preserve that failed receipt and diagnose before another run.

The optional typed `diagnose_start` dispatch input defaults to false and refuses `publish=true` before AWS setup. With it enabled, the same image identity, container arguments, synthetic settings and security/resource limits apply. There is one start attempt, no fallback or retry. Only that fixed `docker container start <owned-id>` stderr is captured (4096 bytes, 15s within the existing deadline). After the exact name/nonce/image/ID check, failed start may read only `docker container inspect --format '{{.State.Error}}' <same-id>` (4096 bytes plus its framing newline, 5s); unexpected inspect stderr refuses that observation. Diagnostic mode never reads application logs.

Generated synthetic credential values are redacted before retaining these two fields. A new exclusive mode 0600 runner-private file contains redacted start stderr followed by redacted State.Error, with no separator; finite `startStderrBytes` and `stateErrorBytes` provide the split, and the combined cap is 8192 bytes. Public output contains only exit/timeout/truncation/presence flags and fixed matching-token booleans/classes for OCI, errno and resource categories. A matching token does not establish the cause. Unknown stays unknown; raw text, paths, configuration, environment and hashes of raw errors are not exported. Ownership mismatch prevents State.Error collection, private diagnostic writing and deletion.

The current repository is public: raw fields stay runner-private and may be lost at teardown. No public diagnostic artifact contains them. Only if GitHub's actual repository-private flag is true does the workflow permit a separate one-day raw diagnostic artifact for an authorized private inspection; it contains those two redacted fields only. Finite smoke evidence remains the existing one-day JSON artifact. The existing non-diagnostic mode retains its earlier bounded application-log behavior.

A separate public COPY fixture proved that a mode 0600 context file remains root-owned 0600 after Docker COPY, unreadable by UID1001. Its receipt is `PUBLIC-COPY-MODE-ad43ae58c60348ccaf0a4437fe1ea400.json`, SHA256 `6ce156a6cfb302ab1bd14ed1d3baa648f6660637d26ad1d6f7bc9609d71ab6ae` (679 bytes). It did not start an application and does not identify the e737 exit 128 cause. The context helper requests 0644 public files subject to the process umask, and creates 0700 private directories. The final image now makes only copied public `/app` code readable/traversable (`a+rX`) and removes group/other write, keeping root ownership. Private host context/source modes and mutable data are unchanged. A network-disabled build check runs as the final runtime user, requiring readable package/bundle/link/decoder/WASM assets and a nonwritable `/app` before the image completes. Local mode fixtures test these permission masks; a real UID1001 image check remains for the next reviewed CI build.

The v5 stop correction uses `--timeout 10` in place of deprecated `--time 10`. [Docker CLI v28.0.4 source](https://github.com/docker/cli/blob/v28.0.4/cli/command/container/stop.go#L43-L64) registers `--timeout` and maps both spellings to the same timeout value, while marking `--time` deprecated; the [official stop reference](https://docs.docker.com/reference/cli/docker/container/stop/) documents the canonical option. The ten-second grace period, default signal, security recipe, deadlines and strict empty-stderr requirement remain unchanged. This prevents the known deprecation warning path; a genuine CI stop with this successor has not run. It is separate from the earlier failed start and does not establish its exit 128 cause.

## Four real outputs

The compiler builds index.mjs, auth-admin.mjs, conference-readiness.mjs and profile-photo-worker.mjs from their existing source entries. It keeps packages external, records metafiles/output hashes/compiler/platform/decoder hashes and the source-context identity, refuses compiler warnings/timeouts or missing assets, and never imports application code. Compile runs with network disabled. The final image checks its revision against this build record, keeps UID1001, and starts `node dist/index.mjs`; the unrelated package.json `start` path is not used.

## Staging and rollout limits

Do not infer that this source matches or supersets the opaque live build. First build and inspect the actual ordinary image under a controlled build record. Stage it with `PHONE11_RUNTIME_ROLE=api-candidate`, one exact PORT and loopback-only publication, fresh clone-only DB/auth settings, separate private cache/media and no provider writes. The image preserves the existing default runtime behavior; it does not silently select a serving worker topology. Candidate role disables scheduled services but real request handlers can still write, so never reuse production connection settings wholesale.

Verify exact build/role, auth readiness, all27 audited operations with owned synthetic users/tenants, cross-tenant/revocation boundaries, restricted actual audit storage and persisted business/audit outcomes. Existing green source/PG16 CI is useful evidence, not this artifact's runtime proof. Preserve the current API route/image and test an application rollback before a narrow cutover. A code rollback is not a database restore; never replay the uncertain1948 migration or restore over new customer writes. Phones/Android/provider calling remain separate.

Focused source checks:

```sh
python3 -I -B tests/phone11-backend-context.test.py
node --test tests/phone11-backend-build.test.mjs
node --test tests/phone11-backend-workflow.test.mjs
python3 -I -B tests/phone11-backend-smoke.test.py
python3 -I -B tests/phone11-backend-start-diagnostic.test.py
python3 -I -B tests/phone11-backend-runtime-modes.test.py
node scripts/build-phone11-backend.mjs --verify-install-inputs
python3 -I -B scripts/prepare-phone11-backend-context.py --check
```

Compiler tests substitute an owned fake executable at the spawn boundary and never execute real esbuild, package code or a server. No Docker build/install/process smoke was run by this source author; Root's separate genuine build evidence must be assessed separately. Node22.23.3 application/staging compatibility, paid SDK/license/provider and phone acceptance are not implied by these source fixtures.
