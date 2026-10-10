# PBX and voicemail commissioning boundary — 6 October 2026

Investigation starts at reviewed source
`617dbd256a2c766c59dfd6b5909fde6f2d472502`. Live writer/principal inventory,
protected-clone rehearsal, retained active/rollback artifacts, helper staging
and an owned real deposit/playback remain incomplete. This continuation has no
production access or action-time authority to collect or change those layers.
Missing live evidence is not a demonstrated source fault.

## Corrected relay source fault

The relay inspected a WAV pathname, checked its resolved containment, then
opened it and compared only its size. A same-size regular-file replacement or
a mailbox ancestor replaced by an external symlink could therefore upload
different bytes under the admitted message identity. A replacement after the
read also allowed acknowledgment to remove the retry manifest despite changed
source evidence. Deterministic filesystem-boundary tests reproduce all three
cases on the base source; the relay sends audio in each case.

The relay now pins the inspected file's device/inode, size, modification/change
times, permissions, owner/group and link count across open/read and the final
pathname check. It rechecks the source-root identity and resolved paths before
upload. Nonblocking open prevents a FIFO replacement from blocking the worker.
Changed or uncertain evidence sends no request, increments retry and retains
the manifest and WAVs. The new tests also refuse an in-place rewrite with its
original size and modification time restored. Existing acknowledgment,
quarantine, crash-link recovery and idempotent retry behavior remain covered.

These are bounded file observations, not a filesystem lease or an authenticated
binding of deposited WAV bytes to an admission. Mutations before the initial
inspection or after the last check require the existing trusted host/storage
custody. Production commissioning still must establish that custody.

## Validation and next operator handoff

The installed Vitest runner, with caching disabled, passes 200 cases without
skips across relay, producer, producer durability, backend durability, lifecycle,
bundle and helper-preflight suites. The bundle suite recompiles captured relay
bytes and verifies the existing offline artifact contract. Scoped TypeScript,
ESLint and whitespace validation pass. Full repository TypeScript was attempted
and failed because the reused installed dependencies omit desktop `electron`
and `@electron/packager` types, producing errors in untouched desktop files;
no dependency installation was attempted. No production
routing, DDL, roles, services, flags, deployments or real deposits were changed.

This relay change alters its source/artifact digests. Build a fresh unsigned
bundle from the independently reviewed final revision and retain its manifest
pin; the earlier bundle cannot cover these bytes. Continue through the existing
[offline bundle](VOICEMAIL-OFFLINE-BUNDLE-20261005.md),
[release prerequisite](VOICEMAIL-RELEASE-PREREQUISITE-20261005.md) and
[acceptance packet](VOICEMAIL-ACCEPTANCE-PACKET-20261004.md) contracts. Neither
caller-attested plans nor these local tests establish runtime authority, helper
readability, loaded Lua, durable mounts, migration/rollback success or physical
playback. Fresh authorized target observations and the protected-clone result
remain the next commissioning inputs.
