# Own-avatar profile follow-up

Build 113's own chat avatar correctly opened a profile with its saved photo,
name and email, but the inline view omitted the authenticated extension and
workspace and did not expose the existing photo editor. The follow-up routes
ordinary own-avatar taps to canonical `/profile` details rather than creating
another profile loader. Back returns to the originating conversation.

The details entry carries owner and tenant identifiers. Only the current
authenticated owner and selected workspace accept that entry; the extension
also requires the saved SIP account to match both. Call, conference and
selection-only picker surfaces keep their inline read-only cards. URL entry
preferences do not grant photo capability. Photo actions use the existing
server capability checks, and stale picker results are retired after session
replacement, workspace change or unmount. Unavailable fields are not invented.

Validation on the six-file delta from `e9241df`: 93 worker tests across seven
profile/avatar/photo suites passed; whole-repository TypeScript passed; owned
file lint reported no errors and nine existing test warnings; diff whitespace
checks passed. The lead's seven-suite integration check covering profile,
contacts, call avatars and meeting pickers also passed. Independent GPT-6.1 Sol
high review returned `APPROVE_SOURCE_ONLY` with unchanged file hashes and no
P0–P2 findings.

This source is in signed daily-pilot Build 114 at `d69eede`, and is not in
Build 113. Build 114's original package passed all 22 signed-package checks
and deep strict code signing. Physical profile navigation/photo acceptance
remains required. Preserve Build 113 and the retained rollback packages.
No backend rollout, customer message, meeting invitation or media acceptance
is established by this source follow-up.

The current second-phone test target is the user-confirmed iPhone 13 Pro Max,
extension 1020. The owner approved its registration and re-signing. Apple's
agreement access block cleared, and the official signing workflow updated the
company's active profile to include this phone while retaining the original
two devices and distribution certificate. Re-signed Build 113
(`8eaabd8e-8ee8-4ad8-99b8-c5bce09079f4`) and Build 114
(`695a7dd4-0094-4f58-9a96-f3235d11832d`) both finished. Both replacement
packages passed the native verifier, 22 signed checks, deep strict signatures,
original JavaScript equality, native-byte equality outside code signatures,
unchanged entitlements and three-device profile coverage. The lead also
verified Build 114's receipt, IPA and JavaScript hashes, bundle/version and
deep strict staged signature. Re-signing does not add the Build 114 source
change to Build 113.

After the user reconnected the iPhone 13 (1020), the official install exited
zero. Fresh app readback confirms `space.manus.phone11ai.t20260425073427`,
version `1.0.0`, bundle version `114`. This establishes installation of the
verified Build 114 package from `d69eede`. Official normal launch then exited
zero; signed-in profile/photo behavior and media acceptance remain unverified. The private evidence is
`/var/folders/g2/3tqvv3ds1jbbyz4d9zlmk_y40000gn/T/phone11-install114-13-tztw5xwh/apps-readback.json`.
Before the update attempt, fresh iPhone 17 app readback confirmed the same
bundle, version `1.0.0`, bundle version `113`. After the user confirmed it was
idle, the wireless installation failed with a CoreDevice tunnel timeout.
Build 114 installation there is not confirmed; USB reconnection is requested.
Historical Build 113 acceptance remains separate from pending Build 114
installation and media acceptance.
