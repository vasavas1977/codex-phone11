# Phone11 profile/DND rollout operator

**Status:** source and hermetic tests only; no production command, image build,
deployment, migration, provider contact, or notification send was run.

**Current rollout decision:** blocked. The repository does not contain or stage
the required host admission-fence controller/helper, its root-owned evidence
record, production manifests, frozen Compose inputs, or immutable release
image. The commands below are the reviewed interface for a later controlled
maintenance window; they are not evidence that the host preconditions exist.

The guarded operator is
`scripts/phone11-profile-dnd-rollout.py`. It implements the eight phases in the
profile/DND dispatcher rollout plan while preserving the current topology:

- `cp11-backend` stays the sole default-role worker and port-3000 SIP wake owner;
- `cp11-api-candidate` stays workerless on loopback port 3002;
- only the exact `/api/trpc` and `/api/trpc/` locations may move;
- Kamailio and FreeSWITCH are inspected but never changed, reloaded, or restarted;
- the old candidate is not stopped during a route change, allowing requests to drain;
- an old dispatcher restored after DND exposure must have
  `PHONE11_CHAT_NOTIFICATIONS_ENABLED=0`.

## Source validation

Run from the clean reviewed release checkout:

```sh
python3 -m py_compile \
  scripts/phone11-profile-dnd-rollout.py \
  tests/phone11-profile-dnd-rollout.test.py
python3 tests/phone11-profile-dnd-rollout.test.py
git diff --check -- \
  scripts/phone11-profile-dnd-rollout.py \
  tests/phone11-profile-dnd-rollout.test.py \
  docs/phone11-daily-use/PROFILE-DND-ROLLOUT-OPERATOR-20260920.md
```

Source tests are not live readiness. Commissioning still requires an
independent exact-head review, a clean release commit, immutable image digest,
live protected pins, and the owner decisions listed in the rollout plan.

## Private staging contract

Create the production staging directory only after the final source and image
are independently approved:

```sh
sudo install -d -o root -g root -m 0700 /opt/phone11ai/profile-dnd-rollout
sudo install -o root -g root -m 0700 \
  scripts/phone11-profile-dnd-rollout.py \
  /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py
sudo install -d -o root -g root -m 0700 /var/lib/phone11-profile-dnd-rollout
```

Every private manifest input must be an absolute-path, root-owned, single-link
regular file with mode `0600`. This includes both rendered Compose sources,
both baseline rollback sources, migration SQL, catalog verification SQL, and
protected probes. The executable host-specific idle/readiness helper must be
root-owned, single-link, and mode `0700`. The active Nginx site keeps its
existing root-owned non-writable mode and is pinned by bytes rather than forced
to mode `0600`. The manifest itself must be root-owned mode `0600`. Do not place
any private artifact in CI logs, the repository, a shared home directory, or a
shell history containing values.

The helper pinned by `guard.program` must emit only this bounded aggregate JSON:

```json
{
  "schema": "phone11-profile-dnd-guard/v1",
  "sampled_at_epoch_ms": 0,
  "coverage": [
    "active_conference_jobs",
    "active_media_jobs",
    "active_recording_jobs",
    "active_worker_jobs",
    "freeswitch_channels",
    "kamailio_dialogs",
    "relay_calls",
    "sip_transactions_active"
  ],
  "admission_fence_id": "profile-dnd-fence-20260921",
  "admission_fence_active": false,
  "admission_fence_expires_at_epoch_ms": 0,
  "admission_fence_coverage": [
    "conference_job_admission",
    "media_job_admission",
    "notification_dispatch_admission",
    "recording_job_admission",
    "sip_invite_admission",
    "worker_job_admission"
  ],
  "admission_fence_evidence_sha256": "<64-lowercase-hex>",
  "idle": true,
  "freeswitch_channels": 0,
  "kamailio_dialogs": 0,
  "relay_calls": 0,
  "sip_transactions_active": 0,
  "active_conference_jobs": 0,
  "active_recording_jobs": 0,
  "active_media_jobs": 0,
  "active_worker_jobs": 0,
  "attempted_notifications": 0,
  "new_attempted_notifications": 0,
  "failed_notifications": 0,
  "pending_notifications": 0,
  "wake_ready": true,
  "notifications_ready": true
}
```

It must obtain a fresh sample on every invocation. With
`--since-epoch-ms <value>`, `new_attempted_notifications` is the count of rows
that first entered `attempted` after that instant. It must never output row IDs,
message bodies, recipients, tokens, credentials, or environment values.

Live idle probes alone never authorize a baseline stop. Operations must first
establish an independent host admission fence that prevents new SIP calls,
conference/media/recording/background jobs, and notification dispatch work
from entering the affected runtime. The helper must verify every named fence
coverage item directly against that controller and hash a root-owned immutable
evidence record. Put that exact digest in `guard.fence_evidence_sha256`; the
helper returns it as `admission_fence_evidence_sha256`. A self-reported boolean,
a manually entered timestamp, or an operator process lock is insufficient.

