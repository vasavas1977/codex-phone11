# Phone11 chat schema preflight — 2026-09-20

## Outcome

The live database is compatible with the minimal Phone11 session-presence and
read-receipt delta. The guarded operator passed an exact, read-only production
preflight. No production DDL was executed during this preparation.

The historical base, collaboration, and media migrations must **not** be
replayed. Their objects are already present. Only these four objects are absent:

- `public.phone11_chat_presence_sessions`
- `public.phone11_chat_presence_sessions_fresh`
- `public.phone11_chat_read_receipts`
- `public.phone11_chat_read_receipts_sender_lookup`

## Pinned evidence

- source contract SHA: `f5b47b8f3b9c09c3bdec05effd6ead5ad664a9e9`
- active backend container ID:
  `f9ce934dc51b531fe1a9b2bd927634322f9c6c572a551592a48d3e0d26a49616`
- active image:
  `sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619`
- normalized database-identity fingerprint:
  `6901e1f28e6fc33ebba8eefaa8708e663f1145a22ccdeb5bdc960cd849b4a552`
- complete scoped pre-migration catalog fingerprint:
  `c1bc10833710e9ceb2a25e0f713c384fc25d70982cd7862e1f6aceaa35526f6c`
- immutable delta SHA-256:
  `dffee7ecb0d713a04cad25de1de493d71780b2d5b8f2d9be3101680e0ccfc93f`

The first operator rehearsal exposed that the earlier identity fingerprint used
a different serialization representation. It failed closed before any write.
The fingerprint above is calculated by the same embedded operator code that
performs the apply and was then matched against the live database. The full
catalog fingerprint remained unchanged and matched on both attempts.

## Guarded apply behavior

`scripts/phone11-chat-presence-receipts-migrate.py`:

- requires root, the exact healthy container ID/image, a root-owned mode `0600`
  SQL artifact, and the pinned artifact hash;
- keeps database credentials inside the backend container and suppresses raw
  database diagnostics;
- obtains a fixed transaction advisory lock with `lock_timeout = '2s'` before
  reading the pinned identity/catalog baseline, and applies under
  `statement_timeout = '30s'`;
- revalidates the exact identity and pre-migration catalog in the same locked
  transaction as the DDL;
- rejects missing, partial, pre-existing, differently owned, RLS-enabled, or
  externally granted prerequisites/targets;
- verifies the exact post-migration columns, constraints, index definitions,
  ownership, grants, policies, and absence of unrelated scoped catalog changes
  **before commit**, using one contract shared with the outer operator check;
- atomically publishes an exclusive, root-owned mode `0600`
  `phone11-migration-receipt/v1` only after commit, so an interrupted write
  cannot expose a partial final receipt;
- provides `--recover-receipt` as a read-only recovery path if commit succeeds
  but receipt creation fails. Recovery re-proves the exact post-state and
  refuses drift before writing the missing receipt, or validates an already
  complete receipt left by a failure after atomic publication.

## Rehearsal evidence

The automated suite ran against a real disposable PostgreSQL 17 cluster and
passed 12/12 checks. It covers the immutable artifact pin, exact post-state,
unrelated drift rejection, identity/policy rejection, secure file handling,
exclusive atomic receipt creation and recovery verification, partial-write
cleanup, successful guarded DDL, pre-commit rollback when inherited default
grants alter the target shape, re-apply rejection, incompatible-prerequisite
rollback, and advisory-lock timeout rollback.

Commands executed:

```text
python3 -m py_compile scripts/phone11-chat-presence-receipts-migrate.py tests/phone11-chat-presence-receipts-migrate.test.py
python3 tests/phone11-chat-presence-receipts-migrate.test.py
git diff --check
```

The embedded production `prepare` action was also executed over the pinned EC2
Instance Connect path. Result: identity pin matched, catalog pin matched,
`apply=NOT_RUN`.

## Remaining activation gates

1. Independent review of this exact migration/operator commit.
2. A controlled production apply using the reviewed immutable files, followed
   by receipt verification. This document does not authorize or claim it.
3. Candidate deployment and API probes remain separate evidence.
4. On the first fresh API process, `phone.getConfig` invokes
   `ensurePhoneProvisioningSchema`. Its existing idempotent provisioning DDL is
   outside this delta and must be observed as a separate activation-compatibility
   gate rather than being silently treated as covered here.
5. Real Phone11 handset conference join, media, participant, lifecycle, and
   locked/background behavior remain separate device-acceptance evidence.
