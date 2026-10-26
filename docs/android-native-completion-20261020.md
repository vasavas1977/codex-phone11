# Android native completion candidate — 20 October 2026

This continuation adds Android native call/wake/history and ordinary Team Chat
notification source to the shared Phone11 app. Shared React Native screens,
assets, API clients and business logic continue to serve iOS and Android. The
signed daily-use iPhone, its installation and production/backend commissioning
remain separate evidence. Passing source checks does not update an installed app.

The source work continues from `d93c384` on
`codex/phone11-android-native-completion-20261020`. The integrator must bind the
final review/build receipts to the eventual committed SHA; this note does not
assign an artifact identity to an uncommitted tree.

## Candidate isolation and packages

| Candidate | Package | Notification/wake configuration |
| --- | --- | --- |
| Existing foreground trial | `ai.phone11.mobile.foregroundtrial` | Existing foreground scope and verifier remain available |
| `preview-android-native-candidate` | `ai.phone11.mobile.androidcandidate` | Native completion source enabled; wake and chat notification flags default off |
| `preview-android-wake-candidate` | `ai.phone11.mobile.staging` | Explicit wake/chat candidate; reuses the staging Firebase package registration with matching public project metadata |

`PHONE11_ANDROID_NATIVE_CANDIDATE` and
`EXPO_PUBLIC_PHONE11_ANDROID_NATIVE_CANDIDATE` must both be `1`. The isolated
foreground flags must also match, the selected SIP engine must be Siprix, and
App Store/iOS wake/chat commissioning must remain off. Ordinary/iOS builds retain
their existing defaults. No new Firebase project, credential, signer or provider
commissioning is implied by selecting a source profile.

Wake additionally requires matching
`PHONE11_ANDROID_WAKE_CANDIDATE=1` and
`EXPO_PUBLIC_PHONE11_ANDROID_WAKE_CANDIDATE=1`, a fixed HTTPS API origin, and an
absolute `PHONE11_ANDROID_GOOGLE_SERVICES_FILE` whose public project/package
metadata matches `PHONE11_ANDROID_FCM_PROJECT_ID` and the selected package.
`PHONE11_ANDROID_CHAT_NOTIFICATIONS=1` independently enables the Android chat
client extra. Missing or mismatched configuration fails closed. The plugin
persists the validated wake origin as `phone11AndroidWakeOrigin`; Gradle consumes
that property and validates it before embedding the native origin.

The pinned Android SDK remains Siprix `1.1.0`, build `20260905_1222`, with the
60-second trial limit. Native capability checks continue to report physical
background/closed-app calling and video acceptance as unavailable. Shared source
parity does not remove SDK licensing, media, lifecycle or handset validation gates.

## Native call, wake and completed history source

The candidate keeps one native SIP process owner across React attachment,
foreground operation and a native wake. FCM wake data carries only version,
opaque call UUID, binding ID and expiry. Native handling validates correlation,
expiry, current enrollment and permissions before it claims the server-authorized
SIP configuration. Telecom/incoming-call service setup, cancellation, stale
notifications, session replacement and JavaScript adoption remain explicitly
owned lifecycle paths. Ordinary FCM messages and token refresh events continue
through Expo Notifications when the wake receiver is present.

Server wake enrollment additionally requires `PHONE11_ANDROID_WAKE_ENABLED=1`
and the existing global wake/pilot configuration. Delivery selects the exact push
revision and rechecks the pending call, current auth session/identity and assigned
phone account immediately before external submission. Disabling Android wake
invalidates Android enrollment, grant access and active-call lookup. iOS retains
its APNs path and existing envelope behavior.

Completed native wake calls use immutable `native-wake:<UUID>` IDs and the existing
JavaScript importer contract. The native spool stores only captured owner/tenant,
sanitized number, inbound direction and call timestamps. It excludes grants,
passwords, SIP account configuration and raw remote URIs. Storage uses a separate
AndroidKeyStore AES-GCM key and an atomic file in the app's no-backup directory.
Atomic reads recover a backup before treating a file as absent. Corrupt or
unreadable data produces a storage failure, without replacing it with an empty
history.

Read/ack operations require the requested binding to match the freshly validated
current binding, including owner, tenant, device, session and expiry. Renewed
sessions for the same owner/tenant can import previously completed rows. Other
owners/tenants cannot see or acknowledge those rows. Acknowledgment follows the
existing durable JavaScript import; replay is idempotent, with bounded native
acknowledgment tombstones. Retention is 100 completed rows and 256 tombstones for
30 days. Committed records survive process recreation. Failed appends remain in a
bounded in-process retry buffer; that buffer is not durable during a disk failure.
Logout/revocation invokes explicit history clearing to match the iOS policy;
clearing immediately erases pending memory and fences further reads until reset succeeds. It destroys the dedicated encryption key before deleting ciphertext, so failed file cleanup cannot resurrect old rows after process recreation. An unavailable key store/filesystem reports storage failure instead of claiming deletion succeeded.

