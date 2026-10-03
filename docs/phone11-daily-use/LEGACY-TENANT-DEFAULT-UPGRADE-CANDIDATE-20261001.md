# Phone11 legacy tenant-default upgrade candidate — 1 October 2026

**Source-only review candidate. Do not run on the live PBX.** The read-only
target catalog showed ordinary `public.tenants` and `public.extensions` tables,
integer primary keys, nullable integer `extensions.tenant_id DEFAULT 1`, no
tenant foreign key, and no NULL tenant assignments. The existing
`server/pbx/extension-tenant-prerequisites.sql` deliberately requires no
default and remains unchanged.

`server/pbx/extension-tenant-legacy-default-prerequisites.sql` is a separate
operator-only transaction for exactly that legacy prestate. It requires the
reviewed database and schema pins plus
`phone11.allow_reviewed_legacy_tenant_default_removal = 'true'` in the
session. That setting records an operator's action acknowledgement **after**
writer and rollback review; it is not evidence that review happened and does
not authorize production use by itself. The complete file must run on a fresh
idle operator connection, outside any existing transaction or generic
migration runner. Its `BEGIN`/`COMMIT` own the transaction; wrapping it in a
READ COMMITTED transaction could commit unrelated caller work. The effective
isolation guard rejects stale REPEATABLE READ or SERIALIZABLE sessions but
does not make a wrapped READ COMMITTED transaction safe. It also requires
`session_replication_role = origin`, pins `pg_catalog` before comparing target
settings so a caller-controlled earlier namespace cannot substitute operators,
and applies
five-second lock and 30-second statement timeouts; locks the named tables;
then rechecks their relation OIDs. It rejects either target table as an
inheritance parent, inheritance child, or partition leaf; parent-table foreign
keys do not guard traditional child inserts. It checks the integer PK and
tenant column shape, accepts only the
canonical constant `1` default, rejects conflicting or partial foreign keys,
and checks for NULL or orphan assignments. The exact replay state also
requires all four internal FK triggers to remain enabled for origin (or
always) on the expected two tables. Only then does it drop the default,
set NOT NULL, add the named same-schema FK and validate it. An exact
no-default/NOT NULL/validated-FK replay performs no DDL. Any other partial
state stops the transaction. It assigns no tenant, backfills no rows, and
changes no roles, grants, applications, providers, or startup path.

The synthetic PostgreSQL rehearsal is in
`tests/phone11-extension-tenant-legacy-default-prerequisites-postgres.test.ts`.
It creates a random schema only in the dedicated loopback
`phone11_pbx_test` database. It checks success, no-DDL replay, omitted-tenant
insert failure, explicit-tenant insertion and FK enforcement, pin and
acknowledgement refusal, hostile search-path operator lookup, inherited and
partitioned targets, incompatible catalogs and FK shapes, disabled FK
triggers, replica sessions, NULL/orphan rollback, stale transaction isolation,
inheritance attachment blocked by the held table locks, and lock-timeout
rollback. These are
source and synthetic-database results, not a protected clone of the real
schema or live commissioning evidence.
The trigger check is a transaction-time catalog guard; it cannot prevent a
later privileged operator from changing triggers or replication role.

The [extension writer inventory](EXTENSION-WRITER-INVENTORY-20261001.md) leaves
an active **BLOCKER**: shared superuser access, host-loopback database access,
retained application images, and unbounded dormant, external, and dynamic
writers prevent a complete writer and rollback inventory. A missing default
could break one of those writers. Before operator consideration, identify the
approved active and rollback image set and every principal with write access,
review extension creation and fresh/partial-schema initialization for each,
rehearse this exact SQL digest on a protected clone, verify backup and access
continuity, and obtain independent source and operator review. Keep the old
strict prerequisite and advanced routing migration as separate gates. Record
catalog and preflight readbacks around any later authorized operator run;
failure means rollback and investigation.
