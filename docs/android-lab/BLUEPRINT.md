# Phone11 Android Virtual Test Lab
## Project Blueprint v1.0 — Siprix readiness, emulator calls and push-wake validation

**Prepared:** 14 September 2026
**Product owner / final approver:** Vasavas Nonsopa
**Implementation owner:** Codex, one bounded workstream at a time
**Target repository found:** `vasavas1977/codex-phone11`
**Status:** Proposed engineering handoff. No application changes, builds, emulator runs, calls, deployments or production approvals were performed in preparing this package.

> Build a repeatable way to test the real Phone11 Android application and its real Siprix native engine without needing a physical Android handset. Keep mock tests, native builds, SIP calls, push wake and hardware validation separate.

Source labels such as [R3] and [S2] resolve in `SOURCES.md`. Numeric acceptance targets below are proposed project requirements, not supplier promises or measured results.

---

## 1. The important repository finding

This project must begin with Android readiness, not an assumption that Phone11 already packages Siprix for Android.

Read-only inspection found an Expo/React Native Phone11 repository. Its main-branch handoff describes a much older implementation. A newer branch, `codex/phone11-daily-use-20260910`, had the following observed head:

`2003984a5cca30a97d70a164907385eb8ebace0a`

That branch's package declares Expo `~54.0.29`, React Native `0.81.5`, pnpm `9.12.0`, an Expo development client and the local dependency `phone11-siprix`. These are observed declared versions, not a recommendation to upgrade or proof of resolved build versions. [R1, R2]

The local module's README describes an **iOS trial bridge**. More importantly, its actual React Native configuration explicitly sets `android: null`, and the inspected module directory has an `ios/` directory but no `android/` directory. This is concrete evidence of an Android integration gap in this inspected module at this commit—not proof that no newer Android work exists elsewhere. [R3, R4, R7]

The shared TypeScript interface already includes registration, calls, snapshots, events and wake-context methods. The README predates some interface changes, so Codex must compare source, configuration and tests rather than treat every README limitation as current. [R3, R5]

The install script chooses different setup paths based on `EXPO_PUBLIC_SIP_ENGINE`. A setting named `siprix` is therefore not sufficient evidence that the actual Android binary loads Siprix. Native packaging and runtime identity both need verification. [R6]

**Baseline decision:** inspect the current checkout, newer remote work and applicable `AGENTS.md` files first. Reuse a newer valid Android implementation when present. Otherwise add the minimum Android bridge required by this lab, behind an Android lab build configuration. Do not restart Phone11, migrate to Flutter, replace working iOS code, or use a different product repository as the default.

### 1.1 Facts still to establish

| Unknown | Required evidence |
|---|---|
| Authoritative current branch and local uncommitted work | Git status, branch/commit inventory and written base-selection rationale |
| Android Siprix implementation outside the inspected module | Source paths, native build configuration and runtime proof |
| Android SDK artifact and license | Official origin, pinned version, checksum, terms and actual trial restrictions |
| Android application ID, SDK levels and build variants | Resolved Expo config, Gradle config and merged manifest |
| Native calling / Android Telecom ownership | Source-based ownership map; one owner for each lifecycle concern |
| Existing Android FCM receiver and server wake path | Client receiver, sender and pending-call routing code—not just a configuration file |
| A usable emulator runner | A successful acceleration/boot check and necessary network access |
| Audio injection/capture capabilities | Tested host or SDK fixture path; no invented PCM/file APIs |

---

## 2. Scope and boundaries

### In scope

Build and install a real Phone11 Android APK on an emulator; load the official Siprix Android engine; exercise registration, outbound and inbound lab calls, answer/reject/hangup, mute, hold/resume, DTMF, history, lifecycle recovery and error handling. Add repeatable local scripts, unit/native/UI tests, synthetic call fixtures, safe diagnostics and an evidence report. Add an independently gated real-FCM incoming-call lane when approved lab configuration is available.

### Out of scope

No production carrier calls, PSTN trunks, emergency numbers, real customer accounts, customer recordings, billing changes, production database migrations, store submission, production deployment or SDK purchase. No iOS rewrite, Super Number redesign, new CRM work, SIP load testing at scale, or new paid device-cloud dependency.

