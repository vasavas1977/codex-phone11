# Phone11 workspace status-only 3012 release

This is a **source and operator handoff**, not evidence that the 3012 candidate
is serving traffic. The v2 status migration was reported applied and its
`--recover` check passed; the route still requires the independent bridge
proof and all candidate gates. The first apply attempt left an intent at
`/var/lib/phone11-profile-status/receipt.json` with the live catalog unchanged.
Preserve that receipt for audit. Its rehearsal ran as `postgres`, producing an
after-catalog owner fingerprint that cannot match tables created by the live
`phone11ai` API role. The corrected rehearsal must use the API role and database
owner, produce fresh linked backup/restore proofs, and write a separate receipt.
It keeps voicemail storage and its FreeSWITCH deposit
hook outside this release. DND remains disabled in every tenant; the route
operator counts live `dnd_enabled` rows before either preparing or activating.

## Fixed predecessor and rollback

The operator is pinned to the current 3011 direct-meeting API, its exact
container/image/source/bundle/lock labels, the active Nginx site SHA-256
`2f744bb0df277cd4cbe7a50c2a6f9122530821d7bfa56f32d1fdb2ac64c59520`,
and the protected direct-meeting route and migration receipts. It changes only
the exact `= /api/trpc` and `^~ /api/trpc/` proxy directives to 3012. All
other Nginx locations remain on their current targets. The immediate rollback
is the sealed 3011 site. The 3010 fallback is retained but not used by this
operator. A changed predecessor, site, or receipt blocks the operation.

## Migration gate

Stage the exact reviewed `server/profile/migration.sql` as root-owned mode
`0600` at
`/opt/phone11ai/status-only-release-20260926/migration/profile-status-migration.sql`.
After the guarded v1 archive step below, stage the matching reviewed
`scripts/phone11-profile-status-migrate.py` beside it with the same ownership
and mode. The containing directory must be root-owned `0700`. The route
operator pins both artifact hashes. Do not use the earlier
profile/DND rollout script: it targets an older API layout.

The migration operator requires a root-only manifest binding the healthy 3011
container, image and release labels, exact SQL SHA-256, database identity, and
before/after full catalog fingerprints. The database identity separately pins
the live database OID and PostgreSQL version. Catalog fingerprints use role
names for relation owners, policy roles, and default-ACL owners, so a fresh
PostgreSQL 16 cluster with different role OIDs can be compared structurally.
They still include grants, column grants, row-level security, policies, and
default privileges. It also requires a fresh protected `pg_dump` backup proof
and an isolated PostgreSQL restore rehearsal proof for that exact database and
SQL. It refuses a stale catalog, mismatched proof, or missing receipt. Its
operator also requires the protected `backup.dump` to remain root-owned mode
`0600` and byte-identical to the backup proof before prepare, immediately
before apply, and after the SQL transaction. If the archive disappears or
changes after commit, the intent remains unsettled until the proved archive is
restored and recovery succeeds. The route gate rechecks this retained archive
through the pinned migration operator before switching traffic. Its
`--prepare` phase is read-only; `--apply` records an intent,
applies only the pinned SQL inside one transaction with an advisory lock, and
rejects any new status table with non-owner table or column grants, row-level
security, or policies before commit. Catalog fingerprints also include table
and column ACLs, row-level security, policies, and default privileges, so a
changed grant or default grant blocks a stale migration plan. It then records an applied receipt
at `/var/lib/phone11-profile-status/receipt-role-rehearsal-v2.json`.
`--recover` settles an interrupted intent only after rechecking the catalog.
The migration is additive: rollback of the API route does not undo its tables.

