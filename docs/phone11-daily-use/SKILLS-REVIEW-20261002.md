# Relevant skill review

Reviewed the available catalog, relevant installed Connect11/LiveKit/Zoom skill
files, and first-party repositories linked through [skills.sh](https://skills.sh/official).
No skills or dependencies were installed. Unrelated creative/document skills
were cataloged, not loaded into this bug-fix context.

- Connect11's local SDK skill simplifies HTTP 402 to an empty wallet. The deployed
  plain-video contract distinguishes missing wallet, insufficient balance and
  expired trial. Follow the verified endpoint contract; do not prescribe arbitrary
  top-up or bypass the protected admission facade.
- [LiveKit's official skills](https://github.com/livekit/agent-skills) now provide
  focused documentation/build/debug/test guidance. Agent skills do not repair a
  human-meeting token gate; apply the relevant guidance when agent work resumes.
- [Expo's official skills](https://github.com/expo/skills) distinguish internal
  dev-client testing from production releases. Preserve Phone11's signed native
  pilot and real-device acceptance; do not substitute Expo Go or Metro.
- [Resend's official skills](https://github.com/resend/resend-skills) emphasize
  server-only keys, returned error handling, idempotency and webhook verification.
  Provider acceptance is separate from recipient delivery.
- Installed Zoom webhook quickstart declares `payload` twice in one block. Do
  not copy it verbatim; event integrations also require freshness/replay and
  idempotency handling. Zoom API guidance is separate from Zoom-style product UX.

These findings inform the ongoing work without changing billing, provider
configuration, signed mobile artifacts or project release boundaries.