## Ordinary Team Chat notifications

Android creates `phone11_team_chat` before permission/token work, prompts only
through the explicit enable action, and enrolls Expo's native FCM token with its
original case. The existing coordinator fences account/workspace changes,
background token rotation, duplicate callbacks, cold taps and stale resolutions.
The iOS APNs token and permission path retains its existing configuration.

Server Android chat requires both `PHONE11_CHAT_NOTIFICATIONS_ENABLED=1` and
`PHONE11_CHAT_ANDROID_NOTIFICATIONS_ENABLED=1`. The gate applies to enrollment,
enqueue, claim, pre-provider checks, tap resolution and mobile-presence fallback.
`FCM_PROJECT_ID` and `FCM_ANDROID_PACKAGE` must match the selected Android app.
The shared HTTP v1 transport uses Google Application Default Credentials, the
Firebase messaging OAuth scope, a fixed Google HTTPS endpoint and a bounded
five-second attempt. It performs no automatic replay after uncertain acceptance.
Only a typed `UNREGISTERED` response with HTTP 404 revokes the delivered token
revision; auth, configuration, payload, throttle, timeout and transport failures
do not delete tokens. Provider response bodies and credentials are not logged.

Lock-screen content is generic “Phone11 / New message” plus an opaque event ID.
FCM offline TTL is reduced immediately before submission to the event's remaining
expiry. Notification taps resolve through current server authority; payload routes
and supplied workspace/conversation fields are ignored.

`server/chat-notifications/migration-android.sql` is a source-only proposal and
**has not been applied**. It adds an `ios` default platform to existing rows,
retains APNs validation and introduces case-sensitive FCM token validation with
platform-scoped uniqueness. The new server supports the original iOS registry
before that migration. Any future schema application or rollback requires its
own owner authorization, backup/rehearsal and exact source/schema review. Older
notification dispatchers require Android registry/outbox rows revoked before
being restored because they cannot interpret FCM rows.

## Executed source validation

These are local source/synthetic checks from this continuation, not hosted CI or
handset receipts. Counts below identify distinct runs; overlapping totals must
not be added together.

| Check | Observed result |
| --- | --- |
| Focused CI-equivalent candidate settings, native wake state and encrypted history command | 5 Node tests passed, zero skips; includes 49 wake-state and 53 history assertions in real JVM executions |
| Focused CI-equivalent FCM/chat/APNs/wake/importer regression command | 141 Vitest tests passed across 10 files, zero skips |
| Complete notification units/components/server plus shared FCM transport | 90 tests passed; PostgreSQL suites intentionally excluded from this unit receipt |
| Isolated local PostgreSQL chat/notification harness | 100 tests passed: 44 notification and 56 Team Chat; additive migration ran twice against disposable test schema |
| Java-generated completed record through the actual JavaScript importer | Passed within the 141-test run; durable import, duplicate replay, wrong-owner and stale-auth cases exercised |
| App/server/tests TypeScript with existing desktop Electron dependency lane excluded | Passed with an ephemeral config; repository config was not changed |
| Whitespace/diff validation | `git diff --check` passed |

The existing `.github/workflows/phone11-mobile-cloud-check.yml` now has explicit
JDK 17 source gates for the new Android configuration, wake/history state and
FCM/chat/importer suites. Its source trigger includes affected server files.
Existing optional Gradle/APK jobs retain their separate invocation conditions.
No new automatic build, distribution, deployment or provider operation was added.

## Evidence still required

No new completion-build receipt is asserted in this note. The root integrator
must add any subsequently observed build/compiler/package evidence with its exact
variant, package, source SHA, artifact checksum and verification outcome. A
successful compiler check, Gradle assembly, signed APK and installation each
require their own receipt. None establishes live SIP/RTP or notification delivery.

The Samsung A55 remains unavailable to this continuation. No authorized,
enumerated handset, installation, microphone/audio route, incoming/outgoing
media, lock screen, Doze, terminated-process call, notification delivery/tap or
real-device logout/revocation acceptance is claimed. Firebase/ADC commissioning,
chat schema application, hosted backend/provider behavior and licensed sustained
calling remain separate owner-approved steps.
