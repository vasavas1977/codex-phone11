# Codex Evaluation — 2026-05-06

## Decision

Do not rebuild Phone11 from scratch. The Manus codebase is a usable alpha foundation for the cloud-phone MVP, especially the Expo app shell, SIP/PBX admin surfaces, Kamailio/FreeSWITCH/RTPEngine configs, Terraform modules, and billing scaffolding.

## What Is Reusable

- Mobile app: Expo Router app with call, contacts, recents, messages, admin, DID, billing, recording, conference, and settings screens.
- Voice core: Kamailio, FreeSWITCH, RTPEngine, DID routing, extension provisioning, CDR processing, and PBX admin APIs.
- Infrastructure: Docker Compose, Kubernetes base manifests, Terraform modules, monitoring dashboards, and deployment guides.
- Billing base: BillRun config and client are present, though not production-live.
- AI base: recording, diarization, analytics, and transcription modules exist and can be wired into the Gemini-first model router from the master plan.

## Critical Corrections Made

- Removed committed Kamailio backup configs that preserved old deployment material.
- Removed the deployment report that contained environment-specific access details.
- Replaced the Kamailio database URL with a placeholder URL.
- Updated `.gitignore` so backup configs do not re-enter source control.
- Changed PBX database access to lazy runtime configuration and allowed the shared `DATABASE_URL` path.
- Changed phone provisioning to reuse the shared PBX database pool.
- Updated the security scrub document to reflect the follow-up cleanup.

## Main Technical Gap

The repo documentation says the mobile SIP stack is JsSIP/WebRTC in several places, but the actual app code uses `react-native-pjsip`. Continue from the actual source, not the older wording.

The current Kamailio media path already uses the important RTPEngine direction from the handoff: `DTLS-reverse=passive` on offer and `DTLS=passive` on answer. RTPEngine documentation says `DTLS-reverse=passive` is specifically for avoiding premature active DTLS attempts, and `ICE-lite=backward` is valid in offer processing. The next live test should validate whether the current deployed config matches this repo config.

Source: https://rtpengine.readthedocs.io/en/latest/ng_control_protocol.html

## Next Engineering Step

1. Deploy the sanitized Kamailio config with real secrets injected at deploy time, not committed.
2. Restart Kamailio/RTPEngine/FreeSWITCH in the test environment.
3. Place one mobile-to-PSTN test call and confirm:
   - call connects,
   - two-way audio works,
   - ringback behavior before answer.
4. If audio works but ringback is silent, add a native local ringback implementation in the app.
5. If audio still fails, capture RTPEngine logs around offer/answer and compare live flags with `infra/configs/kamailio/kamailio.cfg`.

## Product Direction

Proceed with cloud phone first, but keep the full UCC target. The first shippable product should be Phone11 Cloud Phone with AI call transcription and Thai/Bahasa summaries, then meetings/video/chat, then reseller, MVNO, and global DID expansion.
