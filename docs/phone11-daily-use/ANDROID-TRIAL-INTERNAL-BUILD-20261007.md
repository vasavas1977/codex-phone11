# Android foreground trial internal build

The manual `Phone11 Android foreground trial internal build` workflow prepares
the existing `preview-android-siprix-foreground-trial` APK profile. It is limited
to the owned integration branch and depends on the reusable daily-use checks.
It is a standalone, foreground-only Siprix trial with a 60-second call limit;
Android background wake and store distribution are not enabled.

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