Multi-call, transfers, conference and video remain outside v1 unless already implemented and explicitly selected for regression coverage. The initial functional envelope is one account and one active audio call, with clean handling of a second incoming call. Expanding supported behavior is a separate product decision.

Physical handset validation is a documented later release gate, not a dependency for delivering this emulator lab.

---

## 3. Evidence levels: five different answers

| Level | Meaning | Does not prove |
|---|---|---|
| L0 — Logic | Unit tests with synthetic events/fakes | Native SDK load, SIP traffic or Android wake behavior |
| L1 — Native runtime | Real APK boots and real Android Siprix reports its version | Registration, working media or push wake |
| L2 — SIP integration | Real SIP calls through the isolated lab PBX | Audible two-way audio unless separately verified |
| L3 — Real push wake | Actual FCM message, native wake, SIP delivery and successful answer | Every manufacturer's idle behavior or guaranteed delivery |
| L4 — Device validation | Named handset/OS/accessory/network cases actually executed | Untested devices, future OS updates or all environments |

Each test has its own evidence level. A fake push receiver test remains L0, even when the UI it opens looks identical to a real call. A local broadcast is not FCM. A SIP `200 OK` is not audio proof. An emulator's simulated cellular call is not a Siprix call. [S1, S4]

The final report must show each level separately; never turn a partially completed project into an overall green production-readiness badge.

---

## 4. Recommended implementation structure

Use the existing application stack. Add only the components missing for the chosen gate.

| Component | Proposed implementation |
|---|---|
| Product client | Existing Expo / React Native / TypeScript Phone11 |
| Native bridge | Existing `modules/phone11-siprix`; add Android Java/Kotlin implementation only if needed |
| Voice engine | Official, version-pinned Siprix Android AAR |
| Virtual device | Android Emulator on a verified compatible host |
| Logic tests | Existing Vitest and Node tests; preserve their current conventions |
| Native/system tests | AndroidX instrumentation and UI Automator; reuse another proven harness already in the repo rather than add competing frameworks |
| Call fixture | Isolated FreeSWITCH lab, with existing Kamailio/media components only when needed to mirror the real route |
| Call peer | Automated fixture/echo endpoint; an optional desktop SIP client for human audio checks |
| Push fixture | Existing wake contract adapted to a test-only sender and pending-call controller |
| Reporting | Local static HTML plus JSON/JUnit, sanitized logs, screenshots and optional video |

Siprix's official Android distribution includes ARM and x86 native architectures and documents running the integrated application on a device or emulator. Codex must still inspect the specific artifact used in this project. [S1]

UI Automator can interact with application and system UI, which is useful for permission dialogs and call-notification actions outside the React Native screen. Pin a compatible released version rather than copying unverified APIs. [S10]

### Conceptual runtime flow

```text
Codex / developer
    |
    +-- existing unit tests + native bridge tests
    |
    +-- lab orchestrator --> Android Emulator
    |                         |
    |                         +-- actual Phone11 APK
    |                               |
    |                               +-- native Phone11Siprix bridge
    |                                      |
    |                                      +-- real Siprix AAR
    |                                             |
    +-- isolated SIP fixture / PBX <---- SIP + media
    |          |
    |          +-- synthetic peer, echo/tone, DTMF collector
    |
    +-- optional approved push lane
    |      pending call -> FCM -> native wake -> registration -> INVITE
    |
    +-- correlated evidence -> JSON / JUnit / local HTML
```

This is a proposed test architecture, not an assertion that these components are already running.

---

## 5. Android readiness and native bridge gate

### 5.1 Inventory before editing

Read the selected branch's app config, dependency locks, install/staging scripts, native module, SIP engine adapter, native call manager, Android manifest generation, tests and wake backend. Resolve the actual Android engine-selection behavior. Record every relevant source path in `BASELINE.md`.

Do not run inherited deployment commands, migrations or production-connected smoke tests while establishing this baseline. Audit package lifecycle scripts before installing dependencies. Never reset, clean or overwrite another worktree to obtain a clean build.