The route operator independently checks the applied status receipt, the exact
migration bytes, and a fresh catalog inventory using the already verified
operator bytes. It also rechecks the existing direct-meeting migration receipt
and current database identity. The direct migration's catalog fingerprint used
an earlier six-section definition; the status migration's definition also
includes owners, ACLs, policies, and default ACLs. Their hashes cannot be
compared directly. After the status migration is applied, the reviewed
`phone11-status-catalog-bridge.py` restores the retained exact pre-status
`backup.dump` in a separate network-isolated PostgreSQL 16 clone. It runs the
pinned direct and status read-only catalog programs on that same clone and
injects the already verified status operator bytes into the pinned restore
helper in memory, so the helper cannot reload an unverified source file or
stale bytecode from the staged pathname. It
requires the direct result to equal the direct receipt's after-catalog hash and
the status result to equal the status manifest's before-catalog hash. The
helper writes `catalog-bridge-proof.json` only after checking the retained
backup digest, original database identity, and live status after-catalog.
The route checks the protected bridge helper's exact source hash and the proof's
exact manifest, operator, backup, identity, and two catalog pins. A changed or
missing bridge proof blocks both prepare and activation. Review the exact
helper source, clone evidence, and protected proof independently before routing;
the route's protected proof check relies on the reviewed helper having generated
the proof and does not repeat the costly isolated restore at every switch.
The status, DND, and cluster probes follow the profile router’s
`server/pbx/db.ts` connection precedence: `PG_CONNECTION_STRING` first; otherwise
complete `PG_*`/`DB_*`/`POSTGRES_*` discrete settings; otherwise `DATABASE_URL`.
Conflicting alternate settings must not make the probe verify a different database
from the status application path. The status settings table defaults to
`enabled=false` and `dnd_enabled=false`; enabling status per workspace is a
separate admin action after the release passes acceptance.

## Candidate and route gate

Build and independently review a status-only API bundle from a pinned commit
containing the direct-meeting source plus profile status. Start it as the sole
healthy loopback 3012 candidate `cp11-api-candidate-status`, overlaid on the
current 3011 image with `com.phone11.overlay-kind=bundle-only` and the exact
parent image label. Pin its container ID, image digest, full source SHA, bundle
SHA-256, lock SHA-256, and build label in a root-owned mode `0600`
`/opt/phone11ai/status-only-release-20260926/gates/manifest.json` inside a
root-owned `0700` directory:

```json
{
  "schema": "phone11.status-only-release-gates/v1",
  "candidate": {
    "container_id": "<64 lowercase hex>",
    "image": "sha256:<64 lowercase hex>",
    "source_sha": "<40 lowercase hex>",
    "bundle_sha256": "<64 lowercase hex>",
    "lock_sha256": "24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801",
    "build": "<reviewed build label>"
  }
}
```

The operator verifies the candidate's health, loopback-only binding, labels,
running bundle, and voicemail-hook-off environment. It independently reads
PostgreSQL identity and the full post-migration catalog through the immutable
3012 candidate container ID; both must match the applied status migration
receipt. It runs a read-only live PostgreSQL count through the immutable 3011
and 3012 container IDs and requires **zero** DND-enabled tenants on each.
A bounded, read-only advisory-lock contention check proves both containers
reach the same PostgreSQL cluster, even when a clone has identical schema and
database metadata. A holder that exits, a timed-out query, or a clone blocks.
A wrong candidate database or unavailable query blocks the route before any
site write. It never takes a shell command from the manifest.

## Execution sequence for the reviewed operator

On the reviewed source commit, run `corepack pnpm build:backend`, record
`git rev-parse HEAD`, `shasum -a 256 dist/index.mjs`, and the lockfile SHA-256.
Create the 3012 bundle-only overlay from the pinned 3011 image and runtime
configuration, exposing only `127.0.0.1:3012`; preserve the application’s
database configuration. Pin the **immutable** candidate container ID, image,
source, bundle, lockfile, and build labels in the gate manifest above. A
successful `/api/health` response and authenticated tenant-positive and
cross-tenant-denial status regressions are required before routing.

### Single-tenant production validation (2026-09-27)

