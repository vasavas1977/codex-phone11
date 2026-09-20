# Parallel API operator review follow-ups

## Final independent source verdict

On 20 September 2026, the independent Sol High reviewer returned **APPROVE_SOURCE_ONLY** for exact commit `34d7cf059e629ad241bb0c89abd184743ebd75c0`, with no remaining P0/P1/P2 in the bounded operator scope. The exact-head 24-test suite and Python syntax check passed. Script SHA-256: `08d7fef9dd22ad3b33464e617f5715fd3908a76973a9cb8bd384699bfe20b215`; test SHA-256: `1b8a9fe8f8c39d5a5c4e599a62a05f671dc2b57b3d204b4d16bffc556434beed`.

This closes the source-review gate only. Fresh candidate image, protected manifest, migration receipt, authenticated probe set, exact host pins, guarded prepare/activation, and two-device acceptance remain pending. No production activation is recorded here. Historical findings and their corrections follow.

Source review of the initial uncommitted operator. Status: **activation blocked**, not approved for production. Twelve hermetic operator tests pass, but the following must be corrected and tested before preparing a manifest.

1. `prepare()` and post-activation validation require exactly one literal wake URL. The prior live inspection found four occurrences. Pin the exact reviewed Kamailio config hash and expected nonzero occurrence count in the manifest, and verify both before/after; do not weaken this to an arbitrary substring check.
2. `activate()` re-reads Nginx after candidate startup/probes but does not compare it with the pinned original/full dump immediately before the write. Abort if either changed; otherwise a concurrent config edit could be incorporated and later overwritten or make rollback unusable. Recheck the insertion marker as well.
3. Serialize prepare/activate/rollback operators with a protected process lock. Concurrent activation or rollback must fail closed before mutation.
4. Align protected key validation with the corrected installer's canonical 61-character grammar (`c11_live_[0-9a-f]{8}_[A-Za-z0-9_-]{43}`). Prefix-plus-trim validation allowed the duplicated clipboard value that Connect11 is correcting. Recompute credential pins only after that correction is accepted and both keys authenticate through safe probes.

All four items have now been corrected in source and covered by 15 passing hermetic operator tests, including pre-write drift rejection, competing-lock denial and duplicated/truncated key rejection. The independently reviewed installer correction was imported by exact file hash and its 15 tests pass. The five runtime/startup tests also pass. Review final immutable source again before production use. The live image, migration, protected probe set, host baseline and Nginx pins are still separate prerequisites; no operator command has activated production.

A subsequent independent review found three more bounded operator defects. The
public protected-probe destination now accepts only the literal audited origin
`https://api.phone11.ai`. Activation re-renders and revalidates the pinned
Compose source after prepare, writes that fully resolved model to a protected
temporary file, and runs only that snapshot with its pinned project name and
explicit original project directory. The durable writer now handles partial
writes, rejects zero-length writes, syncs the file before replacement, syncs
the parent directory after replacement, and removes temporary files on failure.
Twenty-four hermetic operator tests cover hostile public origins, intervening
Compose edits, frozen execution semantics, partial and zero-length writes, and
file/directory durability. Docker Compose v5.1.4 also reproduced an identical
canonical model after a rendered JSON round trip containing ordinary dollars,
`$$`, and `${...}`. The rendered JSON already carries Compose's literal-dollar
escaping, so the frozen writer preserves its strings exactly instead of escaping
them a second time. This is correction evidence only. It does not approve
activation or establish any live pin, migration, candidate image, or probe result.

The durability follow-up also moves the live Nginx site write inside activation's
recovery boundary. A write now reports whether its atomic replacement committed.
A pre-commit failure leaves the reviewed original untouched and does not reload;
a post-replacement directory-sync failure verifies the current bytes and restores
the original before returning failure. If restoration itself commits but its
directory sync fails, the operator verifies the original bytes, syntax-checks and
reloads that safe configuration, then still reports the durability failure. An
activation-level injected second-sync failure proves the final site bytes and the
only reload both use the original route. This remains source evidence only.
