# Phone11 plain-video admission readiness — 2026-09-20

## Decision

Phone11's reviewed plain-video schema migration was applied to production with
the guarded operator. The schema is empty and the two-user pilot fixture has
not been created. Conference capability remains fail-closed while the pilot
candidate is commissioned.

The historical draft migration is not suitable for direct production replay:
its `IF NOT EXISTS`, `CREATE OR REPLACE`, and trigger replacement statements can
accept or alter partial state. The guarded live delta and operator prepared here
retain the same data model while requiring exact absence, exact live pins, an
outer advisory lock, pre-commit post-shape verification, and an atomic receipt.

## Source and artifact pins

- reviewed source base: `f5b47b8f3b9c09c3bdec05effd6ead5ad664a9e9`
- historical draft migration SHA-256:
  `bb219fbf441959f5a487cda213aef5b69afe69fed5bf384cfe58469a04c38984`
- guarded live delta SHA-256:
  `985437663523803627abd151b5ee3a1858f65b61966c051ec6fbd048a0a4f732`
- live database identity fingerprint:
  `6901e1f28e6fc33ebba8eefaa8708e663f1145a22ccdeb5bdc960cd849b4a552`
- live prerequisite catalog fingerprint:
  `e8e40847c0622d3719b61e7447af883c3b45bc594ac6985c537cbafcdee7e0e3`
- rehearsed exact target fingerprint:
  `8719c1618a1212e13a414e2e717f394ce118660f5da0d3b618a4203bd9edd48c`

## Live read-only preflight

The exact production inspection passed without DDL or row changes:

- prerequisite relations `users`, `tenants`, `tenant_memberships`, and
  `phone11_auth_identity` are present, owned by the current database owner,
  have RLS disabled, and have no non-owner grants;
- no `phone11_plain_video_*` or `phone11_meeting*` relation, routine, or trigger
  exists;
- tenant `1` is active;
- user `1` / extension `3001` and user `2` / extension `1020` each have exactly
  one active Phone11 identity and active tenant membership;
- the protected tenant-1 Connect11 mapping and separate status/join-evict
  server credentials were already validated; no credential value is recorded
  here.

The embedded operator `prepare` action then matched both live fingerprints and
returned `apply=NOT_RUN`.

## Production schema apply

The approved commit `c6c07a73b9c1573fab27e1952e18dc18da11a02e` was staged at
`/opt/phone11ai/plain-video-admission-migration-20260920T101431Z` in a
root-owned mode `0700` directory. The SQL and operator remained root-owned mode
`0600` with the pinned hashes above.

One guarded apply completed and produced a `phone11-migration-receipt/v1`
receipt with `status=applied`. Receipt SHA-256:
`e7b8ba51885f0155b8309acc809536af81c864510fb83f279d8348f72fb9f0d9`;
verification SHA-256:
`777d6eefedfa9e2630a74a769bf82401fb406993a406d5683fa7e91385245917`.
Read-only recovery returned `migration=ALREADY_APPLIED` and
`receipt=ALREADY_PRESENT`, and the live target fingerprint remained
`8719c1618a1212e13a414e2e717f394ce118660f5da0d3b618a4203bd9edd48c`.

All four tables, the revision function, and both enabled revision triggers are
present. Rooms, members, leases, and eviction operations each contain zero
rows. The active backend and isolated API candidate both remained healthy with
HTTP 200 health responses. The protected candidate conference probe still
returned the required unavailable state; no provider call or token mint ran.

The older candidate readiness checker reports a false failure because it
formats two valid partial-index predicates with an explicit `::text` cast. That
diagnostic does not authorize or invalidate the migration; the guarded
operator's exact target fingerprint and receipt are authoritative.

## Guarded migration and fixture behavior

`server/meetings/plain-video-admission-live-delta-20260920.sql` creates only:

- four admission, membership, lease, and eviction-operation tables;
- four explicit lookup indexes plus constraint-owned indexes;
- one revision-touch trigger function;
- two revision-change triggers.

It creates no meeting/admission rows. It contains no provider call, token,
credential, interpreter, agent, bot, recording, or transcript behavior.

`scripts/phone11-plain-video-admission-migrate.py` follows the reviewed chat
migration safety pattern: exact root-only artifacts, exact container/image and
database pins, a fixed transaction advisory lock before the catalog snapshot,
two-second lock and thirty-second statement limits, exact unrelated-catalog
preservation, an exact target fingerprint (including trigger function body,
settings, ACL, and trigger definitions) checked before commit, and atomic
`phone11-migration-receipt/v1` publication with read-only recovery validation.

The existing fixture utility remains the only proposed record writer. Its
default path is read-only, validates both users together against active tenant,
membership, and identity state, derives meeting/participant references on the
server, and writes one open room plus two admitted interactive members only
when `--apply` is explicitly supplied. It never mints a token or calls
Connect11.

## Validation

- 44/44 existing admission, lease, eviction, tenant-provider, facade,
  preflight, and fixture unit tests passed.
- 7/7 new operator tests passed against a disposable real PostgreSQL 17
  cluster.
- The real-database rehearsal proves guarded apply, exact target fingerprint,
  actual fixture dry-run with zero rows, actual two-user fixture apply, default
  grant drift rollback, partial-target rejection, advisory-lock timeout before
  snapshot, and recovery refusal after the revision-trigger function body is
  altered.
- Python compilation and whitespace checks pass.

## Concrete review finding

P2 — `scripts/phone11-plain-video-admission-preflight.ts` derives composite
foreign-key column pairs by joining `key_column_usage` to
`constraint_column_usage` without ordinal-position mapping. That can produce a
cross product and falsely accept a swapped composite foreign key. It remains
useful as a clone-oriented diagnostic, but must not authorize production apply.
The new guarded operator instead pins the complete prerequisite catalog and
the exact rehearsed target catalog inside one transaction.

No P0 or P1 source issue was found in the bounded admission, lease, eviction,
tenant selection, or fixture path.

## Recommended controlled sequence

1. Run the fixture dry-run for tenant `1`, users `1` and `2`; then create one
   pilot room with the same utility under an explicit fixture authorization.
2. Start the candidate API with the protected tenant mapping and bounded
   database lock/statement options. Prove both authenticated users list only
   their admitted meeting.
3. Mint a fresh per-join token for each participant through the server-only
   Connect11 facade; never cache/reuse tokens or expose keys. Validate the
   returned WSS origin and five-minute expiry.
4. Complete the two-handset Phone11 test: join, camera/microphone, two-way
   audio/video, participant state, leave/rejoin, revocation/remint denial,
   eviction acknowledgement, background/lock behavior, and media release.

Interpretation, bots, recording, and transcription remain out of scope and
must not be claimed by this pilot.
