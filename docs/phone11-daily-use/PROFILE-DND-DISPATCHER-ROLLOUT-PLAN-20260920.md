# Phone11 profile, standby presence, and DND dispatcher rollout plan

**Owner:** Phone11 operations | **Frequency:** one controlled pilot rollout
**Last updated:** 20 September 2026 | **Status:** plan only; no production action authorized or run

## Purpose and current boundary

Deploy the workspace-profile schema and the matching Team Chat notification
checks without changing SIP routing or running duplicate background services.
Public `/api/trpc` currently uses `cp11-api-candidate` on loopback port 3002.
`cp11-backend` on port 3000 remains the only owner of SIP wake, ordinary
notification dispatch, media/recording workers, ESL, and WebSocket shutdown.
Kamailio calls `http://127.0.0.1:3000/api/phone11/wake` directly.

The API candidate can suppress a new notification at enqueue time, but it
cannot make an older port-3000 dispatcher recheck DND before provider contact.
Full DND behavior therefore requires both the new API image and the same
reviewed dispatcher code in the default-role baseline runtime.

The last recorded public candidate activation used source `50b6c3b...`; treat
all recorded container IDs, images, hashes, routes, and idle state as stale
until freshly pinned. The current source work also depends on the separate
profile-owned commit. Do not build from the dirty shared checkout.

## Smallest feasible topology

Use one immutable backend image built from one clean reviewed release commit:

- `cp11-backend`: default role, exact existing port-3000 binding and runtime
  shape, all existing workers, wake owner;
- `cp11-api-candidate`: `PHONE11_RUNTIME_ROLE=api-candidate`, exact port 3002,
  no background workers;
- Nginx: exact `/api/trpc` and `/api/trpc/` locations to 3002 after activation;
  all wake, media, auth, PBX, health, and other paths remain on 3000;
- Kamailio and FreeSWITCH: no configuration write, reload, or restart.

There is no worker-only runtime role. Do not start a third copy of the default
runtime. Recreate `cp11-backend` one-for-one: Docker must stop the old
`cp11-backend` before starting the new container with the same name and port.
The API candidate stays running during this short worker/wake restart.

## Prerequisites and immutable artifacts

- [ ] A clean final release SHA containing profile schema/router/accessor,
      `7d7bfdb` push/presence behavior, `70d98e6` accessibility correction, and
      any subsequent reviewed integration fixes.
- [ ] Independent review of the exact final diff, especially tenant access,
      `to_regclass` preflights, DND enqueue/claim/current checks, runtime role,
      and notification failure handling.
- [ ] Passing TypeScript, backend bundle, runtime-role tests, profile tests, and
      disposable PostgreSQL chat/notification tests from that exact SHA.
- [ ] One immutable image digest, bundle hash, source-input manifest, dependency
      lock hash, image history, and filesystem-diff review. A mutable tag is not
      an activation input.
- [ ] Exact root-owned mode-0600 copies of `server/profile/migration.sql`, its
      SHA-256, a reviewed migration operator, and its hermetic tests.
- [ ] Fresh database identity/catalog fingerprint and a post-apply
      `phone11-migration-receipt/v1`. Inspect schema only; do not export profile,
      message, device-token, or customer rows.
- [ ] Fresh pins for both containers, images, health builds, environment-key
      names, mounts, networks, loopback ports, restart policy, and complete
      normalized runtime shape. Never print environment values.
- [ ] Frozen candidate and baseline Compose JSON. Baseline delta must be only
      image/build metadata. Candidate delta must be only image/build metadata
      while preserving `api-candidate`, port 3002, and no-worker behavior.
- [ ] Exact active Nginx site/full-dump hashes, current rollback receipt, and
      protected authenticated probes. Keep the old candidate alive until drain.
- [ ] Exact Kamailio configuration hash and positive count of the unchanged
      port-3000 wake URL.
- [ ] Fresh zero-active guard: zero FreeSWITCH channels, Kamailio dialogs,
      relay calls, and current-minus-waiting SIP transactions. Timeout or probe
      failure is not an idle result.
- [ ] Protected rollback Compose for the exact old baseline image and a second
      emergency variant with `PHONE11_CHAT_NOTIFICATIONS_ENABLED=0`.

## Required operator gap

