# Second handset account: extension 1020

Owner authorized moving secondary extension 1020 to a separate test login. Completed 16 September 2026.

- New canonical user 2 and explicit Better Auth identity; ordinary user role, same Phone11 workspace 1.
- Extension 1020, its sole membership, and canonical SIP account now belong to user 2; primary for that user.
- Retired duplicate SIP row; rotated subscriber, extension and encrypted SIP credentials together in one transaction. Added unique active SIP account index per tenant/extension after checking global duplicate inventory.
- Original user 1 retains primary 3001. Transaction compared its full extension and SIP rows before/after; unchanged. Post-check shows one active SIP row for each extension and matching ownership.
- Before transfer, 1020 had no call legs/recordings or push device registration. No historical data moved.
- Removed owner fallback that could reclaim 1020 without explicit assignment; regression tests cover normal 3001 provisioning and refusal to reclaim.

## Deployment

Targeted bundle rebuilt from live source 5d67771fca833ca3675c9f49066b97ac03c4fab2 with only fallback removal. Rebuild matches exact patched live artifact byte-for-byte.

Before SHA256: d32b1df82341adba985429f32a5977937a88cbdca048a5f1d4ff01308a2477ae
After SHA256: 4dc3541bacad110dd51b750539240df8011da6603a685859da361a35fac0374e

Backend container restarted and API health passed. Patched image `phone11-backend:owner-fallback-fixed-20260916` also tagged to existing deployment image name `phone11-backend:summary-tools-5d67771` for recreation. Previous image retained as `phone11-backend:before-owner-fallback-fix-20260916`. Health build field retains base source SHA, so bundle hash is the evidence for this patch. Do not roll back to unsafe fallback after reassignment.

## Verification

- Focused provisioning tests: 2 passed; agent reported TypeScript passed.
- Real authenticated email sign-in HTTP 200.
- `phone.getConfig`: configured true, extension 1020, tenant 1.
- `chat.list`: Phone11 workspace visible.
- `chat.directory`: original user visible at extension 3001.
- Verification sessions signed out. No Team messages or calls sent by these probes.
- Credential handoff is a private local file outside the repository. Temporary password/hash/rollback credential copies removed after verification.

Handset sign-in, reciprocal chat delivery, app-to-app audio, and background alerts remain separate physical acceptance checks. Existing SIP encryption key fallback remains deployment debt; no global key change was made during this account transfer.
