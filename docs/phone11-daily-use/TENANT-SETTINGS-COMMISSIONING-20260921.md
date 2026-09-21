# Phone11 workspace time-zone commissioning

**Status:** source candidate only. No production preflight, backup, migration,
deployment, service restart, role change, or customer-data write was performed.

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
  dedicated `phone11_pbx_test` database, ran the two focused suites: **70
  passing tests**. This included the three database cases that are otherwise
  skipped when no explicit fixture URL is supplied.
- The database cases created and dropped random schemas. They proved an absent
  table can be migrated twice, workspace rows persist separately, non-admin and
  cross-workspace actors cannot write, blank values are rejected, a tenant
  delete cascades, and a composite tenant key is rejected by both the migration
  and read-only preflight.
- `node node_modules/typescript/bin/tsc --noEmit` completed successfully.

This is local source evidence only. It does not establish the selected
production database state, an applied migration, a deployed API, audit storage,
or browser/device behavior.

## Production commissioning gate

1. Freeze and independently review the exact source commit, migration bytes,
   application bundle, dependency lock, and rollback plan.
2. Obtain an approved database backup and prove its restore procedure. Capture
   the current `tenant_settings` catalog state without row values.
3. Run the read-only preflight against the exact Phone11 database selected by
   `server/pbx/db.ts`:

   ```sh
   node_modules/.bin/tsx scripts/phone11-tenant-settings-preflight.ts
   ```

   Continue only when it reports `status: "absent"`. If it reports
   `incompatible`, stop for schema review. If it already reports `compatible`,
   do not apply an unneeded change; verify the exact migration history instead.

4. Apply the reviewed migration through the approved database migration
   channel with stop-on-error behavior:

   ```sh
   psql "$APPROVED_PHONE11_DATABASE_URL" \
     --set ON_ERROR_STOP=1 \
     --file server/pbx/tenant-settings-migration.sql
   ```

   Keep the connection value in the protected operator environment. Do not put
   it in a command transcript, source file, manifest, or evidence artifact.

5. Rerun the read-only preflight and require `status: "compatible"` with an
   empty `issues` array. Verify that the migration created zero rows.
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
