# Phone11 daily-use readiness — 12 September 2026

Phone11 remains an internal pilot. Build33 is installed and passed two consecutive locked-phone incoming calls without reopening between, as reported by the owner and supported by two native Answer/connected/finished sequences. Two-way speech and immediate End are user-reported. Background routing is active. The requested longer locked-idle call also passed user checks and fresh native connection/termination proof. Network changes, audio controls, cold-start behavior and recipient chat delivery remain separate unaccepted checks.

| Area | Current evidence | Still required |
| --- | --- | --- |
| Incoming public calls | Build33 passed two user-confirmed incoming public calls with native connection and termination evidence; dedicated-number PCMA routing is retained. | Outgoing calls, Recents and other network/audio states on this build. |
| Background calls | Build33 passed two consecutive locked calls; current binding and owner restoration verified. Scoped proxy routing is active. | Ten-minute idle, OS-reclaimed state, network changes and missed/declined-call recovery. |
| Team Chat | Scoped messages, drafts, unread counts and ordinary-alert enrollment/outbox are implemented. The two notification tables are migrated. The later chat backend image exists inactive. | Deploy the reviewed backend, enable and verify ordinary alerts with an authorized second participant, including locked-screen alert and tap. |
| Alert recovery | Temporary enrollment failures retry only for the same account/workspace; token events cannot recursively request tokens. | Real permission, offline recovery and recipient-device tests. |
| Long calls | Not accepted. The owner asked to leave licensing out of the current work; no purchase or licensing change is planned. | A separate longer-call acceptance result. |
| Network/audio changes | Guarded reconnect and call controls are implemented. | Wi-Fi/cellular changes, interruption, speaker/Bluetooth and mute/hold tests on real phones. |

## Installed application and source checks

Version 1.0.0/build33, source `721badaa64939c00ed0cb5d234c9cd05cbd56efc`, is installed with fresh inventory proof from 09:27 UTC. Artifact and production signing identity matched Build32. Two subsequent consecutive locked calls passed the requested user checks and produced complete native call sequences. Earlier failed builds remain historical diagnostics; no new source change is indicated by this successful pair.