The checked-in `phone11-chat-presence-receipts-migrate.py` is pinned to another
migration, container ID, image, catalog, and target-table set. It must not be
reused for the profile table. `phone11-parallel-api-pilot.py` provides the
right atomic Nginx/rollback pattern, but its current source hardcodes the old
`ACTIVE_IMAGE`, requires the candidate image to differ from it, and does not
replace the default worker runtime. It cannot operate this new same-image
baseline/candidate rollout unchanged.

Before rollout, add and independently review a guarded profile/worker operator
with this exact command surface:

```text
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --prepare --manifest /root/phone11-profile-dnd-rollout.json
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --apply-migration --manifest /root/phone11-profile-dnd-rollout.json
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --replace-baseline --manifest /root/phone11-profile-dnd-rollout.json
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --route-baseline --manifest /root/phone11-profile-dnd-rollout.json
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --replace-candidate --manifest /root/phone11-profile-dnd-rollout.json
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --route-candidate --manifest /root/phone11-profile-dnd-rollout.json
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --rollback-route --manifest /root/phone11-profile-dnd-rollout.json
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --rollback-baseline-disabled --manifest /root/phone11-profile-dnd-rollout.json
```

`--prepare` must be read-only. `--apply-migration` must use advisory locking,
`lock_timeout=2s`, `statement_timeout=30s`, exact database/catalog pins, an
idempotent apply, post-state verification, and an exclusive receipt.
`--replace-baseline` must rerun all pins and the fresh idle guard immediately
before stopping exactly `cp11-backend` with `docker stop --time 20`, waiting
for its bounded in-flight notification attempt to finish, and then running one
`docker compose ... up -d --no-deps <exact-service>` against the frozen
rendered configuration. It must reject a forced-kill/OOM exit and any newly
stranded attempted notification row, without reporting row IDs. It must reject
more than one default-role runtime and must never use `docker kill`.
`--rollback-baseline-disabled` is an emergency path described below;
it must never modify SIP configuration. The route phases must preserve the
existing operator's atomic write, syntax check, graceful reload, exact-current
hash check, durable rollback receipt, and candidate drain behavior, while
pinning images from the manifest instead of source constants.

Until that operator and its tests exist, the migration and baseline replacement
are blocked. Do not substitute interactive `psql`, an unpinned Compose source,
or ad-hoc `docker run` commands.

## Ordered rollout

### 1. Prepare without mutation

Run the new operator's `--prepare`. Require an exact final release/image match,
healthy old baseline and candidate, active public candidate route, unchanged
wake target, protected probe validity, frozen rollback inputs, and a fresh idle
result. Stop on drift.

### 2. Apply only the additive profile migration

Run `--apply-migration`. Verify the table, primary/foreign keys, allowed-value
checks, DND expiry check, index, owner, and grants. Write the immutable receipt.
Do not insert a status, alter a membership, or drop anything. Re-running
`--prepare` must observe the receipt and the exact post-catalog fingerprint.

Database rollback is forward-only: retain the empty/additive table. Application
code handles its absence for rolling compatibility, but dropping it after use
would destroy user preferences and can abort active transactions.

### 3. Upgrade the sole worker/wake baseline first

Keep public tRPC on the existing port-3002 candidate. Rerun the call/SIP idle
guard, then run `--replace-baseline`. The replacement must preserve the current
port 3000, container name, network, mounts, APNs/wake/recording flags, secrets,
limits, restart policy, and default runtime role. It must not touch Kamailio,
FreeSWITCH, Nginx, registrations, SIP transport rows, or provider credentials.

Require direct port-3000 health with the new build/default role, exactly one
running default-role container, existing wake readiness, notification readiness,
and bounded database connectivity. Recheck the Kamailio hash and exact wake URL.
If any check fails before the profile API is public, restore the exact old
baseline Compose/image; the additive empty schema remains.

### 4. Move public tRPC temporarily to the new baseline

The mode-0600 rollout manifest must pin the new baseline container/image/build,
the still-running old candidate, current active Nginx bytes, prior rollback
receipt, migration receipt, protected probes, and unchanged Kamailio bytes.
Run:

```text
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --route-baseline --manifest /root/phone11-profile-dnd-rollout.json
```

Expected result is `route_baseline=PASS candidate=RUNNING`. This is a proxy-only
change: public tRPC now uses the new baseline on 3000 while the old candidate
continues draining. The command must refuse stale pins or an intervening Nginx
edit. Verify public authenticated phone/chat reads and the candidate build
header's absence before proceeding.

### 5. Replace the API candidate without workers

Using the separately frozen candidate Compose file, run:

