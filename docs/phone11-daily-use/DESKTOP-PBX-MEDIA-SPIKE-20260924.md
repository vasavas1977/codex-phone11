# Phone11 desktop PBX media spike — macOS and Windows

**Decision status (24 September 2026):** a Phone11 native helper, versioned
desktop call boundary, protected credential provider, and minimal Electron
trial shell now exist in source, but there is no signed desktop package,
PBX change, registration, or desktop call. The first
signed desktop release target is **macOS and Windows**. This note narrows the
calling foundation; [desktop UCC readiness](DESKTOP-UCC-READINESS-20260916.md)
continues to own the broader UI and release checklist.

**Local SDK proof (24 September 2026):** the pinned upstream `SiprixUA` sample
at commit `38fe11b14fb80c40bef725bbb61e6b1ea42a0d4f` configured with
Homebrew CMake 4.4.3 and compiled on this arm64 Mac with Xcode 16.4
(`cmake --build build --config Release`: `BUILD SUCCEEDED`). The output is an
ad-hoc locally signed vendor sample in `/tmp/phone11-siprixua-20260924/build/out`,
not a Phone11 app, Windows build, commercial license, PBX registration, or
audio-call test. No SIP credentials were used.

## Recommendation

Use a **native Siprix C++ calling helper on each desktop OS**, controlled by a
small Electron main process and a narrowly scoped renderer API. Keep one
protocol/state contract for both platforms and compile the helper separately
against Siprix's macOS frameworks and Windows DLL/import library. Reuse the
Phone11 web presentation and authenticated directory/chat/recording contracts
only where they actually work in a packaged renderer. Keep the SIP account,
password, license, call state, and audio device operations in the privileged
side; never expose them through a generic renderer IPC or remote page.

This is the smallest credible route to both requested operating systems because
the vendor supplies one C++ API and desktop binaries for both, and Phone11
already uses Siprix with a native SIP/TLS and SDES-SRTP account shape on iOS.
The Electron shell is implemented as a source-only trial, **not a validated
desktop release**. A helper process avoids Electron ABI rebuilds
for the vendor library and keeps SIP/media alive if the call view reloads. Its
supervisor must fail closed on helper crash, sign-out, account change, or stale
call IDs. Electron may remain running in the tray; a quit or OS shutdown ends
registration and cannot guarantee incoming calls.

| Candidate | Finding | Decision for the first spike |
| --- | --- | --- |
| Reuse `modules/phone11-siprix` | Its Objective-C bridge, React Native event channel, AVAudioSession and RNCallKeep ownership are iOS-specific. `SiprixEngine.initialize()` rejects every non-iOS platform. | Reuse state semantics and security checks as a design reference; do not import the bridge into Electron. |
| Siprix desktop C++ | Vendor provides macOS arm64/x64 frameworks and Windows x64 DLL/import library, a shared API, TLS/SDES-SRTP, call control and audio device enumeration/selection. The vendor's `SiprixUA` is a cross-platform console sample. | **Proof target.** A new helper owns registration, one audio call, mute, hold, DTMF, answer/end and device changes. |
| Siprix Flutter plugin | The vendor has a five-platform plugin, including macOS and Windows, with the above capabilities. | Credible technical fallback, but replacing the current Expo/web UI with Flutter would expand the first release. Reconsider only if the C++ helper boundary fails. |
| Browser SIP.js/WebRTC | A browser requires WSS SIP, DTLS-SRTP/ICE interoperability, secure origins and browser media permissions. | Do not claim it works from the existing web dialer. The checked-in live-oriented Kamailio file has a plain WS listener, but no WSS/TLS listener; its WebRTC route is source intent, not proven ingress/media. |

## Existing Phone11 contract and infrastructure boundary

- `lib/sip/engine.ts` selects the mobile PJSIP or Siprix implementation at
  bundle time. `lib/sip/siprix-engine.ts` owns session revision/account matching,
  event sequence/generation reconciliation, registered state, call controls,
  bounded diagnostics and native wake adoption. The desktop helper should expose
  the same *meaning* of account, call, registration and callback-confirmed state,
  with a new desktop adapter. It must not reuse iOS PushKit/CallKit wake IDs.
- `modules/phone11-siprix/index.d.ts` is the current iOS native contract. It
  supports one account/one call and makes registration and call state callback
  driven. A desktop call command resolving only means the SDK accepted a
  command; connected media, hold, transfer and recording require later evidence.
- `lib/sip/account-store.ts` defaults to TLS and SRTP, but provisioning values
  must be verified per tenant and desktop device. Never copy credentials from a
  mobile install. The admin portal must issue/revoke an explicit desktop binding
  for the correct tenant, user and extension; sign-out must clear the helper
  account and stored secret.
- `infra/configs/kamailio/kamailio.cfg` listens on UDP/TCP 5060 and plain WS
  8088. It contains WebRTC and native-SDES media branches, but no checked-in
  TLS/WSS listener. `deploy/kamailio/kamailio.cfg` is a different template with
  TLS 5061 and WSS 8443. Neither file proves the actual deployed listeners,
  certificates, firewall, registration path, SRTP policy or tenant routing. A
  source-only comparison cannot authorize or substitute for a production change.

## Native and product boundary

