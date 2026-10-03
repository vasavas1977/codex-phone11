# Current authority for PBX routing writes — 4 October 2026

Ring-group, queue and business-hours mutations previously accepted a cached
administrator membership. IVR checked current membership before its write
transaction, leaving a revocation race. All 18 mutations now lock the current
active membership and workspace inside the same transaction as their writes.
Parent-resource checks, extension validation and replacement writes use that
client, including the actual schema-capability query. This avoids waiting for a
second pool connection while holding the first. Audit and cache effects run
after commit. Unavailable facilities retain their friendly display names.

Existing inputs and tenant-selection behavior remain compatible. A request
whose revocation commits first is refused without routing writes. If an
authorized mutation holds the lock first, revocation waits for its commit;
subsequent mutations are refused. This defines ordering rather than claiming
that already-committed work can be canceled.

The frozen baseline failed all 45 initial source regressions. Subsequent
regressions cover friendly labels and connection reuse; the latter reproduces a
timeout before repair with a real one-connection pool. Eight real PostgreSQL
17 cases additionally exercise transaction rollback, resource isolation and both
revocation orderings using observed database blocking. The dedicated mandatory
CI job admits only its disposable service before fixture DDL and runs under a
restricted runtime role. Missing required fixture configuration fails the run.
Independent source and CI-fragment reviews are separate from hosted CI results.
Hosted CI for this integrated follow-up is pending at this document's commit;
the PR checks and private release receipt record its later exact-head result.

This is a mutation-authority fix. Existing cached read authorization, external
writers and deployed database privileges are not certified by these checks.
The source writer inventory remains incomplete for commissioning: protected
target-clone rehearsal, accountable active/rollback writers and operator review
are still required by [PBX release gates](PBX-RELEASE-GATES-20261001.md).
No production schema, routing flag or telephony provider was changed.

This follow-up changes backend/tests and CI/documentation only. Build 116 and
the verified macOS/Windows trial packages remain artifacts of `b5a97e6`, not
artifacts built from this backend follow-up. Client/native source equivalence is
checked separately; installed-client and physical acceptance remain deferred.
