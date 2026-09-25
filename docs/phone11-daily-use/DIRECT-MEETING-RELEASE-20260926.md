# Direct-contact meetings: guarded live candidate

This is a release operator plan, not evidence that direct-contact meetings are live. The reviewed candidate is the direct-meeting port on top of the active Team Chat inbox source. It preserves inbox behavior and uses a new loopback API candidate before moving only the two public tRPC locations.

## Exact current pins and source proof

| Gate | Pin or required observation |
| --- | --- |
| VoIP host | `i-0851dd1ea1cfeef71`, `ap-southeast-7a` |
| Active tRPC predecessor | `cp11-api-candidate-chat-inbox` on `127.0.0.1:3010` |
| Predecessor image | `sha256:55b593f0c392c67bc74589dcae4cb0e36b2f2e6dcd8a3552be781429ed0e2d77` |
| Predecessor source and bundle | `2d125819a7f1713f05b3eaa3bcbf5e5672a84e0c`, `75381c01555e1d924eddc2da2c97a1f1e44224dec5c4f03947518e24f6148b5b` |
| Current Nginx site SHA-256 | `1b9b4c7d89d2c65c6bf8b730decd57513c46194fe21b5470981c7525d0b0ed26` |
| Candidate backend source | `2bbb1ed2e49fb6c1ede1e1aa443eba4fc98238f1` (`codex/phone11-direct-on-inbox-20260926`) |
| Candidate backend bundle SHA-256 | `b42e1b4a88cf063b69aa2faa66fcd944224f5f2f66f4302fdee36513afe3aa74` |
| Candidate build/container/port | `direct-meeting-20260926`, `cp11-api-candidate-direct-meeting`, `127.0.0.1:3011` |

The candidate source must be independently reviewed at the exact SHA and the backend bundle must be reproduced from it. These pins are for the backend bundle. The signed iOS app needs its own source/build/artifact proof; deploying the API does not update either iPhone.

Read-only runtime inspection on active 3010 found the channel-meeting flag enabled with tenant 1 in its parsed tenant list. The server-only Connect11 plain-video configuration parsed as enabled and included tenant 1 with required private fields present and nonempty; no credential or routing values were printed. This is configuration evidence, not a successful admission or two-device call.

At action time, recheck the site bytes/hash, exact and prefix `/api/trpc` locations, predecessor container ID/image/health/port, running bundle, source and lock labels, candidate port absence, PostgreSQL identity/catalog, and the staged artifacts. Stop on any drift. The old 3009 container and its receipt remain retained; the immediate route rollback target is healthy 3010, never 3009.

## Database gate

`server/meetings/direct-meeting-migration.sql` is additive: it gives existing meetings `origin_kind='channel'`, admits `'direct'`, and adds a block-pair revocation trigger. The live catalog currently has the channel and admission tables but no `origin_kind`, so this migration is necessary before direct API activation. It grants no meeting-host permission.

Use `phone11-direct-meetings-migrate.py` as a distinct, reviewed migration operator. Stage the **exact** SQL/operator under a root-owned, `0700` directory; SQL, manifest, backup proof, restore proof, and receipt must be regular root-owned `0600` files. With the immutable active 3010 container ID from action-time inventory, run `--inventory --sql <staged-sql> --container-id <id> --container-name cp11-api-candidate-chat-inbox --container-port 3010 --host-port 3010`. The output contains only identity/catalog fingerprints and release pins. Do not copy protected database environment to the operator host or logs.

Take a fresh protected `pg_dump` backup and rehearse its restore into a **separate PostgreSQL cluster**. Apply the exact SQL in that restored cluster and record the complete after-catalog fingerprint. Seal the operator's exact manifest (`phone11.direct-meetings-migration-manifest/v1`) and matching backup/restore proofs with `pg_dump`/`pg_restore` mechanisms, verified separate-cluster isolation, and freshness within 30 minutes. The manifest binds active container ID/image/port, source/bundle/lock labels, database identity, before/after catalogs, and SQL hash. Run `--prepare`, inspect the output, then `--apply --receipt /var/lib/phone11-direct-meetings/receipt.json`. If apply times out or returns an uncertain result, use `--recover` with that exact receipt; do not retry SQL blindly. The channel migration's separate receipt is already present and must not be overwritten. The direct operator uses the same PostgreSQL advisory key as the earlier channel operator, serializing those DDL paths.

Verify the resulting column type/default/not-null, validated origin constraint, enabled block trigger/function, unchanged existing channel meeting rows, and no unexpected catalog drift. This is a **hosted-database** gate; disposable PostgreSQL tests do not satisfy it. Additive schema rollback is not automatic: route rollback leaves the column/trigger in place pending a separate data-safe decision.

## Image, candidate, route, and rollback gates

After the SQL gate, stage the exact reviewed `index.mjs` as `/opt/phone11ai/direct-meeting-20260926/dist/index.mjs` with its SHA-256 verified. Copy the three new `phone11-direct-meeting-*` operators into a protected staging directory. They are pinned to the active 3010 image/bundle, exact candidate source/bundle, 3011 port, and current Nginx site hash. Review their exact bytes before running. They must not be repointed to another source by changing only their constants without a new review.

1. Run `phone11-direct-meeting-overlay-image.py --bundle-path /opt/phone11ai/direct-meeting-20260926/dist/index.mjs`. It builds offline from the immutable active 3010 image, audits the inherited runtime and single new bundle layer, then prints the candidate image ID. Check the image ID and labels before proceeding.
2. Run `phone11-direct-meeting-release-start.py --image-sha256 <reviewed-64-hex-id>`. It clones the protected 3010 runtime through an inherited memory file descriptor, starts a distinct loopback 3011 candidate, and keeps public tRPC on 3010. Validate its health/build/bundle and authenticated existing `chat.list`, phone, channel-meeting, and direct-meeting calls. Confirm cross-tenant, blocked-contact, revoked-member, and unauthorized-host denials. Do not expose the cloned environment.
3. Run `phone11-direct-meeting-release-route.py inventory`, then `prepare --image-sha256 <same-id>`. Inspect the root-only receipt and exact site diff: only the two tRPC `proxy_pass` lines move from 3010 to 3011; other paths and headers remain unchanged.
4. Run `activate --receipt-dir <prepared-receipt-dir>`. Recheck public authenticated behavior, active Nginx site hash, candidate health, inbox behavior, and tenant boundaries. Retain 3010 running and its original route receipt.
5. If acceptance fails, run `rollback --receipt-dir <same-receipt-dir>`. It requires the sealed active site and healthy pinned 3010 predecessor, restores the exact prior site, validates/reloads Nginx, and records rollback. Site/container drift or failed restoration requires manual review; no blind retry.

## Test account and device gate

Tenant 1 already has a direct chat `6e56c486-cec8-495a-8861-4b2433862206` containing user IDs 1 and 2 (extensions 3001 and 1020). Both direct host grants are currently false. After database/API rollout, the owner/admin can enable **both** in Admin → Meeting hosting → Direct chats; verify each grant and the direct capabilities for each user. The Test **channel** currently open on the iPhone 15 Pro Max is not this direct chat. Open the exact direct chat on both signed current iPhone builds, start and join in both directions, then check invitation delivery, two-way audio/video, block/revoke, app background/reopen, and call coexistence. A source test, browser preview, token, or one-phone join does not prove the two-device result.