Call recovery commit `071b0c7` preserves calls that arrive while a native recovery snapshot is pending. Independent review and 87 focused engine/registration tests passed. Its signed build was requested through [workflow 34665717170](https://github.com/vasavas1977/codex-phone11/actions/runs/34665717170). Later exact source `27371c77b23c580123551f9c4ba0e8819d234127` passed [CI workflow 34666797738](https://github.com/vasavas1977/codex-phone11/actions/runs/34666797738). This later CI result does not change the source installed in build 26.

Full-project TypeScript checking remains unsuccessful due to existing unrelated diagnostics; independent review found none in the changed call engine or notification repository. Focused tests and successful required CI checks are not represented as a clean full-project typecheck.

## Live backend and background commissioning

The live backend remains source `f21e763`. Its reviewed wake activation succeeded, the runtime can read the production APNs key, and ordinary chat alerts remain off. Proxy wake routing is **active for Build33** after fresh device/binding and idle checks. Two consecutive locked calls passed; the longer idle test is pending.

The four existing push/wake tables were previously applied after restore rehearsal and protected-data checks. Private authenticated owner sign-in, canonical profile, chat owner-header/isolation, legacy compatibility and CORS checks passed. Baseline and candidate phone settings matched completely for extension 3001/tenant 1; temporary sessions were revoked and protected data/schema matched. Credentials were not retained.

An earlier wake activation rolled back because its validator expected mount Mode `ro`; an isolated never-started fixture established this host reports Mode empty with `RW=false`. The corrected activation has now succeeded. A retained zero-packet RTP session previously prevented activation. The owner later authorized one exact session deletion, completed after stable-session and idle checks without service restart. No timeout change or idle-guard bypass was performed. These earlier blockers are historical and do not describe the current enabled backend.

Wake routing commit `77e2101` releases allocated media on negative transaction completion, local timeout and immediate relay failure. Twelve isolated real-Kamailio/fake-NG scenarios passed, including successful answers and a CANCEL/200 race; original-code controls failed at the expected missing cleanup. Four static checks and independent review passed. The installed Kamailio parser also checked the private routing candidate while preserving the accepted PCMA filters. Routing activation and physical calling remain separate checkpoints.

## Ordinary chat notification migration

The two additive tables `phone11_chat_notification_devices` and `phone11_chat_notification_outbox` are now committed. A fresh, consistent backup and complete isolated restore/migration rehearsal passed, followed by production dry-run and the exact migration. Fresh protected data and existing schema were unchanged across the migration; the backend runtime was unchanged. This schema result does not prove notification delivery or deployment of the later backend.

Private server evidence:

- Backup: `/opt/phone11ai/chat-backup-lossless-v3-4250d98-bd8bdf239bba`.
- Migration result: `/opt/phone11ai/chat-migration-tools-0638d7bb4ba6/migration-execute.safe.json`.
- Exact migration SQL SHA256: `6328dafb238864d730198a967c059f67ab0f510dcc8b74bee89651d904c4e318`.

The lossless rehearsal represents sequence integer attributes as decimal strings, preserving their exact values through Node JSON. A fresh baseline and dump were collected after that correction; earlier evidence was not normalized or reused to waive strict equality.

Chat source `4250d9849d0674b40c66005f0e1d1c26ca3e3660` removes undeliverable registrations after deleted, disabled or remapped identities while retaining valid device limits. Independent review, 24 isolated PostgreSQL tests and 33 notification tests passed. Its image `sha256:f9d783428a4f4b78ffa589103f4b12751877bb927a3099905f9734368a587e3a` passed isolated runtime import/syntax checks and exists inactive. It is not the live `f21e763` backend. Ordinary alerts remain disabled.

## Remaining physical acceptance

Apple sign-in/key creation and private owner authentication are complete. The directory returned zero other eligible users, so chat acceptance still needs an authorized second participant. The owner has made the two test phones available; request the next test only when its server/app setup is ready.

Selected-workspace message alerts are best effort, with a ten-minute delivery window; uncertain provider attempts are not replayed. OS-reclaimed and user force-quit calling require separate results. Full Zoom feature parity, voicemail, transfer and general production readiness are not claimed.


## Background activation checkpoint — 2026-09-12

After the owner reopened Build 26, the fresh device inventory and canonical database verified exactly one current production VoIP binding for owner 1, tenant 1, extension 3001. Backend container e2ce0ed40596243dc3913503f38f6826a7ca78ae9a28c5b00439fafa0e043d04 remained unchanged. The scoped proxy dry-run passed with all call services idle; execution activated configuration SHA256 `9a62abe16e3f39cc0b2f74e0090f19435ff16c4daab9e28af5c78c7e9a862e3f` in both host and container, preserving the accepted PCMA setup. The owner was asked to perform a locked-screen inbound call. Physical ringing, Answer, two-way audio and End remain pending for this background path. Ordinary chat alerts remain off; the chat candidate is not yet deployed.


### Locked-screen acceptance failed on Build 26

Owner reported that Phone11 rang while locked, but Answer failed. The server recorded two ended wake calls and APNs usage on the current binding. The latest call never set its ready busy lease. Read-only diagnostics verified one eligible claim credential row with a nonempty password and equal foreground/background extension, transport, port and STUN configuration. This proves locked ringing for this test, but not background answering or audio. The saved JS diagnostic trail did not contain the native failure. Chat deployment remains on hold during diagnosis.


### Build 27 diagnosis and safe routing rollback

Signed Build 27 (source e069779b4b4a90e298245cf88fc67aa85da872da, workflow 34668695244) passed all checks and was installed in place, with device inventory verified. Native diagnostics captured five immediate `wake_owner_mismatch` failures after HTTP 200 claims, then one expired claim. A read-only 15-minute aggregate showed six distinct incoming SIP call IDs and six wake IDs for the same binding, so repeated ringing did not arise from duplicate processing of one call ID. The existing guarded rollback completed with all calls idle, restoring host/container configuration SHA256 b0d449b54b126e4e2a2b095919d39f17b395d5eec8d537c3f24803e51c47357b. Background routing is now inactive; backend enrollment remains enabled. A current-session verified owner rebind after native recreation is being implemented and tested. Daily-use/background acceptance remains failed, not complete.


### Build 28 installed; acceptance pending

Source 15ddcec98bfaa6c6829c6234c941b8d7e7fe17e6 restores server-verified cached wake ownership after a fresh native phone account is created. The exact signed workflow 34671267957 passed all checks; Build 28 was verified and installed in place with inventory proof. Signed production APNs identity matches Build 27. IPA SHA256 25f54ca8f0875f914aca4b07e7d11b1dd719cee0ab6160d76c99619e00d99fc1. The owner was asked to open the app before checking its new owner-restoration diagnostic. Background routing remains rolled back. Reactivation currently refuses a leftover zero-packet RTP session despite zero FreeSWITCH channels and Kamailio dialogs; no session was deleted.


### Build 28 failed after another resume restart; Build 29 building

The owner authorized exact retained-session cleanup. The reviewed d0799 helper removed one captured offer-only, zero-traffic session after stable/idle checks, with zero service restarts. Build 28 binding was reverified and proxy 9a62 reactivated. The next locked call failed: native diagnostics reported wake_owner_missing after successful claims. JS evidence shows a restored generation 7 followed four seconds later by generation 9 without an owner restore; later generations restored normally. Root safely rolled back the Build 28 proxy journal to BASE b0d449 with all call services idle.

Commit dbaa1d9 preserves an already registered runtime on healthy foreground resume, still rehydrates secure account state, and retains failure/network/manual recovery. It also logs a fixed warning when wake-owner verification is unavailable. 100 focused engine/lifecycle tests passed and independent review approved. Signed workflow 34674420298 is building this bounded change as Build 29. Broad native pending-wake coordination was reviewed but NOT implemented or included: logout cancellation, ownerless bind ordering and stale JS cleanup require separate design. Background and daily-use acceptance remain unproven.

### Build 29 installed — 2026-09-12 05:10 UTC

Workflow 34674420298 succeeded at dbaa1d9d22b52625fc670d3f276aae8899b3858c. Artifact and production signing checks passed against Build 28; IPA SHA256 f0fd0e380bd48aec70e621c37dbdbd23f0ad37272cdc9ba5eb18461734930b3b. In-place installation and fresh device inventory verified Build 29 at 05:10:29 UTC. Before installation, server calls were idle and proxy BASE was verified. Background routing remains rolled back. Awaiting actual app open, fresh wake-owner diagnostics, and healthy resume check before reactivation or another call. No new background-call acceptance result.

### Build 29 resume and background routing — 2026-09-12 05:17 UTC

User confirmed Ready after opening, then locking/reopening. Fresh handset diagnostics showed owner restored at 05:14:04.827Z and registration renewed at 05:15:12.803Z with no later engine initialization or owner-verification warning. Actual Build29 inventory and fresh current server binding passed. Build29 scoped proxy dry-run and activation succeeded; host/container both candidate 9a62abe16e3f39cc0b2f74e0090f19435ff16c4daab9e28af5c78c7e9a862e3f, accepted PCMA preserved. Background routing is now ACTIVE for the bounded handset test; no call acceptance claimed. Rollback helper and separate Build29 journal retained.

### Build 29 locked-call failed — 2026-09-12 05:27 UTC

User reports still failing. Fresh native diagnostics native-wake-diagnostics-1789190804846895000.private.json show four new claim HTTP200 responses followed by prepare_complete registration_failed within roughly one millisecond, rather than the earlier wake_owner_missing. JS diagnostics handset-diagnostics-1789190809054243000.private.json retained for correlation. Build29 proxy rollback succeeded with host/container both BASE b0d449b54b126e4e2a2b095919d39f17b395d5eec8d537c3f24803e51c47357b; backend enrollment remains enabled. No background acceptance. Native registration callback and SDK recovery semantics under parallel review; no new patch or build yet.

### Build 30 dispatched — 2026-09-12 05:36 UTC

Commit 37a1e4cf3bfb9de4acaf37ad1ba9e8e281b97391 excludes registration callbacks queued before wake preparation from satisfying or failing the newer wake. Fresh callbacks retain success/failure and expiry handling. Fixed registration_fresh/registration_stale diagnostic markers expose only numeric registration enum. Independent native checks passed: 55 wake runtime,119 coordinator,140 bridge assertions,gate-off4,header checks; negative control removing freshness guard reproduces stale callback failure. This fixes a proven queue race but does not establish the cause of Build29 handset failure. Signed workflow34675931581 runs daily-pilot profile; artifact/installation not yet verified. Reviewed Build30 proxy/binding helpers staged,16 tests passed; no activation. Proxy remains BASE rolled back after Build29. Official SDK wrapper uses handleIncomingPush without immediate accountRegister, suggesting duplicate recovery work but not proving the observed failure; no speculative sequence change included.

### Build 30 installed — 2026-09-12 05:45 UTC

Workflow34675931581 succeeded at37a1e4cf3bfb9de4acaf37ad1ba9e8e281b97391. EAS7e8173f3-c5f8-4093-bffc-124aea726931 artifact verified, IPA SHA2568f09c0da57f9ab651f84eaea770d0ff40bfbc45795811b38d634b9d6c56f4067,16574339 bytes. Production APNs signing/profile identity matches Build29; OTA updates disabled. All call services idle and proxyBASE verified immediately before in-place installation. Actual device inventory verified Build30 at05:45:17.844634Z. Awaiting user app-open and fresh owner diagnostics. Backend enrollment remains enabled; background routing remains rolled back; no new call acceptance.

### Build30 test prepared — 2026-09-12 05:51 UTC

User confirmed Ready. Fresh JS diagnostics handset-diagnostics-1789192177077139000.private.json show startup05:49:16.667Z, owner restoration05:49:16.756Z, registered05:49:17.192Z, with no later initialization or failure. Actual Build30 inventory and current server binding passed. Reviewed proxy30 dry-run and activation succeeded; host/container both9a62abe16e3f39cc0b2f74e0090f19435ff16c4daab9e28af5c78c7e9a862e3f and acceptedPCMA preserved. One locked test requested, no call originated by tool. Background acceptance remains pending.

### Build30 user-reported locked-call success

The user replied "it is working" to the requested locked-phone inbound test covering ringing, Answer, two-way speech and End. Record this as user-reported success for this test, without inventing separate per-step confirmation. Fresh native diagnostics could not be retrieved because the iPhone is no longer detected over USB and the previous temporary extractor is absent. No routing or app changes were made in this turn. Longer background duration, network changes, cold-start behavior and chat recipient delivery remain separate outstanding acceptance gates.

### Build30 later background failure diagnosed and rollback verified

After a reported initial success, the user reported ringing followed by Answer failure. On reconnect, native-wake-diagnostics-1789194842666726000.private.json showed repeated claim200, registration_fresh enum1 and registration_failed within2ms, ruling out pre-arm queued callbacks for this failure. JS handset-diagnostics-1789194907183026000.private.json retained; no later engine initialization after05:49 startup is recorded, and registration later recovers on foreground. Exact Build30 guarded rollback succeeded with host/container BASE b0d449b54b126e4e2a2b095919d39f17b395d5eec8d537c3f24803e51c47357b. Warm push-handler plus explicit registration sequencing is under review against official plugin; no new build or activation yet. Initial success does not establish reliable background use.

### Build31 recovery sequencing change building

Reviewed commit45c52ac5b4242a7720885472f6956da32f9349bf uses handleIncomingPush alone for an existing account, matching the official iOS plugin warm push path. Cold accounts retain explicit initial registration. Fresh success remains required; fresh failure and deadline/owner/stale-callback guards are unchanged. Native tests58 runtime,121 coordinator,140 bridge,4 gateoff and headers passed independently, and duplicate-registration negative control failed as expected. Numeric registration_sip_status(-1 when absent) added without raw response text. Workflow34678629658 runs daily-pilot signing; not yet installed. Build31 proxy/binding helpers staged after independent9-test review, activation8ef7c0ccea2bb81474d9e01281aedb1a277252ca581d9f3e18fc2d8a8f365144, binding9659a0df82c293665f47c10f0d4a084c9350cccbf6b0594efb1c7a234a263152; routing remains BASE. This is an evidence-informed change, not proven handset recovery.

### Build31 installed — 2026-09-12 06:48 UTC

Workflow34678629658 succeeded at45c52ac5b4242a7720885472f6956da32f9349bf. EASb6e3db66-4aa8-4bea-9b45-e5628803c3e8, IPA79b6b27df066bae04f0cd36b89cda366ef62379acf3af15b08e5b9cecdad34f9,16575289bytes. Artifact and production signing/profile checks passed against Build30. Actual in-place device installation and inventory verified Build31 at06:48:51.559746Z. Allcallservices idle and proxyBASE verified before installation. Awaiting useropen and fresh ownerdiagnostics; backgroundrouting remains rolledback, no Build31 callacceptance. Durable diagnostic reader is evidence/build31-private-helpers/pull-handset.private.py; use device-toolsPython.

### Build31 locked test ready

User confirmed Ready. Fresh diagnostics show owner restoration06:58:03.815Z and later registration07:02:59.702Z with no later engine restart/verification warning/failure. Native trail contains only earlier Build30 events at this point. Fresh actual Build31 device inventory and server binding passed. Scoped31 proxy dry-run and execution succeeded; host/container both9a62abe16e3f39cc0b2f74e0090f19435ff16c4daab9e28af5c78c7e9a862e3f. Background routing ACTIVE for one test; PCMA preserved; no call originated by tooling. Background acceptance remains pending.

### Build31 first locked call verified

User replied "good" to the locked call test. Native diagnostics native-wake-diagnostics-1789197103195824000.private.json now verify fresh registration success, prepare success,readyHTTP200,incoming,Answer accepted,connected andfinished. This is stronger evidence than Build30 initial user-only report. Audio remains user-reported; immediate local End and Recents not independently verified. Longer background,networktransition,coldstart and chat acceptance remain outstanding. Background routing remains active; no configuration changes made in this turn.

### Build31 consecutive-call failure and rollback

User reports only first call works. Native evidence1789201552936744000 shows a complete successful registration/Answer/connected/finished sequence, then five claim200→runtime_sink_missing failures. JSdiag1789201552969072000 has no recentforegroundevents. Reviewed source shows cold nativewake clearWake releases strongwakeBridge whileleavingSDKinitialized andweaksinknil. Retention-only wouldblocklaterJSinitialize; implementation therefore underreview for scopedterminalshutdown of unadoptednativeownedruntime whilepreservingJSadoption andsuccessor viaidentity/generationguards. Guarded31proxyrollback succeededbothBASE. No newbuildyet; repeated backgroundcalling NOTaccepted.

### Build32 cleanup fix building

Commitb68da3935bc09c9ed53350e2cd92ef233c694b4a closes unadopted native-owned runtime on calltermination, preserves authenticatedJSownership, and guards synchronouscallbacks before/afterclearWake against successor cleanup.81wake-runtime,140bridge,121coordinator,gateoff4 andheaderchecks passed; negativecontrol reproduces original lifetime failure. Independentreview approved. Workflow34683536825 buildingdaily-pilot; no32artifact/installationyet. Reviewed32proxy/bindinghelpers staged: activationac7585ba1a6b9ec9096f38518a9db870b227442801d09f20e9a2e1aabd9d2d9d,binding5cf2d6e7438c14b622c2e88dd454b39464fd4f4b86fc6c53ee93bdcf46e7b032,9guards passed. Priorjournal31rolledback; backgroundrouteBASE.

### Build32 installed — 2026-09-12 08:43 UTC

Workflow34683536825 succeeded atb68da3935bc09c9ed53350e2cd92ef233c694b4a. EASb45f05bd-3321-4e65-9342-9abb7dfc8623; IPA93aa381f30504c478cd80b13c818983e1e2f0b7a41b0091e5a35a1d5816789a3,16575319bytes. Artifact and production signing/profile identity verified against Build31. Preinstallation allcallservicesidle andproxyBASE passed. Inplaceinstallation inventoryverified32 at08:43:41.215035Z. Awaiting actualuseropen andfreshownercheck; backgroundrouting remains rolledback. Consecutivehandsetcalls required; no32callacceptanceyet.

### Build32 consecutive-call test ready

Fresh owner restored08:44:25.641Z andregistered08:44:26.067Z after verified32 installation, no laterinitialization/failure. Freshdeviceinventory+currentserverbinding passed.32proxy dryrunandactivation succeeded,bothhost/container9a62abe16e3f39cc0b2f74e0090f19435ff16c4daab9e28af5c78c7e9a862e3f,PCMApreserved. Two consecutive lockedcalls requested withoutreopeningPhone11between; no calltooloriginated. Backgroundroutingactivefortest, acceptancepending.

### Build32 readiness stalls captured and rollback verified

Native1789203552151609000 andJS1789203552176083000 show32claim200 followed by pendingprepare inthreeattempts; one otherattempt reachedready/incoming butnoconnected. Inlaststall,registered08:58:40.720 occursafterreported40.596 beforeclaim41.001; pre-armfreshnessmissesit. Twootherstalls hadlastsuccess~8secsBEFOREpush(08:57:05.713vs13.087;08:58:02.173vs10.386), thennopostpushcallback. Sincepushproofalone thereforeinsufficient.32guardedrollbackverifiedbothBASE. No actualObjCSDKregistrationgetterexists; privateC++moduleaccessrejected. Nextsource underreview: nativeonlysuccessproofsinceactualpush plusone1.1secdelayedexplicitwarmrefreshwhenstillpending/noobservedinprogress, callbackrequired, allidentity/deadlineguards. Delayisoperationalheuristic,notSDKquiescenceguarantee. No newbuildoractivationyet.


### Build33 registration readiness fix building — 09:15 UTC

Commit `721badaa64939c00ed0cb5d234c9cd05cbd56efc` accepts matching native registration success received after actual push arrival but before claim completion. If the existing SDK produces no callback, one delayed refresh requires a real callback; stale success never directly completes readiness. A pending continuation handles ingress assigned before callback enqueue without duplicate refresh. Wake identity, generation, lease, owner, expiry, current account and newer callback guards remain; registration failure is still fatal. The 1.1-second delay is an operational bound, not proof of SDK quiescence. Independent review approved; full native suite passed 10 tests including 136 runtime,122 coordinator,140 bridge assertions,gate-off and header/Swift import checks. Negative controls reproduce claim-gap, missing-refresh and lost-continuation failures. Workflow `34685363775` is building the daily-pilot signed app. Build33 proxy/binding and strict diagnostic reader helpers are reviewed and staged; no activation. Build32 remains installed; background routing remains BASE. Consecutive physical-call acceptance is still required.


### Build33 installed — 09:27 UTC

Workflow34685363775 succeeded at721badaa64939c00ed0cb5d234c9cd05cbd56efc. EAS29237d09-3d4a-497b-bc46-e93f90228054; IPA SHA2569ba19a85d36870af52c8634081f1179847ed7e06bcc0c9a20c8ef0e1684ba478,16580828bytes. Artifact and production APNs signing/profile matched Build32. Fresh all-call-services-idle, prior32 rollback baseline and unchanged backend checks passed before in-place installation. Actual device inventory verified33 at09:27:39.189406Z. Awaiting owner app-open and fresh owner/registration diagnostics. Background proxy remains BASE; backend wake enabled,ordinary chat alerts off. No Build33 physical call acceptance yet.


### Build33 consecutive-call test prepared

After the owner opened Build33, fresh diagnostics show initialization09:41:47.941Z, owner restoration09:41:48.029Z and registration09:41:48.444Z with no later restart or failure. Actual fresh33 inventory and canonical current binding passed. Reviewed proxy33 dry-run and execution succeeded, host/container both9a62abe16e3f39cc0b2f74e0090f19435ff16c4daab9e28af5c78c7e9a862e3f; accepted PCMA preserved. Background routing is ACTIVE for two consecutive locked-phone calls without reopening between. Tool originated no calls; no33 physical acceptance yet. Rollback33 helper/journal retained.


### Build33 two consecutive locked calls accepted

Owner reports both calls worked for the requested two-call locked-phone test without reopening between. Native evidence1789206500115082000 verifies two report/claim200/prepare0/ready200/incoming/Answer accepted/connected/finished sequences. JS evidence1789206500126550000 shows registration success for each with no engine restart after09:41 startup. The second readiness completion occurs immediately after claim, consistent with the new claim-gap proof path; no delayed refresh marker is present, so this test does not prove the one-shot timer path on-device. Speech both ways and immediate End are user-reported; native evidence independently confirms connection and termination. Background route remains9a62 active; no source/build/routing change made after success. Longer10-minute locked idle test requested. Daily use fully accepted: no.


### Build33 longer locked-idle call reported successful

Owner reports the requested ten-minute locked-phone call worked, covering ringing, Answer, speech both ways and End per the test prompt. This is user-reported acceptance; a fresh native diagnostic pull returned diagnostics_unavailable and idevice_id listed no connected device. Reconnection requested. Do not reinterpret the earlier two native sequences as the new call. Current app/routing/backend remain unchanged. Separate Recents journal candidate is local/uncommitted and under review; chat deployment dry run passed but no rollout occurred.


### Build33 longer-idle native proof retrieved

After reconnection, native1789210404004203000 verifies one new report/claim200/prepare0/ready200/incoming/Answeraccepted/connected/finished sequence at10:49:49–10:50:02UTC. User confirms the requested long-locked-idle call worked. JS1789210404161055000 shows a transient registrationfailure10:49:49.545 then success49.977 beforeclaim50.078, followed bylaterregistration successes; no engine recreation is shown. Fresh native sequence has no failure classification. Lock duration,speech and immediateEnd remain user-reported; connection/termination verified. Recents candidate e7a9d45 is independently reviewed and sourcecommitted; no newappbuild/installation. Build33 remains installed.


### Current handoff after longer-idle proof

Build33 remains installed. Long-idle native proof was captured after a brief reconnection; the subsequent history read failed, idevice_id again returned no devices and SPUSB inventory found no iPhone. No backend rollout or new app build/installation occurred. Owner says there is no second chat account yet; do not send an invitation or message without a chosen recipient. Recents journal source `e7a9d4577a83cc31934bce5b90adb93c18932bcd` is committed and pushed after independent review (94 JS tests;153 runtime/122 coordinator/140 bridge assertions;10 native module subtests). Existing Build33 two-call Recents entries are verified; the new native-only journal has no installed-device proof.