### 5.2 Reuse the existing contract

Use `modules/phone11-siprix/index.d.ts` as the starting contract, not a new parallel API. Preserve Promise semantics, IDs, callbacks, generation/sequence handling and snapshot reconciliation. The shared interface has operations such as `initialize`, `getSnapshot`, `createAccount`, `registerAccount`, `makeCall`, `answerCall`, `hangupCall`, mute, hold and DTMF. [R5]

Add an Android mapping document: JS operation -> Android implementation -> real vendor API -> failure behavior -> test IDs. Inspect the official AAR/API/sample for the pinned version. Do not invent Siprix method names or treat iOS Objective-C selectors as Android APIs.

Where the shared API is iOS-specific or not yet implementable on Android, add an explicit capability boundary or a documented unsupported error. Never return success from an empty implementation. Any shared contract change must be additive where possible and preserve iOS consumers.

### 5.3 Native ownership requirements

The bridge must maintain one correctly owned SIP runtime and reconcile state after React Native listeners or activities reconnect. Registration/call states must follow SDK callbacks rather than button presses or optimistic Promise resolution. Preserve error codes, sanitize payloads, reject stale events and avoid cross-account state leakage.

Create an ownership table covering SIP runtime, notifications, Android Telecom/ConnectionService, foreground service, audio focus/routing, FCM receiver and JavaScript rendering. Reuse existing Android ownership where suitable. Do not create two competing incoming-call notifications or two call-service owners.

Do not directly port iOS CallKit/audio-session logic. Android lifecycle and audio handling need their own implementation. Cold-start handling must not require a mounted React component, an open screen or a Metro connection before native state can progress.

### 5.4 Build requirements

Use a real native development build for interactive development, not Expo Go or a browser preview. Expo development builds allow native libraries; local Android builds use the native toolchain. [S3]

Also provide a self-contained **lab APK with JavaScript bundled and no Metro dependency** for background/cold-start acceptance. A debug dev-server session may be useful while coding, but must not be what keeps the acceptance target alive.

Derive a distinct Android lab application ID from the existing ID, for example a `.lab` suffix. Keep production IDs, iOS identifiers and default release behavior unchanged. The lab's Firebase Android client must match its application ID. Changes to generated native files must survive the project's prebuild process; prefer a tested config plugin where that is the existing pattern.

Check AAR native architectures, all required `.so` files, dependency compatibility, manifest/services, packaging and native library load. Log only the actual SDK version, engine identity and non-sensitive capabilities. Do not initialize PJSIP/JsSIP alongside Siprix in the Siprix lab variant; preserve those paths outside that variant.

The iOS README pins an iOS trial artifact; that is **not** an Android version selection. Independently verify the Android artifact and trial duration. Keep automated call duration within legitimate trial limits; never patch or bypass licensing. [R3]

---

## 6. Runner and emulator design

### 6.1 Separate code authoring from runtime access

Codex can work on the repository and run checks supported by its environment. Its cloud environment is container-based and documents network controls, including an HTTP/HTTPS proxy. Do not assume a given cloud task has an accelerated emulator, host microphone, raw SIP/RTP connectivity or a usable FCM path. [S11]

Preferred initial runtime: an existing developer workstation with Android Studio and an emulator. A verified self-hosted Android runner can later execute the same scripts. Do not provision AWS instances, purchase device-cloud time or expose a remote ADB server merely to finish this task.

`lab:doctor` must check OS/CPU, Node/pnpm, JDK/Gradle compatibility, Android SDK/tools, emulator acceleration, AVD image availability, Docker where needed, APK architecture, host audio capability and approved network access. Probe the actual environment: `emulator -accel-check` is one documented acceleration check. [S5]

If runtime prerequisites are missing, complete source, configuration, static tests and build work that can actually run. Report the blocked runtime lane with exact prerequisites and reproduction commands. Never manufacture screenshots or claim emulator execution.

### 6.2 Version matrix

Select and pin images after reading the app's resolved minimum/target SDK and the installed SDK catalog. Start with one primary supported image. Expand to the minimum supported runtime, Android 13/API 33 and Android 14/API 34 where in scope, plus the latest stable runtime the application claims to support. Deduplicate overlapping selections. Preview images are advisory, not silently added to release gates.

