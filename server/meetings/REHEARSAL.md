# Phone11 meeting migration rehearsal

From the repository root, with project dependencies and local PostgreSQL 17
installed, run:

```sh
node_modules/.bin/tsx scripts/phone11-meeting-chain-rehearsal.ts
python3 scripts/phone11-meeting-concurrency-rehearsal.py
node_modules/.bin/vitest run tests/phone11-plain-video-admission-preflight.test.ts
```

The first command creates a fresh, temporary, socket-only PostgreSQL cluster and
database. It accepts no database URL or data input and removes its cluster after
the run. Its only synthetic prerequisite is `rehearsal-foundation.sql`, which
mirrors four tables created inline by `server/db.ts` and
`server/phone-provisioning.ts`: `users`, `tenants`, `extensions`, and
`user_extensions`. It then applies the checked-in
`server/cloud-recordings/prerequisites.sql` membership schema, calls the real
`applyAuthMigration` generator for Better Auth and `phone11_auth_identity`, and
applies these source migrations in order:

1. `server/chat/migration.sql`
2. `server/chat/collaboration-migration.sql`
3. `server/chat/media-migration.sql`
4. `server/chat/read-receipts-migration.sql`
5. `server/meetings/plain-video-admission-migration.sql`
6. `server/meetings/channel-meeting-migration.sql`
7. `server/meetings/direct-meeting-migration.sql`

The read-only `phone11-plain-video-admission-preflight` logic must report
`ready_for_migration` before step 5 and `already_applied` after it. The runner
also checks the default-deny channel start permission, both member-removal/block
triggers, and meeting foreign keys. It provisions no grants or customer rows.

The second command creates fresh temporary cluster data for each existing
channel/direct PostgreSQL concurrency test. Those tests intentionally replace
their own database schema with small race fixtures; their result does not prove
the full migration chain. The runner uses only their fixed local Unix socket
paths, refuses nonempty sockets, and never opens a TCP listener.

This is source and disposable-schema evidence only. Before a release, take a
fresh catalog-only preflight of the **selected** owned-auth database, inspect
its actual users/tenant/membership/extension/auth/chat objects and migration
history, create an isolated protected restore, rehearse the exact ordered SQL
artifact against that restore, and pin catalog and artifact fingerprints in the
reviewed migration mechanism. The PostgreSQL 17 rehearsal does not establish
hosted schema compatibility, authorization to apply changes, Connect11 tenant
isolation or eviction, or device meeting behavior.
