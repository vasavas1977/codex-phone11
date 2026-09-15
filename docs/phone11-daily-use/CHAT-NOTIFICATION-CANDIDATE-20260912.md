# Chat notification candidate — 12 September 2026

Status: source fix tested; inactive compiled package prepared. This candidate is not deployed and is not part of installed Build 25.

## Change

A recovered account could fail to enroll for message alerts after ten previous device registrations, even when their authentication identities had been retired. Enrollment now clears registrations whose session no longer resolves to the same enabled owner before checking the ten-device quota. Deleting those obsolete registrations also removes their undeliverable outbox entries through the existing foreign key. Valid registrations retain the quota and are not removed.

Files: `server/chat-notifications/repository.ts` and `tests/phone11-chat-notification-postgres.test.ts`.

## Verification

- 24 tests passed against a disposable PostgreSQL database using a private Unix socket and no network listener. Includes deleted, disabled and remapped identities, valid-device quota preservation, outbox cleanup, cross-owner rejection, session revocation, provider invalidation, concurrent dispatch and bounded lock contention.
- 33 separate notification client, provider and server tests passed.
- Backend compilation succeeded. No production data, calls or provider messages were used.

## Inactive package

Location: `/private/tmp/phone11-chat-inactive-mcl_y_h4`.

The bundle includes uncommitted backend changes on base commit `b022f55639d996c2ff06e97bf6a818982d4b7bc5`. Its manifest records every compiled source input hash, output hash, dependency lock and external import. It is a compilation artifact; a production dependency installation/container has not been validated for this package.

- `index.mjs` SHA256: `70ea12163e25cea9215d9024978dd012eb8b9afead6c2fc3154d211938fb3ce7`
- `manifest.safe.json` SHA256: `ae597c7b3b25414246719bfa41a4c870a9dc746323c827911d8097de011dba18`

The package carries the prerequisite chat SQL and separate ordinary-notification SQL. Neither has been applied by this work. Keep this package separate from the already staged VoIP background-call activation.

## Release sequence

1. Review the final source and build an exact-source backend image with validated runtime dependencies. Retain the current image and compose configuration for rollback.
2. Verify the target authentication and chat schema. Apply only the missing reviewed ordinary-notification migration, which creates two tables and indexes; do not blindly replay prerequisite migrations. Its `BEGIN`/`COMMIT` keeps DDL atomic.
3. Deploy with `PHONE11_CHAT_NOTIFICATIONS_ENABLED=0`, preserving the active voice configuration. Check health and authenticated chat access.
4. Verify ordinary APNs configuration and a current app device registration before enabling the flag. Validate one authorized recipient's alert, open-to-conversation behavior and revocation behavior on a physical phone.
5. For rollback, disable the flag and restore the exact previous backend image/configuration if required. Leave newly created tables intact; dropping them would erase device and delivery state. Do not claim delivery based only on compilation or table presence.