Use a Google Play or compatible Google APIs image for real FCM testing; a plain AOSP image is not an equivalent push environment. FCM explicitly supports suitable Google-API emulator environments. [S6]

Match image/native ABI to the host, usually `arm64-v8a` on Apple silicon or `x86_64` on an x86 host. Record exact image ID/revision, API, ABI, emulator build, Play services information and app target SDK. A “Samsung-shaped” emulator profile must not be presented as Samsung firmware testing. [S5]

### 6.3 Lifecycle control

Use only a dedicated lab emulator, selected by explicit serial. Fail when selection is ambiguous. Capture initial battery/network/permission state and restore it even on failure. Never reset a physical phone accidentally or kill unrelated emulators.

Keep separate tests for foreground, Home/background, task removal, activity recreation, verified process death, locked screen, Doze and force-stop. Confirm the intended state using OS evidence. A command that fails to kill the process does not count as a cold-start test.

For true idle and process-death tests, do not keep the app awake with an attached debugger, instrumentation in the target process, an accidental persistent service or repeated polling that defeats the scenario. Use an external controller or separate test package and show before/after process state.

Android documents forcing and exiting Doze through ADB. Wrap those commands with state capture, explicit device targeting, timeouts and cleanup. Force-stop is different: Android FCM documentation says an app force-quit through Settings needs manual reopening before messages resume. Treat that as expected platform behavior, not a requirement to bypass the user's choice. [S7, S8]

---

## 7. Isolated SIP and media lab

### 7.1 Safe topology

Use a new lab-only Compose project/configuration. Do not execute the repository's inherited production-oriented Compose stack without auditing and removing live routes. Prefer one minimal FreeSWITCH instance first; add the existing proxy/media chain only to test the corresponding route.

Use synthetic extensions, such as 7101 for Phone11 and 7102 for its peer. Generate per-run secrets and allow only explicit local fixture destinations. A deny-by-default dialplan must reject every other destination, including PSTN-shaped numbers. No trunk credentials or carrier routes may exist in the lab configuration.

Bind management surfaces to loopback or an approved private interface. Apply host/network controls that allow only the test peer, emulator and approved push/API destinations. Do not expose SIP or FreeSWITCH control interfaces publicly. Protect control sockets and clean up accounts, registrations, containers and temporary files created by the run.

A local FreeSWITCH pass proves compatibility with that lab topology, not your production SBC or carrier route. Add a separately approved staging-interoperability lane later; do not infer it from the first lab result.

### 7.2 Reachability and media

On the standard Android Emulator, `10.0.2.2` is the special address for host-loopback access. It is not a universal address for a remote runner or handset. [S12]

Document the actual host/container/emulator address map, SIP transport and ports, advertised SIP Contact, SDP media addresses and restricted RTP port range. A working web API or SIP TCP connection does not establish RTP reachability. Do not present `adb reverse` for a web development port as a fix for arbitrary UDP media.

Use a media-anchored fixture and correct reachable addresses. Discover which SIP transport and secure-media modes the real Android bridge and PBX support. Test TLS certificate rejection when TLS is supported. Never disable production TLS validation to simplify a local experiment. A test-only trust configuration must be excluded from release artifacts.

### 7.3 Call scenarios

Automate registration success/failure/recovery; outbound answer; foreground inbound answer and reject; caller cancellation; timeout/missed history; local/remote hangup; mute; hold/resume; DTMF at a receiving collector; busy/second-call handling; rapid duplicate actions; and network interruption/recovery.

Exercise `180 Ringing` without SDP separately from early media if the fixture supports both. Confirm state/history cleanup when calls never connect. Preserve one-active-call policy unless the current product explicitly supports more.

### 7.4 Audio evidence must be specific

Record four distinct claims: signaling connected; media packets observed; known audio decoded/received; and human-audible speech in each direction. Passing a weaker claim must not automatically pass a stronger one.