Read-only inspection of the pinned 3012 database found exactly one tenant,
active tenant `1`. Do not create a production tenant merely for a test. For
this release, the foreign-tenant gate uses the disposable PostgreSQL 17
suite `tests/phone11-profile-postgres.test.ts`: its two real tenant fixtures
include a foreign owner denied both `adminSettings` and `setAdminEnabled`
for the other tenant. All 12 tests passed, with no skips. This is isolated
database evidence, not a live foreign-tenant test.

Before routing, still require the signed-in production owner's actual 3012
`adminSettings` response for tenant `1` (both `enabled` and `dndEnabled`
false), plus a `FORBIDDEN` response for a nonexistent tenant. Record the
latter as nonexistent-tenant denial only. A separately reviewed temporary,
exact GET-only API-domain canary may carry the existing browser cookie to
this one protected query; never extract or log credentials. Restore and
verify the original Nginx bytes before the prepared route operator runs.
The canary does not permit mutations or replace post-switch regression
checks. A failed or missing authenticated probe still blocks the switch.

Canary operator: `scripts/phone11-status-cookie-canary.py`, reviewed SHA-256
`25c6f81106128f2043229de2cd11555c5e437e8e5c00c283410ea7db777809ec`.
Install it as root-owned mode `0700` at
`/var/lib/phone11-status-cookie-canary-operator.py` and execute that exact
installed path. The `/opt/phone11ai` parent is owned by the deployment user,
so it does not meet this operator's root-owned-ancestor requirement. Do not
relax the guard. The operator arms a persistent ten-minute UTC calendar timer
before changing Nginx and requires a reboot-cleared `/run` sentinel. Run
`rollback --receipt-dir <returned directory>` immediately after the probes.
The five focused tests are `scripts/test_phone11_status_cookie_canary.py`.

First live canary receipt:
`/var/lib/phone11-status-cookie-canary/20260926T194352Z-f61a27ee0ff625f2`.
Unauthenticated GET returned `401`; POST and HEAD returned `405`. The in-app
browser refused top-level navigation with `net::ERR_BLOCKED_BY_CLIENT`, so
no authenticated result was obtained. Manual rollback completed: exact
original site SHA restored, canary URL `404`, sentinel absent, expiry timer
inactive and disabled. The main 3012 route remains unactivated. Portal
sign-in as extension 3001, workspace administration, Team Chat, and the
direct-contact meeting button were observed working on the existing route;
these are not candidate or handset-media acceptance.

On the VoIP host, keep the original SQL in place; use the reviewed v2 operator
from a temporary root-only path for the guarded archive step below. After
that step, stage the v2 operator at the protected path above and capture a
fresh read-only inventory through the immutable 3011 container ID:

```sh
python3 /opt/phone11ai/status-only-release-20260926/migration/phone11-profile-status-migrate.py \
  --inventory \
  --sql /opt/phone11ai/status-only-release-20260926/migration/profile-status-migration.sql \
  --container-id bd3b5acf2647d239b5d5298c23a0b1bf60699379b25e4e8023b67e27fd6a6195 \
  --container-name cp11-api-candidate-direct-meeting \
  --container-port 3011 --host-port 3011
```

After the guarded archive, the original migration directory must have no
`backup.dump`, manifest, or proof files. The reviewed restore helper creates a
fresh root-only mode-0600 `pg_dump -Fc` archive from the immutable
`cp11-postgres` container, verifies the source database identity and catalog
again, then restores into a short-lived PostgreSQL **16.13** container using
the same pinned database image. The helper rejects other source, dump, restore,
or clone versions. Source-side `psql` and `pg_dump` use the immutable
`cp11-postgres` container's single `POSTGRES_USER` bootstrap role only after
checking that it exists in the API-verified source role inventory; the source
cluster need not have a database role named `postgres`. The disposable clone
still initializes its own `postgres` role. Its network is `none`, with no host port and only
tmpfs data. A Node sidecar shares only that isolated loopback network. It runs
the **same migration operator code** against the restored catalog and exact
SQL, checks ACL safety, and deletes only its privately labeled clone. It
creates the manifest and linked proofs only after the complete rehearsal:

