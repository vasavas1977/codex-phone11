# Phone11 web management and profile photos — 21 September 2026

> Historical source-readiness snapshot. The subsequent deployment and remaining production gates are recorded in [WEB-MANAGEMENT-LIVE-20260921.md](WEB-MANAGEMENT-LIVE-20260921.md). Statements below about no deployment describe the earlier checkpoint.

## Delivered source and ownership

- `78c814c9940857f69c922fee5d458e96c1d609a3`: personal portal uses assigned extensions/numbers and participant-scoped call records; administrator overview requires workspace owner/admin access. Signed-out, denied and failure states are explicit. Billing, support and forwarding do not simulate successful operations.
- `84bf0e858691e7f49cda786c260788ecbc3bdeec`: protected profile-image rendering in chat, profile photo controls and capability-gated Meet icon next to Call. Meet opens the existing admitted conference flow; it does not automatically invite the chat recipient.
- `e78942c`: private photo service passed independent source review after the cleanup fairness correction. `06d2f48` adds immutable CDR owner capture and passed independent source review after the SIP credential-owner correction. Photo reads require current same-workspace membership and use private no-store responses. Uploads are bounded to 2 MiB and 2048 pixels per edge. File cleanup uses durable deletion records and the existing retention lifecycle.
- Personal call history accepts only immutable call-time participant identity. Trusted recording correlation captures new identities; legacy or uncorrelated records remain hidden. Reassigning an extension does not transfer historical access.

Super Number remains responsible for shared company/account identity, invitations, entitlements and billing. Phone11 owns its UC/PBX, devices, calls and internal Team Chat. Cross-product linking requires an explicit reviewed identity/tenant mapping; email/domain similarity is not a mapping. No duplicate shared account or billing service was created.

## Verification recorded in this session

- Integrated local Vitest run: 1,868 passed, 201 skipped, 190 files passed. Database suites ran sequentially because several reset shared fixture tables. Earlier parallel fixture conflicts are not counted as a passing run.
- Separate Node test suite: 69 passed.
- TypeScript checking, backend bundle and Expo static web export passed.
- Browser: signed-out personal portal and administrator states checked; portal navigation checked at 375-pixel width. No authenticated production browser session was tested.
- Final root focused run: 48 passed across photo HTTP/client, chat scope and LiveKit room construction. Photo worker focused run: 32 passed; independent source review approved the corrected snapshot. The broad run above predates the final cleanup correction. Final CDR correction: 27 focused unit tests and 41 isolated PostgreSQL tests passed, plus TypeScript; the earlier native CDR PostgreSQL run passed 8 tests. Independent review accepted the frozen correction.
- Local evidence: `/tmp/phone11-web-qa.z6RwOR/` (temporary, not a durable production acceptance record).

These results prove source behavior and local artifacts only. They do not prove a deployed portal, production migrations, push delivery, media transport or handset behavior.

## Independent source review

Photo review approved `photo.ts` SHA-256 `230e9f1daaefe1b8ad5cc354102d2f0ea505fca112d377dd1fe46873862744ef` after the persistent-directory-error regression. CDR review accepted `correlation.ts` SHA-256 `d92771635c7c1d4a5487751ecab5a10b5bf1ef3f43d17a8bb7e7d320210f10a8` after null/mismatched SIP-owner and split-reassignment coverage. Neither review is deployment or device approval.

## Remaining delivery gates

1. Choose and configure the production static-web origin and its exact trusted authentication origin. The existing marketing site is not proof of a deployed Expo portal. Export with `EXPO_PUBLIC_API_BASE_URL=https://api.phone11.ai` and verify sign-in cookies and cross-origin requests on the chosen origin.
2. Deploy the matching reviewed API and additive photo/CDR migrations. The portal depends on the new self-service API. Photo capability stays unavailable until both photo metadata and deletion tables exist.
3. Preserve the existing worker owner: a workerless API candidate does not run photo retention, notification dispatch or other baseline workers. Follow `PROFILE-DND-HOST-ADMISSION-CONTRACT-20260921.md` before replacing the old baseline. Its first replacement still needs a reviewed all-source initial-INVITE admission control and HTTP mutation boundary; a zero-call snapshot is insufficient.
4. Validate the server-side JPEG/WebP WASM worker dependencies in the actual deployment container. Local Node decoding/bundling is not an Alpine-container result. The local Docker check failed because its daemon was unavailable; no container validation is claimed.
5. Test an authenticated administrator and ordinary user, then a second tenant: own numbers/calls, denied admin access, extension reassignment privacy, photo upload/read/remove and revoked membership.
6. Build and distribute the signed production-mode iPhone update only after the paired service is ready; retain the working Build 80 rollback. Test photos and Meet on both iPhones, including room join, two-way media and lifecycle behavior.

No deployment, production migration, new signed iPhone release or two-phone acceptance was performed for this web/photo integration. Build 80 remains the previously verified signed release; its new conference handset result is still unreported here.