The operator requires the same pinned fence ID and evidence digest immediately
before stop, after the container is stopped, and after restart. The fence must
remain active with the required bounded time remaining, and every snapshot
must still show zero active calls/jobs. If the host cannot enforce or query any
admission source reliably, use an operator-defined maintenance window whose
external admission controller supplies the same evidence. Until that controller
and helper are separately implemented, reviewed, staged, and tested on the
host, do not run `--replace-baseline` or either baseline rollback. A successful
`docker stop --time 20` is only graceful-drain mechanics.

## Manifest construction

The manifest schema is `phone11-profile-dnd-rollout/v1`. Populate it from a
fresh, read-only inventory. Placeholder, mutable-tag, shortened-ID, stale, or
unreviewed values are rejected.

The important sections are:

- `release`: exact 40-character source SHA, health build marker, immutable
  image digest, backend bundle hash, and dependency-lock hash. The image must
  carry matching `com.phone11.source-sha`, `com.phone11.bundle-sha256`, and
  `com.phone11.lock-sha256` labels.
- `current.baseline` and `current.candidate`: exact 64-character container ID,
  immutable image, canonical runtime-shape hash, health build, and the exact
  replacement-receipt hash after a replacement. Route changes require the
  current runtime to be the release image/build and consume that receipt before
  touching Nginx.
- `compose.baseline` and `compose.candidate`: file hash, rendered canonical JSON
  hash, and exact service name. The baseline and old rollback renderings may
  differ only by image/build. The disabled rollback may additionally change
  only `PHONE11_CHAT_NOTIFICATIONS_ENABLED` from `1` to `0`.
- `rollback.normalized_runtime_sha256`: canonical hash of the approved baseline
  runtime after normalizing container ID, image/build and reviewed release
  labels, Compose-generated config hash/path labels, and the emergency
  notification gate. This remains the runtime-shape authority when the failed
  baseline container is absent.
- `rollback.failed_baseline_attempt_receipt_sha256`: normally `null`. Set it
  only to the exact SHA-256 of the operator-created
  `/var/lib/phone11-profile-dnd-rollout/baseline-attempt-receipt.json` after a
  failed recreation produced a different container ID. Never create or edit
  this receipt manually.
- `migration.artifacts`: required first item named `profile`; an optional second
  item named `all_mentions`. Each item has its own exact committed file and
  SHA-256. Do not add `all_mentions` until that implementation and migration are
  merged into the selected clean release and independently reviewed.
- `migration.verify`: one read-only `SELECT`/`WITH` query whose ordered rows
  fully describe the profile table and, when selected, the `@all` objects,
  including columns, primary/foreign keys, allowed-value and DND-expiry checks,
  index, owner, and grants.
- `migration.receipt_sha256`: `null` before first apply. After apply, hash the
  exclusive receipt, set its exact SHA-256, and repin the manifest. An exact
  already-applied catalog can recover a missing receipt after a committed
  transaction; no migration is replayed in that case.
- `probes`: exact protected probe bundle containing precisely
  `existing_phone`, `existing_chat`, `mixed_batch`, `profile_self`,
  `colleague_presence`, `notification_readiness`, `denied_tenant`, and
  `revoked_membership`. Responses are evaluated in memory and never printed.
- `nginx.route`: the currently pinned route, `candidate` or `baseline`.
  `nginx.dnd_exposed` is `false` before the first successful route to the new
  baseline and permanently `true` after profile/DND becomes publicly writable.
  A baseline route with `dnd_exposed=false` is rejected.
- `kamailio`: exact config hash, absolute in-container path, and positive exact
  occurrence count of `http://127.0.0.1:3000/api/phone11/wake`.
- `guard`: exact helper hash, independently assigned fence ID, and the SHA-256
  of the separately established host admission-fence evidence record.

Each successful mutation changes live identities or bytes. Regenerate the
manifest from a fresh read-only inventory before the next phase. Never edit a
stale manifest forward by hand.

## Dry run and ordered execution

`--prepare` is the dry run. It reads live state, validates every pin, verifies
both containers, checks the authoritative Compose project/service/runtime
inventory, and rejects every unknown Phone11-like worker, including one without
`PHONE11_BUILD_SHA`. It renders all four frozen Compose inputs, inspects the
exact migration state, validates protected probes, checks Nginx syntax/current
routing, re-hashes Kamailio, and requires a fresh all-idle result. It validates
the fence evidence shape but does not treat an inactive fence as stop authority.
Its only local effect is taking the root-only nonblocking process lock.

```sh
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py \
  --prepare --manifest /root/phone11-profile-dnd-rollout.json
```

Expected output is exactly `prepare=READY activation=NOT_RUN`. Any
`prepare=BLOCKED stage=...` result is a stop; do not bypass the named guard.

