# Background calling pilot build — 11 September 2026

The foreground public-number audio fix has a user-confirmed two-phone result on build 23; see [the audio evidence](PUBLIC-AUDIO-FIX-20260911.md). Background and locked-device calling remain unaccepted.

## Pilot configuration

The separate `preview-ios-siprix-wake-pilot` build profile enables `PHONE11_VOIP_WAKE_COMMISSIONED=1` for the whole native Siprix pod and supplies production APNs metadata to both the app and its entitlements. It inherits the existing application identity and signing profile, with its own update channel and runtime version. The ordinary Siprix build remains disabled. Generated Podfile properties and build environment must agree; mismatches fail before signing.

The signing workflow offers an explicit allowlisted profile choice and retains all existing server/native checks. It also requires the new build-configuration test. `closedAppCalling` remains false until real commissioning evidence justifies changing the availability claim.

## Verified source behavior

Twenty focused plugin, packaging and configuration tests passed, including evaluation of actual Expo mods and the Ruby podspec. A separate review reran all twenty successfully. Actual Expo 54 iOS project generation passed for both disabled and pilot profiles. The pilot generated production APNs entitlements, matching Podfile properties and the early native bootstrap. These checks are not signed-artifact, Apple-delivery or handset background-call proof.

## Verified signed pilot: build 24

Exact source `da4187df3435a390245036b115c83feb97495eb0` passed [signing workflow 34624514614](https://github.com/vasavas1977/codex-phone11/actions/runs/34624514614), including the required native, PostgreSQL, application and real prebuild checks. EAS build `73bdf19f-a244-48c0-82e8-58e4a478a8dc` finished using `preview-ios-siprix-wake-pilot`. The verified artifact is version **1.0.0/build 24**, **16,607,040 bytes**, SHA256 `a540c6cf6a3d21b4742a300632cebfa69cadb3734aba2547009f5815fe2dc2a6`. Download content length and ZIP integrity passed.

The actual main executable's signed APNs entitlement and its embedded provisioning profile both specify **production**. The application identity, signing team and certificate match build 23. The app plist contains wake gate **1**, the expected fixed API origin and required background modes. Runtime version `1.0.0-siprix-wake-pilot-1` matches EAS. Updates are disabled, so no update-channel header is embedded; `siprix-wake-pilot` is verified in the selected source profile, not claimed as an embedded artifact value. The plist and build checks establish configuration; the compiled native capability still needs a handset check.

Build 24 is **not installed**. Build **23** remains the latest independently verified installation. No background-call, Apple-delivery or locked-device acceptance is established by this artifact. A presence-only inspection found no configured Siprix license in build 24; no license values were published, and licensed long-call acceptance remains open.

## Commissioning still required

On 12 September, the server-local full backup was restored successfully in an isolated database, and both reviewed call-push/wake migrations passed there. The four additive tables were then applied in one checked production transaction; exact rehearsed schema and unchanged protected phone/account/chat data checks passed. A private loopback-only backend candidate for frozen source `f21e763` is healthy, with authentication schema readiness, unauthenticated rejection and trusted/untrusted CORS checks passing. Its immutable image is `sha256:08635193de6a8f0bc0a5a0d077a112511c30e60baaf5bbb6cfb4491b70446a6b`. Real owner sign-in, unchanged phone provisioning, owner-scoped chat and probe-session revocation checks remain pending; no production backend promotion has occurred. The private candidate was stopped after these checks while legitimate owner credentials are pending.

The live backend remains the earlier deployed source. APNs key settings, the push trigger secret and wake enablement are still absent. The accepted PCMA setting remains on the dedicated public-number route. Ordinary chat-notification work is a separate source change and is not part of these four migrated tables or the frozen candidate.

The signed pilot artifact is verified; install only after the backend/provider prerequisites are ready. Enroll the actual device under the existing owner/session, then enable only the dedicated incoming-number wake path. Require foreground, background and locked-device tests that establish ringing, Answer, two-way hearing, End and Recents, plus caller cancellation, stale/duplicate wake, logout and network recovery. OS-reclaimed and user force-quit cases need separate results.

The installed calling engine still has no production license configured. The vendor trial limits call duration to 60 seconds, so a valid license and long-call acceptance remain required for daily use. Team Chat also needs an explicitly authorized second participant and actual recipient testing. Source implementation and provider acceptance do not close these physical and recipient gates.

## Later daily-use source update — 12 September

The later source adds active-app unread refresh on every tab and removes the demo notification-center, billing and conference routes. Notification settings is unavailable in ordinary builds; in the explicitly selected daily pilot it provides a real permission and enrollment action for the selected workspace.

Ordinary Team Chat alerts use a separate authenticated device registry and atomic message outbox. They use standard APNs alert notifications with generic text and an opaque event identifier; they never use PushKit or a VoIP token. Delivery and notification taps recheck current recipient access. See [the ordinary alert implementation and acceptance limits](../../server/chat-notifications/README.md). Its two new tables have not been applied and are not part of the four-table call-wake migration above.

The explicit `preview-ios-siprix-daily-pilot` profile combines the call and ordinary-message pilot configuration, with its own channel and runtime `1.0.0-siprix-daily-pilot-1`. Existing profiles keep ordinary alerts disabled. Invalid flags or an ordinary-alert pilot without production call-pilot settings fail before signing. Configuration/packaging checks and all three actual Expo prebuild combinations passed. This later source is not in signed build 24 or installed build 23; signing, installation, provider setup and physical acceptance remain separate.


## Verified daily pilot: build 25

The later call/chat source is now signed as build **25**, exact application source `1b004bac738111d1ba7849e627341f641cea3af1`. All required checks and signing passed in [workflow 34633414125](https://github.com/vasavas1977/codex-phone11/actions/runs/34633414125). The downloaded IPA was independently verified against installed build 23: production signed APNs/profile, same signing identity, explicit native call/chat markers 1/1, daily runtime and disabled updates. No Siprix license is configured. Build 25 is not installed and the backend/provider prerequisites above remain open. See [the artifact identity and daily-use acceptance matrix](DAILY-READINESS-20260912.md).