```text
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --replace-candidate --manifest /root/phone11-profile-dnd-rollout.json
```

Recreate only `cp11-api-candidate` at `127.0.0.1:3002`. Require the new immutable image,
`PHONE11_RUNTIME_ROLE=api-candidate`, exact `PORT=3002`, new build marker,
existing network/mounts, and zero background service startup. Public tRPC stays
on the new baseline during this replacement.

Run direct protected probes on 3002. They must cover existing phone reads,
mixed tRPC batches, profile self-read, colleague presence, notification
readiness, unauthorized tenant, inactive/revoked membership, and no secret or
message-body output.

Typing indicators are process-local and may disappear once when routing moves
between runtimes. They must expire cleanly and must not be described as durable
presence loss. Messages, notification outbox rows, presence leases, and profile
preferences are database-backed and must remain intact.

### 6. Route only tRPC back to the new candidate

With the manifest freshly repinned to the new baseline and candidate, current
baseline-routed Nginx site, profile migration receipt, protected probes, and
unchanged wake configuration, run:

```text
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --prepare --manifest /root/phone11-profile-dnd-rollout.json
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --route-candidate --manifest /root/phone11-profile-dnd-rollout.json
```

Require `prepare=READY activation=NOT_RUN`, then `route_candidate=PASS`. The operator
must install only exact `/api/trpc` and prefix `/api/trpc/` locations, syntax
check, gracefully reload Nginx, prove the route locally and publicly, and leave
both backends running. All other paths and direct wake remain on 3000.

## Verification without sending a notification

- [ ] Public and direct health attest exact build and runtime role.
- [ ] Exactly one default-role runtime exists; the candidate is api-only.
- [ ] Both pilot notification gates and APNs configuration presence are healthy;
      never print credentials or device tokens.
- [ ] 1020 retains an authorized, fresh notification enrollment aggregate.
- [ ] Profile self-read and colleague presence remain tenant-scoped. A manual
      status never makes a revoked, stale, or unreachable user appear online.
- [ ] DND source/build tests attest enqueue, claim, and final-current checks.
- [ ] Protected aggregate counts show no unexpected attempted/failed outbox
      increase. Do not inspect message bodies or recipient tokens.
- [ ] Kamailio configuration hash and port-3000 wake occurrence count are
      unchanged; no SIP service restarted.
- [ ] Existing calling, wake enrollment/readiness, recording/media routes, auth,
      PBX, and non-tRPC paths remain on 3000.

A real DND provider-contact proof requires an explicitly authorized synthetic
pilot message and handset observation. Without that authorization, report
source, image, schema, route, and aggregate evidence only; do not claim APNs
suppression or delivery from readiness and counts.

## Rollback

Candidate/API failure: run the freshly pinned rollout operator:

```text
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py --rollback-route --manifest /root/phone11-profile-dnd-rollout.json
```

This returns only tRPC to the new baseline, gracefully reloads Nginx, and keeps
the candidate running until drain. It does not change the schema or workers.

Baseline failure before profile/DND is publicly writable: rerun the idle guard
and use the guarded baseline rollback to restore the exact old image/runtime.
Keep the profile table. Verify port-3000 wake and all existing workers.

Baseline failure after profile/DND is publicly writable: never restart the old
image with ordinary notification dispatch enabled. Use
`--rollback-baseline-disabled`, which restores the old wake/recording/ESL
runtime with `PHONE11_CHAT_NOTIFICATIONS_ENABLED=0`, and route tRPC to the
compatible retained API only as allowed by the incident plan. This pauses all
ordinary Team Chat alerts but prevents the old dispatcher from violating saved
DND. Preserve pending outbox and profile rows; do not replay, delete, or rewrite
them. Restore notifications only with the reviewed new dispatcher image.

Do not roll back Kamailio, FreeSWITCH, SIP rows, APNs credentials, device
registrations, or the additive profile schema as part of this change.

## Decisions still required

1. Approve a brief port-3000 wake/worker restart after a fresh all-idle guard.
2. Approve and independently review the missing guarded profile/worker operator.
3. Select the exact clean release SHA after the profile-owned commit lands.
4. Decide whether to authorize one synthetic DND notification test. Without it,
   live APNs suppression remains unproven.
5. Accept the fail-closed emergency rollback behavior: ordinary chat alerts are
   disabled if operations must restore an old dispatcher after DND is exposed.
6. Accept one transient loss of process-local typing indicators during each
   proxy transition; no message or durable presence data may be lost.
