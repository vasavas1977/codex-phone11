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
SiprixUA SDK but includes no vendor code or binary in this repository. Its
private stdin protocol now accepts `v1 init`, `v1 snapshot`, `v1 provision`,
`v1 dial DESTINATION`, `v1 answer CALL_ID`, `v1 end CALL_ID`,
`v1 mute CALL_ID 0|1`, `v1 hold CALL_ID 0|1`,
`v1 dtmf CALL_ID DIGITS`, and `v1 shutdown`.
`v1 provision` consumes exactly five further newline-delimited fields: SIP
server, extension, auth ID, password, and transport (`TLS`, `TCP`, or `UDP`).
Only the authenticated main process may send those fields. A malformed frame
closes the helper. Replies have `version`, `ok`, and `initialized`; snapshots
also have `registered` and `callId`. Asynchronous registration and call events
are separate JSON lines; the future main-process adapter must correlate them
with its current helper generation and authenticated session before exposing
them to `DesktopCallBoundary`. Command acceptance is never proof of SIP
registration or call connection. The native helper is limited to one call.
It rejects a second incoming call and refuses dial until registration callback
success. It never echoes credentials, SIP headers, raw SDK errors, or incoming
caller details. TLS certificate verification remains enabled and SDK logging
remains off. EOF tears down the module.

An unanswered incoming call uses Siprix `Call_Reject` when the user ends it.
After `Call_Accept` succeeds, End uses `Call_Bye` for that exact call even if
`OnCallConnected` is still pending; [Siprix's API](https://docs.siprix-voip.com/rst/api.html)
specifies that `Call_Bye` sends BYE or CANCEL as appropriate. The helper
guards this transition against concurrent callbacks. Run
`python3 desktop/native/test_accept_end.py` for the fake-SDK protocol test of
reject-before-answer and accept-then-end-before-connected. It does not prove
two-way audio. `python3 desktop/native/test_controls.py` covers connected-call
mute, hold/resume, DTMF and invalid or stale-call commands. The helper emits
the confirmed hold state from Siprix's callback; the trial SDK still limits
calls to about 60 seconds. These local tests do not prove
live SIP signaling or media.

If Siprix accepts a hold toggle but does not confirm it, the native helper
checks the local hold state after 15 seconds. When the state remains uncertain,
it emits `hold_error` with `code: state_unconfirmed` and
`holdControl: blocked`. The privileged supervisor must attach the current
helper generation, authenticated session revision, account, and monotonic
sequence before passing that event to `DesktopCallBoundary`. The boundary
rejects stale or mismatched events and exposes only the fixed renderer message
“Hold unavailable; end call if needed.” Further hold toggles remain blocked
for that call, while End remains available. The warning clears on call end,
session change, or helper restart. A later `OnCallHeld` that confirms the
requested local hold state on that same call emits `hold_recovered` with
`code: state_confirmed` and `holdControl: ready`. The boundary clears the
warning and allows Hold again only after that exact authenticated, ordered
recovery event; a generic held event or remote-only hold update cannot clear
it. The desktop boundary accepts mute, hold,
and DTMF actions, but this is not yet an integrated desktop call UI.

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
Xcode 16.4 project and the Release helper compiled against the pinned SDK.
The pipe smoke checks initialization, rejected call commands before
registration, invalid provisioning, malformed-frame teardown, and empty
stderr. No real account, call, or audio has been tested. The Xcode local
ad-hoc signature is not a release signature.

For a repeatable local smoke test, run
`python3 desktop/native/test_bootstrap.py /path/to/phone11_siprix_helper`.
It checks invalid and oversized input, response shape, shutdown, and that
input text is not echoed.

This is **not yet a desktop softphone**: authenticated provisioning, the
main-process helper supervisor/event adapter, Electron IPC/window shell, secure
OS credential storage, packaging, signing, live PBX registration and two-way
media remain required. Siprix's free trial limits calls to 60 seconds; that
limit is acceptable for current development and must be expected in call
tests. A paid distribution license has not been verified.
The pinned SiprixUA vendor sample is a separate compile proof only. The
[desktop media spike](../docs/phone11-daily-use/DESKTOP-PBX-MEDIA-SPIKE-20260924.md)
records the macOS/Windows runtime and release acceptance gates.
