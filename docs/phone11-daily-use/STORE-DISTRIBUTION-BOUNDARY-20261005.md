# Store distribution boundary — 5 October 2026

The common EAS build profiles are selectable for either mobile platform; an
`ios` settings block and an iOS profile name do not restrict that selection.
`app.config.ts` now refuses `PHONE11_APP_STORE_BUILD=1` when
`EAS_BUILD_PLATFORM=android`, including direct selection of `production` or
`production-ios-siprix-store` for Android. This prevents a store configuration
from describing the ordinary Android binary as the licensed iOS calling build.
The Android bridge remains restricted to the separate foreground trial.

Local configuration evaluation with an unset `EAS_BUILD_PLATFORM` and the
reviewed iOS store path retain their existing license-presence, registered
identity and notification commissioning checks. Presence of a license value
does not establish its validity, redistribution rights or sustained-call
acceptance. No Android store profile or production SDK integration is added.

The desktop commands remain `package:mac:local` and `package:win:local`:
macOS arm64 produces an ad-hoc signed trial `.app`; Windows x64 produces an
unsigned trial directory. The helper uses the 60-second trial SDK. Developer ID
signing/notarization, Windows publisher signing/installer preparation, vendor
distribution terms and device acceptance remain external release prerequisites.

The platform regression checks evaluate checked-in config and settings functions
in a VM with synthetic inputs, block the environment-loader import, and forbid
plugin file access. They produce no app artifact and establish no cloud build,
signing, store submission, provider or device result. Existing Apple and Google
store readiness documents continue to describe the remaining operator gates.
