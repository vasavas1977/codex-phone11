# Phone11 desktop calling boundary

`src/call-boundary.ts` is a versioned, source-tested control boundary for the
macOS and Windows trial calling app in `app/`. It runs in a privileged main process,
between an authenticated renderer and a local Siprix helper. The renderer gets
only registration and single-call state; it cannot issue account, credential,
license, or arbitrary helper commands.

`src/helper-supervisor.ts` now provides the main-process helper adapter. It
requires an explicit privileged `verifyHelper` callback that checks the
canonical packaged executable path and its signature/hash before it requests
SIP credentials; an arbitrary absolute executable path is rejected. It
spawns the verified named native binary without a shell, with private stdin and
stdout pipes and ignored stderr. It serializes versioned commands, parses
allowlisted native replies/events, stamps events with a fresh helper generation,
the current authenticated session/account and a monotonic sequence, and closes
the helper on malformed output, timeout, exit or account change. Every queued
write rechecks the exact authenticated session, including a provisioning write
queued after initialization. Native output cannot select its own tenant,
account, generation or session. Credentials are
requested through an injected privileged provider immediately before start;
the provider must enforce the tenant/extension grant. The adapter does not
store a SIP password in renderer state, argv, environment, disk or logs. A
JavaScript string remains in process memory while the provisioning write is
pending, so the caller must keep the provider and main process private.

`src/authenticated-provider.ts` supplies the concrete privileged credential
provider. The embedding main process constructs `AuthenticatedDesktopProvider`
with an HTTPS API origin, calls `signIn(email, password)`, passes
`currentSession()` and `provision(session)` to the helper supervisor, and calls
`signOut()` plus supervisor `stop()` on sign-out. Sign-in uses the native auth
header and an in-memory bearer; provisioning rechecks `/api/auth/me`,
and the protected `phone.getConfig` response before returning the SIP password.
The selected config response must carry a numeric `extension.id` beside its
tenant ID and SIP credentials; the provider binds them as one grant even for
multi-tenant users. It rejects a changed grant or SIP credential between sign-in
and provisioning. Session and provisioning results are immutable.
No bearer or SIP password is persisted or sent to the renderer. The SIP
password is a persistent PBX credential on the server and must be treated as
secret even though this desktop provider keeps it only in memory. The minimal
Electron shell in `app/` supplies sender-checked IPC and trial call controls;
it is not yet a signed or live-call-validated desktop release.

On sign-out or helper replacement, `stop()` invalidates renderer state at once,
sends `v1 shutdown` followed by pipe EOF, and waits for process exit before
another helper can start. It escalates to forced termination after a bounded
grace period. If exit cannot be confirmed, restart stays blocked. This is
local cleanup and **does not prove that an active PBX dialog received BYE**;
the live call must be ended and verified separately before relying on server
side termination.

The embedding main process must validate the IPC sender and obtain the current
authenticated `DesktopSession` on **every** action. The helper supervisor calls
`startHelperGeneration` on each spawn, obtains the Siprix account through the
injected privileged provider and binds that exact session before sending the
provisioning frame so an immediate registration callback is not lost. A failed
provisioning reply tears the helper down. Its events carry the
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
callback or helper/session reset. The supervisor publishes timeout state
transitions to the renderer snapshot subscriber. An ambiguous dial transport
failure also remains in `reconcile`; only a definite pre-acceptance helper
refusal releases that slot. Native helper errors are reduced to generic
renderer errors because SIP responses can contain private account details.
End can replace a pending Answer for the same call, including when the Answer
callback was lost. End then remains reserved until termination. A trusted
`HelperPort` may throw `HelperCommandRejectedError` only after a definite
pre-acceptance refusal. That releases the exact End reservation for a known
live call so the user can retry. If End had superseded an Answer still awaiting
its connected callback, a refused End restores the Answer reconciliation state;
the user can still retry End, but cannot send a second Answer. A connected
callback received while End is pending resolves that Answer uncertainty.
The same definite pre-acceptance refusal releases the matching Answer
reservation for a safe retry. An ordinary rejection may follow dispatch;
it keeps End in reconciliation until a matching terminal callback or session
reset. The helper adapter must never include raw SIP details in either error.
Call IDs terminated in the current helper generation are ignored if a late callback
tries to revive them.

Run `./node_modules/.bin/tsx --test desktop/tests/call-boundary.node.ts desktop/tests/helper-supervisor.node.ts` from
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
are separate JSON lines; the main-process adapter correlates them
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
and DTMF actions. The trial shell surfaces those controls but has no live-call
acceptance yet.

On macOS, with the pinned SDK checked out externally:

```sh
cmake -S desktop/native -B /tmp/phone11-desktop-helper-build -G Xcode \
  -DSIPRIX_SDK_ROOT=/tmp/phone11-siprixua-20260924
cmake --build /tmp/phone11-desktop-helper-build --config Release
```

On Windows, run from a Visual Studio 2022 x64 developer environment. For a
protocol-only build using the checked-in fake SDK:

```powershell
cmake -S desktop/native -B "$env:TEMP\phone11-desktop-helper-fake" -G "Visual Studio 17 2022" -A x64 -DPHONE11_USE_FAKE_SDK=ON
cmake --build "$env:TEMP\phone11-desktop-helper-fake" --config Release
```

For a vendor build, point `SIPRIX_SDK_ROOT` to an external checkout containing
the vendor `win/` headers, import library and DLLs:

```powershell
cmake -S desktop/native -B "$env:TEMP\phone11-desktop-helper" -G "Visual Studio 17 2022" -A x64 "-DSIPRIX_SDK_ROOT=C:\path\to\siprixua"
cmake --build "$env:TEMP\phone11-desktop-helper" --config Release
```

The vendor build copies DLLs next to the helper output; distribution remains
subject to the vendor license. A Windows CI workflow is present, but has not
run on this head, and no Windows runtime/media behavior has been verified.

Local macOS arm64 evidence on 25 September 2026: the Release helper compiled
against the Siprix trial SDK, and protocol tests passed with a fake SDK. The
desktop trial signed in as extension 3001 and registered with the live PBX.
An initial 3001-to-1020 call woke the iPhone but received SIP 488 before the
PBX relayed the INVITE; the desktop account had not enabled secure media.
The helper now requests SDES SRTP. A disposable loopback registrar confirmed
that the rebuilt real SDK offers `RTP/SAVP` and
`AES_CM_128_HMAC_SHA1_80` without exposing its SDP keys. The updated Mac app
is installed locally and ad-hoc signed. Live answer and two-way audio still
need verification after signing back in. The Xcode local ad-hoc signature is
not a release signature.

For a repeatable local smoke test, run
`python3 desktop/native/test_bootstrap.py /path/to/phone11_siprix_helper`.
It checks invalid and oversized input, response shape, shutdown, and that
input text is not echoed.

This is **not yet a released desktop softphone**: distributable macOS and Windows
packaging/signing, a successful live PBX call, and two-way media remain required.
Optional persistent login would require secure OS credential storage; the
current trial keeps the bearer in memory only. Siprix's free trial limits each call to 60 seconds; that
limit is acceptable for current development and must be expected in call
tests. A paid distribution license has not been verified.
The pinned SiprixUA vendor sample is a separate compile proof only. The
[desktop media spike](../docs/phone11-daily-use/DESKTOP-PBX-MEDIA-SPIKE-20260924.md)
records the macOS/Windows runtime and release acceptance gates.
