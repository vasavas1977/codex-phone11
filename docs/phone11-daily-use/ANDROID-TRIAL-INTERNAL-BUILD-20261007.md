# Android foreground trial internal build

The already registered `Phone11 Mobile Native Check` workflow is the manual
entry point. Select the owned integration branch and explicitly enable
`request_internal_android_trial` (default off). All six native-check jobs must
pass before it calls `Phone11 Android foreground trial internal build`, which
also requires the reusable daily-use checks. The called workflow prepares the
fixed `preview-android-siprix-foreground-trial` APK profile and accepts only the
named `EXPO_TOKEN` secret. Pull requests and ordinary native-check dispatches
cannot request signing. No arbitrary profile, source or build inputs are exposed.
Manual prerequisite checkouts bind the dispatch SHA, so later branch movement
cannot substitute a different source for the checks preceding the signed build.
It is a standalone, foreground-only Siprix trial with a 60-second call limit;
Android background wake and store distribution are not enabled.

GitHub does not register a new manual workflow until it exists on the default
branch. The initial direct dispatch returned HTTP 404 and requested no EAS build.
Using the existing registered native-check entry avoids merging this feature
branch merely to register a signing workflow.

The protected runner uses the existing `EXPO_TOKEN`; no key values are printed.
EAS CLI 23.2.0's Android credential setup can generate a missing keystore despite
non-interactive mode. Its `--freeze-credentials` flag is not enforced by that
Android path. The fixed invocation therefore verifies the bytes of the three
inspected CLI credential modules, replaces the provider's mutation setup with
its existing-credential read, and refuses missing/revoked credentials, local
credential files and keystore generation. CLI drift refuses before the build.
The installed CLI files are not modified. A human must configure credentials
for `ai.phone11.mobile.foregroundtrial` separately if they do not already exist.

The pinned package is resolved from pnpm's global module directory, so executable
shell shims are not mistaken for the package entry point. Both EAS output streams
are captured privately; asynchronous CLI errors produce only a fixed public
failure line. Private output is not uploaded as a workflow artifact.

Only a finished build for the exact source SHA, Expo project, Android app identity
and internal trial profile produces a sanitized workflow receipt. Raw EAS
artifact URLs and output are not published. SDK input staging retains its
existing official source and checksum guards.

Source tests, a requested EAS build, a finished EAS result, independent APK
signature/package verification, installation and physical calling acceptance
are separate steps. This workflow does not install anything or commission PBX
routing, wake, unrestricted licensing or Android physical acceptance. Its actual
dispatch and package result must be recorded after source review.