The catalog compares **effective** relation grants. PostgreSQL may restore an
explicit owner-only table or sequence ACL as a NULL ACL with identical default
privileges. The operator expands the effective grants and resolves role IDs to
names, so that representation change does not reject a faithful restore;
additional or missing grants still change the fingerprint. The database's own
identity, including its OID, is pinned separately for the live apply.
Public grants and grants to a quoted role named `"PUBLIC"` have distinct
structured identities in relation ACLs and policy roles; a change between them
must fail the catalog comparison.

```sh
python3 /opt/phone11ai/status-only-release-20260926/migration/phone11-profile-status-restore-proof.py \
  --sql /opt/phone11ai/status-only-release-20260926/migration/profile-status-migration.sql \
  --out-dir /opt/phone11ai/status-only-release-20260926/migration \
  --api-container-id bd3b5acf2647d239b5d5298c23a0b1bf60699379b25e4e8023b67e27fd6a6195 \
  --api-container-name cp11-api-candidate-direct-meeting --api-port 3011 \
  --postgres-container-id <current full immutable ID of cp11-postgres>
```

The helper does not print credentials or customer rows. Its backup remains at
`backup.dump` for recovery; retain it under root-only access. The proofs expire
after 30 minutes, so prepare and apply promptly. A scheduled backup alone is
insufficient.

The first live `--apply` left an immutable pending receipt at
`/var/lib/phone11-profile-status/receipt.json`. The v2 operator pins that
receipt, its failed manifest and proofs, the backed-up archive, the original
operator and helper, the original SQL, and the original before/after catalog
hashes. Stage the reviewed v2 operator temporarily outside the migration
directory in a root-only directory. **Before replacing the original operator
or helper**, use the v2 operator's guarded archive mode:

```sh
python3 <root-only-path-to-reviewed-v2-operator> --archive-failed-v1 \
  --sql /opt/phone11ai/status-only-release-20260926/migration/profile-status-migration.sql
```

This operation requires the original receipt to remain `intent`, rejects a
v2 receipt or an old API exec worker, and obtains the same database advisory
lock used by the old apply. While holding it, it checks the unchanged database
identity, before-catalog fingerprint, `phone11ai` role and owner, and absent
status tables. It moves the original manifest, proofs, backup, operator, and
helper into the root-only `failed-status-apply-v1` directory on the same
filesystem. The original receipt is never moved or rewritten. A partial move
can only be resumed with the same exact pinned bytes; changed or duplicate
files block. Do not manually clear the old intent or delete the archived files.

After that succeeds, stage the exact reviewed v2 operator and role-matched
restore helper at the canonical migration paths. Run the helper again at its
existing `--out-dir`: it takes a new source backup, rehearses the same SQL as
the live API role, and writes fresh linked manifest and proofs. The v2 apply
requires the archived v1 evidence and a changed after-catalog hash, then
rechecks live state while holding the advisory lock through reservation of its
separate intent. A late old worker cannot commit with the v1 proof because its
postgres-owned after-catalog hash differs from the live API role's result;
the v1 transaction checks that hash before COMMIT. If any guard blocks, stop
for review rather than editing receipts or proof files.

If an unconsumed role-matched rehearsal already populated the migration
directory before the reviewed operator bytes change, preserve exactly its
`manifest.json`, `backup-proof.json`, `restore-proof.json`, and `backup.dump`
before generating another proof. First require the v2 receipt and
`cleanup-pending` to be absent, with no helper or disposable clone still
running. Verify the four root-owned mode-0600 regular, one-link files; record
each SHA-256 and verify the manifest/proof linkage and backup digest. Move
those four files to a newly created root-owned mode-0700 sibling directory on
the same filesystem, refusing any existing destination; fsync both directories
and verify the four digests after the move. Keep the archived v1 evidence and
original pending receipt untouched. Stage the newly reviewed operator at its
canonical path, rerun the restore helper into the now-empty migration output
directory, and use only its fresh linked manifest, proofs, and backup for
`--prepare` and `--apply`. Never reuse the preserved rehearsal's expiring
proofs with changed operator bytes.

