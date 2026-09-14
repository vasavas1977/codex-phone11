# Phone11 Android Virtual Test Lab — Test Matrix v1.0

Prepared 14 September 2026. **All scenarios below are planned and NOT_RUN in this handoff.** This file contains acceptance specifications, not test results.

Use the gate definitions in BLUEPRINT.md. Mark only actual results PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE, preserving evidence and reasons. L4 is a later physical-device release gate, not a prerequisite for completing the emulator lab. MEDIA-03 is an optional manual supplement; MEDIA-01 and MEDIA-02 still need explicit verification or open-gate reporting.

## Required per-attempt fields

`test_id`, `run_id`, `attempt`, `commit_sha`, `apk_sha256`, `evidence_level`, `emulator_serial`, `system_image`, `api_level`, `abi`, `sdk_version`, `mode` (real/fake/manual), `preconditions`, `start/end`, `result`, `assertions`, `artifacts`, `reason`, `cleanup_result`.

For push tests include correlated server call UUID, sanitized SIP Call-ID, push ID, native sequence/generation and observed OS state. Do not store raw push destinations or secrets in reports. Keep failed attempts even when a diagnostic rerun succeeds.

## Scenario inventory

| ID | Package | Level | Scenario | Acceptance condition |
|---|---|---|---|---|
| BASE-01 | P0 | L0 | Repository and authoritative base | Record git status, selected branch/SHA and newer-work check. Preserve all unrelated work. |
| BASE-02 | P0 | L0 | Production isolation | Show lab config contains no live trunks or customer credentials; unknown destinations are denied. |
| BASE-03 | P0 | L0 | Runner diagnosis | Report acceleration, tools, image/ABI, SIP/media reachability and audio capabilities without exposing secrets. |
| BUILD-01 | P1 | L1 | Native compile and APK identity | Build actual Android lab APK; record application ID, manifest, SHA-256 and native libraries. |
| BUILD-02 | P1 | L1 | Real Siprix load | Install on explicit emulator; actual native runtime reports the pinned Android SDK version; no fake fallback. |
| BUILD-03 | P1 | L1 | Single engine and ownership | No competing SIP runtime, Telecom owner or duplicated call notification in lab variant. |
| BUILD-04 | P1 | L1 | No Metro dependency | Self-contained APK opens with Metro absent; core state is not supplied by a dev-server session. |
| BUILD-05 | P1 | L0 | Existing paths preserved | Shared contract tests and relevant source/config regressions pass; separately disclose unrun iOS runtime tests. |
| BRIDGE-01 | P1 | L0 | Callbacks and snapshots | Registration and call state follow vendor callbacks; snapshots reconcile missed listeners. |
| BRIDGE-02 | P1 | L0 | Stale events and cleanup | Reject old generations/account context; failed destruction is not falsely reported successful. |
| BRIDGE-03 | P1 | L0 | Unsupported operations | Unsupported platform features reject explicitly; no successful no-op methods. |
| SIP-01 | P2 | L2 | Registration success | Actual REGISTER result and SDK callback correlate; UI agrees with native state. |
| SIP-02 | P2 | L2 | Bad credentials | No false registered state, password leak or infinite retry; actionable sanitized failure. |
| SIP-03 | P2 | L2 | Unreachable server and recovery | Bounded timeout, truthful state, recovery after approved lab connectivity returns. |
| SIP-04 | P2 | L2 | Outgoing answered call | 20 proposed primary-image attempts; correct dialing/ringing/connected/terminated transitions. |
| SIP-05 | P2 | L2 | Foreground incoming answer | 20 proposed primary-image attempts; real INVITE, one call surface, answer reaches peer. |
| SIP-06 | P2 | L2 | Incoming reject | Rejection terminates the actual peer call; no lingering service/notification/history error. |
| SIP-07 | P2 | L2 | Caller cancel before answer | Correct canceled/missed outcome; no ghost ringing after cancellation. |
| SIP-08 | P2 | L2 | No answer and timeout | Call and pending resources expire; exactly one appropriate history record. |
| SIP-09 | P2 | L2 | Hangup from each endpoint | Local and remote termination synchronize; later calls work without app restart. |
| SIP-10 | P2 | L2 | Second call while active | Documented single-call/busy policy; no second phantom active session. |
| SIP-11 | P2 | L2 | Rapid and duplicate UI actions | Answer/hangup/dial duplication remains idempotent and does not corrupt call state. |
| SIP-12 | P2 | L2 | Ringback and early media | Where supported, distinguish 180 without SDP from early media; otherwise record unsupported fixture detail. |
| CTRL-01 | P2 | L2 | Mute and unmute | Native state and peer-observed audio agree; command-only proof is insufficient for the audio assertion. |
| CTRL-02 | P2 | L2 | Hold and resume | Hold callbacks/state and resumed media agree; a pending hold command cannot corrupt state. |
| CTRL-03 | P2 | L2 | DTMF | Receiving fixture observes expected digits in order, not only a UI event. |
| CTRL-04 | P2 | L2 | Speaker request | Record requested versus observed virtual route; do not claim physical earpiece/acoustic validation. |
| MEDIA-01 | P2 | L2 | Uplink known audio | Synthetic known input reaches the peer through a verified actual app media path. |
| MEDIA-02 | P2 | L2 | Downlink known audio | Known peer signal observed after valid client decode/output; RTP count alone does not pass. |
| MEDIA-03 | P2 | L2 | Two-way human host-audio check | Optional computer microphone/desktop-peer check is labeled manual; permissions and evidence recorded. |
| MEDIA-04 | P2 | L2 | One-way media fault detection | Deliberately block one lab media direction; report fails that assertion instead of passing on SIP success. |
| LIFE-01 | P2 | L2 | Activity recreation | Call state survives supported recreation; no duplicate runtime, lost controls or fabricated connection. |
| LIFE-02 | P2 | L2 | Home/background | Record lifecycle transition separately from process death; foreground-only polling does not keep it alive. |
| LIFE-03 | P2 | L2 | Task removal | Observe actual native/process/service state; distinguish removal from force-stop. |
| LIFE-04 | P3 | L3 | Verified process-death incoming call | With process truly absent and not force-stopped, real push/call path starts without React UI or Metro. |
| LIFE-05 | P3 | L3 | Force-stop negative and relaunch | No attempt to bypass stopped state; explicit relaunch restores eligible message/call handling. |
| NET-01 | P2 | L2 | Network loss during registration | Bounded retries and truthful registration; recovery does not create duplicate accounts. |
| NET-02 | P2 | L2 | Network loss during call | Observe documented disconnect/recovery; no silent stuck connected badge after timeout. |
| NET-03 | P2 | L2 | TLS rejection | When TLS is supported, invalid/untrusted certificate fails; no permissive production trust bypass. |
| AUTH-01 | P2 | L2 | Logout/account change | Calls/registrations/credentials cleaned according to policy; stale callbacks cannot attach to new user. |
| WAKE-01 | P3 | L0 | Synthetic payload validation | Malformed, expired, duplicate and wrong-binding payloads are rejected or deduplicated as designed. |
| WAKE-02 | P3 | L0 | Contract ownership | User/tenant/device/session binding checks use actual contract; no ad hoc accept-all fixture logic in app. |
| PUSH-01 | P3 | L3 | Real FCM background call | 20 proposed eligible calls; correlate pending-call creation, push, native wake, INVITE and ring/answer. |
| PUSH-02 | P3 | L3 | Real FCM locked call | 20 proposed eligible calls; observe real lock state and permission-appropriate incoming-call surface. |
| PUSH-03 | P3 | L3 | Real FCM forced-Doze call | 20 proposed eligible calls; prove idle entry and no hidden keep-alive; report every miss and timing. |
| PUSH-04 | P3 | L3 | Duplicate wake and INVITE | One visible call/session only; repeated messages cannot create duplicate history or answer. |
| PUSH-05 | P3 | L3 | Cancel while waking | Cancel before readiness and during answer race yields truthful terminated state with no ghost ring. |
| PUSH-06 | P3 | L3 | Expired or delayed wake | Expired/canceled pending call never becomes a fresh call after connectivity returns. |
| PUSH-07 | P3 | L3 | Destination identifier rotation | Client and server agree on updated registration identifier; old binding is safely retired. |
| PUSH-08 | P3 | L3 | Logout/wrong owner at delivery | No call or sensitive history becomes visible to a logged-out or different user/tenant/device. |
| PUSH-09 | P3 | L3 | Push service/network unavailable | Bounded failure and meaningful pending-call expiry; no claim of guaranteed wake. |
| PERM-01 | P3 | L1 | Microphone denied | No crash, unauthorized capture or false audible-call success; clear supported recovery. |
| PERM-02 | P3 | L3 | Notifications denied/channel disabled | Observe supported behavior accurately; respect settings rather than grant permissions silently. |
| PERM-03 | P3 | L3 | Full-screen intent denied | Supported notification/action fallback; no forced background activity workaround. |
| PERM-04 | P3 | L1 | Service/audio restrictions | Merged manifest and observed service start/audio capture comply with tested target SDK ownership. |
| REPORT-01 | P4 | L0 | Truthful aggregation | Zero tests, missing evidence, failed audio and blocked required push cannot appear as full PASS. |
| REPORT-02 | P4 | L0 | Artifact redaction | No passwords, authorization headers, push destinations or customer data in shareable artifacts. |
| REPORT-03 | P4 | L0 | Reproduction and cleanup | Fresh approved runner can execute runbook; cleanup restores only this run resources and emulator state. |
| REPORT-04 | P4 | L0 | CI trust boundary | Offline PR checks have no live secrets; approved runtime jobs do not run untrusted code on trusted hosts. |
| HW-01 | P5 | L4 | OEM background/overnight behavior | Deferred: execute actual target handset/firmware cases before broad device reliability claim. |
| HW-02 | P5 | L4 | Physical audio/accessories | Deferred: wired/Bluetooth/headset/earpiece/speaker/acoustic and audio-focus interaction tests. |
| HW-03 | P5 | L4 | Real cellular/Wi-Fi transitions | Deferred: validate real mobile-network changes, device-specific power behavior and SIM interaction. |

## Repeatability and timing

Use the blueprint's proposed small-sample gates: 20 outgoing, 20 foreground incoming, then 20 each in background, locked and forced-Doze real-push states on the primary image. Other cases should cover both successful and failing branches; record actual sample counts. A 15-second push-ring observation window is a configurable initial lab target, not a delivery guarantee.

Use event-driven waits with bounded deadlines. Confirm idle/process state rather than assuming a UI action produced it. Keep calls below the verified Android SDK trial limit. Maximum two diagnostic reruns by default; do not replace original failures with retries. Samples that lack prerequisites are BLOCKED, not successful observations or silently removed misses.

## Manual/physical evidence

For a manual computer-audio check, record operator, topology, permissions, directions heard and any synthetic artifact. For later hardware checks, record actual manufacturer/model, firmware/build, OS version, app build, battery setting, accessory and network. A cloud device's marketing label is not sufficient evidence of audio or idle support.
