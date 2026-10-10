# Phone11 profile/DND: 3010 topology source handoff

**State:** source adaptation only. No production manifest, container, route,
database, tenant setting, provider session, or SIP state was changed by this
work. This document is not authorization to run the rollout.

## Observed starting topology (26 September read-only inventory)

The VoIP host's default worker remains `cp11-backend` on loopback 3000, build
`team-chat-media-d41fc504`, with ordinary chat notifications enabled. The
public tRPC pair routes to workerless `cp11-api-candidate-chat-inbox` on 3010,
source label `2d125819a7f1713f05b3eaa3bcbf5e5672a84e0c`. Its Nginx
candidate header still says `channel-meetings-9aab162`; that header is a route
pin, not evidence of the currently serving image's source. The insertion
marker follows other authentication locations, rather than immediately
following the tRPC pair. The live database has the ordinary notification
outbox but neither workspace profile table.

Eight older API candidates occupy 3002 through 3009, and the independent
`cp11-profile-photo-worker` runs `node dist/profile-photo-worker.mjs` with no
published port. The original v2 operator rejected all of these as unknown.
The v4 source accepts older workers only when individually pinned in
`current.parked`; it never accepts a general `cp11-*` wildcard. The operator
still rejects every unlisted Phone11-like process and more than one default
worker. Production Compose infrastructure containers are recognized only with exact
`current.infrastructure` ID, image, runtime hash, name/project/service
identity, and no Phone11 runtime flags.

The active 3010 candidate is a standalone overlay without Compose
project/service labels. The operator preserves it and stages a distinct
Compose-managed `cp11-api-candidate-profile-dnd` on loopback 3012. Both 3012
and that container name were unused in the read-only inventory. A future
inventory must verify that again before any start.

## Current manifest shape

`current.parked` is a list of exact observations, not an allow-all policy. A
parked API entry contains `name`, full `container_id`, immutable `image`,
`runtime_sha256`, `kind: "api-candidate"`, its unique loopback `port`, exact
`build`, and its 40-character `source_sha` label or explicit `null` when the
label is absent. The old 3002 container currently lacks that source label;
its runtime and image must still be pinned and its absence rechecked. The
photo worker uses `kind: "profile-photo-cleanup"`, `port: null`, `build: null`,
and a required source SHA. The pinned canonical runtime hash covers its
environment, mounts, command, image, networks, and Docker labels without
placing environment values in the manifest.

`current.infrastructure` records each existing production Compose PostgreSQL,
Redis, FreeSWITCH, Kamailio, Flexisip, and RTPEngine container's exact name,
full ID, immutable image ID, and canonical runtime hash. The hash binds its
command, entrypoint, environment, mounts, ports, networks, and Docker labels.
An arbitrary image or worker command under an infrastructure name cannot pass
against the reviewed pin. An unpinned infrastructure name also blocks.

`nginx.candidate_header` pins the currently served header separately from
`current.candidate.build`. `nginx.first_location_indent` is `8` for the
observed first tRPC location. The complete Nginx site and `nginx -T` remain
hash-pinned. The operator checks one exact tRPC location of each form and
replaces only those blocks. All other locations and bytes are preserved. On
the final 3012 route, the header must equal the new release build. Manifest
`current.release_candidate` is null before the parallel start, then pins its
new container/runtime and start receipt while `current.candidate` continues
to pin the untouched 3010 service.

The v4 manifest and all private files must be constructed from a fresh
read-only host inventory under the existing root-only permissions. Repin the
manifest after every successful phase. A changed parked ID, image, runtime,
build, port, source label, photo-worker command, Nginx generation, or route
hash is a stop, not an occasion to edit a value forward without review.

## Remaining release gates

1. Select a merged release source that includes the active chat-inbox behavior
   and the DND-aware notification repository/dispatcher. The active 3010
   source is not an ancestor of the profile source branch, so a profile-only
   image cannot be assumed to preserve chat behavior. Independently review
   the exact source and immutable default/API image, bundle, lock, Compose,
   migration, verifier, and protected-probe hashes.
2. Recover and pin the live default worker's source identity, or prove a
   separately reviewed immutable build provenance. Its current image lacks
   `com.phone11.source-sha`; a guessed branch name is not a source pin.
3. Commission the edge POST gate, initial-SIP-INVITE gate, all-source aggregate
   idle collector, and Connect11 issued-token/reconnect/session admission
   fence. The existing aggregate guard intentionally exits with
   `provider_fence_uncommissioned`. Parked photo cleanup is an admitted worker
   and must be covered by worker-job admission and aggregate zero-work proof.
4. Independently failure-test fence activation, expiry, partial restore,
   active calls/jobs, new notification attempts, route drift, and the exact
   rollback artifacts. A zero-count snapshot without active admission control
   never permits default-worker stop.
5. Only in an authorized maintenance window, run fresh `--prepare`, then the
   documented baseline replacement, baseline route, parallel 3012 candidate
   start, disabled-by-default profile migration, and candidate route. No profile
   tenant may be enabled before both runtimes are DND-aware and public and
   protected tenant/notification probes pass.

The old default worker claims push alerts without DND checks. Deploying only
the API candidate and then enabling status could show a DND badge while still
sending APNs. A candidate-only rollout is therefore insufficient. After the
profile migration commits, restoring the old default worker is permitted only
with ordinary chat notifications disabled; keep a reviewed DND-aware API
route and the additive profile tables intact. The exact post-migration
rollback is `--rollback-baseline-disabled` under the same admission evidence.
Before migration, the exact baseline-route receipt can return traffic to
untouched 3010 through `--rollback-to-legacy-candidate`. After migration, the
primary route rollback is the new DND-aware baseline. A 3010 fallback then
requires independent proof that all tenants are disabled; this operator does
not provide that database gate and rejects post-migration 3010 restoration.

The provider fence requires Connect11 cooperation and independent review.
Until it exists, this handoff remains a source candidate; no production
`--replace-baseline`, migration, or tenant activation should run.