The helper protocol should be versioned and allowlisted: `initialize`,
`setAccount`, `clearAccount`, `register`, `dial`, `answer`, `end`, `mute`, `hold`,
`dtmf`, `listDevices`, `selectInput`, `selectOutput`, `snapshot` and `shutdown`.
Every request includes an authenticated desktop session revision; every event
includes a helper generation, monotonic sequence, account ID and call ID. Only
the main process passes commands after verifying current user/tenant/extension
ownership. Protect credentials in macOS Keychain and Windows Credential Manager;
omit them from IPC replies, logs, crash reports, recents and URLs. A helper
restart must clear stale calls and re-register only after rechecking the current
session. Renderer reload must reconcile a snapshot without ending a live call.

The main process owns incoming-call presentation and a single call controller.
On macOS, signed app notification permission and microphone permission require
real package testing. On Windows, a correctly installed AppUserModelID/Start
Menu shortcut is required for dependable notifications. Ringing should also
surface an app/tray call window with Answer and Decline while the application
is running. Launch at login, sleep/wake registration, app minimized/tray state,
screen lock, audio hot-plug, network change and process crash are explicit
tests. There is no mobile PushKit equivalent that wakes an app after it quits;
"background incoming" on desktop means the signed app/helper remains running
and registered. Native audio device APIs can switch during a call, but names,
permission denial and unplug behavior need OS proof. Do not enable transfer,
conference, video, recording capture or screen share based on API availability
alone; each needs its own PBX/policy and signed-client acceptance.

Electron's renderer must have `nodeIntegration: false`, `contextIsolation: true`,
sandboxing, a restrictive CSP and blocked arbitrary navigation. Expose named
methods through preload, validate sender origin and all IPC arguments in main,
and prevent an untrusted web page from controlling calls. Ship the app and helper
as signed platform binaries; macOS notarization and Windows signing are release
gates. The trial Siprix SDK drops calls after about 60 seconds; a production
license covering **both desktop OSes and redistribution** must be confirmed
before any daily-use claim. Mac frameworks and Windows DLLs are different
artifacts, and the vendor's license terms must be checked for the exact intended
distribution. Do not put the license key in renderer JavaScript.

## One bounded proof spike

Use a non-production extension pair and a PBX test window. First establish the
actual transport and media profile from deployed configuration and operator
evidence. If the approved desktop SIP ingress is not TLS with a trusted cert
and compatible SRTP, stop before client integration and request a separately
reviewed PBX transport change. Do not silently downgrade to UDP/plain WS.

1. Pin the official [SiprixUA sample](https://github.com/siprix/SiprixUA)
   revision and the vendor SDK version/binaries for macOS arm64+x64 and Windows
   x64. Check redistribution/license terms and record hashes. Build the
   unmodified console sample on each OS using its `macos/cmake_XCode.sh` and
   `win/cmake_VS2022.bat` scripts (confirm paths in the pinned revision). Use
   `cmake --build build --config Release` after generation. Do not stage vendor
   binaries in public artifacts or print credentials.
2. With a dedicated test account, prove REGISTER challenge/success over TLS,
   an outbound and an inbound call against a second real endpoint. On the
   approved free trial, run short two-way calls and verify the expected
   60-second cutoff. A separate paid-license run must prove sustained audio
   before daily use. Check
   SRTP negotiated on both legs, End, mute, hold/resume, DTMF and headset
   output/input switching. Capture redacted SIP status, SDP media profile,
   registration/call IDs and packet/RTPEngine counters. Verify certificate
   validation, 401/407 failure, wrong tenant, unavailable extension, busy,
   network loss/recovery and sleep/wake. Trial-only sub-minute calls can test
   mechanics but cannot close the daily-use gate.
3. Validate the source-tested local helper protocol and minimal Electron trial
   shell against real registration and call evidence. Add a signed package with
   reliable incoming-call notification. Run the same call matrix on macOS
   and a signed Windows package, including app minimized, renderer reload,
   helper crash/restart, logout, locked screen, microphone denial/recovery and
   unplugged headset. Confirm quit semantics in the UI.

**Exit:** both signed OS packages complete ten repeated inbound/outbound
two-way audio calls with a second endpoint and the failure/lifecycle cases
above, with no stale account after logout and no cross-tenant routing. Record
build identity, OS version, SDK/license version, PBX config identity and media
evidence. Source tests, a console sample, a browser preview, a signed package
alone, and a mobile call are distinct evidence layers; none individually proves
desktop PBX calling. If the vendor binaries/license cannot be obtained, TLS/
SRTP cannot be made compatible without an approved PBX change, or the helper
cannot sustain an incoming call while the UI reloads, stop the spike and
escalate the architecture choice to the lead.

## Primary references checked

- [Siprix integration guide](https://docs.siprix-voip.com/rst/integration.html)
  — Windows DLL/import library and macOS frameworks/permissions.
- [Siprix API reference](https://docs.siprix-voip.com/rst/api.html) — TLS,
  SDES/DTLS media, call controls, desktop audio devices and license API.
- [SiprixUA sample](https://github.com/siprix/SiprixUA) and
  [Flutter plugin](https://github.com/siprix/FlutterPluginFederated) — platform
  availability, trial limitation and build examples.
- [Siprix license agreement](https://docs.siprix-voip.com/rst/license.html) —
  redistribution and license restrictions; commercial scope needs vendor
  confirmation.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
  [IPC](https://www.electronjs.org/docs/latest/tutorial/ipc) and
  [notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)
  — native boundary, renderer isolation and OS notification requirements.