If Docker create, start, or sidecar run fails or times out, the helper retains a
root-private `cleanup-pending/<container-name>.json` marker. Treat that as a
hard hold: do not retry the rehearsal or run migration/route preparation.
Inspect the marker's random container name and owner token, establish that the
Docker operation has terminated, and inspect that exact name and matching
`phone11.status-restore-token` label. Remove only that matching disposable
container, then independently confirm it cannot appear late before manually
clearing the marker. A missing container immediately after timeout alone is
insufficient. Review the incomplete archive/output directory before a fresh
rehearsal. Never clear a marker merely to pass the gate.

With the exact protected manifest and proofs in place, execute:

```sh
python3 /opt/phone11ai/status-only-release-20260926/migration/phone11-profile-status-migrate.py \
  --prepare --manifest /opt/phone11ai/status-only-release-20260926/migration/manifest.json \
  --sql /opt/phone11ai/status-only-release-20260926/migration/profile-status-migration.sql \
  --backup-proof /opt/phone11ai/status-only-release-20260926/migration/backup-proof.json \
  --restore-proof /opt/phone11ai/status-only-release-20260926/migration/restore-proof.json
python3 /opt/phone11ai/status-only-release-20260926/migration/phone11-profile-status-migrate.py \
  --apply --manifest /opt/phone11ai/status-only-release-20260926/migration/manifest.json \
  --sql /opt/phone11ai/status-only-release-20260926/migration/profile-status-migration.sql \
  --backup-proof /opt/phone11ai/status-only-release-20260926/migration/backup-proof.json \
  --restore-proof /opt/phone11ai/status-only-release-20260926/migration/restore-proof.json \
  --receipt /var/lib/phone11-profile-status/receipt-role-rehearsal-v2.json
```

If apply is interrupted, run the same command with `--recover` in place of
`--apply` against the **same** manifest, proof paths, and receipt. Do not
reissue `--apply` until the receipt is settled.

After independent review of the exact head, backup and isolated restore,
receipt, candidate, and authenticated 3012 regressions, run as root on the VoIP
host:

```sh
python3 /opt/phone11ai/status-only-release-20260926/migration/phone11-status-catalog-bridge.py --create
```

Stage that helper as root-owned mode `0600` at the exact path above. It requires
the unchanged protected direct operator and manifest, status operator and
manifest, status backup and restore proofs, and original `backup.dump`. Its
`catalog-bridge-proof.json` is created once as root-owned mode `0600`; a
preexisting proof or an unsettled clone cleanup marker blocks it. Independently
inspect the result and retain the proof. Do not rewrite a failed proof or its
source pins to force a match. The archived failed v1 files are not input to
this helper or the route gate.

Then execute:

```sh
python3 phone11-status-only-release-route.py inventory
python3 phone11-status-only-release-route.py prepare --gate-manifest /opt/phone11ai/status-only-release-20260926/gates/manifest.json
python3 phone11-status-only-release-route.py activate --receipt-dir <exact prepared receipt directory>
```

`prepare` seals the original and proposed Nginx site bytes without mutating the
site. `activate` repeats all gates immediately before the two-line switch and
reloads Nginx. If post-activation Phone, Team Chat, direct meeting, status,
tenant-denial, and DND-off checks fail, use `rollback --receipt-dir <same>`.
After an interrupted switch, `recover --receipt-dir <same>` restores the sealed
3011 route. Unknown site bytes or an unavailable 3011 predecessor require
manual recovery review; do not edit this operator to force the route.

Native meeting media, SIP calling, push delivery, and voicemail deposit remain
separate device/provider gates. No source test or API route check proves them.
