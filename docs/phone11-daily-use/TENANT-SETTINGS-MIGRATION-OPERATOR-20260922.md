# Phone11 tenant-settings guarded migration operator

**Status:** prepared source only. The operator has not been copied to the VOIP
host or run there. No backup, restore, database migration, route change,
container replacement, service restart, or customer-data access was performed.

## Exact target and scope

The public `/api/trpc` locations currently route to
`cp11-api-candidate-next` on `127.0.0.1:3003`. The operator resolves every
inspection and execution through the full immutable container ID, also requires
the expected name, image, health and loopback binding, and uses only that
container's in-memory database configuration. It never executes through the
mutable container name.

The read-only operator catalog pin is the `phone11ai` / `public` PostgreSQL 16
target with identity SHA-256
`35adc6d560d05208bc55746d26c6ed298b19e699dab66c3b5b9124c422f5a17f` and
absent-state catalog SHA-256
`0da5b0d9a09e50624b36fc7a8e1fe262bb130b36a0d52b1b727f27b767edb084`.
`tenant_settings` must still be absent. The operator reads PostgreSQL catalogs
only; it never selects application, identity, membership, message, call, or
other customer rows.

It accepts exactly the reviewed migration digest
`86b829b502b6d1a34e542247de2df6b653a6bcb4e106b4c17d58a8a1c8f2751c`.
It permits one additive table only and verifies the exact post-state: the four
columns, single tenant primary key, cascading tenant foreign key, and reviewed,
validated nonempty-time-zone check. Existing `tenants` metadata must have the
same catalog fingerprint before and after the transaction.

## Required protected evidence before apply

`--prepare` and `--apply` both require two root-owned, mode-0600 JSON proofs.
They contain only hashes, timestamps, mechanism names, and a boolean catalog
result; never include a database URL, credentials, a backup payload, or row
contents.

1. A fresh `phone11.tenant-settings-backup-proof/v1` attests that
   `cp11-postgres:pg_dump` made a protected backup for the pinned database.
2. A matching `phone11.tenant-settings-restore-proof/v1` attests that the same
   backup hash was restored with `cp11-postgres:pg_restore` into a **separate
   PostgreSQL cluster**, then catalog-checked. Both attestations expire after
   30 minutes.

The active `cp11-postgres` container has a writable `/backup` bind mount and
both `pg_dump` and `pg_restore` binaries. A scheduled backup and a restore
rehearsal have not been verified. Provision the protected backup location and
the separate PostgreSQL 16 restore environment before any operator invocation.

## Operator sequence after independent review

Install the reviewed SQL and operator as root-owned mode-0600 regular files,
create a root-owned mode-0700 journal directory, generate the two fresh proof
files, and then run:

```text
sudo /opt/phone11ai/tenant-settings/phone11-tenant-settings-migrate.py \
  --prepare \
  --sql /opt/phone11ai/tenant-settings/tenant-settings-migration.sql \
  --backup-proof /root/phone11-tenant-settings/backup-proof.json \
  --restore-proof /root/phone11-tenant-settings/restore-proof.json

sudo /opt/phone11ai/tenant-settings/phone11-tenant-settings-migrate.py \
  --apply \
  --sql /opt/phone11ai/tenant-settings/tenant-settings-migration.sql \
  --backup-proof /root/phone11-tenant-settings/backup-proof.json \
  --restore-proof /root/phone11-tenant-settings/restore-proof.json \
  --receipt /var/lib/phone11-tenant-settings/receipt.json
```

Before any database mutation, apply exclusively creates and fsyncs a root-only
mode-0600 `phone11.tenant-settings-migration-journal/v2` intent at the receipt
path. Only then does it revalidate the immutable container ID, take the advisory
transaction lock, use a two-second lock timeout and 30-second statement timeout,
strip the migration's reviewed outer transaction envelope, and run the body
inside its own transaction. It rolls back on every precondition, SQL, catalog,
or post-state failure. After a confirmed commit and exact post-state check, it
atomically replaces the intent with an `applied` journal record and fsyncs the
directory. The journal contains hashes only.

If apply exits nonzero, is interrupted, loses the database response, or does not
print `tenant_settings=APPLIED receipt=WRITTEN`, do **not** rerun apply and do not
choose another receipt path. Run the read-only recovery path against the same
SQL, proof files and journal:

```text
sudo /opt/phone11ai/tenant-settings/phone11-tenant-settings-migrate.py \
  --recover \
  --sql /opt/phone11ai/tenant-settings/tenant-settings-migration.sql \
  --backup-proof /root/phone11-tenant-settings/backup-proof.json \
  --restore-proof /root/phone11-tenant-settings/restore-proof.json \
  --receipt /var/lib/phone11-tenant-settings/receipt.json
```

Recovery accepts stale proof timestamps because the durable intent already pins
their exact bytes, but the protected proof files must still exist unchanged. It
revalidates the pinned database without writing it. Exact compatible post-state
finalizes the journal as `applied`; exact original absent-state finalizes it as
`not_applied`; any other state remains blocked for review. A `not_applied`
journal is retained. The operator accepts only the fixed journal path shown
above, so it cannot be bypassed with another pathname. Any later apply requires
a separately reviewed operator revision and fresh proofs; there is no automatic
or blind retry. Do not use interactive `psql`, substitute a different candidate,
remove or rename the retained journal, or reuse the older chat/profile migration
operators.

After a successful apply, run `--recover` once and require
`tenant_settings=RECOVERY_VALID status=APPLIED`. This is the authoritative
read-only post-check through the same pinned candidate. The API candidate image
and Nginx route remain separate rollout decisions.

## Validation and remaining provisioning

Local hermetic checks completed 12 tests with the PostgreSQL 16 class correctly skipped
because this Mac does not have PostgreSQL 16 binaries. The checks cover the
pinned artifact, fresh linked backup/restore proofs, allowlisted test database
environment, immutable container-ID execution, durable exclusive intent before
database access, atomic journal transition, absent-state recovery, and simulated
container/database command failures.

A separate root-only fixture on the VOIP host then passed all 13 tests against
real PostgreSQL **16.13** in a throwaway container created from exact cached
image `sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50`.
Node and `pg` ran in separate throwaway containers created from exact cached
image `sha256:2e7225e80ec7e5fac5d82c20f294372bbcf325116de9926f7dff5f2a9ee1f1a9`.
The fixture had no network, no published ports, no live volumes or inherited
environment, a fresh shared Unix-socket volume, and bounded CPU, memory and PID
limits. It exercised actual Node apply, rerun refusal, wrong-target refusal,
transaction rollback, applied and not-applied recovery, and incompatible-state
recovery refusal. The throwaway containers, socket volume and staged fixture
directory were removed after the run. No production backup or migration ran.
