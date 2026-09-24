# Phone11 desktop calling boundary

`src/call-boundary.ts` is a versioned, source-tested control boundary for the
planned macOS and Windows calling app. It runs in a privileged main process,
between an authenticated renderer and a local Siprix helper. The renderer gets
only registration and single-call state; it cannot issue account, credential,
license, or arbitrary helper commands.

The main process must validate the IPC sender and obtain the current
authenticated `DesktopSession` on **every** action. The helper supervisor calls
`startHelperGeneration` on each spawn, provisions the Siprix account through a
separate privileged path, then calls `bindSession`. Its events must carry the
exact helper generation, session revision, account ID and increasing sequence.
`clear` is mandatory on sign-out, helper exit and account change. Accepted
helper commands do not mean a call is connected; only callback events change
the public state. A renderer reload can request `snapshot` without ending a
call. A helper restart invalidates the prior call and requires a new trusted
binding.

Dial, Answer, and End reserve their call action before awaiting the helper.
Helper command acceptance does not release the reservation: matching call
callbacks do. If a callback is absent after 30 seconds, the public snapshot
reports `reconcile` and duplicate actions remain blocked until a matching
callback or helper/session reset. Native helper errors are reduced to generic
renderer errors because SIP responses can contain private account details.
End can replace a pending Answer for the same call, including when the Answer
callback was lost. End then remains reserved until termination. A trusted
`HelperPort` may throw `HelperCommandRejectedError` only after a definite
pre-acceptance refusal. That releases the exact End reservation for a known
live call so the user can retry. If End had superseded an Answer still awaiting
its connected callback, a refused End restores the Answer reconciliation state;
the user can still retry End, but cannot send a second Answer. A connected
callback received while End is pending resolves that Answer uncertainty.
An ordinary rejection may follow dispatch;
it keeps End in reconciliation until a matching terminal callback or session
reset. The helper adapter must never include raw SIP details in either error.
Call IDs
terminated in the current helper generation are ignored if a late callback
tries to revive them.

Run `./node_modules/.bin/tsx --test desktop/tests/call-boundary.node.ts` from
the repository root. No Siprix vendor binaries, credentials, or license keys
are stored here.

## Native helper bootstrap

`native/phone11_siprix_helper.cpp` compiles against the pinned upstream
SiprixUA SDK but includes no vendor code or binary in this repository. It
accepts only three newline-delimited commands on private stdin:
`v1 init`, `v1 snapshot`, and `v1 shutdown`. Every reply is one JSON line with
`version`, `ok`, and `initialized`. Invalid and oversized commands receive a
generic error. The helper never echoes input, SIP headers, raw SDK errors, or
credentials. It explicitly keeps TLS certificate verification enabled and
vendor file/IDE logging off. EOF tears down the module.

On macOS, with the pinned SDK checked out externally:

```sh
cmake -S desktop/native -B /tmp/phone11-desktop-helper-build -G Xcode \
  -DSIPRIX_SDK_ROOT=/tmp/phone11-siprixua-20260924
cmake --build /tmp/phone11-desktop-helper-build --config Release
```

On Windows, use the same CMake source with Visual Studio 2022 and point
`SIPRIX_SDK_ROOT` at an external checkout containing the vendor `win/`
headers, import library and DLLs. The build copies DLLs next to the helper
output; they must be handled under the vendor's distribution license. The
Windows target has **not** been compiled or run here.

Local macOS arm64 evidence on 24 September 2026: CMake 4.4.3 generated an
Xcode 16.4 project, Release build succeeded, and a direct private-pipe run of
snapshot → init → snapshot → shutdown exited 0 with `false → true → true →
false` initialized states and empty stderr. This is an SDK initialization
proof, with no account, registration, call, audio, production license, app
signing or notarization. The Xcode local ad-hoc signature is not a release
signature.

For a repeatable local smoke test, run
`python3 desktop/native/test_bootstrap.py /path/to/phone11_siprix_helper`.
It checks invalid and oversized input, response shape, shutdown, and that
input text is not echoed.

This is **not yet a desktop softphone**: native account/call operations,
authenticated provisioning, Electron IPC/window shell, secure OS credential storage,
packaging, signing, live PBX registration and two-way media remain required.
The pinned SiprixUA vendor sample is a separate compile proof only. The
[desktop media spike](../docs/phone11-daily-use/DESKTOP-PBX-MEDIA-SPIKE-20260924.md)
records the macOS/Windows runtime and release acceptance gates.
