# Phone11 read receipts backend rollout plan

Status: source-only preparation. This document does not authorize or record an
image build, migration, candidate startup, proxy change, credential use, message
write, or production deployment.

## Evidence boundary

The following are fresh root observations supplied on 20 September 2026. They
were not independently re-read while writing this plan:

- `cp11-backend` container ID
  `f9ce934dc51b531fe1a9b2bd927634322f9c6c572a551592a48d3e0d26a49616`
  was running image
  `sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619`.
- The old reviewed conference source was present at
  `/opt/phone11ai/conference-pilot-20260920/source`.
- Its `Dockerfile.conference` starts from that immutable active image and copies
  only `dist/index.mjs`, `conference-readiness.mjs`,
  `conference-fixture.mjs`, and
  `phone11-plain-video-admission-preflight.mjs` into `/app/dist`.
- The old source hashes were:

  | Path | Observed SHA-256 |
  | --- | --- |
  | `server/chat/service.ts` | `32bf360b3b3eec4ee5f0d0be5cac21aa2b19c87113fd9b817c3ef1bd96e97cba` |
  | `server/chat/router.ts` | `3602130f54997ad4404657cab9a6c6ae453a836e1f9a80a5d00c81acab2aa78d` |
  | `server/_core/index.ts` | `e3c23639a8f18a63a53c02e93d1843a1cc4b0114765151d74d1ed0443543341b` |
  | `package.json` | `f06986899b3c4ae650998a52d1fe07ea99268f9bb468030d87ec0726113ca010` |
  | `pnpm-lock.yaml` | `54da5c1566fd81dc32b17a916fa428500ad6f94516d2d7f0eaac17b5e15d9650` |

  `lib/chat/types.ts`, `server/chat/typing.ts`,
  `server/_core/runtime-role.ts`, and the read-receipt migration were absent.

The repository documents an earlier snapshot of the same active image, port
3000 ownership, direct wake target, Nginx routing, and free candidate port in
`PARALLEL-API-ACTIVATION-CONTRACT-20260920.md`. Those values are historical
documentation and must be freshly pinned. Neither that document nor the root
source observation establishes the database's current schema.

Local source was verified at `7d5524233bb780f56c6789e11f67caf24252c9be`.
The six candidate files retain the accepted application bytes from receipt
commit `a0f5c463e9a09ef3ca43f53a4de5dae6f54651e5`; the later operator commit does
not change them. The unrelated untracked `pnpm-workspace.yaml` is excluded.

## Exact source overlay

Create a new protected staging directory from the old reviewed conference
source. Never edit or package that source directory in place. Verify all five
old hashes above before copying anything, and stop on any extra local change.
Extract only these six paths from immutable commit `a0f5c463e9a09ef3ca43f53a4de5dae6f54651e5`:

| Path | SHA-256 | Purpose |
| --- | --- | --- |
| `lib/chat/types.ts` | `26b1dc50db71de66c0129960dad5fe67ee882d713d1f83103eed1edf749a12ae` | Build-time presence and receipt types; erased from the runtime bundle |
| `server/chat/typing.ts` | `d2a8f78e5c5770f7e184326c1af91337c071befd80e12f5c247e9ea0a0fe72bf` | Process-local, bounded typing leases |
| `server/chat/service.ts` | `91908bb40bdea305561f8234bf7114818a93b3efd11bad068d61b72e8e5a027a` | Presence leases, typing authorization, receipt writes and sender-only reads |
| `server/chat/router.ts` | `19e609c80d0d0223810eab382aa92a3f3d5aa7b325689335177f1e185c293809` | Owner-bound additive tRPC procedures |
| `server/_core/runtime-role.ts` | `d0a387f084c89855c91daee919311fb0dd0b238a29686bc12cc7b5a50a888fc8` | Candidate role and no-worker lifecycle |
| `server/_core/index.ts` | `56da03a43bd2a0372a61604146eb6871c5a20bed1c529f751f6c989c6a7e1376` | Exact port, health role, and guarded worker startup |

This is a cohesive overlay. Do not copy only the receipt procedures: the new
service imports `server/chat/typing.ts`, and the new entry point imports
`server/_core/runtime-role.ts`. `lib/chat/types.ts` is type-only but is required
to compile. `server/routers.ts` is unchanged and already registers `chatRouter`.

