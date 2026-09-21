# Phone11 workspace time-zone commissioning

**Status:** source-approved candidate with a production **read-only** catalog
check. No production backup, migration, deployment, service restart, role
change, or customer-data write was performed.

## Bounded capability

This slice stores one workspace setting: `businessHoursTimezone`. Phone11 uses
it for workspace profile/status expiry calculations. It does not configure or
change caller ID, emergency calling, recording, voicemail, ring timeout,
business-hours call routing, SIP, Kamailio, FreeSWITCH, or carrier behavior.
The migration creates no setting rows, so deploying the schema alone changes no
workspace behavior. An owner or administrator must explicitly save a time zone
for their own active workspace.

The API rejects unsupported setting names and invalid IANA time zones. A write
is selected and locked through the actor's active owner/admin membership in the
same SQL statement as the upsert. A removed, inactive, lower-role, or
cross-workspace membership produces no write and no audit success record.

## Artifacts

- Migration: `server/pbx/tenant-settings-migration.sql`
- Read-only preflight: `scripts/phone11-tenant-settings-preflight.ts`
- Focused test: `tests/phone11-tenant-settings-readiness.test.ts`

The migration is explicit and rerunnable. It stops if `tenants` is absent or an
existing `tenant_settings` relation is partial or incompatible. The application
does not run migrations at startup.

## Source validation

Run from the exact reviewed clean checkout with the repository's pinned
dependency closure:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/phone11-tenant-settings-readiness.test.ts \
  tests/phone11-pbx-admin-authorization.test.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check -- \
  server/pbx/pbx-router.ts \
  server/pbx/tenant-settings-migration.sql \
  scripts/phone11-tenant-settings-preflight.ts \
  tests/phone11-tenant-settings-readiness.test.ts \
  docs/phone11-daily-use/TENANT-SETTINGS-COMMISSIONING-20260921.md
```

For the isolated PostgreSQL path, set `PHONE11_PBX_TEST_DATABASE_URL` only to a
dedicated loopback database named `phone11_pbx_test` with an explicit port.
The test creates and removes its own random schema, applies the migration twice,
checks persistence and tenant separation, and verifies database constraints.

### Executed source evidence — 22 September 2026

- A temporary loopback-only PostgreSQL 17 cluster on port `55448`, using the
  dedicated `phone11_pbx_test` database, ran the two focused suites: **72
  passing tests**. This included the three database cases that are otherwise
  skipped when no explicit fixture URL is supplied.
- The database cases created and dropped random schemas. They proved an absent
  table can be migrated twice, workspace rows persist separately, non-admin and
  cross-workspace actors cannot write, blank values are rejected, a tenant
  delete cascades, and composite tenant keys are rejected by both the migration
  and read-only preflight. They also reject a same-name `CHECK (true)` and an
  otherwise-correct but `NOT VALID` time-zone check.
- `node node_modules/typescript/bin/tsc --noEmit` completed successfully.

The exact six-file candidate was independently source-reviewed and committed as
`9804c2f09f99453747e0bb54e23d3b6149f5b5cb`. The review bound the migration to
its SHA-256, its preflight to the reviewed/validated check expression, and the
router to the one supported time-zone field. It was source approval only.

### Canonical production readback — 22 September 2026

The public Nginx `/api/trpc` routes were read without modification and resolve
to the healthy `cp11-api-candidate-next` on loopback port 3003. Its application
database contract selected `phone11ai`, schema `public`, PostgreSQL `160013`.
The read-only transaction found `tenant_settings` **absent** and `tenants.id`
as the single primary key, with one primary key, zero outbound foreign keys and
17 inbound foreign keys. No customer rows were queried.

An earlier edge-host catalog is not this public API target and must not be used
for this migration decision. The routed candidate’s absent relation is the
only catalog state recorded here. This readback does not establish a backup,
restore rehearsal, migration application, API deployment, audit storage, or
browser/device behavior.

## Production commissioning gate

1. Freeze and independently review the exact source commit, migration bytes,
   application bundle, dependency lock, and rollback plan.
2. Obtain an approved database backup and prove its restore procedure. Capture
   the current `tenant_settings` catalog state without row values.
3. Install the independently reviewed guarded operator, reviewed SQL and proof
   files exactly as specified in
   `TENANT-SETTINGS-MIGRATION-OPERATOR-20260922.md`. Run its read-only prepare
   mode through the pinned routed candidate:

   ```text
   sudo /opt/phone11ai/tenant-settings/phone11-tenant-settings-migrate.py \
     --prepare \
     --sql /opt/phone11ai/tenant-settings/tenant-settings-migration.sql \
     --backup-proof /root/phone11-tenant-settings/backup-proof.json \
     --restore-proof /root/phone11-tenant-settings/restore-proof.json
   ```

   Continue only when it prints
   `tenant_settings=PREPARE_READY apply=NOT_RUN`. Any other result stops the
   operation for review.

4. Apply only through that guarded operator and a new root-only journal path:

   ```text
   sudo /opt/phone11ai/tenant-settings/phone11-tenant-settings-migrate.py \
     --apply \
     --sql /opt/phone11ai/tenant-settings/tenant-settings-migration.sql \
     --backup-proof /root/phone11-tenant-settings/backup-proof.json \
     --restore-proof /root/phone11-tenant-settings/restore-proof.json \
     --receipt /var/lib/phone11-tenant-settings/receipt.json
   ```

   The operator creates and fsyncs the exclusive intent before database access.
   Do not use direct `psql`, the TypeScript preflight as an alternate production
   path, or any database URL outside the pinned candidate environment.

5. If apply is interrupted, exits nonzero, or lacks its exact success message,
   do not retry it. Run the documented `--recover` mode with the same artifact,
   proofs and journal. Recovery must prove and record either `APPLIED` or
   `NOT_APPLIED`; every other state stops for review. After a reported success,
   run the same recovery command and require
   `tenant_settings=RECOVERY_VALID status=APPLIED`. Verify through the later
   authorized application test that the migration created zero rows; the
   operator itself reads catalogs only and does not inspect customer rows.
6. Build and deploy the exact reviewed workerless API candidate through its
   existing blue/green process. Do not restart or replace the calling baseline.
7. With an isolated test owner/admin and test workspace, save `Asia/Bangkok`,
   reload tenant details, and verify the same value. Confirm an ordinary member
   and a user from a second workspace receive denial and cannot change either
   row. Confirm an unsupported caller-ID or recording setting is rejected.
8. Verify the audit event contains the actor and selected workspace, contains no
   credentials, and corresponds to the persisted row. Then perform the normal
   rollback-readiness and exact-runtime checks for the API candidate.

## Rollback

Roll back the API route/image with the already reviewed blue/green operator if
the application check fails. The new table is inert while unused and its rows
do not affect calling. Do not drop the table or delete workspace rows during an
application rollback. Any later schema removal is a separate reviewed data
migration performed only after export/retention decisions and confirmation that
no runtime still reads the workspace time zone.

Source checks, an applied migration, an API response, and a browser save each
prove different layers. None proves call routing, provider behavior, or handset
calling because this slice does not wire those behaviors.
