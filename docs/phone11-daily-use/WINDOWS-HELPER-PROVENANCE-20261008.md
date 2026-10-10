# Windows helper source verification — 8 October 2026

The Windows package receipt previously compared recorded native-input hashes
with the committed source, then relied on Git status to check that the working
files had not changed. Git's `assume-unchanged` and `skip-worktree` flags can hide
modified files from that status check. A clean status therefore did not prove
that the consumed helper source, CMake configuration and bootstrap test still
matched the receipt.

The final synchronous receipt check now hashes all three actual files against
the recorded hashes, which are independently bound to the committed source.
The same check runs when the receipt is first admitted and at the later package
boundary. Existing receipt custody, SDK, helper-binary, copied-inventory and
source-revision checks remain in place.

Six negative regressions reproduced the defect before the fix. Coverage also
accepts unchanged files with either index flag and rejects persistent native
input replacements after the awaited checks. The ordinary daily-use workflow
already requires the helper provenance suite to pass without skipped cases.

This is local package consistency validation. The synchronous pass prevents
local JavaScript callbacks from interleaving with its checks; it is not an
atomic filesystem snapshot against external writers. A matching receipt does
not establish receipt custody, a licensed SDK, code signing, distribution,
deployment or physical calling acceptance. Existing trial packages retain
their original source and artifact identities; this change does not rebuild
or relabel them.
