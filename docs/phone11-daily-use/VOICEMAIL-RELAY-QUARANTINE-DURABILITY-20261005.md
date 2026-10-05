# Voicemail relay quarantine durability — 5 October 2026

Source correction from `32d9af7be19e1dab0abe1292a10a28d1d69735be`; no host,
database, provider, deposit, deployment or flag action was performed.

The relay previously synchronized the quarantine directory's contents, removed
the original outbox manifest, then synchronized the outbox parent. The new
quarantine directory's entry had no successful parent durability barrier before
source removal. A real-file relay fixture injecting parent `fsync` failure
returned `retry=1` with the original manifest absent; the next tick found nothing
to retry. Quarantine bytes and the WAV remained visible in that process, but the
new directory entry's persistence was not established. This reproduces ordering
and an I/O failure, not a power-loss experiment on a commissioned volume.

The relay now synchronizes quarantine contents and its outbox parent **before**
unlinking the source. It repeats both barriers for an existing quarantine
directory and an interrupted move. Parent failure keeps the exact original
manifest and its quarantine hardlink available for recovery. A later failure
synchronizing source removal reports uncertainty, while quarantine already has
the successful preservation barriers. No WAV is deleted.

Cleanup is bound to the regular, private manifest inode and metadata captured
when it was read. Persistent manifest replacements during upload or directory
synchronization refuse removal. Quarantine and outbox directory identities are
checked across synchronization. Symlink destinations, conflicting inodes and
unaccounted hardlinks fail closed. The exact producer temporary hardlink and
interrupted quarantine hardlink states remain supported, including their
three-link combination. Producer temporary evidence is preserved; the relay
does not clean another process's staging file. Successful upload cleanup also
checks the captured manifest identity before removal.

The producer and fixed runner bytes are unchanged. The supported producer temp
name/inode geometry comes from the existing exclusive-link publication protocol;
it is not authorization to accept unrelated links or infer a completed deposit
from a directory scan. Backend admission/upload status handling, UUID replay,
owner-epoch authority and both default-off flags are unchanged.

Validation includes original-source failure, parent/child sync failure,
existing-directory and hardlink recovery, persistent source/destination/parent
replacement, symlink and unrelated-link refusal, and post-unlink sync uncertainty.
Adjacent lifecycle, producer, producer durability, backend durability and offline
bundle tests remain separate source fixtures. Compiled producer/relay CLI smoke
checks use empty disposable directories and fake configuration only; the fixed
Linux runner is checked for exact-copy preservation and shell syntax, not
executed or certified on an active host.

These sequential checks are not an atomic filesystem lease and do not defeat a
writer changing and restoring evidence between checks or after the final check.
Runtime mounts and files must stay under exclusive operator custody. Filesystem
durability semantics, actual runner/runtime availability, installed helper/Lua
readiness, protected target clone, database writers, final-WAV lifecycle,
admitted deposits/replay, rollback and owned device playback remain open under
the [acceptance packet](VOICEMAIL-ACCEPTANCE-PACKET-20261004.md).

Changed relay bytes require a new independently retained
[offline bundle](VOICEMAIL-OFFLINE-BUNDLE-20261005.md) input/artifact manifest and
digest. Historical bundle, source and runtime receipts retain their original
pins; this source change grants no commissioning or activation authority.
