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

This source is not in Build 113. A new signed daily-pilot build and physical
profile navigation/photo acceptance remain required. Preserve Build 113 and
the previously retained rollback packages. No backend rollout, Apple device
registration, customer message, meeting invitation or media acceptance is
established by this source follow-up.

The current second-phone test target is the user-confirmed iPhone 13 Pro Max,
extension 1020. Its retained hardware identifier is absent from Build 113's
provisioning profile. Registration and re-signing require the pending owner's
approval before consuming an Apple annual device slot. The earlier iPhone 15
profile match does not establish compatibility for this phone.
