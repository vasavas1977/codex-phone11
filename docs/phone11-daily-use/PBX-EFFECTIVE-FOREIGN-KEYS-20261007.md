# Advanced PBX foreign-key enforcement — 7 October 2026

The preflight at `eb57852776c72bcbbdae838e915b70756a79f167` accepted validated
advanced foreign keys even when their internal PostgreSQL enforcement triggers
were disabled or enabled only for replication. Migration replay also retained
that state without refusing it. Eight new tests reproduced both failure paths
in a disposable loopback PostgreSQL 17 database; the 80 existing cases passed.

Preflight and replay now require exactly one foreign key for each of the 11
declared advanced relationships: the single-column, same-schema target,
validated nondeferrable MATCH SIMPLE constraint, CASCADE delete and NO ACTION
update. Each must have all four distinct internal `pg_catalog` RI triggers
with the expected relation, function and event, enabled for an origin session.
ALWAYS-enabled enforcement is accepted. Replay checks while the existing
relation locks are held and rejects drift without enabling or replacing an
existing constraint. The test fixtures verify unchanged catalogs after refusal.

The two PBX suites pass 278 cases without skips. They cover every RI event in
disabled and replica-only modes across all 11 relationships, ALWAYS-enabled
enforcement, missing/duplicate constraints, action/target/match/column-shape
drift, deferrable and unvalidated constraints. Focused TypeScript, ESLint and
whitespace checks passed. The ESLint configuration emits an existing Node
module-type warning. These are source and synthetic-database results only.

This changes the advanced migration and preflight bytes. Retain fresh digests
and the final reviewed source revision before any new protected-clone rehearsal
or operator plan. Earlier source/package/migration receipts retain their
original pins and do not cover this change. The existing [writer, rollback and
commissioning gates](PBX-RELEASE-GATES-20261001.md) still apply. The last read-only
live observation on 6 October found the public API on port 3023, not the older
3016 plan, and all nine advanced PBX tables absent. No live migration, routing,
roles, provider activation, application installation or device test occurred.
