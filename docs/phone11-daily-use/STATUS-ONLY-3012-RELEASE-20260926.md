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
before/after full catalog fingerprints. It also requires a fresh protected
`pg_dump` backup proof and an isolated PostgreSQL restore rehearsal proof for
that exact database and SQL. It refuses a stale catalog, mismatched proof, or
missing receipt. Its `--prepare` phase is read-only; `--apply` records an intent,
applies only the pinned SQL inside one transaction with an advisory lock, and
rejects any new status table with non-owner grants, row-level security, or
policies before commit. Catalog fingerprints also include relation ACLs,
row-level security, policies, and default privileges, so a changed grant or
default grant blocks a stale migration plan. It then records an applied receipt
at `/var/lib/phone11-profile-status/receipt.json`.
`--recover` settles an interrupted intent only after rechecking the catalog.
The migration is additive: rollback of the API route does not undo its tables.

The route operator independently checks the applied status receipt, the exact
migration bytes, and a fresh catalog inventory using the already verified
operator bytes. It also rechecks the existing direct-meeting migration receipt
and current database identity. The status settings table defaults to
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
A wrong candidate database or unavailable query blocks the route before any
site write. It never takes a shell command from the manifest.

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