Provide a deterministic media fixture with a known tone or synthetic speech. Verify downlink at a supported SDK capture point or controlled emulator/host audio sink. Verify uplink at the peer using an approved virtual microphone source or a documented supported SDK input. Confirm signatures/energy and channel direction with recorded evidence. First prove that the instrumentation really observes the intended signal path.

Do not invent vendor PCM APIs. Where automated capture is unavailable, mark the affected audible-audio case BLOCKED or NOT_RUN and provide a manual computer-microphone/desktop-peer check. Android Emulator microphone input is disabled by default and can be explicitly enabled through host-audio input, subject to host permissions. [S4]

Collect only synthetic media by default. Human microphone testing requires the operator's awareness and permission. Do not retain real conversations. A screen recording without an audio track is UI evidence only. Bluetooth/earpiece/acoustic quality on a physical phone remains outside emulator certification.

---

## 8. Real FCM push-wake lane

### 8.1 Two lanes, never interchangeable

**Contract lane:** synthetic payloads test parsing, expiry, deduplication, ownership and reconciliation. It runs without Firebase credentials and is labeled mocked.

**Real push lane:** a genuine Firebase message targets the installed lab Android client while a genuine lab SIP call is pending. It requires an approved test project, compatible Google services, a matching application ID, network access and server-side sender authorization. Missing prerequisites block this lane, not unrelated offline work.

Siprix recommends data messages and describes a server-controlled sequence in which the client wakes/restores registration before the PBX forwards the call. A message delivery receipt alone is not a call-delivery result. [S2]

### 8.2 Reuse and validate the wake contract

Inspect the existing Phone11 wake methods and binding fields before designing new ones. The inspected shared API includes user, tenant, device, session, binding expiry and call identifiers. Preserve those ownership boundaries. Do not copy an iOS-specific push adapter and assume it is an Android implementation. [R5]

A proposed end-to-end fixture must:

1. Accept a call only for an allowlisted lab account, create a unique correlated pending-call record and arm a bounded deadline.
2. Send a real high-priority call-related data message with a short expiry aligned with the pending call. Include minimal opaque identifiers, never SIP passwords or session secrets.
3. Wake a native Android receiver without requiring an already-running JavaScript UI.
4. Validate the wake binding using the existing authenticated design; reject expired, replayed, logged-out or wrong-owner context.
5. Initialize/reuse the single native runtime and obtain fresh registration when the route requires it.
6. Deliver the pending INVITE based on correlated registration/readiness, not an unverified fixed sleep.
7. Present exactly one legitimate incoming-call surface and allow answer/reject under the applicable OS rules.
8. Reconcile native state/history when JavaScript reconnects; cancel stale notifications and pending calls correctly.

High-priority FCM processing is constrained and may be deprioritized when not used for appropriate visible, time-sensitive interactions. Use the actual documented SDK behavior and measure delivery; do not promise guaranteed wake. [S9]

Record the pinned Firebase client/server library versions and compatible destination identifier type. Do not silently migrate an existing token-based production contract just because current documentation describes newer options. The sender, client and backend must agree and be tested together.

### 8.3 Android permission and service requirements

Inventory microphone, notification, full-screen-intent, foreground-service and self-managed-calling configuration. Apply only permissions required by the selected ownership model. Validate allow and deny paths, notification channels, immutable/explicit actions where required, and supported incoming-call UI fallback.

Android 14 introduced explicit foreground-service type requirements and restrictions around full-screen intents. A sideloaded emulator permission state is not evidence of store approval or every user's settings. Test with full-screen permission denied as well as allowed. [S13]

Review microphone and phone-call foreground-service prerequisites for the actual target SDK. Do not start microphone capture before a legitimate answer or circumvent background-start restrictions. A fake always-running service that keeps tests green is not an acceptable replacement for wake integration. [S14]

### 8.4 Failure cases that matter

Test late/duplicate wake, duplicate INVITE, caller cancel before and after wake, answer racing cancel, rejected/expired credentials, token/identifier rotation, wrong user/tenant/device, logout before delivery, network loss while waking, app process gone, FCM unavailable and force-stop followed by explicit relaunch.

