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

## Exact-source container verification

The follow-up package at `/private/tmp/phone11-chat-4250d98-vzbib2pr` matches committed source `4250d9849d0674b40c66005f0e1d1c26ca3e3660` byte for byte for every compiled input. Manifest SHA256: `98a752e750fc1a7aee9c0a9653127faca678de5e11acc42c537276355e356a7e`. Its bundle hash is unchanged from the earlier working-tree package.

A reviewed overlay on the exact installed backend image passed Node syntax and dynamic import/export checks inside disposable containers with no network, ports, production environment or mounts. Candidate image: `sha256:f9d783428a4f4b78ffa589103f4b12751877bb927a3099905f9734368a587e3a`. The four running phone-service identities, configuration and start state were unchanged after checks and cleanup. Evidence is held at `/opt/phone11ai/chat-inactive-4250d98-1d7be3ba9897/image-check.safe.json`. The service was not launched or deployed; authentication, migration and recipient acceptance are still separate gates.


### Durable deployment helper recovery — 12 September

The lost temporary deployment helper was reconstructed exactly from the original local tool records into the private evidence folder `chat-recovery-private-helpers`. Its SHA256 matches the recorded `48e5e5503ca2169e3902130a92477d84ef6c97da019486483a07263341f94828`; both original isolated test files were restored and passed five plus four tests. No server action ran. The historical helper retains its original activation-helper pin and candidate proxy requirement; it cannot run against the currently rolled-back proxy or newer activation helper. Fresh exact-runtime review and a verified calling baseline are required before updating those pins. Migration is already complete and must not be repeated. Ordinary alerts remain off; no recipient message was sent.


### Reviewed deployment candidate after Build33 calling acceptance

Two consecutive locked33 calls now passed user checks and native connection/termination evidence, and both are saved in app Recents. Background proxy9a62 is active; long10-minute idle test remains pending. Fresh read-only inspection confirms backend e2ce/sourcef21/image0863/runtime2f593, Compose2bcd, candidateimagef9d/source4250, wakeenabled and ordinaryalertsoff. Historical ba8b45 dependency was missing on disk, not inherently invalidated by33; revised helper uses the reviewed33 utility dependency5ec642 without invoking activation functions.

Independent review identified pending push transactions could escape channel/dialog/RTP idle checks. Version2 adds strict actual Kamailio tm.stats current-minus-waiting==0 at each deployment/rollback idle guard and immediately before backend up. Eighteen isolated tests pass independently, including a new pending transaction before rollback. Exact helper SHA2325c370c819bc2ccb3f89746866672a242d1f935ef0f00e72066218992f854b is staged root-private at `/opt/phone11ai/chat-post-build33-tools-721bada/deploy-chat-preserve-wake.private.py`. Its actual readonly dry run succeeded (`chat_deployment_dry_run_ready`,wakePreservedtrue,ordinaryAlertsEnabledfalse). No deployment/runtimechange, migration or message send occurred. Pending longer-idle physical test remains a rollout hold. Future execution must repeat fresh guards; this dry run does not reserve idle state.


### Post-check and manual recovery bundle staged; rollout held

Postdeployment binding verifier SHA180ac00b46e3d0100ccc5ed526ac8ae4e78fcc7e90620435c0d85a5af72960b5 passed independent three-test review. It uses the owned new deployment journal/runtime rather than changing old wake activation evidence. Final manual rollback helper SHA7485b53af744112822094edd54d2f6e8c0833c1de630d080c81688f841d3f62a passed eight tests independently, including stopped/foreign/intervened target and failed compose command after replacement. Both are staged root-private alongside the reviewed deployer at `/opt/phone11ai/chat-post-build33-tools-721bada`. A local hash check refused an intermediate changed helper before any transfer; only final reviewed bytes were staged. No runtime change.

Before deployment, run manual rollback helper mode `capture` with deployer dependency2325, proxy utility5ec642 and proof path `/opt/phone11ai/chat-manual-rollback-after-build33`; this freezes protected-file hashes omitted from the original deployment journal. Do not create rollout stage in advance: deployer stage is `/opt/phone11ai/chat-deploy-4250d98-after-build33`. Then repeat actual idle/dry-run guards and execute the reviewed source/image-only rollout. Postcheck requires a fresh actual Build33 device inventory envelope and verifies new journal/runtime + canonical current binding. Manual mode `check` is read-only after deployed; mode `execute` is reserved for actual owned rollback, uses fresh active-call guards and never overwrites historical deployment records. Neither capture nor rollout has run yet. Current blocker: iPhone USB connection dropped again. A second account is also absent, so two-person message/alert acceptance remains pending. Ordinary alerts are still off.
