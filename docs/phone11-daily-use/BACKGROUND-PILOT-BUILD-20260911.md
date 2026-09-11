# Background calling pilot build — 11 September 2026

The foreground public-number audio fix has a user-confirmed two-phone result on build 23; see [the audio evidence](PUBLIC-AUDIO-FIX-20260911.md). Background and locked-device calling remain unaccepted.

## Pilot configuration

The separate `preview-ios-siprix-wake-pilot` build profile enables `PHONE11_VOIP_WAKE_COMMISSIONED=1` for the whole native Siprix pod and supplies production APNs metadata to both the app and its entitlements. It inherits the existing application identity and signing profile, with its own update channel and runtime version. The ordinary Siprix build remains disabled. Generated Podfile properties and build environment must agree; mismatches fail before signing.

The signing workflow offers an explicit allowlisted profile choice and retains all existing server/native checks. It also requires the new build-configuration test. `closedAppCalling` remains false until real commissioning evidence justifies changing the availability claim.

## Verified source behavior

Twenty focused plugin, packaging and configuration tests passed, including evaluation of actual Expo mods and the Ruby podspec. A separate review reran all twenty successfully. Actual Expo 54 iOS project generation passed for both disabled and pilot profiles. The pilot generated production APNs entitlements, matching Podfile properties and the early native bootstrap. These checks are not signed-artifact, Apple-delivery or handset background-call proof.

## Commissioning still required

The live server currently has no APNs key settings, no push trigger secret and no enabled wake service. Its backend remains the earlier deployed source. Prepare and independently review the additive push/wake database migration and backend-only deployment with backup, isolated restore rehearsal, exact schema checks, owner probes and rollback. Preserve the accepted PCMA setting on the public-number route.

Verify the signed pilot artifact and install only after the backend/provider prerequisites are ready. Enroll the actual device under the existing owner/session, then enable only the dedicated incoming-number wake path. Require foreground, background and locked-device tests that establish ringing, Answer, two-way hearing, End and Recents, plus caller cancellation, stale/duplicate wake, logout and network recovery. OS-reclaimed and user force-quit cases need separate results.

The installed calling engine still has no production license configured. The vendor trial limits call duration to 60 seconds, so a valid license and long-call acceptance remain required for daily use. Team Chat also needs an explicitly authorized second participant and actual recipient testing. Source implementation and provider acceptance do not close these physical and recipient gates.