Call state at the server must be rechecked before stale UI is shown. The expected outcome for an expired or canceled call is no ghost ringing and no accidental connection. Repeat each asynchronous case with bounded attempts and retain first-run failures.

---

## 9. Diagnostics and evidence report

Provide a small lab-only diagnostics surface or read-only test export, not a product redesign. Show build/commit, actual engine/SDK, registration, permission state, native runtime generation, last sanitized push receipt, call state and network status. Separate observations from requested actions.

Suggested event record:

```json
{
  "run_id": "generated-at-runtime",
  "test_id": "PUSH-01",
  "correlation_id": "synthetic-call-id",
  "component": "android-native",
  "event": "push_received",
  "timestamp_utc": "runtime ISO-8601 timestamp",
  "monotonic_ms": 0,
  "generation": 0,
  "sequence": 0,
  "evidence_level": "L3"
}
```

This is a schema example, not a test result. Preserve the difference between app call ID, SIP Call-ID, server call UUID and push message ID. Keep a sanitized correlation map. For measurements across hosts, synchronize clocks and report uncertainty; do not subtract unrelated monotonic clocks.

Per-run outputs must include JSON, JUnit where applicable, a local HTML report, APK SHA-256, selected commit, AVD identity, dependency versions, sanitized app/server events, failures, screenshots and optional video. Any raw SIP trace may expose authorization material or media metadata: keep it private and short-lived; only a reviewed, redacted representation may be shared.

The report must show totals by evidence level and outcome, exact executed/skipped/blocked test IDs, first-run and rerun results, registration and ring-time distributions with sample sizes, media assertions and a gap list. Include links to evidence with relative paths. Zero tests or missing required lanes must never yield success.

Results are `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN` or `NOT_APPLICABLE` with a written reason. An overall stage may be `PARTIAL`; individual assertion gaps cannot be hidden behind a broad PASS. A negative force-stop case can PASS only because it matched the expected no-wake/relaunch behavior, not because the app rang while stopped.

---

## 10. Commands and repository deliverables

The names below are **interfaces for Codex to implement**, not existing verified commands.

```text
pnpm lab:doctor                 # inspect prerequisites; never install silently
pnpm lab:setup                  # approved, pinned tool/assets setup
pnpm lab:up                     # isolated SIP fixture only
pnpm lab:android:build          # build genuine native lab APK
pnpm lab:android:install        # install on explicit lab emulator
pnpm lab:test:logic             # no live SIP/push credentials
pnpm lab:test:sip               # real local SIP and media assertions
pnpm lab:test:push:contract     # mocked wake contract only
pnpm lab:test:push:live         # real approved FCM + pending lab call
pnpm lab:report                 # render actual evidence, no network required
pnpm lab:down                   # only resources created for this run
```

Implement them with the repository's existing tooling. Commands must be non-interactive after authorized configuration, idempotent where meaningful and safe on repeated execution. Use argument arrays rather than unsafe shell interpolation, validate destinations and paths, enforce timeouts and provide cleanup traps.

Suggested placement, adapted to actual conventions:

```text
docs/android-virtual-lab/
  BASELINE.md
  BLUEPRINT.md
  ANDROID-BRIDGE-MAPPING.md
  RUNBOOK.md
  TEST-MATRIX.md
  KNOWN-LIMITATIONS.md
  ACCEPTANCE.md
scripts/android-lab/
tests/android-lab/
infra/lab/
modules/phone11-siprix/android/      # only when missing
artifacts/android-lab/              # ignored runtime outputs
.github/workflows/android-lab.yml   # isolated, reviewed CI
```

Provide a documented example config with non-secret placeholders. A real local config is ignored and access-restricted. Prefer an approved runtime secret mechanism; never write production secrets, Firebase sender credentials or SIP passwords into JavaScript, `EXPO_PUBLIC_*`, an APK, committed fixtures or CI logs.

Do not expose unauthenticated debug endpoints or exported command receivers. Test-only state injection must be excluded from release builds and must not be used in L2/L3 evidence lanes.

---

## 11. Work packages and review gates