After the owner authorizes the brief worker/wake interruption and all source,
image, artifact, and live pins are current, use the ordered phases below. Run a
fresh `--prepare` and repin between every phase.

```sh
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py \
  --apply-migration --manifest /root/phone11-profile-dnd-rollout.json

sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py \
  --replace-baseline --manifest /root/phone11-profile-dnd-rollout.json

sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py \
  --route-baseline --manifest /root/phone11-profile-dnd-rollout.json

sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py \
  --replace-candidate --manifest /root/phone11-profile-dnd-rollout.json

sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py \
  --route-candidate --manifest /root/phone11-profile-dnd-rollout.json
```

The migration is one serializable transaction with a transaction advisory
lock, `lock_timeout=2s`, `statement_timeout=30s`, exact database identity,
exact before catalog, and exact after catalog. For each committed artifact the
operator strips exactly one top-level outer `BEGIN`/`COMMIT` wrapper before
passing the SQL to its own transaction. It rejects every other transaction
control statement, data write, dynamic data write in a `DO` block, and
destructive DDL. Additive foreign keys with `ON DELETE CASCADE` are permitted;
the actual profile, `@all` base, and `@all` live-delta SQL files are exercised by
the hermetic tests. It never drops the additive schema.

Baseline and candidate replacement use only the frozen rendered Compose model,
`docker stop --time 20`, and one `docker compose ... up -d --no-deps <service>`.
The operator rejects OOM or exit 137, never calls `docker kill`, reruns the live
idle and admission-fence guard immediately before the baseline stop, repeats it
after stop, and requires the identical fence evidence plus zero active calls,
meetings, ESL/media/recording/background jobs and zero new `attempted`
notification rows after restart. The minimal-interruption design is one bounded
port-3000 stop/start while public tRPC remains on port 3002. Its safety depends
on the independently enforced fence and fresh zero-active evidence throughout;
the 20-second stop timeout alone is never sufficient.

Before changing the baseline, the operator requires the attempt-receipt path to
be absent. After Compose creates a replacement whose image, build, runtime
shape, Compose project/service, default role, port, and notification gate match
the approved operation, it writes an exclusive root-only attempt receipt before
requiring health. If a later health/readiness check fails, retain that receipt.
During incident preparation, hash it without printing its contents and repin
only that digest in the rollback manifest:

```sh
sudo sha256sum \
  /var/lib/phone11-profile-dnd-rollout/baseline-attempt-receipt.json
```

Archive the receipt only after the operation is closed; an existing receipt
blocks a new baseline replacement rather than being overwritten.

## Rollback

For a candidate/API failure after routing to the new candidate:

```sh
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py \
  --rollback-route --manifest /root/phone11-profile-dnd-rollout.json
```

The command requires the exact route receipt and a healthy pinned new baseline,
atomically restores the baseline-routed site, checks syntax, gracefully reloads
Nginx, rechecks wake bytes, and leaves the candidate running to drain.

If the old baseline must be restored after DND was publicly exposed, use only:

```sh
sudo /opt/phone11ai/profile-dnd-rollout/phone11-profile-dnd-rollout.py \
  --rollback-baseline-disabled \
  --manifest /root/phone11-profile-dnd-rollout.json
```

The manifest must say `dnd_exposed=true`; the operator accepts only the exact
old rollback image/config with ordinary chat notifications set to `0`. Wake,
recording, ESL, mounts, networks, limits, and restart policy remain pinned.
Its rollback preflight accepts the exact pinned baseline even if unhealthy, an
absent baseline container, or a different failed-replacement ID proven by the
pinned operator attempt receipt. Any other named or Phone11-like container is
rejected. Recovery does not depend on either backend's health endpoint: the
candidate may be unhealthy, but its exact container ID, image, runtime shape,
role, port, and Compose labels must still match the manifest. The preflight
continues to fail closed on rollback image/runtime/Compose drift, file
ownership/permissions, route, migration receipt, worker inventory, and
unchanged Kamailio wake configuration. It establishes the external admission
fence before restart, requires the restored service to become healthy, requires
live wake readiness again, and checks for notification attempts since the
actual stopped snapshot.
Pending outbox/profile rows are retained. Do not re-enable ordinary alerts on
the old dispatcher; restore them only with the reviewed new dispatcher image.

No rollback phase changes Kamailio, FreeSWITCH, SIP rows, credentials,
registrations, provider state, or the additive database schema.

## Remaining decisions and evidence limits

The owner still must commission and independently verify the host admission
fence, approve the brief port-3000 interruption, accept disabled ordinary
alerts for emergency old-dispatcher rollback, select the clean final release
SHA/image, and decide whether to authorize a synthetic DND notification and
handset test. Without those gates, this work establishes operator source and
hermetic behavior only. It does not establish production readiness, live APNs
suppression, or handset delivery behavior.