The bundle still depends on the old conference source's existing
`server/chat/media.ts`, `intelligence.ts`, `link-preview.ts`,
`office-package.ts`, chat-notification repository, `server/pbx/db.ts`, meeting
routers, and all other server modules reachable from `server/_core/index.ts`.
Preserve those files exactly. The new runtime code adds no external package:
typing and runtime-role use platform facilities, while `pg`, `zod`, Express and
tRPC were already required by the old bundle. Preserve the observed remote
`package.json` and lockfile; do not substitute the local dependency manifests.

## Candidate build recipe

1. Copy the old reviewed conference source into a new root-owned, mode-0700
   staging directory and record a complete file manifest. Keep the old source
   and its existing candidate artifacts unchanged for comparison and rollback.
2. Verify the old hashes, then extract the six files above directly from
   `a0f5c463e9a09ef3ca43f53a4de5dae6f54651e5`. Recompute and compare every
   overlay hash before building.
3. Use the old source's exact dependency manifest, lockfile and reviewed build
   toolchain. Install no newer dependency and do not run mobile/native lifecycle
   scripts. Compile only the backend entry point with the existing contract:

   ```text
   pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
   ```

   Run the build in an isolated environment with the frozen dependency closure.
   Record the tool versions, input manifest and `dist/index.mjs` SHA-256.
4. Retain the three already reviewed conference utility artifacts byte-for-byte,
   or rebuild them only through their separately reviewed recipe and prove their
   hashes equal the prior candidate. Do not silently mix newly generated utility
   programs into this chat/runtime overlay.
5. Retain `Dockerfile.conference` except for its newly pinned build context.
   Its `FROM` must remain the exact active image digest above and its only file
   additions must remain the four `/app/dist` artifacts. Build an immutable
   image, record its digest and build marker, and inspect its history/filesystem
   diff before creating any runtime manifest.
6. Run backend compilation, the runtime/startup tests, focused owner/typing/read
   receipt suites, and the disposable PostgreSQL chat suite. At minimum include
   `phone11-runtime-role`, `phone11-api-candidate-startup`,
   `phone11-chat-owner`, `phone11-chat-typing`,
   `phone11-chat-read-receipts`, and `phone11-chat-postgres`. A real startup
   check must prove `api-candidate` binds exactly port 3002 and starts none of
   the chat-notification, media-retention, recording, ESL, or WebSocket shutdown
   owners.

Do not use the dirty canonical tree, its untracked workspace file, local
`package.json`, or local lockfile as the remote build context.

## Ordered migration artifact

Create one reviewed migration artifact whose manifest lists these files in this
exact order. The artifact hash remains unknown until that immutable ordered
artifact is created; do not put an individual SQL hash into the receipt as if it
covered the complete sequence.

| Order | Path | SHA-256 | Required relationship |
| --- | --- | --- | --- |
| 1 | `server/chat/migration.sql` | `e4f16299d310ac480e1007b3d79c3b35fcc92242de5a6fd64b326e371e772b3c` | Base conversations, members, messages, blocks and reports |
| 2 | `server/chat/collaboration-migration.sql` | `54f31fc541e4232544be318ff75b3abe0d25d2703debcffcc2bbd918645cac66` | Collaboration tables and database-backed presence sessions |
| 3 | `server/chat/media-migration.sql` | `4ebb3a6626c27289cb1a00e6cbf46e8776716409e07df5fc22c2f781f74c4dc2` | Required by existing history/media hydration in the full chat service |
| 4 | `server/chat/read-receipts-migration.sql` | `ef59764f767dc9b7fe717d1e464d049fcf74430d605d0fabca3e5c79077f3c98` | Explicit server-time per-message receipts |

Typing is process-local and has no migration. Conference admission migrations
and their proof remain separate; a chat migration receipt must not advertise
conference readiness.

Before any migration decision, perform a fresh read-only schema preflight on
the exact owned-auth database. Read only catalog metadata: database/server
identity fingerprint; `to_regclass` results; columns, types, defaults, nullability,
constraints, indexes, owners and grants for the required auth and
`phone11_chat_*` objects. Confirm the `users`, `tenants`, `tenant_memberships`,
`user_extensions`, and active-extension schema used by authorization. Do not
query message, member, receipt, credential, or other customer rows. Treat every
table as unknown until this preflight is recorded.

Rehearse the exact ordered artifact against a disposable restore or schema clone
with bounded `lock_timeout` and `statement_timeout`. Review locks and estimated
work before applying. In production, use the separately approved migration
mechanism, one controlled transaction boundary per reviewed artifact policy,
then repeat catalog-only verification. Produce a root-owned
`phone11-migration-receipt/v1` containing the aggregate artifact SHA-256,
database fingerprint and verification SHA-256. The parallel operator must pin
the receipt file hash. No source-only evidence substitutes for this receipt.