| Package | Deliverable | Exit evidence |
|---|---|---|
| P0 — Baseline and safety | Source inventory, selected commit, runner diagnosis, engine/ownership map | Written facts versus unknowns; no destructive checkout or production activity |
| P1 — Native Android readiness | Existing bridge verified or missing bridge implemented; build integration | Actual Android compile/install/load when runner available; no fake fallback |
| P2 — Repeatable SIP lab | Local fixtures, automation, audio evidence, core UI flows | L2 test results and explicit audio status |
| P3 — Wake contract and real push | Deterministic contract tests plus separately gated FCM integration | L0 contract results and independent L3 evidence or blockers |
| P4 — Report and CI | One-command runbook, evidence bundle, safe CI | Fresh reproduction, truthful report, reviewed changes |
| P5 — Handoff | Operator guide, remaining hardware matrix, release gap list | Human review; no claim of device-wide readiness |

Use small PRs/commits with one owner. Do not merge, enable auto-merge, force-push or publish. Preserve active branches and uncommitted work. Run regressions for shared interfaces and iOS build configuration where the environment supports them; clearly state when iOS runtime regression was not executed.

Changes to authentication, wake authorization, call routing, account ownership or failure behavior require independent high-risk review and Vasavas's approval before integration. The lab can implement isolated test components; it cannot treat this handoff as authorization to alter production routes or terms.

Avoid unbounded attempts. Default to at most two diagnostic reruns per failing case, preserving each failure, and one documented implementation revision per hypothesis before reevaluating. Set total run and spend limits in configuration. Default external paid-service spending is zero.

---

## 12. Acceptance gates and proposed targets

Use the accompanying test matrix as the minimum scenario inventory. It is not a pre-filled success report.

**G0 — Scope safe:** P0 records authoritative code and runner constraints; release/production configuration unchanged; no secret leakage or live trunk reachability.

**G1 — Native ready:** the actual lab APK loads the actual Android Siprix library on the selected ABI and reports its runtime version. Build/install failure is not excused by passing mock tests.

**G2 — SIP functional:** all required call/control/error cases pass on the primary image. Initial repeatability target: 20 outgoing and 20 foreground incoming calls complete their expected signaling transitions with no unexplained crash, duplicate active call or stuck notification. Keep individual connected calls within the verified SDK license limit. Media assertions remain separate.

**G3 — Audio verified:** both directions carry known audio through an observed valid signal path. Either deterministic automated evidence or a clearly identified manual host-audio test is acceptable; report which was used. Missing audio capability means this gate remains open, even when G2 passes.

**G4 — Push verified:** actual FCM/pending-call tests pass separately in background, locked and forced-Doze states. Proposed initial target: 20 calls per state, each eligible call visible within a configurable 15-second observation window. Report all misses and p50/p95 with sample counts. Also pass cancel/duplicate/expiry/ownership tests. These small-sample targets do not establish a production reliability percentage or FCM guarantee.

**G5 — Reproducible:** a clean supported runner can follow the documented configuration and commands; reports identify actual execution, required missing coverage and first-run failures. Real-push steps may remain blocked only with explicit prerequisites—not presented as passed.

**G6 — Physical release gate:** before broad Android availability, validate actual target handset firmware, overnight idle, push/background restrictions, wired/Bluetooth accessories, earpiece/speaker/acoustic quality, cellular/Wi-Fi transitions, lockscreen and battery behavior. Named device evidence is required. Remote physical devices may contribute later after checking their audio/network/idle capabilities and approving access/cost.

Deliverable status can legitimately be “lab implementation complete; real FCM blocked by missing test configuration” or “SIP validated; audible audio pending.” It cannot be “all Android devices supported” on emulator evidence.

---

## 13. Final Codex response contract

Return: selected repository/base SHA and rationale; files changed; actual APK path/hash when built; exact commands executed and exit results; evidence levels achieved; test counts and IDs; known failures and blockers; security/production-scope checks; operator reproduction commands; remaining handset validation; and PR/diff location only if actually created.

Never claim a call, SDK load, push delivery, emulator execution or audio path without its evidence. Do not stop at a plan when safe implementation can proceed; do not invent success when a runtime capability is missing.
