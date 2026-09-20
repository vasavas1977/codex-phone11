# Phone11 plain-video admission readiness — 2026-09-20

## Decision

Phone11's reviewed plain-video schema migration, two-user pilot fixture, public
API route, and bounded provider-join probes have been completed. The admitted
pilot is limited to tenant `1`, users `1` and `2`. Native two-handset media
acceptance remains required before conferencing is called customer-ready.

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

## Pilot activation and provider proof

The independently reviewed parallel-API operator at commit
`50b6c3b62298b21baa778053d08ce1054422c608` completed guarded preparation and
activation. The five direct probes passed before the Nginx write, followed by
the local build-marker barrier, three consecutive public build-marker probes,
and the complete public probe set. The original backend, wake route, and reused
candidate remained unchanged and healthy. Full route evidence is recorded in
[the parallel API activation record](READ-RECEIPTS-PARALLEL-API-ACTIVATION-20260920.md).

The reviewed fixture source SHA-256
`5dfc695030ac03b3fdd520e148796bffbc4ddb8a595b1dbe514c95387dcbe17b`
was compiled into a dedicated bundle with SHA-256
`62c838cc03f105436916a5207200267faa81c3b6467871a3d29d93a39c777b6a`.
After an exact dry-run and zero-row recheck, one guarded apply created one open
tenant-1 room and two admitted interactive members for users `1` and `2`.
Leases and eviction operations remained empty at fixture commit. The protected
stage is `/opt/phone11ai/plain-video-fixture-20260920T144601Z`; fixture receipt
SHA-256 is
`5fda6ee9688082e0a528b003549e81d7dae7eafef7be93b950dbb1e70d41cf0f`.
Opaque meeting and participant references are retained only in the root-owned
private receipt.

Public authenticated checks then proved both users see available video
capability and only the same admitted meeting. An unauthenticated request
returned `401`; an authorized request for an unknown meeting returned `404`.
Exactly one join was attempted for each pilot user. Both returned the expected
`phone11-plain-video.v1` interactive grant, configured WSS origin, and bounded
five-minute expiry; the two tokens were distinct and were neither printed nor
persisted. Two distinct tenant-1 admission leases are now durably `issued` for
the same meeting and users `1` and `2`.

Connect11 intentionally does not copy raw Phone11 participant references into
LiveKit identities. Its reviewed contract derives customer-, meeting-, and
participant-bound HMAC room and identity values. The live tokens exhibited this
derived-not-raw behavior. Provider proof receipt SHA-256:
`57bff91c806b4269b29444d6f208048efaa16bc72a32dc65a5e5e3511164595b`.
No interpreter, bot, recording, transcript, agent dispatch, eviction, or media
session was started.

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

1. Install a fresh signed Phone11 build containing the admitted meeting path on
   both pilot handsets.
2. Mint fresh per-join tokens only when each handset starts its live acceptance
   session; the commissioning tokens above expire and must not be reused.
3. Complete the two-handset Phone11 test: join, camera/microphone, two-way
   audio/video, participant state, leave/rejoin, revocation/remint denial,
   eviction acknowledgement, background/lock behavior, and media release.

Interpretation, bots, recording, and transcription remain out of scope and
must not be claimed by this pilot.