## Protected candidate and probe requirements

Generate a fresh root-owned candidate Compose file and pin its source and
rendered hashes. It must contain only service `candidate`, immutable candidate
image digest, container `cp11-api-candidate`,
`PHONE11_RUNTIME_ROLE=api-candidate`, `PORT=3002`, exact build marker, and only
`127.0.0.1:3002:3002/tcp`. Preserve the existing protected conference config by
reference. The reviewed operator rejects privileged mode, host PID/IPC, devices,
added capabilities, drifted rendering, and any public origin other than the
literal `https://api.phone11.ai`.

Create a new root-owned protected probe bundle; never place session tokens,
cookies, Connect11 keys, user names, or message text in this document or normal
logs. Every Chat probe must use the existing authenticated session and an
`X-Phone11-Chat-Owner` value equal to that authenticated user's numeric ID. The
header is an equality assertion, not authority.

The operator's five exact labels must prove:

- `existing_phone`: an authenticated existing phone read remains compatible;
- `existing_chat`: an authorized pilot recipient can query presence capability,
  publish an inactive typing state, and idempotently publish one receipt for a
  dedicated non-customer fixture message;
- `conference`: the admitted pilot capability stays bounded to the mapped
  tenant and returns no credential or token in captured output;
- `mixed_batch`: an authenticated sender-bound batch combines an existing phone
  read with receipt summary/details for that sender's dedicated fixture and
  confirms the expected reader identity structurally, without logging its name;
- `denied_tenant`: an authenticated but unauthorized tenant/member request stays
  denied and returns no data.

Use two explicitly authorized pilot principals for the receipt write and
sender-only read. Their protected headers may differ by probe. The receipt write
is safe to repeat because the database key is idempotent and the timestamp is
server-generated first-read time. Pin exact paths, methods, bodies, response
status, required structural fragments and forbidden credential/token fragments.
Run the same bundle directly on loopback before routing and through the exact
public origin afterward. Do not use notifications, search, inbox previews, or
`last_read_sequence` to create a receipt.

## Activation acceptance and rollback

Before activation, freshly pin the active container/runtime fingerprint, image,
health build, candidate image/build/config, protected credential files,
migration receipt, probes, Nginx site/full dump, Kamailio config/wake occurrence
count, port 3002 availability and absent candidate name. These are currently
unknown even where an earlier snapshot exists.

Successful preparation must still report `activation=NOT_RUN`. A separately
authorized activation reruns every guard, starts only the loopback candidate,
proves its health role/build and disabled workers, runs protected direct probes,
and confirms the original container ID and direct wake target are unchanged.
Only then may exact `/api/trpc` and `/api/trpc/` routing move to the candidate.

After routing, repeat public probes and verify:

- existing calling, chat and conference API contracts;
- presence lease states and inactive typing cleanup;
- direct receipt publication, sender-only named details, first-read timestamp
  stability, and root/thread separation using only dedicated pilot fixtures;
- cross-tenant, revoked-member, inactive-extension and bilateral-block denial;
- `cp11-backend` remains running on port 3000 as the sole background worker and
  wake owner.

Proxy rollback restores only the exact saved Nginx site and gracefully reloads;
it does not stop either backend. Keep the candidate running until outstanding
requests drain. Additive chat schema remains in place on rollback: never drop
receipt, presence, media, message, or membership data. Confirm public API routes
again use the original backend and the direct wake target remains port 3000.
Stopping/removing the drained candidate is a later separately reviewed action.

Finally run two-iPhone acceptance for direct/group/thread receipts, presence,
typing, foreground/background transitions, app-to-app calling, locked-screen
ringing and two-way audio. Source, migration, API probes and signed installation
are separate evidence layers.

## Unresolved inputs that block activation

- Fresh immutable candidate image digest, build marker, four output-artifact
  hashes, image history and filesystem-diff review.
- Fresh read-only live schema inventory, migration rehearsal, applied aggregate
  artifact hash, database fingerprint, verification hash and pinned receipt.
- Fresh candidate Compose source/rendered hashes and proof that protected env
  resolution yields the pinned model without exposing values.
- Fresh protected credential file hashes and safe authentication results.
- A reviewed two-principal probe bundle with exact owner binding and no customer
  content or secrets in its expected output.
- Fresh active runtime, health, Nginx, Kamailio, port and candidate-absence pins.
- Independent final operator review after the durability correction.
- Authorized activation, public-route evidence, signed candidate installation,
  and two-iPhone chat/calling/conference acceptance.
