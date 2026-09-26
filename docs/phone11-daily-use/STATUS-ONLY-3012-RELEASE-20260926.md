# Phone11 workspace status-only 3012 release

This is a **source and operator handoff**, not evidence that the 3012 candidate or
status migration is live. It keeps voicemail storage and its FreeSWITCH deposit
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
Stage the matching reviewed `scripts/phone11-profile-status-migrate.py` beside
it with the same ownership and mode. The containing directory must be root-owned
`0700`. The route operator pins both artifact hashes. Do not use the earlier
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
at `/var/lib/phone11-profile-status/receipt.json`.
`--recover` settles an interrupted intent only after rechecking the catalog.
The migration is additive: rollback of the API route does not undo its tables.

The route operator independently checks the applied status receipt, the exact
migration bytes, and a fresh catalog inventory using the already verified
operator bytes. It also rechecks the existing direct-meeting migration receipt
and current database identity. The status, DND, and cluster probes follow the profile router’s
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

On the VoIP host, stage the reviewed SQL and operator at the protected paths
above and capture a fresh read-only inventory through the immutable 3011
container ID:

```sh
python3 /opt/phone11ai/status-only-release-20260926/migration/phone11-profile-status-migrate.py \
  --inventory \
  --sql /opt/phone11ai/status-only-release-20260926/migration/profile-status-migration.sql \
  --container-id bd3b5acf2647d239b5d5298c23a0b1bf60699379b25e4e8023b67e27fd6a6195 \
  --container-name cp11-api-candidate-direct-meeting \
  --container-port 3011 --host-port 3011
```

Create the root-owned mode-0700 migration directory first, with no existing
`backup.dump`, manifest, or proof files. The reviewed restore helper creates a
fresh root-only mode-0600 `pg_dump -Fc` archive from the immutable
`cp11-postgres` container, verifies the source database identity and catalog
again, then restores into a short-lived PostgreSQL **16.13** container using
the same pinned database image. The helper rejects other source, dump, restore,
or clone versions. Its network is `none`, with no host port and only
tmpfs data. A Node sidecar shares only that isolated loopback network. It runs
the **same migration operator code** against the restored catalog and exact
SQL, checks ACL safety, and deletes only its privately labeled clone. It
creates the manifest and linked proofs only after the complete rehearsal:

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
  --receipt /var/lib/phone11-profile-status/receipt.json
```

If apply is interrupted, run the same command with `--recover` in place of
`--apply` against the **same** manifest, proof paths, and receipt. Do not
reissue `--apply` until the receipt is settled.

After independent review of the exact head, backup and isolated restore,
receipt, candidate, and authenticated 3012 regressions, run as root on the VoIP
host:

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
